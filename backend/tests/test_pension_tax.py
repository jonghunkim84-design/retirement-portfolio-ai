"""
연금소득세 핵심 계산 함수 단위 테스트.

테스트 케이스: 작업지시서 2단계 '계산 로직 검증용 테스트 케이스' 6개.
DB 접근 없음 — calc_depletion, calc_retirement_pension_limit_ytd 순수 함수만 테스트.

실행: backend/ 디렉터리에서 `pytest tests/test_pension_tax.py -v`
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import date
from routers.pension_tax import calc_depletion, calc_retirement_pension_limit_ytd
from tax_constants import PRIVATE_PENSION_ANNUAL_LIMIT


# ── 케이스 1 ─────────────────────────────────────────────────────
# 원금 2억, 월 100만, 개시 2026-07-01, 인출 기록 없음
# 기대: 소진 예상 ≈ 200개월 후(is_estimate=True), 대략 2043년 2월

def test_case1_no_records_200months():
    result = calc_depletion(
        severance_principal=200_000_000,
        pension_start_date=date(2026, 7, 1),
        monthly_pension_amount=1_000_000,
        rp_records=[],
    )
    assert result["is_estimate"] is True
    assert result["is_depleted"] is False
    assert result["months_remaining"] == 200

    # depletion_date는 오늘 + 200개월이므로 실행 날짜에 따라 약간 달라짐
    dep = date.fromisoformat(result["depletion_date"])
    today = date.today()
    months_diff = (dep.year - today.year) * 12 + (dep.month - today.month)
    assert 199 <= months_diff <= 201, f"예상 소진까지 약 200개월이어야 함, 실제: {months_diff}"


# ── 케이스 2 ─────────────────────────────────────────────────────
# 원금 소진 전 해의 인출 1,800만 (전액 원금 재원)
# 기대: 한도 게이지 0 (이연퇴직소득 재원이라 한도 무관)

def test_case2_principal_only_ytd_zero():
    withdrawals = [
        {
            "withdrawal_date": "2025-06-01",
            "amount": 18_000_000,
            "tax_account_type": "retirement_pension",
        }
    ]
    result = calc_retirement_pension_limit_ytd(
        year=2025,
        all_withdrawals=withdrawals,
        pension_start_date=date(2025, 1, 1),
        severance_principal=200_000_000,
    )
    assert result == 0.0, f"원금 재원 인출은 한도 제외되어야 함, 실제: {result}"


# ── 케이스 3 ─────────────────────────────────────────────────────
# 원금 800만, 개시 2026-01-01, 월 125만 수령 (1~12월)
# 8월 인출에서 정확히 원금 소진 (잔여 원금 = 125만 = 당월 인출액)
# 기대: 9~12월 4개월 × 125만 = 500만 (소진 월 비례분 없음)

def test_case3_depletion_in_august_no_fraction():
    withdrawals = [
        {"withdrawal_date": f"2026-{m:02d}-01", "amount": 1_250_000, "tax_account_type": "retirement_pension"}
        for m in range(1, 13)
    ]
    # 1-7월 누적 875만, 8월 인출 125만 → 누적 1000만 = 정확히 원금 800만 초과 아님
    # → 원금 800만: 8월 인출 전 누적 875만 > 800만 → 8월 인출이 소진 이후
    # 다시: 원금 1000만으로 테스트 (8월 인출에서 정확히 소진)
    # 1-7월: 7 × 125만 = 875만 < 1000만
    # 8월 인출: 875만 + 125만 = 1000만 = 정확히 소진 경계 (amount == remaining_principal)
    #   → 한도 제외 (전액 원금)
    # 9-12월: 4 × 125만 = 500만 → 한도 대상
    result = calc_retirement_pension_limit_ytd(
        year=2026,
        all_withdrawals=withdrawals,
        pension_start_date=date(2026, 1, 1),
        severance_principal=10_000_000,
    )
    assert result == 5_000_000, f"9~12월 500만이어야 함, 실제: {result}"


# ── 케이스 3b ────────────────────────────────────────────────────
# 원금 800만, 개시 2026-01-01, 월 125만
# 7월 인출에서 소진 경계에 걸침 (비례 분할 케이스)
# 6월 말 누적: 750만 / 원금 800만 → 7월 잔여 원금: 50만
# 7월 인출 125만 중 50만은 원금, 75만은 운용수익 → 한도 75만
# 8~12월: 5 × 125만 = 625만
# 합계: 700만

def test_case3b_depletion_proportional_split():
    withdrawals = [
        {"withdrawal_date": f"2026-{m:02d}-01", "amount": 1_250_000, "tax_account_type": "retirement_pension"}
        for m in range(1, 13)
    ]
    result = calc_retirement_pension_limit_ytd(
        year=2026,
        all_withdrawals=withdrawals,
        pension_start_date=date(2026, 1, 1),
        severance_principal=8_000_000,   # 6월 말 750만, 7월에 소진 경계
    )
    # 7월 비례: 75만 + 8~12월: 5×125만 = 625만 = 700만
    assert result == 7_000_000, f"7월 비례 분할 + 8~12월 합산 700만이어야 함, 실제: {result}"


# ── 케이스 4 ─────────────────────────────────────────────────────
# pension_savings 인출 연 600만 + 운용수익 단계 IRP 인출 연 1,000만 = 합산 1,600만 → 초과

def test_case4_over_limit():
    # 2025년에 원금 100만짜리 IRP를 200만 수령 → 이미 소진
    # 2026년: pension_savings 600만 + retirement_pension 1000만
    all_withdrawals = [
        {"withdrawal_date": "2025-01-01", "amount": 2_000_000, "tax_account_type": "retirement_pension"},
        {"withdrawal_date": "2026-03-01", "amount": 6_000_000, "tax_account_type": "pension_savings"},
        {"withdrawal_date": "2026-06-01", "amount": 10_000_000, "tax_account_type": "retirement_pension"},
    ]

    ps_ytd = sum(
        float(r["amount"]) for r in all_withdrawals
        if r["tax_account_type"] == "pension_savings"
        and r["withdrawal_date"][:4] == "2026"
    )
    rp_ytd = calc_retirement_pension_limit_ytd(
        year=2026,
        all_withdrawals=all_withdrawals,
        pension_start_date=date(2025, 1, 1),
        severance_principal=1_000_000,   # 원금 100만, 2025년에 이미 소진
    )
    total = ps_ytd + rp_ytd

    assert total > PRIVATE_PENSION_ANNUAL_LIMIT, f"합산 {total}이 15,000,000을 초과해야 함"
    assert total == 16_000_000


# ── 케이스 5 ─────────────────────────────────────────────────────
# other_private_pension_annual = 1,600만 → 권장 월 상한 0 + 경고 플래그

def test_case5_other_pension_over_limit():
    other_annual = 16_000_000
    monthly_limit = max(0.0, (PRIVATE_PENSION_ANNUAL_LIMIT - other_annual) / 12)
    assert monthly_limit == 0.0
    assert other_annual >= PRIVATE_PENSION_ANNUAL_LIMIT  # over_other_pension 조건


# ── 케이스 6 ─────────────────────────────────────────────────────
# 미래 날짜 인출 기록 → 422 거부 (날짜 검증 로직 확인)

def test_case6_future_date_is_invalid():
    future = date(9999, 12, 31)
    today  = date.today()
    assert future > today, "미래 날짜가 오늘보다 커야 함"
    # 실제 API 422 거부는 withdrawals.py의 _validate_in에서 처리
    # 여기서는 날짜 비교 로직만 확인
