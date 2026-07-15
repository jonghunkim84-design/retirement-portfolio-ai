"""몬테카를로 시뮬레이션 순수 함수 단위 테스트.

실행: backend/ 디렉터리에서 `pytest tests/test_simulation.py -v`
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routers.simulation import (
    portfolio_sigma,
    home_pension_monthly,
    build_yearly_cashflow,
    run_monte_carlo,
)


def _cashflow(start_year=2026, birth_year=1960, monthly=3_000_000, inflation=0.0,
              pension_start=10 ** 9, pension_base=0, gifts=None):
    return build_yearly_cashflow(
        birth_year=birth_year, monthly_expense=monthly, inflation=inflation,
        pension_start_year=pension_start, pension_base=pension_base,
        home_pension=None, gifts_by_year=gifts or {}, start_year=start_year,
    )


# ── portfolio_sigma ──────────────────────────────────────────────

def test_sigma_weighted_by_value():
    assets = [
        {"asset_type": "cash",   "current_value": 50},
        {"asset_type": "equity", "current_value": 50},
    ]
    # 0.5×1% + 0.5×15% = 8%
    assert abs(portfolio_sigma(assets) - 0.08) < 1e-9


def test_sigma_empty_default():
    assert portfolio_sigma([]) == 0.10


# ── home_pension_monthly ─────────────────────────────────────────

def test_home_pension_fixed_and_increasing():
    # 70세 3억 정액형: 30.8 × 3 = 92.4만 → 92만 (round) = 920,000원
    assert home_pension_monthly(3, 70, "fixed", 0) == round(30.8 * 3) * 10_000
    # 정기증가형: 3년마다 4.5% 증가
    base = 30.8 * 3
    assert home_pension_monthly(3, 70, "increasing", 6) == round(base * 1.045 ** 2) * 10_000


# ── build_yearly_cashflow ────────────────────────────────────────

def test_cashflow_age_decay_and_span():
    rows = _cashflow(start_year=2026, birth_year=1960, monthly=1_000_000)
    # 1960년생 → 2026년 66세, 95세(2055년)까지 = 30행
    assert rows[0]["age"] == 66
    assert rows[-1]["age"] == 95
    by_age = {r["age"]: r for r in rows}
    # 물가 0% → 69세까지 연 1,200만, 70세부터 10% 감액, 80세부터 추가 10%
    assert by_age[69]["withdrawal"] == 12_000_000
    assert by_age[70]["withdrawal"] == 12_000_000 * 0.9
    assert abs(by_age[80]["withdrawal"] - 12_000_000 * 0.9 * 0.9) < 1
    # 증여 없음
    assert all(r["gift"] == 0 for r in rows)


def test_cashflow_pension_offsets_withdrawal():
    rows = _cashflow(monthly=1_000_000, pension_start=2030, pension_base=1_000_000)
    by_year = {r["year"]: r for r in rows}
    assert by_year[2029]["withdrawal"] == 12_000_000
    assert by_year[2030]["withdrawal"] == 0  # 연금이 생활비 전액 충당


def test_cashflow_gift_included():
    rows = _cashflow(gifts={2028: 50_000_000})
    by_year = {r["year"]: r for r in rows}
    assert by_year[2028]["gift"] == 50_000_000


# ── run_monte_carlo ──────────────────────────────────────────────

def test_zero_sigma_matches_deterministic():
    """변동성 0 → 결정론적 재귀와 일치해야 함."""
    cf = _cashflow(monthly=1_000_000)
    mc = run_monte_carlo(initial_balance=500_000_000, cashflow=cf,
                         mu=0.04, sigma=0.0, runs=100, seed=1)
    # 수동 재귀
    bal = 500_000_000
    expected_first = bal
    for c in cf:
        bal = max(0.0, bal * 1.04 - c["withdrawal"] - c["gift"])
    assert mc["percentiles"]["p50"][0] == expected_first
    assert abs(mc["final"]["median"] - bal) < 2
    # 모든 백분위 동일 (경로가 전부 같음)
    assert mc["percentiles"]["p5"][-1] == mc["percentiles"]["p95"][-1]


def test_seed_reproducible():
    cf = _cashflow()
    a = run_monte_carlo(initial_balance=3e8, cashflow=cf, mu=0.04, sigma=0.1, runs=500, seed=42)
    b = run_monte_carlo(initial_balance=3e8, cashflow=cf, mu=0.04, sigma=0.1, runs=500, seed=42)
    assert a["success_prob"] == b["success_prob"]
    assert a["percentiles"]["p50"] == b["percentiles"]["p50"]


def test_rich_portfolio_high_success():
    # 자산 100억, 연 인출 3,600만 → 사실상 100% 성공
    cf = _cashflow(monthly=3_000_000)
    mc = run_monte_carlo(initial_balance=1e10, cashflow=cf, mu=0.04, sigma=0.1, runs=500, seed=7)
    assert mc["success_prob"] >= 99.0
    assert mc["depletion"]["prob"] <= 1.0


def test_poor_portfolio_low_success():
    # 자산 1억, 연 인출 3,600만 → 수년 내 고갈
    cf = _cashflow(monthly=3_000_000)
    mc = run_monte_carlo(initial_balance=1e8, cashflow=cf, mu=0.04, sigma=0.1, runs=500, seed=7)
    assert mc["success_prob"] <= 1.0
    assert mc["depletion"]["median_year"] is not None
    assert mc["depletion"]["median_year"] <= 2032


def test_estate_target_prob_leq_success():
    cf = _cashflow(monthly=1_500_000)
    mc = run_monte_carlo(initial_balance=8e8, cashflow=cf, mu=0.04, sigma=0.12,
                         runs=800, seed=3, estate_target=5e8)
    # 목표 달성 확률 ≤ 고갈 없음 확률
    assert mc["estate_success_prob"] <= mc["success_prob"]


def test_volatility_widens_band():
    cf = _cashflow(monthly=1_000_000)
    low  = run_monte_carlo(initial_balance=5e8, cashflow=cf, mu=0.04, sigma=0.03, runs=800, seed=5)
    high = run_monte_carlo(initial_balance=5e8, cashflow=cf, mu=0.04, sigma=0.15, runs=800, seed=5)
    spread_low  = low["percentiles"]["p95"][-1]  - low["percentiles"]["p5"][-1]
    spread_high = high["percentiles"]["p95"][-1] - high["percentiles"]["p5"][-1]
    assert spread_high > spread_low
