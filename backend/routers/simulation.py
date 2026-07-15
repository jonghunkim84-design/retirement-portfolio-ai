"""몬테카를로 연금 자산 시뮬레이션.

연금 계획(PensionPlan.jsx)의 결정론적 현금흐름 모델과 동일한 가정을 사용하되,
수익률만 확률 변수로 바꿔 N개 경로를 생성한다:

- 생활비: 물가 연동 + 70세 10% / 80세 추가 10% 감액
- 국민연금: 물가 연동
- 주택연금: HF 정액형/정기증가형 요율 (프론트 HOME_PENSION_RATE와 동일)
- 증여 유출: 상속·증여 계획 연동 (gift_plans)
- 수익률: N(μ, σ) 연간 표본 — μ는 사용자의 수익률 가정, σ는 버킷 구성에서 도출
  (완전 상관 가정: σ_p = Σ wᵢσᵢ — 분산 효과를 무시한 보수적 추정)

성공 기준:
- success_prob: 95세 시점 잔액 > 0 경로 비율
- estate_success_prob: 95세 시점 잔액 ≥ 상속 목표 경로 비율

⚠️ 정규분포 가정이라 극단적 폭락(fat tail)은 과소평가될 수 있다. 결과는 보장이
아니라 입력 가정 위의 추정이다.
"""
from datetime import date
from typing import Optional

import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel, field_validator

from utils import get_config, get_active_assets, calculate_buckets
from routers.estate import build_gift_schedule

router = APIRouter()

# 자산 유형별 연간 변동성 가정 (장기, 명목)
VOLATILITY = {
    "cash":   0.01,
    "bond":   0.05,
    "tdf":    0.08,
    "fund":   0.08,
    "equity": 0.15,
    "income": 0.12,
}
DEFAULT_SIGMA = 0.10

# 주택연금 월지급금 요율표 (만원/월 per 1억원 — 프론트와 동일 유지)
HOME_PENSION_RATE = {
    55: 15.4, 56: 16.0, 57: 16.7, 58: 17.4, 59: 18.1,
    60: 18.9, 61: 19.7, 62: 20.5, 63: 21.5, 64: 22.5,
    65: 23.5, 66: 24.6, 67: 25.8, 68: 27.1, 69: 28.5,
    70: 30.8, 71: 32.3, 72: 33.9, 73: 35.6, 74: 37.5,
    75: 39.5, 76: 41.6, 77: 43.9, 78: 46.4, 79: 49.1,
    80: 52.0,
}

END_AGE = 95
PERCENTILES = [5, 25, 50, 75, 95]


# ── 순수 계산 함수 (테스트에서 직접 import) ─────────────────────────

def portfolio_sigma(assets: list) -> float:
    """자산 구성 → 포트폴리오 연간 변동성 (완전 상관 가정)."""
    total = sum(a["current_value"] for a in assets)
    if total <= 0:
        return DEFAULT_SIGMA
    return sum(
        a["current_value"] / total * VOLATILITY.get(a.get("asset_type"), DEFAULT_SIGMA)
        for a in assets
    )


def home_pension_monthly(house_value_eok: float, start_age: int, payment_type: str, years_from_start: int) -> float:
    """주택연금 월지급금 (원). 프론트 calcHomePensionMonthly와 동일."""
    clamped = min(80, max(55, round(start_age)))
    rate = HOME_PENSION_RATE.get(clamped, HOME_PENSION_RATE[70])
    base = rate * house_value_eok  # 만원/월
    if payment_type == "increasing":
        periods = years_from_start // 3
        base = base * (1.045 ** periods)
    return round(base) * 10_000


def build_yearly_cashflow(
    *,
    birth_year: int,
    monthly_expense: float,
    inflation: float,
    pension_start_year: int,
    pension_base: float,
    home_pension: Optional[dict],
    gifts_by_year: dict,
    start_year: int,
) -> list:
    """연도별 순유출(인출+증여) 목록 — 결정론적 부분만 미리 계산.

    반환: [{year, age, withdrawal, gift}] (start_year ~ birth_year+95)
    """
    rows = []
    end_year = birth_year + END_AGE
    hp = home_pension or {}
    hp_enabled = bool(hp.get("enabled"))
    hp_start_year = birth_year + int(hp.get("start_age", 70)) if hp_enabled else 10 ** 9

    for year in range(start_year, end_year + 1):
        age = year - birth_year
        years_from_now = year - start_year

        # 생활비 (물가 + 나이별 감액) — 프론트 calcProjections와 동일
        if age < 70:
            expense = monthly_expense * (1 + inflation) ** years_from_now
        elif age < 80:
            expense = monthly_expense * 0.9 * (1 + inflation) ** (age - 70)
        else:
            expense79 = monthly_expense * 0.9 * (1 + inflation) ** 9
            expense = expense79 * 0.9 * (1 + inflation) ** (age - 80)

        # 국민연금 (물가 연동)
        pension = 0.0
        if year >= pension_start_year:
            years_to_start = max(0, pension_start_year - start_year)
            base_eff = pension_base * (1 + inflation) ** years_to_start
            pension = base_eff * (1 + inflation) ** (year - pension_start_year)

        # 주택연금
        hp_monthly = 0.0
        if hp_enabled and year >= hp_start_year:
            hp_monthly = home_pension_monthly(
                float(hp.get("house_value_eok", 5)),
                int(hp.get("start_age", 70)),
                hp.get("payment_type", "fixed"),
                year - hp_start_year,
            )

        withdrawal = max(0.0, (expense - pension - hp_monthly) * 12)
        gift = float(gifts_by_year.get(year, 0) or gifts_by_year.get(str(year), 0) or 0)
        rows.append({"year": year, "age": age, "withdrawal": withdrawal, "gift": gift})

    return rows


def run_monte_carlo(
    *,
    initial_balance: float,
    cashflow: list,
    mu: float,
    sigma: float,
    runs: int = 1000,
    seed: Optional[int] = None,
    estate_target: float = 0,
) -> dict:
    """몬테카를로 실행 — numpy 벡터화.

    cashflow: build_yearly_cashflow 결과.
    반환: percentiles(연도별), success_prob, estate_success_prob, depletion 통계.
    """
    rng = np.random.default_rng(seed)
    n_years = len(cashflow)
    outflows = np.array([c["withdrawal"] + c["gift"] for c in cashflow])

    balances = np.full(runs, float(initial_balance))
    # 연도별 시작 잔액 기록 (결정론 차트와 동일 기준)
    paths = np.zeros((n_years, runs))
    depleted_year = np.full(runs, -1)

    for i in range(n_years):
        paths[i] = balances
        if sigma > 0:
            returns = rng.normal(mu, sigma, runs)
        else:
            returns = np.full(runs, mu)
        balances = balances * (1 + returns) - outflows[i]
        newly_depleted = (balances <= 0) & (depleted_year == -1)
        depleted_year[newly_depleted] = cashflow[i]["year"]
        balances = np.maximum(balances, 0.0)

    final = balances
    success = final > 0
    estate_ok = final >= estate_target if estate_target > 0 else success

    pct = {f"p{p}": np.percentile(paths, p, axis=1).round().tolist() for p in PERCENTILES}

    dep_years = depleted_year[depleted_year > 0]
    return {
        "years":  [c["year"] for c in cashflow],
        "ages":   [c["age"] for c in cashflow],
        "percentiles": pct,
        "final": {
            "median": round(float(np.median(final))),
            "p5":     round(float(np.percentile(final, 5))),
            "p95":    round(float(np.percentile(final, 95))),
        },
        "success_prob":        round(float(success.mean()) * 100, 1),
        "estate_success_prob": round(float(estate_ok.mean()) * 100, 1) if estate_target > 0 else None,
        "depletion": {
            "prob":        round(float((depleted_year > 0).mean()) * 100, 1),
            "median_year": int(np.median(dep_years)) if dep_years.size else None,
            "worst10_year": int(np.percentile(dep_years, 10)) if dep_years.size else None,
        },
        "runs": runs,
    }


# ── Pydantic 모델 ────────────────────────────────────────────────

class HomePensionIn(BaseModel):
    enabled: bool = False
    house_value_eok: float = 5
    start_age: int = 70
    payment_type: str = "fixed"


class MonteCarloIn(BaseModel):
    return_rate_pct: float = 4.0     # 연 기대수익률 (%, 연금 계획 슬라이더와 동일)
    runs: int = 1000
    seed: Optional[int] = None       # 지정 시 재현 가능 (테스트용)
    home_pension: Optional[HomePensionIn] = None

    @field_validator("runs")
    @classmethod
    def runs_range(cls, v):
        if not 100 <= v <= 10_000:
            raise ValueError("runs는 100~10,000 범위여야 합니다")
        return v

    @field_validator("return_rate_pct")
    @classmethod
    def rate_range(cls, v):
        if not -20 <= v <= 20:
            raise ValueError("수익률은 -20~20% 범위여야 합니다")
        return v


# ── 라우터 ───────────────────────────────────────────────────────

@router.post("/montecarlo")
def monte_carlo(body: MonteCarloIn):
    config = get_config()
    assets = get_active_assets()
    buckets = calculate_buckets(assets, config)

    birth_year = int(config.get("user", {}).get("birth_year", date.today().year - 65))
    monthly_expense = float(config.get("user", {}).get("monthly_expense", 5_000_000))
    inflation = float(config.get("inflation", {}).get("assumed_rate", 0.025))

    pension_raw = config.get("income", {}).get("national_pension", {}) or {}
    start_str = pension_raw.get("start_date") if isinstance(pension_raw, dict) else None
    pension_start_year = int(start_str.split("-")[0]) if start_str else 10 ** 9
    pension_base = float(pension_raw.get("base_amount", 0)) if isinstance(pension_raw, dict) else 0.0

    # 증여 유출 + 상속 목표 (상속·증여 계획 연동)
    try:
        from database import supabase
        plans = supabase.table("gift_plans").select("*").execute().data or []
        gifts_by_year = build_gift_schedule(plans)
    except Exception:
        gifts_by_year = {}
    estate_target = float((config.get("estate_plan") or {}).get("target_amount") or 0)

    sigma = portfolio_sigma(assets)
    mu = body.return_rate_pct / 100

    cashflow = build_yearly_cashflow(
        birth_year=birth_year,
        monthly_expense=monthly_expense,
        inflation=inflation,
        pension_start_year=pension_start_year,
        pension_base=pension_base,
        home_pension=body.home_pension.model_dump() if body.home_pension else None,
        gifts_by_year=gifts_by_year,
        start_year=date.today().year,
    )

    result = run_monte_carlo(
        initial_balance=buckets["total"],
        cashflow=cashflow,
        mu=mu,
        sigma=sigma,
        runs=body.runs,
        seed=body.seed,
        estate_target=estate_target,
    )
    result["assumptions"] = {
        "mu_pct":    round(mu * 100, 1),
        "sigma_pct": round(sigma * 100, 1),
        "inflation_pct": round(inflation * 100, 1),
        "initial_balance": round(buckets["total"]),
        "estate_target": round(estate_target),
        "note": "정규분포 · 완전 상관 가정 — 극단 손실은 과소평가될 수 있음",
    }
    return result
