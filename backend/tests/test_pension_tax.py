"""
연금소득세 핵심 계산 함수 단위 테스트 (v2 — 듀얼 트랙 모델).

테스트 케이스: 작업지시서 2단계 v2 '계산 로직 검증용 테스트 케이스' 10개.
DB 접근 없음 — 순수 함수(calc_depletion, calc_track_limit_ytd, build_track,
calc_phases, calc_over_warning, calc_limit_breakdown)만 테스트.

실행: backend/ 디렉터리에서 `pytest tests/test_pension_tax.py -v`
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import date

import pytest
from fastapi import HTTPException

from routers.pension_tax import (
    calc_depletion,
    calc_track_limit_ytd,
    build_track,
    calc_phases,
    calc_over_warning,
    calc_limit_breakdown,
    MONTHLY_CAP,
)
from tax_constants import PRIVATE_PENSION_ANNUAL_LIMIT


def _months_between(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month)


# ── 케이스 1: 퇴직연금 원금 2억, 월 100만, 개시 2026-07, 실적 없음 ──
# 기대: 과세 전환 ≈ 200개월 후(≈2043-02), is_estimate=True

def test_case1_rp_depletion_200months():
    result = calc_depletion(
        principal=200_000_000,
        start_date=date(2026, 7, 1),
        monthly_amount=1_000_000,
        records=[],
    )
    assert result["is_estimate"] is True
    assert result["is_depleted"] is False
    assert result["months_remaining"] == 200

    dep = date.fromisoformat(result["depletion_date"])
    today = date.today()
    assert 199 <= _months_between(today, dep) <= 201


# ── 케이스 2: 개인연금 비과세 원금 3,600만, 월 60만, 개시 2026-01 ──
# 기대: 과세 전환 ≈ 개시 후 60개월 (≈2031-01)

def test_case2_pp_depletion_60months():
    start = date(2026, 1, 1)
    result = calc_depletion(
        principal=36_000_000,
        start_date=start,
        monthly_amount=600_000,
        records=[],
    )
    assert result["is_estimate"] is True
    dep = date.fromisoformat(result["depletion_date"])
    assert 59 <= _months_between(start, dep) <= 61


# ── 케이스 3: pp_deducted_principal 0 → 5,000만 변경 → 과세 전환 시점 불변 ──

def test_case3_deducted_principal_does_not_affect_tax_start():
    base_plan = {
        "pp_non_deducted_principal": 36_000_000,
        "pp_start_date":             "2026-01-01",
        "pp_monthly_amount":         600_000,
        "pp_deducted_principal":     0,
    }
    track_a = build_track("pension_savings", base_plan, [])
    track_b = build_track("pension_savings", {**base_plan, "pp_deducted_principal": 50_000_000}, [])
    assert track_a["tax_start_date"] is not None
    assert track_a["tax_start_date"] == track_b["tax_start_date"]
    assert track_a["depletion"] == track_b["depletion"]


# ── 케이스 4: 개인연금 비과세 원금 0 → 개시일부터 즉시 과세 ──

def test_case4_pp_zero_principal_immediate_tax():
    plan = {
        "pp_non_deducted_principal": 0,
        "pp_start_date":             "2026-03-01",
        "pp_monthly_amount":         500_000,
    }
    track = build_track("pension_savings", plan, [])
    assert track["active"] is True
    assert track["tax_start_date"] == "2026-03-01"
    assert track["depletion"]["is_depleted"] is True


# ── 케이스 5: 과세 전환 전 해에 퇴직연금 인출 1,800만 → 한도 게이지 0 ──

def test_case5_principal_stage_withdrawal_excluded():
    records = [
        {"withdrawal_date": "2025-06-01", "amount": 18_000_000},
    ]
    result = calc_track_limit_ytd(
        year=2025,
        records=records,
        start_date=date(2025, 1, 1),
        principal=200_000_000,
    )
    assert result == 0.0


# ── 케이스 6: 개인연금만 과세 단계 연 800만 + 퇴직연금 원금 구간 연 1,200만 ──
# 기대: 한도 대상 800만 — 퇴직연금분 미합산 (과세 기간 비겹침)

def test_case6_only_taxable_track_counted():
    plan = {
        # 퇴직연금: 원금 2억 — 2026년 인출은 전부 원금 구간
        "severance_principal":       200_000_000,
        "pension_start_date":        "2025-01-01",
        "monthly_pension_amount":    1_000_000,
        # 개인연금: 비과세 원금 100만 — 2020년에 이미 소진
        "pp_non_deducted_principal": 1_000_000,
        "pp_start_date":             "2020-01-01",
        "pp_monthly_amount":         700_000,
    }
    withdrawals = [
        {"withdrawal_date": "2020-02-01", "amount": 2_000_000, "tax_account_type": "pension_savings"},
        {"withdrawal_date": "2026-03-01", "amount": 8_000_000, "tax_account_type": "pension_savings"},
        {"withdrawal_date": "2026-04-01", "amount": 12_000_000, "tax_account_type": "retirement_pension"},
    ]
    breakdown = calc_limit_breakdown(2026, withdrawals, plan)
    assert breakdown["pension_savings_ytd"] == 8_000_000
    assert breakdown["retirement_pension_ytd"] == 0.0
    assert breakdown["ytd_total"] == 8_000_000


# ── 케이스 7: 두 계좌 모두 과세 단계, 개인연금 700만 + 퇴직연금 900만 ──
# 기대: 합산 1,600만 → 한도 초과

def test_case7_both_taxable_over_limit():
    plan = {
        "severance_principal":       1_000_000,
        "pension_start_date":        "2024-01-01",
        "monthly_pension_amount":    1_000_000,
        "pp_non_deducted_principal": 1_000_000,
        "pp_start_date":             "2024-01-01",
        "pp_monthly_amount":         700_000,
    }
    withdrawals = [
        # 2024년에 두 계좌 모두 비과세 풀 소진
        {"withdrawal_date": "2024-02-01", "amount": 2_000_000, "tax_account_type": "retirement_pension"},
        {"withdrawal_date": "2024-02-01", "amount": 2_000_000, "tax_account_type": "pension_savings"},
        # 2026년 과세 단계 인출
        {"withdrawal_date": "2026-03-01", "amount": 7_000_000, "tax_account_type": "pension_savings"},
        {"withdrawal_date": "2026-06-01", "amount": 9_000_000, "tax_account_type": "retirement_pension"},
    ]
    breakdown = calc_limit_breakdown(2026, withdrawals, plan)
    assert breakdown["ytd_total"] == 16_000_000
    assert breakdown["ytd_total"] > PRIVATE_PENSION_ANNUAL_LIMIT


# ── 케이스 8: 퇴직연금 전환이 7월 발생, 월 125만 수령 → 경계 비례 분할 ──
# 원금 800만: 6월 말 누적 750만 → 7월 인출 125만 중 50만 원금 / 75만 과세
# 기대: 75만 + 8~12월 5×125만 = 700만

def test_case8_mid_year_transition_proration():
    records = [
        {"withdrawal_date": f"2026-{m:02d}-01", "amount": 1_250_000}
        for m in range(1, 13)
    ]
    result = calc_track_limit_ytd(
        year=2026,
        records=records,
        start_date=date(2026, 1, 1),
        principal=8_000_000,
    )
    assert result == 7_000_000


# ── 케이스 9: rp 월 100만 + pp 월 60만 (합 160만 > 125만) ──
# 기대: 동시 과세 구간 초과 예상 경고 + 초과 시작 연도

def _track(track_type, start, tax_start, monthly):
    return {
        "type": track_type, "active": True,
        "plan": {"start_date": start, "monthly_amount": monthly},
        "depletion": None,
        "tax_start_date": tax_start,
        "tax_started": False,
    }


def test_case9_dual_phase_over_warning():
    rp = _track("retirement_pension", "2026-01-01", "2030-01-01", 1_000_000)
    pp = _track("pension_savings",    "2026-01-01", "2028-01-01", 600_000)

    warning = calc_over_warning(rp, pp)
    assert warning["will_exceed"] is True
    # 2028~2029: pp만 과세 연 720만 ≤ 1,500만 / 2030: 720만 + 1,200만 = 1,920만 초과
    assert warning["first_over_year"] == 2030
    assert warning["planned_monthly_total"] == 1_600_000

    phases = calc_phases(rp, pp)
    assert [p["phase"] for p in phases] == ["tax_free", "single", "dual"]
    tax_free, single, dual = phases
    assert tax_free["to"] == "2028-01-01"
    assert single["taxable_accounts"] == ["pension_savings"]
    assert single["to"] == "2030-01-01"
    assert dual["from"] == "2030-01-01"
    assert dual["monthly_cap"] == MONTHLY_CAP
    assert set(dual["taxable_accounts"]) == {"pension_savings", "retirement_pension"}


def test_case9b_within_cap_no_warning():
    rp = _track("retirement_pension", "2026-01-01", "2030-01-01", 700_000)
    pp = _track("pension_savings",    "2026-01-01", "2028-01-01", 500_000)
    warning = calc_over_warning(rp, pp)
    assert warning["will_exceed"] is False
    assert warning["first_over_year"] is None


def test_single_track_phases():
    rp = _track("retirement_pension", "2026-01-01", "2030-01-01", 1_000_000)
    inactive_pp = {"type": "pension_savings", "active": False, "plan": {},
                   "depletion": None, "tax_start_date": None, "tax_started": False}
    phases = calc_phases(rp, inactive_pp)
    assert [p["phase"] for p in phases] == ["tax_free", "single"]
    assert phases[1]["to"] is None


# ── 케이스 10: 미래 날짜 인출 POST → 422 거부 ──

def test_case10_future_date_rejected():
    from routers.withdrawals import WithdrawalIn, _validate_in

    body = WithdrawalIn(
        withdrawal_date=date(9999, 12, 31),
        amount=1_000_000,
        account_name="테스트IRP",
        tax_account_type="retirement_pension",
    )
    with pytest.raises(HTTPException) as exc:
        _validate_in(body)
    assert exc.value.status_code == 422
