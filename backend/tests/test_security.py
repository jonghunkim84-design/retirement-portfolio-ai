"""API 인증·크론 보호·서버 키 필수 테스트 (지시서 S1 단계 B).

- 토큰 검증: 없음/형식 오류/만료/aud·iss 불일치/서명 불일치/알고리즘 위조 → 401, 허용되지 않은 이메일 → 403, 허용된 사용자 → 200
- JWKS: 캐시, 알 수 없는 kid 는 1회 재조회 후 실패, 키 교체 시 재조회로 통과
- 크론: 시크릿 없음·불일치 → 401, 일치 → 통과
- main.app 의 모든 라우트가 인증 없이는 401 (예외 /health 만 공개)
- SUPABASE_SERVICE_KEY 미설정 시 시작 실패 (anon 키로 대체하지 않음)

운영 서비스에 접속하지 않는다 (JWKS 는 가짜, DB 는 conftest 의 더미 값).
실행: backend/ 디렉터리에서 `pytest tests/test_security.py -v`
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import importlib.util
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import Depends, FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

import auth

SUPABASE_URL = os.environ["SUPABASE_URL"]
ISS = f"{SUPABASE_URL}/auth/v1"
OWNER = os.environ["ALLOWED_USER_EMAIL"]
CRON = os.environ["CRON_SECRET"]


# ── 테스트용 서명 키 / 토큰 ───────────────────────────────────────

class Signer:
    def __init__(self, kid):
        self.kid = kid
        self.private = ec.generate_private_key(ec.SECP256R1())

    def jwk(self):
        d = jwt.algorithms.ECAlgorithm.to_jwk(self.private.public_key(), as_dict=True)
        return {**d, "kid": self.kid, "alg": "ES256", "use": "sig"}

    def token(self, *, email=OWNER, aud="authenticated", iss=ISS, exp_delta=3600,
              alg="ES256", kid="__default__", drop=(), extra=None):
        now = int(time.time())
        claims = {"sub": "user-1", "aud": aud, "iss": iss, "iat": now, "exp": now + exp_delta}
        if email is not None:
            claims["email"] = email
        claims.update(extra or {})
        for k in drop:
            claims.pop(k, None)
        headers = {"kid": self.kid if kid == "__default__" else kid}
        return jwt.encode(claims, self.private, algorithm=alg, headers=headers)


@pytest.fixture
def signer():
    return Signer("kid-1")


@pytest.fixture
def jwks(monkeypatch, signer):
    """가짜 JWKS 서버. state['keys'] 를 바꾸면 다음 조회에 반영되고 조회 횟수를 센다."""
    state = {"keys": [signer.jwk()], "calls": 0, "fail": False}

    def fake_fetch():
        state["calls"] += 1
        if state["fail"]:
            raise RuntimeError("network down")
        return {"keys": state["keys"]}

    monkeypatch.setattr(auth, "_fetch_jwks", fake_fetch)
    monkeypatch.setattr(auth, "_keys", {})
    monkeypatch.setattr(auth, "_fetched_at", 0.0)
    monkeypatch.setattr(auth, "JWKS_REFRESH_COOLDOWN", 0)
    return state


@pytest.fixture
def mini_client(jwks):
    """require_user 만 붙인 최소 앱 — 허용된 사용자 200 을 DB 없이 확인."""
    app = FastAPI()

    @app.get("/secret", dependencies=[Depends(auth.require_user)])
    def secret():
        return {"ok": True}

    return TestClient(app)


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


# ── require_user: 401 ────────────────────────────────────────────

def test_no_authorization_header_401(mini_client):
    r = mini_client.get("/secret")
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize("header", ["Basic abc", "Bearer", "Bearer ", "Bearer a b", "token", ""])
def test_malformed_authorization_header_401(mini_client, header):
    assert mini_client.get("/secret", headers={"Authorization": header}).status_code == 401


def test_garbage_token_401(mini_client):
    assert mini_client.get("/secret", headers=bearer("not.a.jwt")).status_code == 401


def test_expired_token_401(mini_client, signer):
    tok = signer.token(exp_delta=-3600)
    assert mini_client.get("/secret", headers=bearer(tok)).status_code == 401


def test_wrong_audience_401(mini_client, signer):
    assert mini_client.get("/secret", headers=bearer(signer.token(aud="anon"))).status_code == 401


def test_wrong_issuer_401(mini_client, signer):
    tok = signer.token(iss="https://evil.supabase.co/auth/v1")
    assert mini_client.get("/secret", headers=bearer(tok)).status_code == 401


@pytest.mark.parametrize("missing", ["exp", "aud", "iss", "sub"])
def test_missing_required_claim_401(mini_client, signer, missing):
    assert mini_client.get("/secret", headers=bearer(signer.token(drop=(missing,)))).status_code == 401


def test_signature_from_other_key_401(mini_client, jwks):
    attacker = Signer("kid-1")          # 같은 kid 를 쓰지만 개인키가 다름
    assert mini_client.get("/secret", headers=bearer(attacker.token())).status_code == 401


def test_hs256_token_rejected(mini_client):
    """알고리즘 혼동 공격: HS256 으로 서명된 토큰은 kid 가 맞아도 거부."""
    tok = jwt.encode({"sub": "x", "aud": "authenticated", "iss": ISS, "email": OWNER,
                      "exp": int(time.time()) + 3600}, "secret" * 8, algorithm="HS256",
                     headers={"kid": "kid-1"})
    assert mini_client.get("/secret", headers=bearer(tok)).status_code == 401


def test_alg_none_rejected(mini_client):
    tok = jwt.encode({"sub": "x", "aud": "authenticated", "iss": ISS, "email": OWNER,
                      "exp": int(time.time()) + 3600}, None, algorithm="none", headers={"kid": "kid-1"})
    assert mini_client.get("/secret", headers=bearer(tok)).status_code == 401


def test_token_without_kid_401(mini_client, signer):
    tok = jwt.encode({"sub": "x", "aud": "authenticated", "iss": ISS, "email": OWNER,
                      "exp": int(time.time()) + 3600}, signer.private, algorithm="ES256")
    assert mini_client.get("/secret", headers=bearer(tok)).status_code == 401


# ── require_user: 403 / 200 ──────────────────────────────────────

def test_valid_token_other_email_403(mini_client, signer):
    assert mini_client.get("/secret", headers=bearer(signer.token(email="intruder@example.com"))).status_code == 403


def test_valid_token_without_email_403(mini_client, signer):
    assert mini_client.get("/secret", headers=bearer(signer.token(email=None))).status_code == 403


def test_allowed_user_200(mini_client, signer):
    r = mini_client.get("/secret", headers=bearer(signer.token()))
    assert r.status_code == 200 and r.json() == {"ok": True}


def test_allowed_email_is_case_insensitive(mini_client, signer):
    assert mini_client.get("/secret", headers=bearer(signer.token(email=OWNER.upper()))).status_code == 200


def test_allowed_email_unset_denies_everyone(mini_client, signer, monkeypatch):
    monkeypatch.delenv("ALLOWED_USER_EMAIL")
    assert mini_client.get("/secret", headers=bearer(signer.token())).status_code == 403


# ── JWKS 캐시 / kid 처리 ─────────────────────────────────────────

def test_jwks_is_cached_between_requests(mini_client, signer, jwks):
    for _ in range(3):
        assert mini_client.get("/secret", headers=bearer(signer.token())).status_code == 200
    assert jwks["calls"] == 1


def test_unknown_kid_refetches_once_then_fails(mini_client, signer, jwks):
    assert mini_client.get("/secret", headers=bearer(signer.token())).status_code == 200
    assert jwks["calls"] == 1
    stranger = Signer("kid-unknown")
    assert mini_client.get("/secret", headers=bearer(stranger.token())).status_code == 401
    assert jwks["calls"] == 2            # 정확히 1회 재조회


def test_unknown_kid_on_cold_cache_fetches_only_once(mini_client, jwks):
    stranger = Signer("kid-unknown")
    assert mini_client.get("/secret", headers=bearer(stranger.token())).status_code == 401
    assert jwks["calls"] == 1            # 방금 새로 받은 캐시라 다시 조회하지 않음


def test_key_rotation_picked_up_by_refetch(mini_client, signer, jwks):
    assert mini_client.get("/secret", headers=bearer(signer.token())).status_code == 200
    new = Signer("kid-2")
    jwks["keys"] = [signer.jwk(), new.jwk()]
    assert mini_client.get("/secret", headers=bearer(new.token())).status_code == 200
    assert jwks["calls"] == 2


def test_refetch_cooldown_limits_forced_refresh(mini_client, signer, jwks, monkeypatch):
    monkeypatch.setattr(auth, "JWKS_REFRESH_COOLDOWN", 3600)
    assert mini_client.get("/secret", headers=bearer(signer.token())).status_code == 200
    stranger = Signer("kid-unknown")
    for _ in range(3):
        assert mini_client.get("/secret", headers=bearer(stranger.token())).status_code == 401
    assert jwks["calls"] == 1            # 무작위 kid 로 JWKS 조회를 유발할 수 없음


def test_jwks_fetch_failure_is_denied(mini_client, signer, jwks):
    jwks["fail"] = True
    assert mini_client.get("/secret", headers=bearer(signer.token())).status_code == 503


# ── 크론 보호 ────────────────────────────────────────────────────

def test_cron_without_header_401():
    with pytest.raises(auth.HTTPException) as e:
        auth.require_cron(authorization=None)
    assert e.value.status_code == 401


@pytest.mark.parametrize("value", ["Bearer wrong-secret", "Bearer ", "Basic x", CRON])
def test_cron_wrong_secret_401(value):
    with pytest.raises(auth.HTTPException) as e:
        auth.require_cron(authorization=value)
    assert e.value.status_code == 401


def test_cron_correct_secret_passes():
    assert auth.require_cron(authorization=f"Bearer {CRON}") is None


def test_cron_secret_unset_denies_even_empty_bearer(monkeypatch):
    monkeypatch.delenv("CRON_SECRET")
    for value in (f"Bearer {CRON}", "Bearer x", None):
        with pytest.raises(auth.HTTPException) as e:
            auth.require_cron(authorization=value)
        assert e.value.status_code == 401


# ── main.app 전체 라우트 보호 ────────────────────────────────────

@pytest.fixture(scope="module")
def app_client():
    import main
    return main.app, TestClient(main.app, raise_server_exceptions=False)


def _api_routes(app):
    for route in app.routes:
        if isinstance(route, APIRoute):
            for method in route.methods - {"HEAD", "OPTIONS"}:
                yield method, route.path


def test_every_route_requires_auth_except_health(app_client):
    app, client = app_client
    checked, open_paths = 0, set()
    for method, path in _api_routes(app):
        url = path
        for seg in [s for s in path.split("/") if s.startswith("{")]:
            url = url.replace(seg, "1")
        r = client.request(method, url)
        checked += 1
        if r.status_code != 401:
            open_paths.add((method, path, r.status_code))
    assert checked > 60, "라우트를 충분히 순회하지 못했습니다"
    assert open_paths == {("GET", "/health", 200)}


def test_docs_disabled_on_vercel(monkeypatch):
    """VERCEL 환경에서는 /docs·/openapi.json 을 공개하지 않는다."""
    spec = importlib.util.spec_from_file_location(
        "main_vercel_probe", os.path.join(os.path.dirname(__file__), "..", "main.py"))
    monkeypatch.setenv("VERCEL", "1")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    c = TestClient(mod.app)
    assert c.get("/docs").status_code == 404
    assert c.get("/openapi.json").status_code == 404


def test_alert_daily_uses_cron_secret_not_user_token(app_client, signer, jwks, monkeypatch):
    import main
    monkeypatch.setattr(main, "run_daily_alert", lambda: {"ok": True})
    _, client = app_client
    assert client.get("/alert/daily").status_code == 401
    assert client.get("/alert/daily", headers=bearer("wrong")).status_code == 401
    assert client.get("/alert/daily", headers=bearer(signer.token())).status_code == 401    # 사용자 토큰으로는 불가
    r = client.get("/alert/daily", headers=bearer(CRON))
    assert r.status_code == 200 and r.json() == {"ok": True}


def test_alert_test_and_deactivate_require_user(app_client, signer, jwks):
    _, client = app_client
    for method, path in (("POST", "/alert/test"), ("POST", "/assets/deactivate-expired")):
        assert client.request(method, path).status_code == 401
        assert client.request(method, path, headers=bearer(CRON)).status_code == 401
        assert client.request(method, path, headers=bearer(signer.token(email="x@example.com"))).status_code == 403


# ── 서버 전용 키 필수 ────────────────────────────────────────────

def _load_database_fresh(monkeypatch):
    """database.py 를 별도 모듈로 새로 실행 (기존 모듈·전역 상태를 건드리지 않음).
    .env 파일 재로딩으로 환경이 되살아나지 않도록 load_dotenv 를 무력화한다."""
    monkeypatch.setattr("dotenv.load_dotenv", lambda *a, **k: False)
    spec = importlib.util.spec_from_file_location(
        "database_probe", os.path.join(os.path.dirname(__file__), "..", "database.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_startup_fails_without_service_key(monkeypatch):
    monkeypatch.delenv("SUPABASE_SERVICE_KEY")
    with pytest.raises(RuntimeError, match="SUPABASE_SERVICE_KEY"):
        _load_database_fresh(monkeypatch)


def test_startup_does_not_fall_back_to_anon_key(monkeypatch):
    monkeypatch.delenv("SUPABASE_SERVICE_KEY")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key-must-not-be-used")
    with pytest.raises(RuntimeError):
        _load_database_fresh(monkeypatch)


def test_startup_fails_without_url(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL")
    with pytest.raises(RuntimeError, match="SUPABASE_URL"):
        _load_database_fresh(monkeypatch)


def test_startup_ok_with_service_key(monkeypatch):
    mod = _load_database_fresh(monkeypatch)
    assert mod.SUPABASE_KEY == os.environ["SUPABASE_SERVICE_KEY"]
