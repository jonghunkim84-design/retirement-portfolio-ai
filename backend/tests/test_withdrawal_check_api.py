"""생활비·버킷 점검 API 및 보유상품 그리드 응답 테스트 (지시서 02, 단계 C).

- 가짜 Supabase 와 인증 override 사용 — 운영 DB 접근 없음.
- GET /withdrawal-check: 응답 구조, 인증 필요(401), as_of 파라미터 검증·반영, 읽기 전용, 규칙 로딩
- GET /holding-profiles/overview, 목록, /missing: 모든 행의 default_bucket / effective_bucket / bucket_source

실행: backend/ 디렉터리에서 `pytest tests/test_withdrawal_check_api.py -v`
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import date

import pytest
from fastapi.testclient import TestClient

import main
import routers.holding_profiles as hp
import routers.withdrawal_check as wcr
import utils
from auth import require_user
from tests.test_withdrawal_data_api import FakeDB, _Query
from utils import BUCKET_MAP

TODAY = date(2026, 9, 20)


class _Q(_Query):
    """기존 가짜 쿼리에 gte 를 더하고, 읽기/쓰기 호출을 기록한다."""

    def gte(self, col, val):
        self.filters.append(lambda r: r.get(col) is not None and str(r.get(col)) >= str(val))
        return self

    def execute(self):
        self.db.modes.append((self.name, self.mode))
        return super().execute()


class DB(FakeDB):
    def __init__(self):
        super().__init__()
        self.modes = []

    def table(self, name):
        return _Q(self, name)


def _fixed_today(monkeypatch, fixed=TODAY):
    class _D(date):
        @classmethod
        def today(cls):
            return fixed
    monkeypatch.setattr(wcr, "date", _D)


@pytest.fixture
def db(monkeypatch):
    fake = DB()
    for mod in (utils, hp, wcr):
        monkeypatch.setattr(mod, "supabase", fake)
    _fixed_today(monkeypatch)
    return fake


@pytest.fixture
def client(db):
    main.app.dependency_overrides[require_user] = lambda: {"email": "owner@example.com"}
    yield TestClient(main.app, raise_server_exceptions=False)
    main.app.dependency_overrides.pop(require_user, None)


def seed(db, *, assets=(), profiles=(), items=(), baseline=None, rules=None, withdrawals=()):
    t = db.tables
    t["assets"] = [dict(a) for a in assets]
    t["holding_profiles"] = [dict(p) for p in profiles]
    t["cashflow_items"] = [dict(i, id=n + 1) for n, i in enumerate(items)]
    t["withdrawal_baseline"] = [dict(baseline, id=1)] if baseline else []
    t["ips_rules"] = list(rules) if rules is not None else list(DEFAULT_RULES)
    t["withdrawals"] = [dict(w) for w in withdrawals]


def A(id_, asset_type, value, active=True):
    return {"id": id_, "asset_name": f"자산{id_}", "account_name": "계좌", "asset_type": asset_type,
            "current_value": value, "is_active": active, "maturity_date": None}


def I(kind, monthly, start=None, end=None):
    return {"item_type": kind, "name": kind, "monthly_amount": monthly, "start_date": start, "end_date": end}


DEFAULT_RULES = [
    {"rule_code": "R-01", "enabled": True, "parameters": {"min_years": 1.0, "target_years": 2.0}},
    {"rule_code": "R-02", "enabled": True, "parameters": {"target_years": 5.0}},
    {"rule_code": "R-05", "enabled": True, "parameters": {"upper_multiplier": 1.2, "cut_ratio": 0.1}},
    {"rule_code": "R-06", "enabled": True, "parameters": {"lower_multiplier": 0.8, "raise_ratio": 0.1}},
    {"rule_code": "R-03", "enabled": True, "parameters": {}},          # 이번 계산이 쓰지 않는 규칙
]
BASELINE = {"withdrawal_start_date": "2025-09-01", "initial_portfolio_value": 1_000_000_000,
            "initial_annual_withdrawal": 40_000_000}


# ── GET /withdrawal-check ────────────────────────────────────────

def test_response_structure(client, db):
    seed(db, assets=[A(1, "cash", 60_000_000), A(2, "bond", 200_000_000), A(3, "equity", 700_000_000)],
         items=[I("expense_essential", 2_000_000), I("expense_discretionary", 1_000_000), I("income_regular", 1_500_000)],
         baseline=BASELINE, withdrawals=[{"withdrawal_date": "2026-08-01", "amount": 2_000_000}])
    r = client.get("/withdrawal-check")
    assert r.status_code == 200
    body = r.json()
    assert set(body) >= {"as_of", "total_assets", "net_need", "buckets", "cumulative", "assets", "rules",
                         "withdrawal_rate", "completeness", "assumptions", "provenance", "reasons", "baseline"}
    assert body["as_of"] == "2026-09-20"                       # 라우터가 오늘을 넣는다
    assert body["net_need"]["annual_total"] == 18_000_000
    assert [b["bucket"] for b in body["buckets"]] == [1, 2, 3]
    assert set(body["rules"]) == {"R-01", "R-02", "R-05", "R-06", "guardrail"}
    assert body["rules"]["R-01"]["status"] == "ok"
    assert body["withdrawal_rate"]["actual_12m_total"] == 2_000_000
    assert body["baseline"]["initial_annual_withdrawal"] == 40_000_000
    assert body["completeness"]["default_bucket_count"] == 3


def test_requires_authentication(db):
    """override 없이 실제 인증 의존성을 거치면 401."""
    seed(db)
    c = TestClient(main.app, raise_server_exceptions=False)
    assert c.get("/withdrawal-check").status_code == 401
    assert c.get("/withdrawal-check", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_as_of_parameter_is_applied(client, db):
    seed(db, assets=[A(1, "cash", 100_000_000)],
         items=[I("expense_essential", 1_000_000), I("income_regular", 500_000, start="2026-10-01")])
    before = client.get("/withdrawal-check?as_of=2026-09-30").json()
    after = client.get("/withdrawal-check?as_of=2026-10-01").json()
    assert before["as_of"] == "2026-09-30" and after["as_of"] == "2026-10-01"
    assert before["net_need"]["annual_total"] == 12_000_000
    assert after["net_need"]["annual_total"] == 6_000_000
    assert before["net_need"]["upcoming_income"][0]["start_date"] == "2026-10-01"


@pytest.mark.parametrize("bad", ["abc", "2026-13-01", "2026-02-30", "20260920", "2026/09/20", ""])
def test_as_of_invalid_is_422(client, db, bad):
    seed(db)
    assert client.get(f"/withdrawal-check?as_of={bad}").status_code == 422


def test_default_as_of_uses_router_today(client, db, monkeypatch):
    seed(db, items=[I("expense_essential", 1_000_000, start="2026-09-21")])
    assert client.get("/withdrawal-check").json()["net_need"]["annual_total"] == 0          # 오늘 2026-09-20 → 예정
    _fixed_today(monkeypatch, date(2026, 9, 21))
    assert client.get("/withdrawal-check").json()["net_need"]["annual_total"] == 12_000_000


def test_is_read_only(client, db):
    seed(db, assets=[A(1, "cash", 100)], items=[I("expense_essential", 10)], baseline=BASELINE)
    client.get("/withdrawal-check")
    assert db.modes and all(mode == "select" for _, mode in db.modes)
    assert {name for name, _ in db.modes} >= {"assets", "holding_profiles", "cashflow_items",
                                              "withdrawal_baseline", "ips_rules", "withdrawals"}


def test_empty_database_returns_reasons_not_errors(client, db):
    seed(db, rules=[])
    r = client.get("/withdrawal-check")
    assert r.status_code == 200
    body = r.json()
    codes = {(x["field"], x["code"]) for x in body["reasons"]}
    assert ("net_need", "no_net_need") in codes
    assert ("rules.R-01", "rule_missing") in codes
    assert ("withdrawal_rate.initial", "baseline_missing") in codes
    assert body["baseline"] is None and body["rules"]["guardrail"] is None


def test_rules_are_read_from_ips_rules_and_can_be_disabled(client, db):
    rules = [{**r, "enabled": False} if r["rule_code"] == "R-01" else r for r in DEFAULT_RULES]
    seed(db, assets=[A(1, "cash", 1_000_000)], items=[I("expense_essential", 1_000_000)], rules=rules)
    body = client.get("/withdrawal-check").json()
    assert body["rules"]["R-01"]["status"] is None and body["rules"]["R-01"]["reason"] == "rule_disabled"
    assert body["rules"]["R-02"]["status"] == "below_target"


def test_rule_thresholds_come_from_parameters_not_code(client, db):
    rules = [{"rule_code": "R-01", "enabled": True, "parameters": {"min_years": 5.0, "target_years": 10.0}}]
    seed(db, assets=[A(1, "cash", 60_000_000)], items=[I("expense_essential", 1_000_000)], rules=rules)
    body = client.get("/withdrawal-check").json()
    assert body["rules"]["R-01"]["years"] == pytest.approx(5.0)
    assert body["rules"]["R-01"]["status"] == "below_target"        # min=5.0 과 같음, target=10.0 미만


def test_profile_override_is_reflected(client, db):
    seed(db, assets=[A(1, "equity", 300_000), A(2, "cash", 100_000)], profiles=[{"holding_id": 1, "bucket": 1}],
         items=[I("expense_essential", 10_000)])
    body = client.get("/withdrawal-check").json()
    b = {x["bucket"]: x for x in body["buckets"]}
    assert b[1]["value"] == 400_000 and b[3]["value"] == 0
    rows = {a["id"]: a for a in body["assets"]}
    assert rows[1]["bucket_source"] == "override" and rows[2]["bucket_source"] == "default"


def test_withdrawals_outside_window_are_ignored(client, db):
    seed(db, assets=[A(1, "cash", 100_000_000)], items=[I("expense_essential", 1_000_000)], baseline=BASELINE,
         withdrawals=[{"withdrawal_date": "2025-09-20", "amount": 999},      # 정확히 12개월 전 → 제외
                      {"withdrawal_date": "2025-09-21", "amount": 1_000_000},
                      {"withdrawal_date": "2024-01-01", "amount": 999}])
    body = client.get("/withdrawal-check").json()
    assert body["withdrawal_rate"]["actual_12m_count"] == 1
    assert body["withdrawal_rate"]["actual_12m_total"] == 1_000_000


def test_route_is_registered_once():
    paths = [r.path for r in main.app.routes if getattr(r, "path", "").startswith("/withdrawal-check")]
    assert paths == ["/withdrawal-check"]


# ── 버킷 기본값 서버 일원화 ───────────────────────────────────────

ALL_TYPES = ["cash", "bond", "tdf", "fund", "equity", "income"]


def test_overview_has_bucket_fields_on_every_row(client, db):
    seed(db, assets=[A(i + 1, t, 100 - i) for i, t in enumerate(ALL_TYPES)] + [A(99, "cash", 5, active=False)],
         profiles=[{"holding_id": 3, "bucket": 1, "role": "stability"}])
    body = client.get("/holding-profiles/overview").json()
    assert body["count"] == 6 and body["profile_count"] == 1                      # 비활성 제외
    for it in body["items"]:
        t = it["asset"]["asset_type"]
        assert it["default_bucket"] == BUCKET_MAP[t]                               # 서버 BUCKET_MAP 이 단일 출처
        assert set(it) >= {"asset", "profile", "default_bucket", "effective_bucket", "bucket_source"}
    by_id = {it["asset"]["id"]: it for it in body["items"]}
    assert by_id[3]["bucket_source"] == "override" and by_id[3]["effective_bucket"] == 1 and by_id[3]["default_bucket"] == 2
    assert by_id[1]["bucket_source"] == "default" and by_id[1]["effective_bucket"] == by_id[1]["default_bucket"]
    assert by_id[3]["profile"]["role"] == "stability" and by_id[1]["profile"] is None


def test_overview_is_sorted_by_value_desc_and_read_only(client, db):
    seed(db, assets=[A(1, "cash", 10), A(2, "equity", 500), A(3, "bond", 50)])
    ids = [it["asset"]["id"] for it in client.get("/holding-profiles/overview").json()["items"]]
    assert ids == [2, 3, 1]
    assert all(mode == "select" for _, mode in db.modes)


def test_overview_attaches_bond_warning_only_for_saved_profile(client, db):
    seed(db, assets=[A(1, "bond", 100), A(2, "bond", 90)], profiles=[{"holding_id": 1, "bucket": None, "role": "stability"}])
    by_id = {it["asset"]["id"]: it for it in client.get("/holding-profiles/overview").json()["items"]}
    assert by_id[1]["profile"]["warnings"][0]["code"] == "bond_duration_missing"
    assert by_id[2]["profile"] is None


def test_profile_list_and_missing_also_carry_bucket_fields(client, db):
    seed(db, assets=[A(1, "equity", 100), A(2, "cash", 50)], profiles=[{"holding_id": 1, "bucket": 2, "role": "growth"}])
    rows = client.get("/holding-profiles").json()
    assert rows[0]["default_bucket"] == 3 and rows[0]["effective_bucket"] == 2 and rows[0]["bucket_source"] == "override"
    missing = client.get("/holding-profiles/missing").json()["items"]
    assert missing[0]["asset_id"] == 2
    assert (missing[0]["default_bucket"], missing[0]["effective_bucket"], missing[0]["bucket_source"]) == (1, 1, "default")


def test_overview_route_is_not_shadowed_by_holding_id():
    """/holding-profiles/overview 가 /{holding_id} 로 잡히지 않는다 (라우트 등록 순서)."""
    paths = [r.path for r in main.app.routes if getattr(r, "path", "").startswith("/holding-profiles")]
    assert paths.index("/holding-profiles/overview") < paths.index("/holding-profiles/{holding_id}")


def test_overview_requires_authentication(db):
    seed(db)
    assert TestClient(main.app, raise_server_exceptions=False).get("/holding-profiles/overview").status_code == 401
