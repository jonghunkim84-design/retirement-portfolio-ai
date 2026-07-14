"""건강보험료 지역가입자 계산 (백엔드 공용 모듈).

프론트 HealthInsurance.jsx의 점수표·계산식을 그대로 이식 — 두 곳의 결과가 항상
일치해야 한다. 점수표 개정 시 이 파일과 HealthInsurance.jsx를 함께 수정.

금액 단위 주의: 소득·재산 과세표준은 '만원', 보험료 결과는 '원'.
"""
from tax_constants import HEALTH_INSURANCE_2026

# 소득 점수표: (연 소득 상한 [만원], 점수) — 상한 이하 구간 첫 매칭
INCOME_SCORE_TABLE = [
    (336, 0), (500, 17), (700, 51), (1000, 103), (1500, 184),
    (2000, 257), (2500, 325), (3000, 390), (4000, 498), (5000, 612),
    (7000, 810), (10000, 1082), (15000, 1486),
]
INCOME_SCORE_MAX = 1956

# 재산 점수표: (재산 과세표준 상한 [만원], 점수)
PROPERTY_SCORE_TABLE = [
    (450, 22), (900, 44), (1350, 66), (1900, 93), (2700, 138),
    (3500, 188), (4900, 250), (6500, 326), (8500, 411), (11000, 511),
    (14000, 628), (18000, 782), (24000, 982), (32000, 1249),
    (44000, 1571), (60000, 1952), (80000, 2363),
]
PROPERTY_SCORE_MAX = 2700


def get_income_score(annual_income_manwon: float) -> int:
    """연 소득(만원) → 소득 부과점수."""
    for limit, score in INCOME_SCORE_TABLE:
        if annual_income_manwon <= limit:
            return score
    return INCOME_SCORE_MAX


def get_property_score(net_tax_base_manwon: float) -> int:
    """재산 과세표준(만원, 기본공제 차감 후) → 재산 부과점수."""
    if net_tax_base_manwon <= 0:
        return 0
    for limit, score in PROPERTY_SCORE_TABLE:
        if net_tax_base_manwon <= limit:
            return score
    return PROPERTY_SCORE_MAX


def calc_taxable_income_manwon(
    national_pension_annual: float,
    financial_income_annual: float,
    earned_income_annual: float,
) -> float:
    """건보료 부과 대상 연 소득(만원). 입력은 모두 '원' 단위.

    국민연금 50% 반영 / 사적연금(연금저축·IRP) 미부과 / 이자·배당·근로 전액.
    """
    ratio = HEALTH_INSURANCE_2026["national_pension_ratio"]
    total_won = national_pension_annual * ratio + financial_income_annual + earned_income_annual
    return total_won / 10_000


def calc_premium(income_score: int, property_score: int) -> dict:
    """부과점수 → 월 건강보험료·장기요양보험료 (원)."""
    c = HEALTH_INSURANCE_2026
    total_score = income_score + property_score
    health = max(c["min_premium"], round(total_score * c["rate_per_point"]))
    long_care = round(health * c["long_care_rate"])
    return {
        "total_score":   total_score,
        "health":        health,
        "long_care":     long_care,
        "total_monthly": health + long_care,
        "total_annual":  (health + long_care) * 12,
    }


def estimate_annual_premium(
    national_pension_annual: float,
    financial_income_annual: float,
    earned_income_annual: float,
    property_tax_base_manwon: float,
) -> dict:
    """소득(원)·재산 과세표준(만원, 공제 후) → 연간 보험료 추정 요약."""
    income_manwon = calc_taxable_income_manwon(
        national_pension_annual, financial_income_annual, earned_income_annual
    )
    i_score = get_income_score(income_manwon)
    p_score = get_property_score(property_tax_base_manwon)
    premium = calc_premium(i_score, p_score)
    return {
        "income_manwon":  round(income_manwon, 1),
        "income_score":   i_score,
        "property_score": p_score,
        **premium,
    }
