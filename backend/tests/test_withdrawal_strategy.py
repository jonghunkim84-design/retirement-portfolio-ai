"""인출 순서 최적화 순수 함수 단위 테스트.

DB 접근 없음 — build_pools / allocate / simulate_scenario만 테스트.
실행: backend/ 디렉터리에서 `pytest tests/test_withdrawal_strategy.py -v`
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routers.withdrawal_strategy import (
    build_pools,
    allocate,
    simulate_scenario,
    RECOMMENDED_ORDER,
    PENSION_FIRST_ORDER,
    NO_PENSION_ORDER,
)
from tax_constants import ISA_TAX_FREE_LIMIT
from health_insurance import (
    get_income_score,
    get_property_score,
    calc_premium,
    estimate_annual_premium,
)


def _pools_standard(age_rate=0.055, limit_remaining=15_000_000):
    """일반 2억 / ISA 5천(원금 4천) / IRP 1억(비과세 3천) / 연금저축 8천(비과세 2천)"""
    return build_pools(
        regular_balance=200_000_000,
        isa_balance=50_000_000,
        isa_principal=40_000_000,
        rp_balance=100_000_000,
        rp_tax_free_remaining=30_000_000,
        ps_balance=80_000_000,
        ps_tax_free_remaining=20_000_000,
        limit_remaining=limit_remaining,
        age_rate=age_rate,
    )


# ── build_pools ──────────────────────────────────────────────────

def test_pools_split_and_amounts():
    pools = {p["id"]: p for p in _pools_standard()}
    assert pools["regular"]["available"] == 200_000_000
    assert pools["isa_principal"]["available"] == 40_000_000
    assert pools["isa_gain"]["available"] == 10_000_000
    assert pools["rp_tax_free"]["available"] == 30_000_000
    assert pools["pp_tax_free"]["available"] == 20_000_000
    # 과세분 합계 = (10-3) + (8-2) = 1.3억, 한도 내 1,500만 / 초과 1.15억
    assert pools["pension_within_limit"]["available"] == 15_000_000
    assert pools["pension_over_limit"]["available"] == 115_000_000


def test_pools_under_55_excludes_taxable_pension():
    pools = {p["id"]: p for p in _pools_standard(age_rate=None)}
    assert pools["pension_within_limit"]["available"] == 0
    assert pools["pension_over_limit"]["available"] == 0


def test_pools_limit_partially_used():
    pools = {p["id"]: p for p in _pools_standard(limit_remaining=5_000_000)}
    assert pools["pension_within_limit"]["available"] == 5_000_000
    assert pools["pension_over_limit"]["available"] == 125_000_000


# ── allocate ─────────────────────────────────────────────────────

def test_allocate_small_need_uses_regular_only():
    alloc = allocate(60_000_000, _pools_standard(), RECOMMENDED_ORDER)
    assert alloc["rows"] == [
        {"id": "regular", "label": "일반계좌", "amount": 60_000_000, "tax": 0, "rate_pct": 0.0}
    ]
    assert alloc["total_tax"] == 0
    assert alloc["unfunded"] == 0


def test_allocate_cascades_through_ladder():
    # 일반 2억 + ISA 원금 4천 + 비과세 풀 5천 = 2.9억 소진 후 과세분 진입
    need = 290_000_000 + 10_000_000  # 한도 내 연금 과세분 1,000만 필요
    alloc = allocate(need, _pools_standard(), RECOMMENDED_ORDER)
    by_id = {r["id"]: r for r in alloc["rows"]}
    assert by_id["pension_within_limit"]["amount"] == 10_000_000
    assert by_id["pension_within_limit"]["tax"] == 550_000  # 5.5%
    assert "isa_gain" not in by_id
    assert alloc["total_tax"] == 550_000


def test_allocate_isa_gain_tax_free_allowance():
    # 사다리에서 ISA 수익까지 도달: 2.9억 + 1,500만(한도) + ISA 수익 500만
    need = 290_000_000 + 15_000_000 + 5_000_000
    alloc = allocate(need, _pools_standard(), RECOMMENDED_ORDER)
    by_id = {r["id"]: r for r in alloc["rows"]}
    # ISA 수익 500만 중 200만 비과세 → 300만 × 9.9%
    expected = round((5_000_000 - ISA_TAX_FREE_LIMIT) * 0.099)
    assert by_id["isa_gain"]["tax"] == expected
    # 한도 내 연금 1,500만 × 5.5%
    assert by_id["pension_within_limit"]["tax"] == 825_000


def test_allocate_unfunded_when_insufficient():
    total = 200_000_000 + 50_000_000 + 100_000_000 + 80_000_000  # 4.3억
    alloc = allocate(total + 7_000_000, _pools_standard(), RECOMMENDED_ORDER)
    assert alloc["unfunded"] == 7_000_000


# ── simulate_scenario ────────────────────────────────────────────

def _ctx(**over):
    base = dict(
        base_financial_income=8_000_000,   # 일반계좌 연 800만 이자·배당
        regular_balance=200_000_000,
        national_pension_annual=12_000_000,
        earned_income=0,
        property_tax_base_manwon=20_000,   # 재산 과세표준 2억
    )
    base.update(over)
    return base


def test_scenario_regular_withdrawal_reduces_financial_income():
    pools = _pools_standard()
    s = simulate_scenario("r", "권장", 60_000_000, pools, RECOMMENDED_ORDER, **_ctx())
    # 평균 잔액 = 2억 − 3천 = 1.7억 → 금융소득 800만 × 0.85 = 680만
    assert s["projected_financial_income"] == 6_800_000
    assert s["financial_income_tax"] == round(6_800_000 * 0.154)
    assert s["withdrawal_tax"] == 0


def test_scenario_pension_first_costs_more():
    pools = _pools_standard()
    need = 60_000_000
    rec = simulate_scenario("r", "권장", need, pools, RECOMMENDED_ORDER, **_ctx())
    pf  = simulate_scenario("p", "연금 우선", need, pools, PENSION_FIRST_ORDER, **_ctx())
    # 연금 우선: 비과세 5천 + 한도 내 1,500만(5.5%) 후 초과분 16.5% — 부담이 커야 함
    assert pf["withdrawal_tax"] > 0
    assert pf["total_burden"] > rec["total_burden"]


def test_scenario_no_pension_order_never_touches_pension():
    pools = _pools_standard()
    s = simulate_scenario("n", "미사용", 240_000_000, pools, NO_PENSION_ORDER, **_ctx())
    ids = {r["id"] for r in s["allocation"]}
    assert ids <= {"regular", "isa_principal", "isa_gain"}


def test_scenario_comprehensive_tax_risk_flag():
    s = simulate_scenario(
        "r", "권장", 0, _pools_standard(), RECOMMENDED_ORDER,
        **_ctx(base_financial_income=25_000_000),
    )
    assert s["comprehensive_tax_risk"] is True


# ── health_insurance 모듈 (프론트 점수표와 일치 검증) ──────────────

def test_income_score_brackets():
    assert get_income_score(336) == 0
    assert get_income_score(337) == 17
    assert get_income_score(2000) == 257
    assert get_income_score(99999) == 1956


def test_property_score_brackets():
    assert get_property_score(0) == 0
    assert get_property_score(450) == 22
    assert get_property_score(20000) == 982
    assert get_property_score(999999) == 2700


def test_premium_min_and_composition():
    p = calc_premium(0, 0)
    assert p["health"] == 20160          # 최저보험료
    assert p["long_care"] == round(20160 * 0.1295)
    assert p["total_annual"] == p["total_monthly"] * 12


def test_estimate_premium_national_pension_half():
    # 국민연금 2,400만 → 50%인 1,200만(=1,200만원)만 소득 반영
    r = estimate_annual_premium(24_000_000, 0, 0, 0)
    assert r["income_manwon"] == 1200
    assert r["income_score"] == get_income_score(1200)
