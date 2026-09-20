"""IPS 규칙 · 판단 실행 · 의사결정 로그 API 테스트 (지시서 03, 단계 D).

가짜 Supabase 와 인증 override 를 쓴다 — 운영 DB 접근 없음.

실행: backend/ 디렉터리에서 `pytest tests/test_decision_api.py -v`
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import copy
from datetime import date

import pytest
from fastapi.testclient import TestClient

import main
import routers.decision_engine as der
import routers.decision_log as dlog
import routers.ips_rules as ipr
import utils
from auth import require_user
from tests.test_withdrawal_check_api import DB

TODAY = date(2026, 10, 5)                                           # 2026-Q4
MIL = 1_000_000

RULE_ROWS = [
    ("R-01", "bucket", "1버킷 최소 수준", {"min_years": 1.0, "target_years": 2.0}),
    ("R-02", "bucket", "2버킷 목표", {"target_years": 5.0}),
    ("R-03", "rebalance", "자산군 허용 폭", {"mode": "config"}),
    ("R-04", "market_regime", "하락 국면", {"drawdown_threshold": 0.15}),
    ("R-05", "guardrail", "상단 가드레일", {"upper_multiplier": 1.2, "cut_ratio": 0.1}),
    ("R-06", "guardrail", "하단 가드레일", {"lower_multiplier": 0.8, "raise_ratio": 0.1}),
    ("R-07", "pre_trade", "매매 전 확인", {}),
]


def rules_table():
    return [{"rule_code": c, "category": cat, "name": n, "parameters": dict(p), "enabled": True,
             "description": "", "updated_at": "OLD"} for c, cat, n, p in RULE_ROWS]


def A(id_, asset_type, value, tax="regular"):
    return {"id": id_, "asset_name": f"자산{id_}", "account_name": "계좌", "asset_type": asset_type,
            "current_value": value, "is_active": True, "tax_account_type": tax, "maturity_date": None}


NEED = [{"item_type": "expense_essential", "name": "생활비", "monthly_amount": 1_000_000}]        # 순인출 연 1,200만


def base_assets(b1=14 * MIL):
    return [A(1, "cash", b1), A(2, "bond", 60 * MIL, "retirement_pension"), A(3, "equity", 150 * MIL),
            A(4, "equity", 76 * MIL, "pension_savings")]


def seed(db, *, assets=None, items=NEED, baseline=None, rules=None, withdrawals=(), portfolio=None, plan=None, profiles=()):
    t = db.tables
    t["assets"] = [dict(a) for a in (assets if assets is not None else base_assets())]
    t["holding_profiles"] = [dict(p) for p in profiles]
    t["cashflow_items"] = [dict(i, id=n + 1) for n, i in enumerate(items)]
    t["withdrawal_baseline"] = [dict(baseline, id=1)] if baseline else []
    t["ips_rules"] = rules if rules is not None else rules_table()
    t["withdrawals"] = [dict(w) for w in withdrawals]
    portfolio = {"target_cash": 0.25, "target_bond": 0.25, "target_equity": 0.35, "target_income": 0.15,
                 "rebalance_threshold": 0.1} if portfolio is None else portfolio
    cfg = {"portfolio": portfolio, "user": {"monthly_expense": 0}}
    if plan is not None:
        cfg["pension_plan"] = plan
    t["user_config"] = [{"key": "config", "value": cfg}]
    t.setdefault("decision_log", [])


@pytest.fixture
def db(monkeypatch):
    fake = DB()
    for mod in (utils, ipr, der, dlog):
        monkeypatch.setattr(mod, "supabase", fake)

    class _D(date):
        @classmethod
        def today(cls):
            return TODAY
    monkeypatch.setattr(der, "date", _D)
    seed(fake)
    return fake


@pytest.fixture
def client(db):
    main.app.dependency_overrides[require_user] = lambda: {"email": "owner@example.com"}
    yield TestClient(main.app, raise_server_exceptions=False)
    main.app.dependency_overrides.pop(require_user, None)


def run(client, **body):
    r = client.post("/decision-engine/run", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def field_errors(resp):
    return sorted(e["field"] for e in resp.json()["detail"])


# ══ /ips-rules ═══════════════════════════════════════════════════

def test_list_rules_is_sorted_by_code(client, db):
    db.tables["ips_rules"].reverse()
    rows = client.get("/ips-rules").json()
    assert [r["rule_code"] for r in rows] == [c for c, *_ in RULE_ROWS]
    assert rows[0]["parameters"] == {"min_years": 1.0, "target_years": 2.0}


def test_put_updates_parameters_enabled_and_updated_at(client, db):
    r = client.put("/ips-rules/R-01", json={"parameters": {"min_years": 1.5, "target_years": 3}, "enabled": False})
    assert r.status_code == 200
    body = r.json()
    assert body["parameters"] == {"min_years": 1.5, "target_years": 3} and body["enabled"] is False
    assert body["updated_at"] != "OLD" and body["rule_code"] == "R-01" and body["category"] == "bucket"
    stored = next(x for x in db.tables["ips_rules"] if x["rule_code"] == "R-01")
    assert stored["parameters"] == {"min_years": 1.5, "target_years": 3}


def test_put_enabled_only_keeps_parameters(client, db):
    r = client.put("/ips-rules/R-04", json={"enabled": False})
    assert r.status_code == 200 and r.json()["enabled"] is False
    assert r.json()["parameters"] == {"drawdown_threshold": 0.15}


@pytest.mark.parametrize("code, params, fields", [
    ("R-01", {"min_years": 3, "target_years": 2}, ["min_years"]),
    ("R-01", {"min_years": 1, "target_years": 2, "typo": 1}, ["typo"]),
    ("R-02", {"target_years": 0}, ["target_years"]),
    ("R-03", {"mode": "relative", "relative": 2, "min_abs": 0.03}, ["relative"]),
    ("R-03", {"mode": "nope"}, ["mode"]),
    ("R-04", {"drawdown_threshold": 1}, ["drawdown_threshold"]),
    ("R-05", {"upper_multiplier": 1, "cut_ratio": 0.1}, ["upper_multiplier"]),
    ("R-06", {"lower_multiplier": 0.8, "raise_ratio": 1}, ["raise_ratio"]),
    ("R-07", {"x": 1}, ["x"]),
    ("R-02", {"target_years": "5"}, ["target_years"]),
])
def test_put_rejects_invalid_values_per_field_and_leaves_the_row_unchanged(client, db, code, params, fields):
    before = copy.deepcopy(db.tables["ips_rules"])
    r = client.put(f"/ips-rules/{code}", json={"parameters": params})
    assert r.status_code == 422 and field_errors(r) == fields
    assert all(set(e) == {"field", "msg"} for e in r.json()["detail"])
    assert db.tables["ips_rules"] == before


@pytest.mark.parametrize("params", [{}, {"mode": "config"}, {"mode": "relative", "relative": 0.2, "min_abs": 0.03}])
def test_put_accepts_the_r03_modes(client, db, params):
    r = client.put("/ips-rules/R-03", json={"parameters": params})
    assert r.status_code == 200 and r.json()["parameters"] == params


@pytest.mark.parametrize("extra", [{"rule_code": "R-99"}, {"category": "guardrail"}, {"name": "x"}, {"description": "x"}])
def test_put_cannot_change_code_category_or_name(client, db, extra):
    before = copy.deepcopy(db.tables["ips_rules"])
    r = client.put("/ips-rules/R-01", json={"parameters": {"min_years": 1, "target_years": 2}, **extra})
    assert r.status_code == 422 and db.tables["ips_rules"] == before


def test_put_unknown_rule_is_404_and_empty_body_is_422(client, db):
    assert client.put("/ips-rules/R-99", json={"enabled": True}).status_code == 404
    assert client.put("/ips-rules/R-01", json={}).status_code == 422


# ══ /decision-engine/run ═════════════════════════════════════════

def test_run_returns_the_engine_output_for_the_router_date(client, db):
    r = run(client)
    assert r["as_of"] == "2026-10-05" and r["period"] == "2026-Q4"
    assert r["payment"]["base_quarterly"] == 3 * MIL and r["payment"]["source_bucket"] == 1
    assert r["regime"]["status"] == "assumed_normal"
    assert r["conclusion"]["type"] == "pay_and_refill" and r["conclusion"]["summary_code"] == "below_min_refill"
    assert [(s["asset_id"], s["amount"]) for s in r["refill"]["sells"]] == [(3, 13 * MIL)]
    assert set(r) >= {"inputs_snapshot", "refill", "bucket1_after", "account_checks", "applied_rules", "skipped_rules", "assumptions"}
    assert r["inputs_snapshot"]["targets"]["equity"] == 0.35


def test_run_never_writes_to_the_database(client, db):
    before = copy.deepcopy(db.tables)
    run(client, market_input={"index_name": "KOSPI", "drawdown": 0.2})
    assert db.tables == before
    assert db.modes and all(mode == "select" for _, mode in db.modes)
    assert {name for name, _ in db.modes} >= {"assets", "holding_profiles", "cashflow_items", "withdrawal_baseline",
                                              "ips_rules", "withdrawals", "user_config"}


def test_run_accepts_an_empty_request(client, db):
    assert client.post("/decision-engine/run").status_code == 200
    assert client.post("/decision-engine/run", json={}).status_code == 200


def test_run_as_of_parameter_sets_period(client, db):
    r = run(client, as_of="2027-02-10")
    assert r["as_of"] == "2027-02-10" and r["period"] == "2027-Q1"


@pytest.mark.parametrize("body", [
    {"as_of": "2026-13-01"}, {"as_of": "abc"}, {"market_input": {"drawdown": 1.5}}, {"market_input": {"drawdown": -0.1}},
    {"market_input": {"drawdown": 0.1, "typo": 1}}, {"typo": 1}, {"market_input": {"drawdown": "x"}},
    {"market_input": {"index_name": "x" * 51}},
])
def test_run_validates_the_request(client, db, body):
    assert client.post("/decision-engine/run", json=body).status_code == 422


def test_run_downturn_input_excludes_bucket3_from_sells(client, db):
    r = run(client, market_input={"index_name": "KOSPI", "drawdown": 0.15})          # 임계값과 같음 → 하락 국면
    assert r["regime"]["status"] == "downturn" and r["regime"]["index_name"] == "KOSPI"
    assert r["refill"]["sells"] and all(s["bucket"] == 2 for s in r["refill"]["sells"])
    assert r["conclusion"]["summary_code"] == "downturn_refill_to_min"


def test_run_reads_rules_from_the_database(client, db):
    client.put("/ips-rules/R-01", json={"parameters": {"min_years": 0.5, "target_years": 0.8}})
    r = run(client)                                                                   # 잔액 1,100만 = 0.92년 ≥ 목표 0.8
    assert r["conclusion"]["summary_code"] == "above_target" and r["refill"]["sells"] == []
    client.put("/ips-rules/R-01", json={"enabled": False})
    r = run(client)
    assert r["conclusion"]["summary_code"] == "r01_not_applied"
    assert {"code": "R-01", "reason": "rule_disabled"} in r["skipped_rules"]


def test_run_uses_targets_and_threshold_from_config(client, db):
    seed(db, portfolio={"target_cash": 0.05, "target_bond": 0.2, "target_equity": 0.7, "target_income": 0.05,
                        "rebalance_threshold": 0.9})
    r = run(client)
    assert r["inputs_snapshot"]["targets"] == {"cash": 0.05, "bond": 0.2, "equity": 0.7, "income": 0.05}
    assert r["inputs_snapshot"]["rebalance_threshold"] == 0.9
    assert not any(c["over_band"] for c in r["inputs_snapshot"]["class_weights"].values())


def test_run_warns_when_rebalance_threshold_is_zero(client, db):
    seed(db, portfolio={"target_cash": 0.25, "target_bond": 0.25, "target_equity": 0.35, "target_income": 0.15,
                        "rebalance_threshold": 0})
    r = run(client)
    assert {"code": "threshold_zero", "values": {"rebalance_threshold": 0.0}} in r["warnings"]
    seed(db, portfolio={"target_cash": 0.25, "target_bond": 0.25, "target_equity": 0.35, "target_income": 0.15})   # 키 없음
    r = run(client)
    assert not any(w["code"] == "threshold_zero" for w in r["warnings"])
    assert r["inputs_snapshot"]["class_weights"]["equity"]["band"] == pytest.approx(0.1)                    # 기본값 0.1 사용


def test_run_attaches_pension_limit_usage_reference(client, db):
    assets = [A(1, "cash", 14 * MIL), A(4, "equity", 200 * MIL, "pension_savings")]
    seed(db, assets=assets, withdrawals=[
        {"id": 1, "withdrawal_date": "2026-03-01", "amount": 5 * MIL, "account_name": "연금저축", "tax_account_type": "pension_savings"},
        {"id": 2, "withdrawal_date": "2025-03-01", "amount": 9 * MIL, "account_name": "연금저축", "tax_account_type": "pension_savings"},
        {"id": 3, "withdrawal_date": "2026-04-01", "amount": 1 * MIL, "account_name": "일반", "tax_account_type": "regular"}])
    r = run(client)
    ref = r["account_checks"][0]["reference"]
    assert r["account_checks"][0]["account_type"] == "pension_savings"
    assert ref["year"] == 2026 and ref["ytd_total"] == 5 * MIL                       # 올해·연금 계좌 인출만
    assert ref["annual_limit"] == 15 * MIL and ref["remaining"] == 10 * MIL


def test_run_survives_an_unreadable_pension_plan(client, db):
    assets = [A(1, "cash", 14 * MIL), A(4, "equity", 200 * MIL, "pension_savings")]
    seed(db, assets=assets, plan={"pension_start_date": "not-a-date", "severance_principal": 1},
         withdrawals=[{"id": 1, "withdrawal_date": "2026-03-01", "amount": 5 * MIL, "account_name": "x",
                       "tax_account_type": "retirement_pension"}])
    r = client.post("/decision-engine/run")
    assert r.status_code == 200
    body = r.json()
    assert {"code": "pension_usage_unavailable", "values": {}} in body["warnings"]
    assert body["account_checks"][0]["reference"] is None


def test_run_reflects_bucket_overrides(client, db):
    seed(db, profiles=[{"holding_id": 3, "bucket": 1}])                                # 주식 자산 3 을 1버킷으로 재지정
    r = run(client)
    assert 3 not in {s["asset_id"] for s in r["refill"]["sells"]}


# ══ /decision-log ════════════════════════════════════════════════

def save(client, run_result, kind="base", overwrite=False):
    url = "/decision-log" + ("?overwrite=true" if overwrite else "")
    return client.post(url, json={"engine_output": run_result, "selected_payment_kind": kind})


def test_post_saves_the_full_engine_output_with_selected_payment(client, db):
    out = run(client)
    r = save(client, out)
    assert r.status_code == 200
    row = r.json()
    assert row["period"] == "2026-Q4" and row["executed"] is None and row["deviation_reason"] is None
    assert row["applied_rules"] == out["applied_rules"]
    eo = row["engine_output"]
    assert eo["inputs_snapshot"] == out["inputs_snapshot"] and eo["conclusion"] == out["conclusion"]     # 입력 스냅샷까지 재현 가능
    assert eo["selected_payment"] == {"kind": "base", "amount": 3 * MIL}
    assert len(db.tables["decision_log"]) == 1


def test_post_same_period_is_409_and_keeps_the_original(client, db):
    out = run(client)
    first = save(client, out).json()
    r = save(client, out)
    assert r.status_code == 409
    d = r.json()["detail"]
    assert d["code"] == "period_exists" and d["period"] == "2026-Q4" and d["existing_id"] == first["id"]
    assert len(db.tables["decision_log"]) == 1


def test_post_overwrite_replaces_and_resets_execution(client, db):
    out = run(client)
    first = save(client, out).json()
    client.patch(f"/decision-log/{first['id']}", json={"executed": False, "deviation_reason": "일부만 실행"})
    r = save(client, run(client, market_input={"drawdown": 0.3}), overwrite=True)
    assert r.status_code == 200
    row = r.json()
    assert row["id"] == first["id"] and len(db.tables["decision_log"]) == 1
    assert row["executed"] is None and row["deviation_reason"] is None                 # 새 판단이므로 실행 여부 초기화
    assert row["engine_output"]["regime"]["status"] == "downturn"


def test_post_different_periods_are_stored_separately_and_listed_newest_first(client, db):
    save(client, run(client, as_of="2026-07-10"))
    save(client, run(client, as_of="2026-10-05"))
    save(client, run(client, as_of="2026-04-01"))
    rows = client.get("/decision-log").json()
    assert [r["period"] for r in rows] == ["2026-Q4", "2026-Q3", "2026-Q2"]


def test_post_selected_recommended_payment(client, db):
    items = [{"item_type": "expense_essential", "name": "필수", "monthly_amount": 800_000},
             {"item_type": "expense_discretionary", "name": "선택", "monthly_amount": 200_000}]
    seed(db, items=items, baseline={"withdrawal_start_date": "2025-10-01", "initial_portfolio_value": 1_000 * MIL,
                                    "initial_annual_withdrawal": 20 * MIL})
    out = run(client)
    assert out["payment"]["recommended_quarterly"] == 2_940_000
    row = save(client, out, kind="recommended").json()
    assert row["engine_output"]["selected_payment"] == {"kind": "recommended", "amount": 2_940_000}


def test_post_recommended_without_recommendation_is_422(client, db):
    r = save(client, run(client), kind="recommended")
    assert r.status_code == 422 and field_errors(r) == ["selected_payment_kind"]
    assert db.tables["decision_log"] == []


def _broken(out, **changes):
    o = copy.deepcopy(out)
    for k, v in changes.items():
        if v is KeyError:
            o.pop(k, None)
        else:
            o[k] = v
    return o


@pytest.mark.parametrize("changes, field", [
    ({"inputs_snapshot": KeyError}, "engine_output"),
    ({"conclusion": KeyError}, "engine_output"),
    ({"period": "2026-Q5"}, "engine_output.period"),
    ({"period": "2026Q4"}, "engine_output.period"),
    ({"period": "2026-Q3"}, "engine_output.period"),                            # as_of(2026-10-05)와 불일치
    ({"as_of": "not-a-date"}, "engine_output.as_of"),
    ({"conclusion": {"type": "sell_everything"}}, "engine_output.conclusion"),
    ({"payment": {"base_quarterly": "3000000"}}, "engine_output.payment"),
])
def test_post_validates_the_engine_output(client, db, changes, field):
    out = run(client)
    r = client.post("/decision-log", json={"engine_output": _broken(out, **changes), "selected_payment_kind": "base"})
    assert r.status_code == 422 and field in field_errors(r)
    assert db.tables["decision_log"] == []


def test_post_rejects_unknown_body_fields_and_kinds(client, db):
    out = run(client)
    assert client.post("/decision-log", json={"engine_output": out, "selected_payment_kind": "base", "period": "2026-Q1"}).status_code == 422
    assert client.post("/decision-log", json={"engine_output": out, "selected_payment_kind": "custom"}).status_code == 422
    assert client.post("/decision-log", json={"selected_payment_kind": "base"}).status_code == 422


# ── PATCH ────────────────────────────────────────────────────────

@pytest.fixture
def logged(client, db):
    return save(client, run(client)).json()["id"]


def test_patch_executed_true_clears_reason(client, db, logged):
    client.patch(f"/decision-log/{logged}", json={"executed": False, "deviation_reason": "현금이 부족해서"})
    r = client.patch(f"/decision-log/{logged}", json={"executed": True})
    assert r.status_code == 200 and r.json()["executed"] is True and r.json()["deviation_reason"] is None


def test_patch_executed_false_requires_a_reason(client, db, logged):
    for body in ({"executed": False}, {"executed": False, "deviation_reason": ""}, {"executed": False, "deviation_reason": "   "},
                 {"executed": False, "deviation_reason": None}):
        r = client.patch(f"/decision-log/{logged}", json=body)
        assert r.status_code == 422 and field_errors(r) == ["deviation_reason"], body
    row = db.tables["decision_log"][0]
    assert row["executed"] is None and row["deviation_reason"] is None                 # 실패한 요청은 저장되지 않는다


def test_patch_executed_false_with_reason_is_saved_trimmed(client, db, logged):
    r = client.patch(f"/decision-log/{logged}", json={"executed": False, "deviation_reason": "  주식은 그대로 두고 예금에서 지급  "})
    assert r.status_code == 200
    assert r.json()["executed"] is False and r.json()["deviation_reason"] == "주식은 그대로 두고 예금에서 지급"


def test_patch_reason_can_be_edited_when_already_not_executed(client, db, logged):
    client.patch(f"/decision-log/{logged}", json={"executed": False, "deviation_reason": "첫 사유"})
    r = client.patch(f"/decision-log/{logged}", json={"deviation_reason": "수정한 사유"})
    assert r.status_code == 200 and r.json()["deviation_reason"] == "수정한 사유" and r.json()["executed"] is False
    assert client.patch(f"/decision-log/{logged}", json={"deviation_reason": ""}).status_code == 422       # 비울 수 없다


def test_patch_reason_without_not_executed_is_rejected(client, db, logged):
    assert client.patch(f"/decision-log/{logged}", json={"deviation_reason": "사유만"}).status_code == 422       # 미확인 상태
    assert client.patch(f"/decision-log/{logged}", json={"executed": True, "deviation_reason": "사유"}).status_code == 422


def test_patch_explicit_null_resets_to_unconfirmed(client, db, logged):
    client.patch(f"/decision-log/{logged}", json={"executed": False, "deviation_reason": "사유"})
    r = client.patch(f"/decision-log/{logged}", json={"executed": None})
    assert r.status_code == 200 and r.json()["executed"] is None and r.json()["deviation_reason"] is None


def test_patch_unknown_id_and_empty_body(client, db, logged):
    assert client.patch("/decision-log/9999", json={"executed": True}).status_code == 404
    assert client.patch(f"/decision-log/{logged}", json={}).status_code == 422
    assert client.patch(f"/decision-log/{logged}", json={"period": "2026-Q1"}).status_code == 422


def test_patch_touches_only_execution_fields(client, db, logged):
    before = copy.deepcopy(db.tables["decision_log"][0])
    client.patch(f"/decision-log/{logged}", json={"executed": True})
    after = db.tables["decision_log"][0]
    for k in ("period", "engine_output", "applied_rules"):
        assert after[k] == before[k]


# ── 인증·읽기 전용 보장 ───────────────────────────────────────────

def test_all_new_endpoints_require_authentication(db):
    c = TestClient(main.app, raise_server_exceptions=False)
    calls = [("GET", "/ips-rules", None), ("PUT", "/ips-rules/R-01", {"enabled": True}),
             ("POST", "/decision-engine/run", {}), ("GET", "/decision-log", None),
             ("POST", "/decision-log", {"engine_output": {}, "selected_payment_kind": "base"}),
             ("PATCH", "/decision-log/1", {"executed": True})]
    for method, path, body in calls:
        assert c.request(method, path, json=body).status_code == 401, (method, path)
        assert c.request(method, path, json=body, headers={"Authorization": "Bearer nope"}).status_code == 401


def test_decision_log_never_touches_assets_or_withdrawals(client, db):
    snapshot = {k: copy.deepcopy(db.tables[k]) for k in ("assets", "withdrawals", "cashflow_items", "holding_profiles")}
    out = run(client)
    row = save(client, out).json()
    client.patch(f"/decision-log/{row['id']}", json={"executed": False, "deviation_reason": "x"})
    save(client, out, overwrite=True)
    assert {k: db.tables[k] for k in snapshot} == snapshot
