"""API 인증 의존성.

- require_user : Supabase 로그인 토큰(ES256, JWKS)을 로컬 검증하고 허용된 사용자 1명만 통과시킨다.
- require_cron : Vercel Cron 전용. Authorization: Bearer <CRON_SECRET>.

환경변수: SUPABASE_URL, ALLOWED_USER_EMAIL, CRON_SECRET
"""
import logging
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Optional

import httpx
import jwt
from dotenv import load_dotenv
from fastapi import Header, HTTPException

load_dotenv(Path(__file__).parent.parent / ".env")
load_dotenv()

logger = logging.getLogger(__name__)

ALLOWED_ALGORITHMS = ["ES256"]
AUDIENCE = "authenticated"
JWKS_TTL_SECONDS = 3600            # 캐시 유효 시간
JWKS_REFRESH_COOLDOWN = 10         # 알 수 없는 kid 로 인한 강제 재조회 최소 간격(초)
LEEWAY_SECONDS = 10                # 서버 간 시계 오차 허용

_lock = threading.Lock()
_keys: dict = {}
_fetched_at: float = 0.0


def _unauthorized(detail: str = "인증이 필요합니다") -> HTTPException:
    return HTTPException(status_code=401, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def _supabase_url() -> str:
    return os.getenv("SUPABASE_URL", "").rstrip("/")


def _fetch_jwks() -> dict:
    """Supabase 공개 JWKS 조회 (테스트에서 대체)."""
    res = httpx.get(f"{_supabase_url()}/auth/v1/.well-known/jwks.json", timeout=5.0)
    res.raise_for_status()
    return res.json()


def _refresh_keys() -> None:
    global _keys, _fetched_at
    data = _fetch_jwks()
    _keys = {k["kid"]: k for k in data.get("keys", []) if k.get("kid")}
    _fetched_at = time.monotonic()


def _get_signing_key(kid: str):
    """캐시된 JWKS 에서 kid 에 맞는 공개 키를 반환.
    알 수 없는 kid 면 (이번 호출에서 이미 새로 받은 게 아니라면) 1회 재조회하고, 그래도 없으면 None."""
    with _lock:
        just_fetched = False
        if not _keys or time.monotonic() - _fetched_at > JWKS_TTL_SECONDS:
            _refresh_keys()
            just_fetched = True
        if kid not in _keys and not just_fetched \
                and time.monotonic() - _fetched_at >= JWKS_REFRESH_COOLDOWN:
            _refresh_keys()
        jwk = _keys.get(kid)
    return jwt.PyJWK.from_dict(jwk).key if jwk else None


def _extract_bearer(authorization: Optional[str]) -> str:
    if not authorization:
        raise _unauthorized()
    parts = authorization.split(" ")
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1]:
        raise _unauthorized("Authorization 헤더 형식이 올바르지 않습니다")
    return parts[1]


def require_user(authorization: Optional[str] = Header(default=None)) -> dict:
    token = _extract_bearer(authorization)

    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        raise _unauthorized("유효하지 않은 토큰입니다")
    kid = header.get("kid")
    if header.get("alg") not in ALLOWED_ALGORITHMS or not kid:
        raise _unauthorized("유효하지 않은 토큰입니다")

    try:
        key = _get_signing_key(kid)
    except Exception as e:                                   # JWKS 조회 실패 — 검증 불가이므로 거부
        logger.error("JWKS 조회 실패: %s", e)
        raise HTTPException(status_code=503, detail="인증 서버를 확인할 수 없습니다")
    if key is None:
        raise _unauthorized("유효하지 않은 토큰입니다")

    try:
        claims = jwt.decode(
            token, key,
            algorithms=ALLOWED_ALGORITHMS,
            audience=AUDIENCE,
            issuer=f"{_supabase_url()}/auth/v1",
            leeway=LEEWAY_SECONDS,
            options={"require": ["exp", "aud", "iss", "sub"]},
        )
    except jwt.PyJWTError as e:
        logger.info("토큰 검증 실패: %s", type(e).__name__)
        raise _unauthorized("유효하지 않거나 만료된 토큰입니다")

    allowed = os.getenv("ALLOWED_USER_EMAIL", "").strip().lower()
    email = str(claims.get("email") or "").strip().lower()
    if not allowed:
        logger.error("ALLOWED_USER_EMAIL 이 설정되지 않아 모든 요청을 거부합니다")
    if not allowed or not email or not secrets.compare_digest(email.encode(), allowed.encode()):
        raise HTTPException(status_code=403, detail="허용되지 않은 계정입니다")
    return claims


def require_cron(authorization: Optional[str] = Header(default=None)) -> None:
    secret = os.getenv("CRON_SECRET", "")
    if not secret:
        logger.error("CRON_SECRET 이 설정되지 않아 크론 호출을 거부합니다")
        raise _unauthorized()
    token = _extract_bearer(authorization)
    if not secrets.compare_digest(token.encode(), secret.encode()):
        raise _unauthorized()
