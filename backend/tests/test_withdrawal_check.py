"""생활비·버킷 점검 계산 테스트 (지시서 02, 단계 B).

- 순수 함수 테스트 — DB 접근 없음, 모든 호출에 기준일 as_of 를 고정해서 넘긴다.
- 계산 모듈에 오늘 날짜 호출이 없는지 소스 검사도 포함.

실행: backend/ 디렉터리에서 `pytest tests/test_withdrawal_check.py -v`
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import date, datetime
from pathlib import Path

import pytest

import withdrawal_check as wc
from utils import BUCKET_MAP

AS_OF = date(2026, 9, 20)

RULES = {
    "R-01": {"enabled": True, "parameters": {"min_years": 1.0, "target_years": 2.0}},
    "R-02": {"enabled": True, "parameters": {"target_years": 5.0}},
    "R-05": {"enabled": True, "parameters": {"upper_multiplier": 1.2, "cut_ratio": 0.10}},
    "R-06": {"enabled": True, "parameters": {"lower_multiplier": 0.8, "raise_ratio": 0.10}},
}


def asset(id_, asset_type, value, active=True, name=None):
    return {"id": id_, "asset_name": name or f"자산{id_}", "account_name": "계좌", "asset_type": asset_type,
            "current_value": value, "is_active": active}


def item(kind, monthly, start=None, end=None, name=None):
    return {"item_type": kind, "name": name or kind, "monthly_amount": monthly, "start_date": start, "end_date": end}


def baseline(pv=1_000_000_000, annual=40_000_000):
    return {"withdrawal_start_date": "2025-09-01", "initial_portfolio_value": pv, "initial_annual_withdrawal": annual}


def run(**over):
    args = dict(as_of=AS_OF, assets=[], profiles=[], cashflow_items=[], baseline=None, rules=RULES, withdrawals=None)
    args.update(over)
    return wc.compute_withdrawal_check(**args)


# ── 종합 시나리오 (손계산 값과 대조) ───────────────────────────────

def test_full_scenario_matches_hand_calculation():
    r = run(
        assets=[asset(1, "cash", 60_000_000), asset(2, "bond", 200_000_000), asset(3, "equity", 700_000_000),
                asset(4, "tdf", 50_000_000, active=False)],
        cashflow_items=[item("expense_essential", 2_000_000), item("expense_discretionary", 1_000_000),
                        item("income_regular", 1_500_000, start="2026-01-01")],
        baseline=baseline(),
    )
    net = r["net_need"]
    assert net["annual_total"] == 18_000_000            # (200 + 100 − 150)만 × 12
    assert net["annual_essential"] == 6_000_000         # (200 − 150)만 × 12
    assert net["monthly_total"] == 1_500_000
    assert r["total_assets"] == 960_000_000             # 비활성 제외
    b = {x["bucket"]: x for x in r["buckets"]}
    assert b[1]["years_total"] == pytest.approx(60 / 18)
    assert b[1]["years_essential"] == pytest.approx(10.0)
    assert r["cumulative"]["b1_b2_years_total"] == pytest.approx(260 / 18)
    assert r["cumulative"]["all_years_total"] == pytest.approx(960 / 18)
    assert r["rules"]["R-01"]["status"] == "ok"
    assert r["rules"]["R-02"]["status"] == "ok"
    wr = r["withdrawal_rate"]
    assert wr["initial"] == pytest.approx(0.04)
    assert wr["current_plan"] == pytest.approx(0.01875)
    assert wr["ratio_to_initial"] == pytest.approx(0.46875)
    assert r["rules"]["R-05"]["status"] == "within"
    assert r["rules"]["R-06"]["status"] == "lower_breach"
    assert r["rules"]["R-06"]["suggestion_amount"] == pytest.approx(1_800_000)     # 순인출 1,800만 × 10%
    assert r["rules"]["guardrail"] == "lower_breach"
    assert r["as_of"] == "2026-09-20"
    assert r["assumptions"] and r["provenance"]["observed"]


# ── 4.1 실효 버킷 ─────────────────────────────────────────────────

def test_effective_bucket_override_vs_default():
    a = asset(1, "equity", 100)
    assert wc.effective_bucket(a, None) == {"default_bucket": 3, "effective_bucket": 3, "bucket_source": "default"}
    assert wc.effective_bucket(a, {"bucket": None}) == {"default_bucket": 3, "effective_bucket": 3, "bucket_source": "default"}
    assert wc.effective_bucket(a, {"bucket": 2}) == {"default_bucket": 3, "effective_bucket": 2, "bucket_source": "override"}


def test_effective_bucket_unknown_type_without_override():
    a = asset(1, "crypto", 100)
    assert wc.effective_bucket(a, None)["effective_bucket"] is None
    assert wc.effective_bucket(a, {"bucket": 1})["effective_bucket"] == 1


def test_bucket_map_not_modified():
    assert BUCKET_MAP == {"cash": 1, "bond": 2, "tdf": 2, "fund": 2, "equity": 3, "income": 3}


def test_override_moves_value_between_buckets():
    r = run(assets=[asset(1, "equity", 300), asset(2, "cash", 100)], profiles=[{"holding_id": 1, "bucket": 1}],
            cashflow_items=[item("expense_essential", 10)])
    b = {x["bucket"]: x for x in r["buckets"]}
    assert b[1]["value"] == 400 and b[3]["value"] == 0
    rows = {x["id"]: x for x in r["assets"]}
    assert rows[1]["bucket_source"] == "override" and rows[1]["default_bucket"] == 3 and rows[1]["effective_bucket"] == 1
    assert rows[2]["bucket_source"] == "default"
    assert r["completeness"]["default_bucket_count"] == 1


def test_unassigned_assets_are_reported_not_dropped_from_total():
    r = run(assets=[asset(1, "cash", 100), asset(2, "crypto", 50)], cashflow_items=[item("expense_essential", 10)])
    assert r["total_assets"] == 150
    assert r["unassigned"] == {"count": 1, "value": 50}
    assert {"field": "buckets", "code": "unassigned_assets"} in r["reasons"]


def test_inactive_assets_excluded():
    r = run(assets=[asset(1, "cash", 100), asset(2, "cash", 999, active=False)])
    assert r["total_assets"] == 100
    assert len(r["assets"]) == 1


# ── 4.2 순인출 필요액: 유효기간 경계 ───────────────────────────────

def test_effective_period_boundaries():
    items = [
        item("expense_essential", 100, start="2026-09-20"),                   # 시작일 당일 → 유효
        item("expense_essential", 200, end="2026-09-20"),                     # 종료일 당일 → 유효
        item("expense_essential", 400, start="2026-09-21"),                   # 내일 시작 → 예정
        item("expense_essential", 800, end="2026-09-19"),                     # 어제 종료 → 제외
        item("expense_essential", 1600, start="2020-01-01", end="2030-01-01"),
        item("expense_essential", 3200),                                      # 기간 없음
    ]
    net = wc.compute_net_need(items, AS_OF)
    assert net["gross"]["essential_annual"] == (100 + 200 + 1600 + 3200) * 12
    assert net["counts"] == {"active_expense": 4, "active_income": 0, "upcoming": 1, "ended": 1}
    assert net["upcoming_expense"] == [{"name": "expense_essential", "monthly_amount": 400, "start_date": "2026-09-21"}]


def test_upcoming_income_not_summed_but_listed():
    items = [item("expense_essential", 1_000_000), item("income_regular", 800_000, start="2027-01-01", name="국민연금")]
    net = wc.compute_net_need(items, AS_OF)
    assert net["annual_total"] == 12_000_000            # 개시 전 수입은 차감하지 않음
    assert net["upcoming_income"] == [{"name": "국민연금", "monthly_amount": 800_000, "start_date": "2027-01-01"}]
    later = wc.compute_net_need(items, date(2027, 1, 1))                     # 개시일 당일부터 반영
    assert later["annual_total"] == (1_000_000 - 800_000) * 12
    assert later["upcoming_income"] == []


def test_dates_accept_strings_and_dates():
    a = wc.compute_net_need([item("expense_essential", 100, start=date(2026, 9, 20))], AS_OF)
    b = wc.compute_net_need([item("expense_essential", 100, start="2026-09-20")], AS_OF)
    assert a == b


def test_net_need_zero_when_income_exceeds_expense():
    net = wc.compute_net_need([item("expense_essential", 1_000_000), item("income_regular", 3_000_000)], AS_OF)
    assert net["annual_total"] == 0 and net["annual_essential"] == 0 and net["monthly_total"] == 0


def test_essential_net_and_total_net_are_independent():
    net = wc.compute_net_need([item("expense_essential", 100), item("expense_discretionary", 100),
                               item("income_regular", 150)], AS_OF)
    assert net["annual_total"] == 50 * 12               # 200 − 150
    assert net["annual_essential"] == 0                 # 100 − 150 → 0


def test_no_net_need_gives_null_years_with_reason():
    r = run(assets=[asset(1, "cash", 100)], cashflow_items=[item("expense_essential", 100), item("income_regular", 500)])
    assert r["net_need"]["annual_total"] == 0
    assert all(b["years_total"] is None for b in r["buckets"])
    assert r["cumulative"]["all_years_total"] is None
    assert r["rules"]["R-01"]["status"] is None and r["rules"]["R-01"]["reason"] == "no_net_need"
    assert {"field": "net_need", "code": "no_net_need"} in r["reasons"]


def test_no_cashflow_at_all():
    r = run(assets=[asset(1, "cash", 100)])
    assert r["completeness"]["cashflow_set"] is False
    assert r["net_need"]["annual_total"] == 0


# ── 4.4 R-01, R-02 경계 ───────────────────────────────────────────

NEED_12M = [item("expense_essential", 1_000_000)]        # 순인출 필요액 연 1,200만원


@pytest.mark.parametrize("b1_value, expected", [
    (11_999_999, "below_min"),       # 1.0년 미만
    (12_000_000, "below_target"),    # min 과 같음 → below_min 아님
    (23_999_999, "below_target"),
    (24_000_000, "ok"),              # target 과 같음 → ok
    (50_000_000, "ok"),
])
def test_r01_boundaries(b1_value, expected):
    r = run(assets=[asset(1, "cash", b1_value)], cashflow_items=NEED_12M)
    assert r["rules"]["R-01"]["status"] == expected


def test_r01_shortfall_reference_amount():
    r = run(assets=[asset(1, "cash", 10_000_000)], cashflow_items=NEED_12M)
    assert r["rules"]["R-01"]["shortfall"] == 14_000_000       # 2.0년 × 1,200만 − 1,000만
    ok = run(assets=[asset(1, "cash", 30_000_000)], cashflow_items=NEED_12M)
    assert ok["rules"]["R-01"]["shortfall"] == 0


@pytest.mark.parametrize("b2_value, expected", [(59_999_999, "below_target"), (60_000_000, "ok"), (90_000_000, "ok")])
def test_r02_boundaries_use_b2_alone(b2_value, expected):
    # 1버킷이 커도 2버킷 단독 연수만 본다
    r = run(assets=[asset(1, "cash", 500_000_000), asset(2, "bond", b2_value)], cashflow_items=NEED_12M)
    assert r["rules"]["R-02"]["status"] == expected
    assert r["rules"]["R-02"]["years"] == pytest.approx(b2_value / 12_000_000)


def test_r02_shortfall():
    r = run(assets=[asset(2, "bond", 20_000_000)], cashflow_items=NEED_12M)
    assert r["rules"]["R-02"]["shortfall"] == 40_000_000       # 5.0년 × 1,200만 − 2,000만


# ── 규칙 비활성화·누락 ────────────────────────────────────────────

def test_disabled_rules_are_not_judged():
    rules = {k: {**v, "enabled": False} for k, v in RULES.items()}
    r = run(assets=[asset(1, "cash", 1)], cashflow_items=NEED_12M, baseline=baseline(), rules=rules)
    for code in ("R-01", "R-02", "R-05", "R-06"):
        assert r["rules"][code]["status"] is None
        assert r["rules"][code]["reason"] == "rule_disabled"
    assert r["rules"]["guardrail"] is None


def test_missing_rules_and_bad_parameters():
    r = run(assets=[asset(1, "cash", 1)], cashflow_items=NEED_12M, baseline=baseline(), rules={})
    assert r["rules"]["R-01"]["reason"] == "rule_missing"
    bad = {**RULES, "R-01": {"enabled": True, "parameters": {"min_years": 1.0}},
           "R-05": {"enabled": True, "parameters": {"upper_multiplier": 1.2}}}
    r = run(assets=[asset(1, "cash", 1)], cashflow_items=NEED_12M, baseline=baseline(), rules=bad)
    assert r["rules"]["R-01"]["reason"] == "rule_parameters_invalid"
    assert r["rules"]["R-05"]["reason"] == "rule_parameters_invalid"


def test_one_disabled_guardrail_does_not_block_the_other():
    rules = {**RULES, "R-05": {**RULES["R-05"], "enabled": False}}
    r = run(assets=[asset(1, "cash", 300_000_000)], cashflow_items=NEED_12M, baseline=baseline(), rules=rules)
    assert r["rules"]["R-05"]["status"] is None
    assert r["rules"]["R-06"]["status"] in ("within", "lower_breach")


# ── 4.5 인출률·가드레일 ───────────────────────────────────────────

def guard_run(total_assets, discretionary=0, initial_annual=50_000_000, initial_pv=1_000_000_000):
    """초기 인출률 5.0%, 순인출 연 1,200만원 고정. 현재 인출률 = 1,200만 ÷ total_assets."""
    items = [item("expense_essential", 1_000_000)]
    if discretionary:
        items = [item("expense_essential", 1_000_000 - discretionary), item("expense_discretionary", discretionary)]
    return run(assets=[asset(1, "cash", total_assets)], cashflow_items=items,
               baseline=baseline(initial_pv, initial_annual))


def test_guardrail_upper_boundary():
    same = guard_run(200_000_000)                       # 현재 6.0% ÷ 초기 5.0% = 1.2 → 배수와 같음
    assert same["withdrawal_rate"]["ratio_to_initial"] == pytest.approx(1.2)
    assert same["rules"]["R-05"]["status"] == "within"
    above = guard_run(199_000_000)
    assert above["rules"]["R-05"]["status"] == "upper_breach"
    assert above["rules"]["guardrail"] == "upper_breach"


def test_guardrail_lower_boundary():
    same = guard_run(300_000_000)                       # 현재 4.0% ÷ 5.0% = 0.8 → 배수와 같음
    assert same["withdrawal_rate"]["ratio_to_initial"] == pytest.approx(0.8)
    assert same["rules"]["R-06"]["status"] == "within"
    below = guard_run(301_000_000)
    assert below["rules"]["R-06"]["status"] == "lower_breach"
    assert below["rules"]["guardrail"] == "lower_breach"
    assert guard_run(250_000_000)["rules"]["guardrail"] == "within"


def test_upper_suggestion_cuts_discretionary_only():
    r = guard_run(100_000_000, discretionary=400_000)        # 선택생활비 월 40만 → 연 480만
    assert r["rules"]["R-05"]["status"] == "upper_breach"
    assert r["rules"]["R-05"]["suggestion_amount"] == pytest.approx(4_800_000 * 0.10)
    none_disc = guard_run(100_000_000)                       # 선택생활비가 없으면 감액 여지 0
    assert none_disc["rules"]["R-05"]["suggestion_amount"] == 0


def test_lower_suggestion_is_raise_ratio_of_net_need():
    r = guard_run(600_000_000)
    assert r["rules"]["R-06"]["status"] == "lower_breach"
    assert r["rules"]["R-06"]["suggestion_amount"] == pytest.approx(12_000_000 * 0.10)


def test_baseline_missing():
    r = run(assets=[asset(1, "cash", 100_000_000)], cashflow_items=NEED_12M, baseline=None)
    wr = r["withdrawal_rate"]
    assert wr["initial"] is None and wr["ratio_to_initial"] is None
    assert wr["reasons"]["initial"] == "baseline_missing"
    assert r["rules"]["R-05"]["reason"] == "baseline_missing"
    assert r["rules"]["guardrail"] is None
    assert r["completeness"]["baseline_set"] is False
    assert r["baseline"] is None


def test_zero_division_cases():
    zero_pv = run(assets=[asset(1, "cash", 100)], cashflow_items=NEED_12M, baseline=baseline(pv=0))
    assert zero_pv["withdrawal_rate"]["initial"] is None
    assert zero_pv["withdrawal_rate"]["reasons"]["initial"] == "baseline_portfolio_zero"
    no_assets = run(assets=[], cashflow_items=NEED_12M, baseline=baseline())
    assert no_assets["withdrawal_rate"]["current_plan"] is None
    assert no_assets["withdrawal_rate"]["reasons"]["current_plan"] == "no_assets"
    assert no_assets["completeness"]["default_bucket_value_share"] is None
    zero_initial = run(assets=[asset(1, "cash", 100)], cashflow_items=NEED_12M, baseline=baseline(annual=0))
    assert zero_initial["withdrawal_rate"]["initial"] == 0
    assert zero_initial["withdrawal_rate"]["reasons"]["ratio"] == "initial_rate_zero"


# ── 실적 인출률 (참고) ────────────────────────────────────────────

def w(day, amount=1_000_000):
    return {"withdrawal_date": day, "amount": amount}


def test_actual_rate_window_boundaries():
    ws = [w("2025-09-20"),            # 정확히 12개월 전 → 제외
          w("2025-09-21"),            # 포함
          w("2026-09-20"),            # 기준일 당일 → 포함
          w("2026-09-21")]            # 미래 → 제외
    r = run(assets=[asset(1, "cash", 100_000_000)], cashflow_items=NEED_12M, baseline=baseline(), withdrawals=ws)
    wr = r["withdrawal_rate"]
    assert wr["actual_12m_count"] == 2
    assert wr["actual_12m_total"] == 2_000_000
    assert wr["current_actual"] == pytest.approx(0.02)


def test_actual_rate_window_on_leap_day():
    assert wc.minus_months(date(2028, 2, 29), 12) == date(2027, 2, 28)
    assert wc.minus_months(date(2026, 3, 31), 1) == date(2026, 2, 28)
    assert wc.minus_months(date(2026, 1, 15), 2) == date(2025, 11, 15)


def test_actual_rate_without_data_is_null_not_zero():
    none_provided = run(assets=[asset(1, "cash", 100)], cashflow_items=NEED_12M, withdrawals=None)
    assert none_provided["withdrawal_rate"]["current_actual"] is None
    assert none_provided["withdrawal_rate"]["reasons"]["current_actual"] == "withdrawals_not_provided"
    empty = run(assets=[asset(1, "cash", 100)], cashflow_items=NEED_12M, withdrawals=[])
    assert empty["withdrawal_rate"]["current_actual"] is None
    assert empty["withdrawal_rate"]["reasons"]["current_actual"] == "no_withdrawals_12m"
    old_only = run(assets=[asset(1, "cash", 100)], cashflow_items=NEED_12M, withdrawals=[w("2020-01-01")])
    assert old_only["withdrawal_rate"]["reasons"]["current_actual"] == "no_withdrawals_12m"


def test_actual_rate_is_not_used_for_guardrail():
    heavy = [w("2026-08-01", 500_000_000)]
    r = run(assets=[asset(1, "cash", 300_000_000)], cashflow_items=NEED_12M, baseline=baseline(annual=50_000_000),
            withdrawals=heavy)
    assert r["withdrawal_rate"]["current_actual"] > 1          # 실적은 크지만
    assert r["rules"]["R-05"]["status"] == "within"            # 판정은 계획 기준 (4.0% ÷ 5.0% = 0.8)


# ── 4.6 완성도 ────────────────────────────────────────────────────

def test_completeness_counts_and_value_share():
    r = run(assets=[asset(1, "cash", 300), asset(2, "equity", 700)], profiles=[{"holding_id": 2, "bucket": 3}],
            cashflow_items=NEED_12M, baseline=baseline())
    c = r["completeness"]
    assert c["active_assets"] == 2
    assert c["default_bucket_count"] == 1 and c["no_profile_count"] == 1
    assert c["default_bucket_value_share"] == pytest.approx(0.3)
    assert c["baseline_set"] is True and c["cashflow_set"] is True


def test_profile_without_bucket_is_default_but_has_profile():
    r = run(assets=[asset(1, "cash", 100)], profiles=[{"holding_id": 1, "bucket": None}], cashflow_items=NEED_12M)
    c = r["completeness"]
    assert c["default_bucket_count"] == 1 and c["no_profile_count"] == 0


# ── 순수성 ───────────────────────────────────────────────────────

def test_module_never_reads_todays_date():
    src = Path(wc.__file__).read_text(encoding="utf-8")
    assert "today" not in src.lower()
    assert "datetime.now" not in src and "date.today" not in src


def test_as_of_is_required_and_must_be_a_date():
    with pytest.raises(TypeError):
        run(as_of="2026-09-20")
    with pytest.raises(TypeError):
        run(as_of=datetime(2026, 9, 20, 12, 0))
    with pytest.raises(TypeError):
        wc.compute_withdrawal_check(assets=[], profiles=[], cashflow_items=[], baseline=None, rules={})


def test_result_changes_with_as_of_only():
    items = [item("expense_essential", 1_000_000), item("income_regular", 500_000, start="2026-10-01")]
    before = run(cashflow_items=items, as_of=date(2026, 9, 30))
    after = run(cashflow_items=items, as_of=date(2026, 10, 1))
    assert before["net_need"]["annual_total"] == 12_000_000
    assert after["net_need"]["annual_total"] == 6_000_000
    assert run(cashflow_items=items, as_of=date(2026, 9, 30)) == before        # 같은 입력 → 같은 결과


def test_reasons_list_shape():
    r = run(assets=[asset(1, "cash", 100)], cashflow_items=NEED_12M)
    assert all(set(x) == {"field", "code"} for x in r["reasons"])
    assert {"field": "withdrawal_rate.initial", "code": "baseline_missing"} in r["reasons"]
