"""인출 순서 최적화 (세금 + 건강보험료 통합) API.

핵심 아이디어 — 계좌 유형별 '한계 비용 사다리':
  같은 1원을 인출해도 어느 계좌에서 빼느냐에 따라 당해 연도 부담이 다르다.

  ① 일반계좌            0%   (인출 자체 비과세 · 잔액 감소 → 금융소득·건보료도 감소)
  ② ISA 납입원금        0%   (중도인출 자유 · 비과세)
  ③ IRP 이연퇴직소득    0%   (비과세 풀 — 기존 듀얼 트랙 모델 재사용)
  ④ 연금저축 비과세원금 0%   (세액공제 받지 않은 납입 원금)
  ⑤ 연금 과세분(한도내) 3.3~5.5% (연 1,500만원 잔여 한도 내 저율 분리과세)
  ⑥ ISA 수익            9.9% (비과세 200만원 초과분 · 만기 해지 가정)
  ⑦ 연금 과세분(초과)   16.5%

  0% 구간 순서 근거: 일반계좌를 먼저 줄이면 이자·배당(15.4% + 건보료 + 종합과세
  위험)이 함께 줄지만, 연금·ISA는 과세이연/비과세 성장 이점이 있어 뒤로 미룬다.

시나리오 비교: 권장 순서 / 연금 우선 / 연금 미사용 3가지에 대해
  연금소득세 + ISA세 + 금융소득 원천징수 + 건강보험료(연간) 합산 부담을 비교.
"""
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter

from database import supabase
from utils import get_config, get_active_assets, get_pension_info
from tax_constants import (
    PRIVATE_PENSION_ANNUAL_LIMIT,
    PENSION_TAX_RATES,
    OVER_LIMIT_SEPARATE_RATE,
    ISA_SEPARATE_RATE,
    ISA_TAX_FREE_LIMIT,
    FINANCIAL_WITHHOLDING_RATE,
    FINANCIAL_COMPREHENSIVE_THRESHOLD,
)
from health_insurance import estimate_annual_premium
from routers.pension_tax import build_track, calc_limit_breakdown

router = APIRouter()

# 금융소득 실적이 없을 때 일반계좌 잔액 대비 가정 수익률 (이자·배당)
DEFAULT_TAXABLE_YIELD = 0.025

# 권장 사다리 순서 (한계 비용 오름차순)
RECOMMENDED_ORDER = [
    "regular", "isa_principal", "rp_tax_free", "pp_tax_free",
    "pension_within_limit", "isa_gain", "pension_over_limit",
]
PENSION_FIRST_ORDER = [
    "rp_tax_free", "pp_tax_free", "pension_within_limit", "pension_over_limit",
    "regular", "isa_principal", "isa_gain",
]
NO_PENSION_ORDER = ["regular", "isa_principal", "isa_gain"]

POOL_LABELS = {
    "regular":              "일반계좌",
    "isa_principal":        "ISA 납입원금",
    "rp_tax_free":          "IRP 이연퇴직소득 (비과세)",
    "pp_tax_free":          "연금저축 비과세 원금",
    "pension_within_limit": "연금계좌 과세분 (한도 내)",
    "isa_gain":             "ISA 운용수익",
    "pension_over_limit":   "연금계좌 과세분 (한도 초과)",
}


# ── 순수 계산 함수 (테스트에서 직접 import) ─────────────────────────

def build_pools(
    *,
    regular_balance: float,
    isa_balance: float,
    isa_principal: float,
    rp_balance: float,
    rp_tax_free_remaining: float,
    ps_balance: float,
    ps_tax_free_remaining: float,
    limit_remaining: float,
    age_rate: Optional[float],
) -> list:
    """계좌 잔액 → 한계 비용 사다리 풀 목록 (권장 순서).

    age_rate가 None(55세 미만 등)이면 연금 과세분 풀은 available=0 처리.
    """
    isa_principal_avail = max(0.0, min(isa_balance, isa_principal))
    isa_gain_avail      = max(0.0, isa_balance - isa_principal_avail)

    rp_free = max(0.0, min(rp_balance, rp_tax_free_remaining))
    pp_free = max(0.0, min(ps_balance, ps_tax_free_remaining))

    pension_taxable = max(0.0, rp_balance - rp_free) + max(0.0, ps_balance - pp_free)
    if age_rate is None:
        within = over = 0.0
    else:
        within = min(max(0.0, limit_remaining), pension_taxable)
        over   = pension_taxable - within

    def pool(pid, available, rate, note):
        return {
            "id":        pid,
            "label":     POOL_LABELS[pid],
            "available": round(available),
            "rate":      rate,
            "rate_pct":  round(rate * 100, 1) if rate is not None else None,
            "note":      note,
        }

    return [
        pool("regular", regular_balance, 0.0,
             "인출 자체 비과세 · 잔액이 줄면 금융소득세·건보료 부담도 감소"),
        pool("isa_principal", isa_principal_avail, 0.0,
             "납입 원금은 중도인출 자유 · 비과세"),
        pool("rp_tax_free", rp_free, 0.0,
             "이연퇴직소득 원금 — 1,500만원 한도와 무관"),
        pool("pp_tax_free", pp_free, 0.0,
             "세액공제 받지 않은 납입 원금 — 한도와 무관"),
        pool("pension_within_limit", within,
             age_rate if age_rate is not None else None,
             "연 1,500만원 잔여 한도 내 저율 분리과세"
             if age_rate is not None else "55세 미만 — 연금 수령 개시 전"),
        pool("isa_gain", isa_gain_avail, ISA_SEPARATE_RATE,
             f"비과세 {ISA_TAX_FREE_LIMIT / 10_000:,.0f}만원 초과 수익에 9.9% (만기 해지 가정)"),
        pool("pension_over_limit", over, OVER_LIMIT_SEPARATE_RATE,
             "한도 초과분 16.5% 분리과세 (또는 종합과세 선택)"),
    ]


def _pool_tax(pool_id: str, amount: float, rate: Optional[float]) -> float:
    """풀별 인출액 → 당해 연도 세금. ISA 수익은 비과세 한도 차감 후 과세."""
    if amount <= 0:
        return 0.0
    if pool_id == "isa_gain":
        return max(0.0, amount - ISA_TAX_FREE_LIMIT) * ISA_SEPARATE_RATE
    if rate is None:
        return 0.0
    return amount * rate


def allocate(need: float, pools: list, order: list) -> dict:
    """필요 인출액을 order 순서대로 풀에 배분.

    반환: rows(풀별 배분·세금), total_tax, unfunded(자산 부족분)
    """
    by_id = {p["id"]: p for p in pools}
    remaining = max(0.0, need)
    rows = []

    for pid in order:
        p = by_id.get(pid)
        if p is None or p["available"] <= 0:
            continue
        take = min(remaining, p["available"])
        if take <= 0:
            continue
        tax = _pool_tax(pid, take, p["rate"])
        rows.append({
            "id":       pid,
            "label":    p["label"],
            "amount":   round(take),
            "tax":      round(tax),
            "rate_pct": p["rate_pct"],
        })
        remaining -= take
        if remaining <= 0:
            break

    total_tax = sum(r["tax"] for r in rows)
    return {"rows": rows, "total_tax": round(total_tax), "unfunded": round(remaining)}


def simulate_scenario(
    scenario_id: str,
    label: str,
    need: float,
    pools: list,
    order: list,
    *,
    base_financial_income: float,
    regular_balance: float,
    national_pension_annual: float,
    earned_income: float,
    property_tax_base_manwon: float,
) -> dict:
    """한 시나리오의 당해 연도 총 부담 (인출세 + 금융소득세 + 건보료)."""
    alloc = allocate(need, pools, order)

    withdrawal_tax = alloc["total_tax"]

    # 일반계좌 인출 → 연평균 잔액 감소 → 금융소득 비례 감소 가정
    regular_used = sum(r["amount"] for r in alloc["rows"] if r["id"] == "regular")
    if regular_balance > 0:
        avg_balance = max(0.0, regular_balance - regular_used / 2)
        financial_income = base_financial_income * (avg_balance / regular_balance)
    else:
        financial_income = base_financial_income

    financial_tax = financial_income * FINANCIAL_WITHHOLDING_RATE

    premium = estimate_annual_premium(
        national_pension_annual, financial_income, earned_income,
        property_tax_base_manwon,
    )

    total_burden = withdrawal_tax + financial_tax + premium["total_annual"]

    return {
        "id":                       scenario_id,
        "label":                    label,
        "allocation":               alloc["rows"],
        "unfunded":                 alloc["unfunded"],
        "withdrawal_tax":           round(withdrawal_tax),
        "projected_financial_income": round(financial_income),
        "financial_income_tax":     round(financial_tax),
        "health_premium_monthly":   premium["total_monthly"],
        "health_premium_annual":    premium["total_annual"],
        "comprehensive_tax_risk":   financial_income > FINANCIAL_COMPREHENSIVE_THRESHOLD,
        "total_burden":             round(total_burden),
    }


def _age_rate(age: Optional[int]) -> Optional[float]:
    if age is None or age < 55:
        return None
    for (lo, hi), rate in PENSION_TAX_RATES.items():
        if lo <= age <= hi:
            return rate
    return 0.033


# ── 라우터 ───────────────────────────────────────────────────────

@router.get("/summary")
def get_strategy_summary(
    annual_need: Optional[float] = None,
    property_tax_base: float = 0,   # 재산 과세표준 (만원, 기본공제 차감 후)
    earned_income: float = 0,       # 연간 근로·사업소득 (원)
):
    """인출 순서 사다리 + 권장 배분 + 3개 시나리오 비교."""
    config = get_config()
    assets = get_active_assets()
    plan   = config.get("pension_plan") or {}
    today  = date.today()

    # ── 계좌 유형별 잔액 ───────────────────────────────────────
    def bal(t):
        return sum(a["current_value"] for a in assets if a.get("tax_account_type") == t)

    regular_balance = bal("regular") + sum(
        a["current_value"] for a in assets if not a.get("tax_account_type")
    )
    unclassified = sum(1 for a in assets if not a.get("tax_account_type"))
    isa_balance = bal("isa")
    isa_principal = sum(
        float(a.get("investment_amount") or 0)
        for a in assets if a.get("tax_account_type") == "isa"
    )
    rp_balance = bal("retirement_pension")
    ps_balance = bal("pension_savings")

    # ── 연금 비과세 풀 · 1,500만원 한도 (기존 듀얼 트랙 모델 재사용) ──
    all_withdrawals = (
        supabase.table("withdrawals").select("*").order("withdrawal_date").execute().data or []
    )
    rp_records = [r for r in all_withdrawals if r["tax_account_type"] == "retirement_pension"]
    ps_records = [r for r in all_withdrawals if r["tax_account_type"] == "pension_savings"]
    rp_track = build_track("retirement_pension", plan, rp_records)
    pp_track = build_track("pension_savings", plan, ps_records)

    def _free_remaining(track, balance):
        if track["active"] and track["depletion"]:
            return float(track["depletion"]["remaining_principal"])
        return 0.0  # 계획 미설정 → 보수적으로 비과세 풀 없음 처리

    breakdown = calc_limit_breakdown(today.year, all_withdrawals, plan)
    limit_remaining = max(0.0, PRIVATE_PENSION_ANNUAL_LIMIT - breakdown["ytd_total"])

    # ── 나이 · 국민연금 · 금융소득 실적 ─────────────────────────
    birth_year = config.get("user", {}).get("birth_year")
    age = (today.year - int(birth_year)) if birth_year else None
    age_rate = _age_rate(age)

    pension_info = get_pension_info(config)
    national_pension_annual = pension_info["income"] * 12

    # 최근 12개월 이자·배당 실적 → 향후 1년 금융소득 추정 베이스
    since = (today - timedelta(days=365)).isoformat()
    fin_res = (
        supabase.table("income_log").select("amount")
        .in_("income_type", ["interest", "dividend"])
        .gte("income_date", since).execute()
    )
    base_financial_income = sum(float(r["amount"]) for r in (fin_res.data or []))
    fin_income_is_estimate = False
    if base_financial_income == 0 and regular_balance > 0:
        base_financial_income = regular_balance * DEFAULT_TAXABLE_YIELD
        fin_income_is_estimate = True

    # ── 필요 인출액 기본값: 연 생활비 − 국민연금 ─────────────────
    monthly_expense = config.get("user", {}).get("monthly_expense", 5_000_000)
    if annual_need is None:
        annual_need = max(0.0, monthly_expense * 12 - national_pension_annual)

    # ── 사다리 · 권장 배분 · 시나리오 ───────────────────────────
    pools = build_pools(
        regular_balance=regular_balance,
        isa_balance=isa_balance,
        isa_principal=isa_principal,
        rp_balance=rp_balance,
        rp_tax_free_remaining=_free_remaining(rp_track, rp_balance),
        ps_balance=ps_balance,
        ps_tax_free_remaining=_free_remaining(pp_track, ps_balance),
        limit_remaining=limit_remaining,
        age_rate=age_rate,
    )

    ctx = dict(
        base_financial_income=base_financial_income,
        regular_balance=regular_balance,
        national_pension_annual=national_pension_annual,
        earned_income=earned_income,
        property_tax_base_manwon=property_tax_base,
    )
    scenarios = [
        simulate_scenario("recommended", "권장 순서 (사다리)", annual_need, pools,
                          RECOMMENDED_ORDER, **ctx),
        simulate_scenario("pension_first", "연금계좌 우선", annual_need, pools,
                          PENSION_FIRST_ORDER, **ctx),
        simulate_scenario("no_pension", "연금 미사용 (일반·ISA만)", annual_need, pools,
                          NO_PENSION_ORDER, **ctx),
    ]
    best = min(s["total_burden"] for s in scenarios)
    for s in scenarios:
        s["delta_vs_best"] = s["total_burden"] - best
        s["is_best"] = s["total_burden"] == best

    # ── 경고 ────────────────────────────────────────────────────
    warnings = []
    if age is not None and age < 55:
        warnings.append("55세 미만 — 연금계좌 인출 시 기타소득세 16.5% (세액공제분) 등 불이익이 있어 연금 풀을 제외했습니다.")
    if age is None:
        warnings.append("설정에서 출생연도를 입력하면 연금소득세율이 반영됩니다.")
    if unclassified:
        warnings.append(f"세제 분류 미설정 자산 {unclassified}건은 일반계좌로 간주했습니다.")
    if fin_income_is_estimate:
        warnings.append(f"금융소득 실적이 없어 일반계좌 잔액 × {DEFAULT_TAXABLE_YIELD:.1%} 가정으로 추정했습니다.")
    if scenarios[0]["unfunded"] > 0:
        warnings.append("필요 인출액이 전체 가용 자산을 초과합니다.")
    if not rp_track["active"] and rp_balance > 0:
        warnings.append("연금 계획(IRP)이 미설정이라 IRP 비과세 원금을 0으로 처리했습니다 — 연금 세금 페이지에서 설정하세요.")
    if not pp_track["active"] and ps_balance > 0:
        warnings.append("연금 계획(연금저축)이 미설정이라 비과세 원금을 0으로 처리했습니다.")

    return {
        "inputs": {
            "annual_need":              round(annual_need),
            "monthly_expense":          monthly_expense,
            "national_pension_annual":  round(national_pension_annual),
            "earned_income":            earned_income,
            "property_tax_base_manwon": property_tax_base,
            "age":                      age,
            "age_rate_pct":             round(age_rate * 100, 1) if age_rate else None,
        },
        "balances": {
            "regular":            round(regular_balance),
            "isa":                round(isa_balance),
            "pension_savings":    round(ps_balance),
            "retirement_pension": round(rp_balance),
        },
        "limit": {
            "limit":     PRIVATE_PENSION_ANNUAL_LIMIT,
            "ytd_used":  round(breakdown["ytd_total"]),
            "remaining": round(limit_remaining),
        },
        "pools":       pools,
        "recommendation": allocate(annual_need, pools, RECOMMENDED_ORDER),
        "scenarios":   scenarios,
        "base_financial_income": round(base_financial_income),
        "warnings":    warnings,
    }
