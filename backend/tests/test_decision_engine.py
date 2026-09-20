"""분기 인출 판단 엔진 테스트 (지시서 03, 단계 C).

- 순수 함수 테스트 — DB 접근 없음, 모든 호출에 as_of 를 고정한다.
- 02 의 compute_withdrawal_check 를 실제로 호출해 만든 결과를 엔진 입력으로 쓴다 (통합 관점).
- R-03 허용 폭 경계는 기존 리밸런싱과 같이 '이상(>=)' 을 초과로 본다.

실행: backend/ 디렉터리에서 `pytest tests/test_decision_engine.py -v`
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import copy
import json
from datetime import date, datetime
from pathlib import Path

import pytest

import decision_engine as de
import withdrawal_check as wc
from utils import calculate_buckets

AS_OF = date(2026, 10, 5)                                    # 2026-Q4

RULES = {
    "R-01": {"enabled": True, "parameters": {"min_years": 1.0, "target_years": 2.0}},
    "R-02": {"enabled": True, "parameters": {"target_years": 5.0}},
    "R-03": {"enabled": True, "parameters": {"mode": "config"}},
    "R-04": {"enabled": True, "parameters": {"drawdown_threshold": 0.15}},
    "R-05": {"enabled": True, "parameters": {"upper_multiplier": 1.2, "cut_ratio": 0.10}},
    "R-06": {"enabled": True, "parameters": {"lower_multiplier": 0.8, "raise_ratio": 0.10}},
    "R-07": {"enabled": True, "parameters": {}},
}
NEED = [{"item_type": "expense_essential", "name": "생활비", "monthly_amount": 1_000_000}]   # 순인출 연 1,200만 → 분기 300만
NEED_TEXT = 12_000_000
MIL = 1_000_000


def A(id_, asset_type, value, tax="regular", name=None):
    return {"id": id_, "asset_name": name or f"자산{id_}", "account_name": "계좌", "asset_type": asset_type,
            "current_value": value, "is_active": True, "tax_account_type": tax}


def make(assets, *, items=NEED, baseline=None, profiles=(), rules=RULES):
    return wc.compute_withdrawal_check(as_of=AS_OF, assets=assets, profiles=list(profiles), cashflow_items=items,
                                       baseline=baseline, rules=rules, withdrawals=[])


def decide(assets, *, items=NEED, baseline=None, profiles=(), rules=RULES, **kw):
    check = make(assets, items=items, baseline=baseline, profiles=profiles, rules=rules)
    return de.compute_decision(as_of=AS_OF, check=check, rules=rules, assets=assets, **kw)


def base_assets(b1=14 * MIL):
    """총 300만원대 포트폴리오: 현금(1버킷), 채권(2버킷), 주식 2개(3버킷, 주식군이 목표보다 크게 초과)."""
    return [A(1, "cash", b1), A(2, "bond", 60 * MIL, tax="retirement_pension"),
            A(3, "equity", 150 * MIL), A(4, "equity", 76 * MIL, tax="pension_savings")]


def sells_of(res):
    return res["refill"]["sells"]


def concl(res):
    return res["conclusion"]["type"], res["conclusion"]["summary_code"]


# ── 기본 도우미 ───────────────────────────────────────────────────

def test_to_won_rounds_half_up_not_bankers():
    assert [de.to_won(x) for x in (0.5, 1.5, 2.5, 3.5, 1.49, 2.51)] == [1, 2, 3, 4, 1, 3]


@pytest.mark.parametrize("d, expected", [
    (date(2026, 1, 1), "2026-Q1"), (date(2026, 3, 31), "2026-Q1"), (date(2026, 4, 1), "2026-Q2"),
    (date(2026, 9, 30), "2026-Q3"), (date(2026, 10, 5), "2026-Q4"), (date(2026, 12, 31), "2026-Q4"),
])
def test_period_of(d, expected):
    assert de.period_of(d) == expected


def test_module_never_reads_todays_date():
    src = Path(de.__file__).read_text(encoding="utf-8")
    assert "today" not in src.lower()
    assert "datetime.now" not in src


def test_as_of_must_be_a_date():
    check = make(base_assets())
    for bad in ("2026-10-05", datetime(2026, 10, 5, 9, 0)):
        with pytest.raises(TypeError):
            de.compute_decision(as_of=bad, check=check, rules=RULES)


def test_class_mapping_matches_rebalance_grouping():
    """CLASS_OF_TYPE 이 utils.calculate_buckets(리밸런싱과 같은 자산군 체계)와 일치한다."""
    assets = [A(i + 1, t, (i + 1) * MIL) for i, t in enumerate(["cash", "bond", "tdf", "fund", "equity", "income"])]
    b = calculate_buckets(assets, {})
    derived = {c: sum(a["current_value"] for a in assets if de.CLASS_OF_TYPE[a["asset_type"]] == c) for c in de.CLASSES}
    assert derived == {"cash": b["cash_total"], "bond": b["bond_total"], "equity": b["equity_total"], "income": b["income_total"]}
    check = make(assets)
    via_totals = de.compute_decision(as_of=AS_OF, check=check, rules=RULES, assets=assets,
                                     class_totals={"cash": b["cash_total"], "bond": b["bond_total"],
                                                   "equity": b["equity_total"], "income": b["income_total"]})
    assert via_totals == de.compute_decision(as_of=AS_OF, check=check, rules=RULES, assets=assets)


# ── 정상 국면 ─────────────────────────────────────────────────────

def test_normal_below_min_refills_to_target_from_over_band_class():
    r = decide(base_assets(14 * MIL))                             # 지급 300만 → 잔액 1,100만 = 0.92년 < 1.0
    assert r["payment"]["base_quarterly"] == 3 * MIL and r["payment"]["source_bucket"] == 1
    assert r["regime"]["status"] == "assumed_normal"
    assert r["refill"]["required"] is True and r["refill"]["case"] == "below_min"
    assert r["refill"]["need_amount"] == 13 * MIL                 # 목표 2.0년(2,400만) − 1,100만
    assert sells_of(r) == [{"asset_id": 3, "asset_name": "자산3", "asset_class": "equity", "bucket": 3,
                            "bucket_source": "default", "account_type": "regular", "amount": 13 * MIL, "rule": "R-03"}]
    assert concl(r) == ("pay_and_refill", "below_min_refill")
    assert r["bucket1_after"]["years_before_refill"] == pytest.approx(11 / 12)
    assert r["bucket1_after"]["years_after_refill"] == pytest.approx(2.0)
    assert r["bucket1_after"]["after_refill"] == 24 * MIL


def test_normal_below_min_falls_back_to_above_target_classes_when_none_over_band():
    r = decide(base_assets(14 * MIL), rebalance_threshold=0.9)    # 허용 폭 90%p → 초과 자산군 없음
    assert all(not c["over_band"] for c in r["inputs_snapshot"]["class_weights"].values())
    assert [(s["asset_id"], s["amount"], s["rule"]) for s in sells_of(r)] == [(3, 13 * MIL, "R-01")]
    assert concl(r) == ("pay_and_refill", "below_min_refill")


def test_normal_below_min_with_no_eligible_asset_needs_user_judgment():
    r = decide([A(1, "cash", 14 * MIL)])                          # 매도 가능한 (1버킷 밖) 자산이 없다
    assert sells_of(r) == []
    assert concl(r) == ("needs_user_judgment", "below_min_unresolved")
    assert r["conclusion"]["reasons"][-1]["values"]["shortfall_to_min"] == 1 * MIL


def test_between_min_and_target_with_over_band_class_refills_within_excess():
    r = decide(base_assets(18 * MIL))                             # 잔액 1,500만 = 1.25년 (min 1.0 ≤ … < target 2.0)
    assert r["refill"]["required"] is False and r["refill"]["case"] == "below_target_excess"
    assert [(s["asset_id"], s["amount"], s["rule"]) for s in sells_of(r)] == [(3, 9 * MIL, "R-03")]
    assert concl(r) == ("pay_and_refill", "below_target_excess_refill")


def test_refill_is_capped_by_the_class_excess():
    """초과분(500만)이 목표까지 필요한 금액(1,200만)보다 작으면 초과분만큼만 보충한다."""
    assets = [A(1, "cash", 15 * MIL), A(2, "bond", 175 * MIL, tax="retirement_pension"), A(3, "equity", 110 * MIL)]
    r = decide(assets, targets={"cash": 0.05, "bond": 175 / 300, "equity": 0.35, "income": 0.0}, rebalance_threshold=0.015)
    assert r["refill"]["need_amount"] == 12 * MIL
    assert [(s["asset_id"], s["amount"]) for s in sells_of(r)] == [(3, 5 * MIL)]
    assert r["refill"]["shortfall_amount"] == 7 * MIL
    codes = [x["code"] for x in r["conclusion"]["reasons"]]
    assert concl(r) == ("pay_and_refill", "below_target_excess_refill") and "target_not_fully_covered" in codes


def test_between_min_and_target_without_over_band_class_holds_with_reason():
    r = decide(base_assets(18 * MIL), rebalance_threshold=0.9)
    assert sells_of(r) == []
    assert concl(r) == ("pay_only", "below_target_no_excess")
    v = r["conclusion"]["reasons"][0]["values"]
    assert v["years_after_payment"] == pytest.approx(1.25) and v["target_years"] == 2.0     # '현재는 유지' 근거 수치


def test_at_or_above_target_holds():
    r = decide(base_assets(30 * MIL))                             # 잔액 2,700만 = 2.25년 ≥ 2.0
    assert sells_of(r) == [] and r["refill"]["case"] is None
    assert concl(r) == ("pay_only", "above_target")
    assert r["conclusion"]["reasons"][0]["values"]["years_after_payment"] == pytest.approx(2.25)


def test_boundary_years_equal_min_is_not_below_min():
    r = decide(base_assets(15 * MIL))                             # 지급 후 정확히 1,200만 = 1.0년
    assert r["bucket1_after"]["years_before_refill"] == pytest.approx(1.0)
    assert r["refill"]["required"] is False and r["refill"]["case"] == "below_target_excess"
    assert concl(r)[0] == "pay_and_refill"


def test_boundary_years_equal_target_is_not_below_target():
    r = decide(base_assets(27 * MIL))                             # 지급 후 정확히 2,400만 = 2.0년
    assert r["bucket1_after"]["years_before_refill"] == pytest.approx(2.0)
    assert concl(r) == ("pay_only", "above_target")


def test_payment_larger_than_bucket1_triggers_advance_refill():
    r = decide(base_assets(2 * MIL))                              # 1버킷 200만 < 지급 300만
    assert r["payment"]["shortfall_before_refill"] == 1 * MIL
    assert r["bucket1_after"]["after_payment"] == -1 * MIL
    assert r["refill"]["need_amount"] == 25 * MIL and r["refill"]["hard_need_amount"] == 13 * MIL
    assert "payment_exceeds_bucket1" in [x["code"] for x in r["conclusion"]["reasons"]]
    assert sum(s["amount"] for s in sells_of(r)) == 25 * MIL
    assert r["bucket1_after"]["after_refill"] == 24 * MIL


# ── 하락 국면 ─────────────────────────────────────────────────────

def down(**kw):
    return {"market_input": {"index_name": "KOSPI", "drawdown": 0.20}, **kw}


def test_downturn_excludes_bucket3_even_when_the_class_is_over_band():
    r = decide(base_assets(14 * MIL), **down())
    assert r["regime"]["status"] == "downturn"
    assert r["inputs_snapshot"]["class_weights"]["equity"]["over_band"] is True     # 주식군은 초과 상태지만
    assert sells_of(r) and all(s["bucket"] == 2 for s in sells_of(r))                # 3버킷은 매도 대상이 아니다
    assert not any(s["asset_class"] == "equity" for s in sells_of(r))


def test_downturn_refills_only_up_to_min_years_from_bucket2():
    r = decide(base_assets(14 * MIL), **down())
    assert r["refill"]["need_amount"] == 1 * MIL and r["refill"]["target_amount"] == 12 * MIL   # target(2.0년)이 아니라 min(1.0년)까지
    assert [(s["asset_id"], s["amount"], s["rule"]) for s in sells_of(r)] == [(2, 1 * MIL, "R-04")]
    assert concl(r) == ("pay_and_refill", "downturn_refill_to_min")
    assert r["bucket1_after"]["years_after_refill"] == pytest.approx(1.0)


def test_downturn_bucket2_over_band_class_is_sold_under_r03():
    assets = [A(1, "cash", 14 * MIL), A(2, "bond", 200 * MIL, tax="retirement_pension"), A(3, "equity", 86 * MIL)]
    r = decide(assets, **down())
    assert [(s["asset_id"], s["amount"], s["rule"]) for s in sells_of(r)] == [(2, 1 * MIL, "R-03")]


def test_downturn_with_insufficient_bucket2_needs_user_judgment_and_never_sells_bucket3():
    assets = [A(1, "cash", 14 * MIL), A(2, "bond", 500_000, tax="retirement_pension"), A(3, "equity", 285_500_000)]
    r = decide(assets, **down())
    assert [(s["asset_id"], s["amount"]) for s in sells_of(r)] == [(2, 500_000)]
    assert concl(r) == ("needs_user_judgment", "downturn_unresolved")
    assert r["conclusion"]["reasons"][-1]["values"]["shortfall_to_min"] == 500_000
    assert all(s["bucket"] != 3 for s in sells_of(r))


def test_downturn_above_min_holds():
    r = decide(base_assets(30 * MIL), **down())
    assert sells_of(r) == []
    assert concl(r) == ("pay_only", "downturn_above_min")
    v = r["conclusion"]["reasons"][0]["values"]
    assert v["drawdown"] == 0.20 and v["threshold"] == 0.15


@pytest.mark.parametrize("dd, status", [(0.14999, "normal"), (0.15, "downturn"), (0.1501, "downturn"), (0.0, "normal"), (1.0, "downturn")])
def test_regime_boundary_equal_to_threshold_is_downturn(dd, status):
    r = decide(base_assets(), market_input={"drawdown": dd})
    assert r["regime"]["status"] == status
    assert r["regime"]["threshold"] == 0.15 and r["regime"]["drawdown"] == dd


def test_no_market_input_is_assumed_normal_and_flagged():
    for mi in (None, {}, {"index_name": "KOSPI"}):
        r = decide(base_assets(), market_input=mi)
        assert r["regime"]["status"] == "assumed_normal" and r["regime"]["drawdown"] is None
        assert {"code": "R-04", "reason": "no_market_input"} in r["skipped_rules"]
        assert "R-04" not in r["applied_rules"]


def test_invalid_drawdown_is_rejected():
    for bad in (-0.01, 1.01):
        with pytest.raises(ValueError):
            decide(base_assets(), market_input={"drawdown": bad})


def test_r04_disabled_ignores_the_input_and_sells_like_normal():
    rules = {**RULES, "R-04": {**RULES["R-04"], "enabled": False}}
    r = decide(base_assets(14 * MIL), rules=rules, market_input={"drawdown": 0.5})
    assert r["regime"]["status"] == "not_applied"
    assert {"code": "R-04", "reason": "rule_disabled"} in r["skipped_rules"]
    assert [(s["asset_id"], s["rule"]) for s in sells_of(r)] == [(3, "R-03")]      # 정상 국면 처리 (3버킷 매도 가능)


# ── 가드레일 (R-05, R-06) ────────────────────────────────────────

def test_upper_breach_gives_recommended_payment_without_cutting_essentials():
    items = [{"item_type": "expense_essential", "name": "필수", "monthly_amount": 800_000},
             {"item_type": "expense_discretionary", "name": "선택", "monthly_amount": 200_000}]
    baseline = {"withdrawal_start_date": "2025-10-01", "initial_portfolio_value": 1_000 * MIL, "initial_annual_withdrawal": 20 * MIL}
    r = decide(base_assets(), items=items, baseline=baseline)
    pay = r["payment"]
    assert pay["base_quarterly"] == 3 * MIL                            # 기본 지급액은 그대로
    assert pay["recommended_quarterly"] == 2_940_000                   # (960만 + 240만 × 0.9) ÷ 4
    assert pay["recommended_quarterly"] >= 2_400_000                   # 필수생활비(분기 240만)는 줄이지 않는다
    assert pay["raise_room_quarterly"] is None


def test_lower_breach_gives_raise_room_as_reference_only():
    baseline = {"withdrawal_start_date": "2025-10-01", "initial_portfolio_value": 200 * MIL, "initial_annual_withdrawal": 20 * MIL}
    r = decide(base_assets(), baseline=baseline)
    pay = r["payment"]
    assert pay["raise_room_quarterly"] == 300_000                      # 1,200만 × 10% ÷ 4
    assert pay["base_quarterly"] == 3 * MIL and pay["recommended_quarterly"] is None      # 기본 지급액 불변


def test_guardrail_rules_without_baseline_are_skipped():
    r = decide(base_assets(), baseline=None)
    skipped = {(s["code"], s["reason"]) for s in r["skipped_rules"]}
    assert ("R-05", "baseline_missing") in skipped and ("R-06", "baseline_missing") in skipped
    assert r["payment"]["recommended_quarterly"] is None and r["payment"]["raise_room_quarterly"] is None


def test_payment_is_quarter_of_net_need_rounded_half_up():
    items = [{"item_type": "expense_essential", "name": "x", "monthly_amount": 1_000_000.0416667}]     # 연 12,000,000.5 → ÷4 = 3,000,000.125
    assert decide(base_assets(), items=items)["payment"]["base_quarterly"] == 3_000_000
    odd = [{"item_type": "expense_essential", "name": "x", "monthly_amount": 1_000_000.1666667}]        # 연 12,000,002 → ÷4 = 3,000,000.5
    assert decide(base_assets(), items=odd)["payment"]["base_quarterly"] == 3_000_001


# ── 매도 제약 ─────────────────────────────────────────────────────

def test_sells_never_exceed_asset_value_and_never_include_bucket1_assets():
    assets = [A(1, "cash", 14 * MIL), A(10, "equity", 100 * MIL), A(3, "equity", 120 * MIL), A(2, "bond", 50 * MIL)]
    items = [{"item_type": "expense_essential", "name": "x", "monthly_amount": 10 * MIL}]    # 순인출 연 1.2억
    r = decide(assets, items=items, profiles=[{"holding_id": 10, "bucket": 1}])            # 주식 자산 10 을 1버킷으로 재지정
    values = {a["id"]: a["value"] for a in r["inputs_snapshot"]["assets"]}
    per_asset = {}
    for s in sells_of(r):
        per_asset[s["asset_id"]] = per_asset.get(s["asset_id"], 0) + s["amount"]
    assert per_asset and all(amt <= values[i] for i, amt in per_asset.items())
    assert 10 not in per_asset and 1 not in per_asset                                       # 1버킷 자산은 제외
    assert all(s["bucket"] != 1 for s in sells_of(r))


def test_bucket_override_makes_a_cash_asset_eligible():
    """자산유형이 아니라 실효 버킷이 기준이다: 2버킷으로 재지정한 현금 자산은 매도 후보가 된다."""
    assets = [A(1, "cash", 14 * MIL), A(5, "cash", 40 * MIL), A(2, "bond", 20 * MIL)]
    r = decide(assets, market_input={"drawdown": 0.3}, profiles=[{"holding_id": 5, "bucket": 2}])
    assert {s["asset_id"] for s in sells_of(r)} <= {2, 5} and sells_of(r)
    assert all(s["bucket"] == 2 for s in sells_of(r))
    assert any(s["bucket_source"] == "override" for s in sells_of(r)) or all(s["asset_id"] == 2 for s in sells_of(r))


def test_sell_order_is_by_value_within_class_and_deterministic():
    assets = [A(1, "cash", 14 * MIL), A(3, "equity", 100 * MIL), A(4, "equity", 100 * MIL), A(5, "equity", 60 * MIL)]
    r1, r2 = decide(assets), decide(assets)
    assert r1 == r2
    assert [s["asset_id"] for s in sells_of(r1)][:1] == [3]        # 금액이 같으면 id 오름차순, 큰 자산부터
    assert json.dumps(r1)                                          # JSON 직렬화 가능


def test_inputs_are_not_mutated():
    assets = base_assets()
    check = make(assets)
    snapshot = copy.deepcopy((assets, check, RULES))
    de.compute_decision(as_of=AS_OF, check=check, rules=RULES, assets=assets, market_input={"drawdown": 0.2})
    assert (assets, check, RULES) == snapshot


# ── R-03 허용 폭 두 가지 모드 ────────────────────────────────────

TOTALS = {"cash": 25 * MIL, "bond": 25 * MIL, "equity": 45 * MIL, "income": 5 * MIL}       # 총 1억, 주식 45% (목표 35% → +10%p)


def test_r03_config_mode_boundary_is_inclusive():
    a = de.class_analysis(TOTALS, de.DEFAULT_TARGETS, 0.1, RULES["R-03"])
    assert a["mode"] == "config" and a["applied"] is True
    assert a["classes"]["equity"]["over_band"] is True             # 이탈 10%p == 허용 폭 10%p → 초과 (>=)
    assert a["classes"]["equity"]["excess"] == pytest.approx(10 * MIL)
    assert a["classes"]["income"]["over_band"] is True and a["classes"]["income"]["excess"] == 0   # 부족한 자산군은 매도 원천 아님
    just_under = {"cash": 25 * MIL, "bond": 25 * MIL, "equity": 44.9 * MIL, "income": 5.1 * MIL}
    b = de.class_analysis(just_under, de.DEFAULT_TARGETS, 0.1, RULES["R-03"])
    assert b["classes"]["equity"]["over_band"] is False and b["classes"]["equity"]["excess"] == 0


def test_r03_empty_parameters_behave_as_config_and_missing_threshold_uses_default():
    a = de.class_analysis(TOTALS, de.DEFAULT_TARGETS, None, {"enabled": True, "parameters": {}})
    b = de.class_analysis(TOTALS, de.DEFAULT_TARGETS, 0.1, {"enabled": True, "parameters": {"mode": "config"}})
    assert a["mode"] == "config" and a["classes"] == b["classes"]
    assert a["classes"]["equity"]["band"] == pytest.approx(0.1)


def test_r03_threshold_zero_warns_and_flags_every_class():
    r = decide(base_assets(), rebalance_threshold=0)
    assert {"code": "threshold_zero", "values": {"rebalance_threshold": 0.0}} in r["warnings"]
    assert all(c["over_band"] for c in r["inputs_snapshot"]["class_weights"].values())     # 0 이면 모든 자산군이 초과
    ok = decide(base_assets(), rebalance_threshold=0.1)
    assert not any(w["code"] == "threshold_zero" for w in ok["warnings"])


def test_r03_relative_mode_uses_target_times_relative_with_min_abs_floor():
    rule = {"enabled": True, "parameters": {"mode": "relative", "relative": 0.2, "min_abs": 0.03}}
    a = de.class_analysis(TOTALS, {"cash": 0.25, "bond": 0.25, "equity": 0.35, "income": 0.10}, 0.5, rule)
    assert a["mode"] == "relative"
    assert a["classes"]["cash"]["band"] == pytest.approx(0.05)
    assert a["classes"]["equity"]["band"] == pytest.approx(0.07)
    assert a["classes"]["income"]["band"] == pytest.approx(0.03)          # 0.10 × 0.2 = 0.02 → 최소 0.03 적용
    assert a["classes"]["equity"]["over_band"] is True                    # 이탈 0.10 ≥ 0.07


def test_r03_relative_boundary_is_inclusive():
    rule = {"enabled": True, "parameters": {"mode": "relative", "relative": 0.2, "min_abs": 0.0}}
    totals = {"cash": 25 * MIL, "bond": 25 * MIL, "equity": 42 * MIL, "income": 8 * MIL}      # 주식 42% vs 목표 35% → +7%p == 35% × 0.2
    a = de.class_analysis(totals, de.DEFAULT_TARGETS, 0.5, rule)
    assert a["classes"]["equity"]["over_band"] is True


@pytest.mark.parametrize("params", [
    {"mode": "relative", "relative": 1.5, "min_abs": 0.03}, {"mode": "relative", "relative": 0, "min_abs": 0.03},
    {"mode": "relative", "relative": 0.2}, {"mode": "relative", "relative": 0.2, "min_abs": 1.5}, {"mode": "unknown"},
])
def test_r03_invalid_parameters_are_skipped_not_guessed(params):
    a = de.class_analysis(TOTALS, de.DEFAULT_TARGETS, 0.1, {"enabled": True, "parameters": params})
    assert a["applied"] is False and a["skip_reason"] == "rule_parameters_invalid"
    assert not any(c["over_band"] for c in a["classes"].values())


def test_r03_disabled_or_missing_is_skipped_and_stops_over_band_selling():
    rules = {**RULES, "R-03": {**RULES["R-03"], "enabled": False}}
    r = decide(base_assets(18 * MIL), rules=rules)                       # min~target 구간: 초과 자산군 판단 없이는 보충하지 않는다
    assert {"code": "R-03", "reason": "rule_disabled"} in r["skipped_rules"]
    assert concl(r) == ("pay_only", "below_target_no_excess") and r["conclusion"]["reasons"][0]["values"]["r03_applied"] is False
    missing = {k: v for k, v in RULES.items() if k != "R-03"}
    assert {"code": "R-03", "reason": "rule_missing"} in decide(base_assets(), rules=missing)["skipped_rules"]


def test_class_analysis_handles_empty_portfolio():
    a = de.class_analysis({}, de.DEFAULT_TARGETS, 0.1, RULES["R-03"])
    assert a["total"] == 0
    assert all(c["weight"] is None and c["over_band"] is False and c["excess"] == 0 for c in a["classes"].values())


# ── 규칙 비활성화·누락 ───────────────────────────────────────────

def test_r01_disabled_skips_refill_judgment():
    rules = {**RULES, "R-01": {**RULES["R-01"], "enabled": False}}
    r = decide(base_assets(14 * MIL), rules=rules)
    assert concl(r) == ("pay_only", "r01_not_applied") and sells_of(r) == []
    assert {"code": "R-01", "reason": "rule_disabled"} in r["skipped_rules"] and "R-01" not in r["applied_rules"]


def test_r01_invalid_parameters_are_skipped():
    rules = {**RULES, "R-01": {"enabled": True, "parameters": {"min_years": 1.0}}}
    r = decide(base_assets(14 * MIL), rules=rules)
    assert concl(r)[1] == "r01_not_applied"
    assert {"code": "R-01", "reason": "rule_parameters_invalid"} in r["skipped_rules"]


def test_r05_r06_disabled_are_skipped_and_payment_has_no_guidance():
    rules = {**RULES, "R-05": {**RULES["R-05"], "enabled": False}, "R-06": {**RULES["R-06"], "enabled": False}}
    baseline = {"withdrawal_start_date": "2025-10-01", "initial_portfolio_value": 1_000 * MIL, "initial_annual_withdrawal": 20 * MIL}
    r = decide(base_assets(), baseline=baseline, rules=rules)
    assert r["payment"]["recommended_quarterly"] is None and r["payment"]["raise_room_quarterly"] is None
    skipped = {(s["code"], s["reason"]) for s in r["skipped_rules"]}
    assert ("R-05", "rule_disabled") in skipped and ("R-06", "rule_disabled") in skipped


def test_applied_rules_lists_only_rules_actually_used():
    r = decide(base_assets(14 * MIL), market_input={"drawdown": 0.05},
               baseline={"withdrawal_start_date": "2025-10-01", "initial_portfolio_value": 300 * MIL, "initial_annual_withdrawal": 12 * MIL})
    assert r["applied_rules"] == ["R-01", "R-03", "R-04", "R-05", "R-06", "R-07"] and r["skipped_rules"] == []


# ── 순인출 필요액 0 ───────────────────────────────────────────────

def test_zero_net_need_is_hold():
    items = [{"item_type": "expense_essential", "name": "x", "monthly_amount": 1_000_000},
             {"item_type": "income_regular", "name": "연금", "monthly_amount": 2_000_000}]
    r = decide(base_assets(), items=items)
    assert concl(r) == ("hold", "no_net_need")
    assert r["payment"]["base_quarterly"] == 0 and sells_of(r) == [] and r["account_checks"] == []
    no_items = decide(base_assets(), items=[])
    assert concl(no_items) == ("hold", "no_net_need")


# ── 계좌 확인 항목 (R-07) ────────────────────────────────────────

def test_account_checks_by_account_type_and_pension_reference():
    assets = [A(1, "cash", 14 * MIL), A(3, "equity", 5 * MIL, tax="isa"),
              A(4, "equity", 100 * MIL, tax="pension_savings"), A(5, "equity", 20 * MIL, tax="regular")]
    usage = {"year": 2026, "pension_savings_ytd": 5 * MIL, "retirement_pension_ytd": 2 * MIL, "ytd_total": 7 * MIL,
             "annual_limit": 15 * MIL}
    r = decide(assets, rebalance_threshold=0.01, pension_usage=usage,
               items=[{"item_type": "expense_essential", "name": "x", "monthly_amount": 3 * MIL}])
    checks = {c["asset_id"]: c for c in r["account_checks"]}
    sold_ids = {s["asset_id"] for s in sells_of(r)}
    assert set(checks) == sold_ids and sold_ids
    for aid, c in checks.items():
        t = c["account_type"]
        assert c["items"] == de.ACCOUNT_ITEMS[t]
        if t == "pension_savings":
            assert c["reference"]["ytd_total"] == 7 * MIL and c["reference"]["remaining"] == 8 * MIL
            assert "in_account_cash" in c["items"] and "pension_annual_limit" in c["items"]
        else:
            assert c["reference"] is None
    if 3 in checks:
        assert "isa_holding_period" in checks[3]["items"]
    if 5 in checks:
        assert checks[5]["items"] == ["capital_gain_and_dividend_tax"]


def test_pension_reference_is_none_without_usage_and_never_computes_tax():
    r = decide([A(1, "cash", 14 * MIL), A(4, "equity", 200 * MIL, tax="retirement_pension")])
    c = r["account_checks"][0]
    assert c["account_type"] == "retirement_pension" and c["reference"] is None
    assert "tax_amount" not in json.dumps(r)


def test_r07_disabled_skips_account_checks():
    rules = {**RULES, "R-07": {**RULES["R-07"], "enabled": False}}
    r = decide(base_assets(14 * MIL), rules=rules)
    assert sells_of(r) and r["account_checks"] == []
    assert {"code": "R-07", "reason": "rule_disabled"} in r["skipped_rules"]


# ── 출력 형태 ─────────────────────────────────────────────────────

def test_output_structure_and_snapshot_allow_reproducing_the_decision():
    r = decide(base_assets(14 * MIL), market_input={"index_name": "KOSPI", "drawdown": 0.1})
    assert set(r) >= {"as_of", "period", "inputs_snapshot", "payment", "regime", "refill", "bucket1_after",
                      "account_checks", "conclusion", "applied_rules", "skipped_rules", "assumptions"}
    assert r["as_of"] == "2026-10-05" and r["period"] == "2026-Q4"
    snap = r["inputs_snapshot"]
    assert set(snap) >= {"net_need", "buckets", "class_weights", "targets", "rules", "market_input", "assets"}
    assert snap["market_input"] == {"index_name": "KOSPI", "drawdown": 0.1}
    assert snap["rules"]["R-01"]["parameters"] == {"min_years": 1.0, "target_years": 2.0}
    assert {a["id"] for a in snap["assets"]} == {1, 2, 3, 4}
    assert set(r["conclusion"]) == {"type", "summary_code", "reasons"} and r["assumptions"]
    for reason in r["conclusion"]["reasons"]:                     # 사람이 읽는 문장이 아니라 코드와 수치
        assert set(reason) == {"code", "values"} and isinstance(reason["code"], str) and isinstance(reason["values"], dict)


def test_engine_never_writes_or_changes_balances():
    assets = base_assets(14 * MIL)
    before = copy.deepcopy(assets)
    decide(assets)
    assert assets == before                                           # 자산 잔액을 바꾸지 않는다
    src = Path(de.__file__).read_text(encoding="utf-8")
    for forbidden in ("supabase", "from database", "import database", ".table(", ".execute("):
        assert forbidden not in src, f"엔진에 DB 접근이 있습니다: {forbidden}"      # 저장·쓰기 동작이 없는 순수 함수
