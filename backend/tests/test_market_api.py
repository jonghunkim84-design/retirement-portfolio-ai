"""시장·노출 API 테스트 (지시서 04 단계 E) — 가짜 Supabase·인증 override, 운영 DB·네트워크 접근 없음.

- /market/series, /market/series/{code}/history, /market/regime, /market/refresh(사용자·크론 분리)
- /exposure, /exposure/scenario(프리셋·직접 입력·422·DB 쓰기 없음), /exposure/signals
- R-04 lookback_days 검증, /decision-engine/run 의 market_input 확장(기존 형식 호환)
실행: backend/ 디렉터리에서 `pytest tests/test_market_api.py -v`
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

import main
import market_store as store
import routers.exposure as exr
import routers.market as mkt
from auth import require_user
from ips_rules_validation import validate_parameters
from routers.decision_engine import MarketInput, _market_input_dict

AS_OF = date(2026, 9, 18)
CRON = os.environ["CRON_SECRET"]


class _Res:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, db, name):
        self.db, self.name, self.mode, self.filters, self.orders = db, name, "select", [], []
        self.rng, self.payload = None, None

    def select(self, *_): return self
    def eq(self, c, v): self.filters.append(lambda r: r.get(c) == v); return self
    def in_(self, c, vs): self.filters.append(lambda r: r.get(c) in vs); return self
    def gte(self, c, v): self.filters.append(lambda r: r.get(c) is not None and str(r[c]) >= str(v)); return self
    def lte(self, c, v): self.filters.append(lambda r: r.get(c) is not None and str(r[c]) <= str(v)); return self
    def order(self, c, desc=False): self.orders.append(c); return self
    def range(self, a, b): self.rng = (a, b); return self
    def insert(self, p): self.mode, self.payload = "insert", p; return self
    def update(self, p): self.mode, self.payload = "update", p; return self
    def upsert(self, p, on_conflict=None): self.mode, self.payload = "upsert", p; return self
    def delete(self): self.mode = "delete"; return self

    def execute(self):
        self.db.modes.append((self.name, self.mode))
        rows = self.db.tables.setdefault(self.name, [])
        out = [r for r in rows if all(f(r) for f in self.filters)]
        for c in reversed(self.orders):
            out = sorted(out, key=lambda r: r.get(c))
        if self.rng:
            out = out[self.rng[0]: self.rng[1] + 1]
        return _Res([dict(r) for r in out])


class MDB:
    def __init__(self):
        self.tables, self.modes = {}, []

    def table(self, name):
        return _Q(self, name)

    def writes(self):
        return [m for m in self.modes if m[1] != "select"]


def series_row(code, category, frequency="daily", is_proxy=False, name=None):
    return {"code": code, "name": name or code, "category": category, "frequency": frequency, "currency": None,
            "unit": "level", "is_proxy": is_proxy, "enabled": True, "note": None,
            "sources": [{"source": "fdr", "symbol": code}]}


def daily(code, start, end, fn):
    rows, d, i = [], start, 0
    while d <= end:
        rows.append({"series_code": code, "obs_date": d.isoformat(), "value": fn(i, d), "flag": None, "source": "fdr"})
        d += timedelta(days=1)
        i += 1
    return rows


def dd_obs(code, dd):
    return daily(code, date(2025, 9, 1), AS_OF, lambda i, d: 100.0 if d < AS_OF else 100.0 * (1 - dd))


def A(id_, typ, value, maturity=None):
    return {"id": id_, "asset_name": f"자산{id_}", "account_name": "계좌", "asset_type": typ,
            "current_value": value, "is_active": True, "maturity_date": maturity}


RULES = [
    {"rule_code": "R-01", "enabled": True, "parameters": {"min_years": 2, "target_years": 3}},
    {"rule_code": "R-02", "enabled": True, "parameters": {"target_years": 5}},
    {"rule_code": "R-04", "enabled": True, "parameters": {"drawdown_threshold": 0.15, "lookback_days": 365}},
    {"rule_code": "R-05", "enabled": True, "parameters": {"upper_multiplier": 1.2, "cut_ratio": 0.1}},
    {"rule_code": "R-06", "enabled": True, "parameters": {"lower_multiplier": 0.8, "raise_ratio": 0.1}},
]


@pytest.fixture
def mdb(monkeypatch):
    db = MDB()
    monkeypatch.setattr(mkt, "supabase", db)
    monkeypatch.setattr(exr, "supabase", db)
    t = db.tables
    t["market_series"] = [series_row("KS11", "equity_index"), series_row("US500", "equity_index"),
                          series_row("KR_10Y", "rate"), series_row("USD_KRW", "fx")]
    t["market_observations"] = (dd_obs("KS11", 0.10) + dd_obs("US500", 0.20)
                                + daily("KR_10Y", date(2026, 1, 1), AS_OF, lambda i, d: 3.0 if d <= date(2026, 8, 18) else 3.4)
                                + daily("USD_KRW", date(2026, 1, 1), AS_OF, lambda i, d: 1400.0))
    t["region_benchmarks"] = [{"region": "한국", "series_code": "KS11"}, {"region": "미국", "series_code": "US500"}]
    t["assets"] = [A(1, "cash", 40_000_000), A(2, "bond", 60_000_000, "2031-09-18"), A(3, "equity", 60_000_000),
                   A(4, "equity", 40_000_000)]
    t["holding_profiles"] = [
        {"holding_id": 2, "bucket": None, "bond_modified_duration": 5.0, "currency": "KRW", "fx_hedged": False},
        {"holding_id": 3, "bucket": None, "region": " 한국 ", "currency": "KRW", "fx_hedged": False},
        {"holding_id": 4, "bucket": None, "region": "미국", "currency": "USD", "fx_hedged": False}]
    t["cashflow_items"] = [{"id": 1, "item_type": "expense_essential", "name": "필수", "monthly_amount": 2_000_000,
                            "inflation_linked": True, "start_date": None, "end_date": None}]
    t["withdrawal_baseline"], t["withdrawals"] = [], []
    t["ips_rules"] = [dict(r) for r in RULES]
    return db


@pytest.fixture
def client(mdb):
    main.app.dependency_overrides[require_user] = lambda: {"email": "owner@example.com"}
    yield TestClient(main.app, raise_server_exceptions=False)
    main.app.dependency_overrides.pop(require_user, None)


def get(client, path, **params):
    r = client.get(path, params={"as_of": AS_OF.isoformat(), **params})
    assert r.status_code == 200, r.text
    return r.json()


# ══ /market/series ════════════════════════════════════════════════

def test_series_list_has_meta_summary_and_no_writes(client, mdb):
    body = get(client, "/market/series")
    by = {s["code"]: s for s in body["series"]}
    assert set(by) == {"KS11", "US500", "KR_10Y", "USD_KRW"} and body["provenance"] == "observed"
    assert by["KS11"]["latest_value"] == 90.0 and by["KS11"]["stale"] is False and by["KS11"]["sources"] == ["fdr"]
    assert by["KS11"]["drawdown"]["value"] == pytest.approx(0.10)
    assert by["KR_10Y"]["change_1m"]["unit"] == "pp" and by["KR_10Y"]["change_1m"]["value"] == pytest.approx(0.4)
    assert mdb.writes() == []


def test_series_marks_stale_when_old(client, mdb):
    mdb.tables["market_observations"] = daily("KS11", date(2025, 9, 1), AS_OF - timedelta(days=9), lambda i, d: 100.0)
    s = {x["code"]: x for x in get(client, "/market/series")["series"]}
    assert s["KS11"]["stale"] is True and s["US500"]["latest_value"] is None and s["US500"]["reason"] == "no_data"


def test_series_lookback_comes_from_r04_and_defaults_to_365(client, mdb):
    assert get(client, "/market/series")["lookback_days"] == 365
    for r in mdb.tables["ips_rules"]:
        if r["rule_code"] == "R-04":
            r["parameters"] = {"drawdown_threshold": 0.15, "lookback_days": 180}
    assert get(client, "/market/series")["lookback_days"] == 180
    mdb.tables["ips_rules"] = [r for r in mdb.tables["ips_rules"] if r["rule_code"] != "R-04"]
    body = get(client, "/market/series")
    assert body["lookback_days"] == 365


def test_observations_loaded_across_pages_beyond_1000_rows(mdb):
    mdb.tables["market_observations"] = daily("KS11", date(2023, 9, 1), AS_OF, lambda i, d: 100.0 + i)     # 약 1,110행
    out = store.load_observations(mdb, ["KS11"], date(2023, 9, 1), AS_OF)
    assert len(out["KS11"]) == (AS_OF - date(2023, 9, 1)).days + 1 > 1000


# ══ /market/series/{code}/history ═════════════════════════════════

def test_history_range_order_and_flag(client, mdb):
    mdb.tables["market_observations"][-1]["flag"] = "x"
    r = client.get("/market/series/KS11/history", params={"as_of": AS_OF.isoformat(), "days": 10})
    body = r.json()
    dates = [p["date"] for p in body["points"]]
    assert dates == sorted(dates) and dates[0] >= (AS_OF - timedelta(days=10)).isoformat() and dates[-1] == AS_OF.isoformat()
    assert len(dates) == 11 and body["series"]["code"] == "KS11" and body["provenance"] == "observed"


def test_history_unknown_code_404_and_bad_days_422(client):
    assert client.get("/market/series/NOPE/history").status_code == 404
    assert client.get("/market/series/KS11/history", params={"days": 0}).status_code == 422
    assert client.get("/market/series/KS11/history", params={"days": 1096}).status_code == 422


# ══ /market/regime ════════════════════════════════════════════════

def test_regime_weighted_drawdown_judgement_and_suggested_input(client, mdb):
    body = get(client, "/market/regime")
    assert body["weighted_drawdown"] == pytest.approx((60 * 0.10 + 40 * 0.20) / 100)               # 지역 값의 공백은 제거되어 매칭
    assert body["judgement"]["status"] == "normal" and body["rule"] == {"enabled": True, "threshold": 0.15}      # 14% < 15%
    mdb.tables["ips_rules"][2]["parameters"] = {"drawdown_threshold": 0.14, "lookback_days": 365}
    assert get(client, "/market/regime")["judgement"]["status"] == "downturn"                                  # 경계값과 같으면 하락 국면
    s = body["suggested_input"]
    assert s["source"] == "auto" and s["lookback_days"] == 365 and s["unreliable"] is False
    assert {c["region"] for c in s["components"]} == {"한국", "미국"} and s["data_date"] == AS_OF.isoformat()
    assert mdb.writes() == []


def test_regime_below_threshold_is_normal_and_unreliable_flag(client, mdb):
    mdb.tables["ips_rules"][2]["parameters"] = {"drawdown_threshold": 0.5}
    body = get(client, "/market/regime")
    assert body["judgement"]["status"] == "normal" and body["lookback_source"] == "default"
    mdb.tables["holding_profiles"] = mdb.tables["holding_profiles"][:1]                             # 지역 입력 모두 제거
    body = get(client, "/market/regime")
    assert body["weighted_drawdown"] is None and body["suggested_input"] is None and body["judgement"] is None
    assert body["excluded_share"] == 1.0 and body["unreliable"] is True


def test_regime_suggested_input_is_valid_market_input_and_keeps_components(client):
    s = get(client, "/market/regime")["suggested_input"]
    d = _market_input_dict(MarketInput(**s))                       # 판단 실행 입력 모델이 그대로 받아들인다
    assert d["source"] == "auto" and d["drawdown"] == s["drawdown"] and len(d["components"]) == 2
    assert d["components"][0].keys() == {"region", "series_code", "drawdown", "share", "is_proxy"}


# ══ /market/refresh ═══════════════════════════════════════════════

def test_refresh_post_uses_user_auth_and_returns_summary(client, monkeypatch):
    seen = {}
    def fake_refresh(db, today, env=None, **kw):
        seen["today"] = today
        return {"as_of": today.isoformat(), "results": [{"code": "A", "status": "ok", "sample": 1}], "ok": 1,
                "failed": 0, "skipped": 0, "stored": 3}
    monkeypatch.setattr(mkt.market_data, "refresh_all", fake_refresh)
    r = client.post("/market/refresh")
    assert r.status_code == 200 and r.json()["stored"] == 3 and "sample" not in r.json()["results"][0]
    assert isinstance(seen["today"], date)


def test_refresh_cron_requires_cron_secret_not_user_token(mdb, monkeypatch):
    monkeypatch.setattr(mkt.market_data, "refresh_all",
                        lambda db, today, env=None, **kw: {"as_of": "x", "results": [], "ok": 0, "failed": 0, "skipped": 0, "stored": 0})
    c = TestClient(main.app, raise_server_exceptions=False)
    assert c.get("/market/refresh").status_code == 401
    assert c.get("/market/refresh", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert c.get("/market/refresh", headers={"Authorization": f"Bearer {CRON}"}).status_code == 200
    assert c.post("/market/refresh", headers={"Authorization": f"Bearer {CRON}"}).status_code == 401    # 사용자 경로는 크론 시크릿 불가


def test_all_new_routes_require_auth(mdb):
    c = TestClient(main.app, raise_server_exceptions=False)
    for method, path in [("GET", "/market/series"), ("GET", "/market/series/KS11/history"), ("GET", "/market/regime"),
                         ("POST", "/market/refresh"), ("GET", "/market/refresh"), ("GET", "/exposure"),
                         ("GET", "/exposure/scenario/presets"), ("POST", "/exposure/scenario"), ("GET", "/exposure/signals")]:
        assert c.request(method, path).status_code == 401, (method, path)


# ══ /exposure ═════════════════════════════════════════════════════

def test_exposure_response_and_no_writes(client, mdb):
    body = get(client, "/exposure")
    assert body["total_assets"] == 200_000_000 and body["rate"]["price_change_per_1pp"] < 0
    regions = {g["region"]: g for g in body["equity"]["by_region"]}
    assert regions["한국"]["has_benchmark"] is True and regions["미국"]["amount"] == 40_000_000
    assert body["fx"]["by_currency"] == {"USD": 40_000_000}
    assert "assumed" in body["provenance"] and body["assumptions"]
    assert mdb.writes() == []


# ══ /exposure/scenario ════════════════════════════════════════════

def scenario(client, **body):
    return client.post("/exposure/scenario", json={"as_of": AS_OF.isoformat(), **body})


def test_scenario_presets_endpoint_lists_all(client):
    ids = {p["id"] for p in client.get("/exposure/scenario/presets").json()}
    assert {"rate_up_1", "rate_down_1", "equity_down_20", "fx_down_10", "fx_up_10", "inflation_up_2"} <= ids


def test_scenario_preset_and_custom_and_no_writes(client, mdb):
    r = scenario(client, preset_id="rate_up_1")
    assert r.status_code == 200
    body = r.json()
    assert body["label"] == "금리 +1%p" and body["change"]["total"] == pytest.approx(-0.05 * 60_000_000, rel=0.02)
    assert set(body) >= {"before", "after", "r01", "excluded", "assumptions", "provenance"}
    custom = scenario(client, kind="equity", params={"mode": "uniform", "pct": 0.1}).json()
    assert custom["change"]["total"] == pytest.approx(-10_000_000)
    infl = scenario(client, preset_id="inflation_up_2").json()
    assert infl["change"]["total"] == 0 and infl["after"]["annual_need_total"] > infl["before"]["annual_need_total"]
    assert mdb.writes() == []


@pytest.mark.parametrize("body", [
    {"preset_id": "nope"}, {}, {"kind": "rate", "params": {"delta_pp": 0}}, {"kind": "rate"},
    {"kind": "equity", "params": {"mode": "uniform", "pct": 2}}, {"kind": "shock", "params": {}},
    {"kind": "rate", "params": {"delta_pp": 1}, "typo": 1}, {"as_of": "2026-13-01", "kind": "rate", "params": {"delta_pp": 1}},
])
def test_scenario_invalid_bodies_422(client, body):
    r = client.post("/exposure/scenario", json=body)
    assert r.status_code == 422, r.text


# ══ /exposure/signals ═════════════════════════════════════════════

def test_signals_uses_observed_changes(client, mdb):
    body = get(client, "/exposure/signals")
    rate = next(s for s in body["signals"] if s["kind"] == "rate")
    assert rate["market"] == "KR" and rate["observed_change_pp"] == pytest.approx(0.4)
    assert rate["estimated_impact"] < 0 and body["total_impact"] < 0
    eq = {s["region"]: s for s in body["signals"] if s["kind"] == "equity"}
    assert eq["한국"]["series_code"] == "KS11" and eq["미국"]["series_code"] == "US500"
    assert mdb.writes() == []


# ══ R-04 lookback_days 검증 ═══════════════════════════════════════

@pytest.mark.parametrize("lb,ok", [(365, True), (30, True), (1095, True), (29, False), (1096, False), (365.5, False),
                                   ("365", False), (True, False), (None, False)])
def test_r04_lookback_validation(lb, ok):
    errs = validate_parameters("R-04", {"drawdown_threshold": 0.15, "lookback_days": lb})
    assert (errs == []) is ok
    if not ok:
        assert [e["field"] for e in errs] == ["lookback_days"]


def test_r04_lookback_optional_and_unknown_key_still_rejected():
    assert validate_parameters("R-04", {"drawdown_threshold": 0.15}) == []
    assert [e["field"] for e in validate_parameters("R-04", {"drawdown_threshold": 0.15, "typo": 1})] == ["typo"]


def test_vercel_json_has_new_cron_and_keeps_existing():
    import json
    cfg = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "vercel.json"), encoding="utf-8"))
    assert cfg["crons"] == [{"path": "/api/alert/daily", "schedule": "0 23 * * *"},
                            {"path": "/api/market/refresh", "schedule": "0 22 * * *"}]
