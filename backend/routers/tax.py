from fastapi import APIRouter
from datetime import date
from database import supabase

router = APIRouter()

FINANCIAL_THRESHOLD = 20_000_000
PENSION_THRESHOLD   = 15_000_000

# account_name 값 기준으로 사적연금 판별
PENSION_ACCOUNTS = ["연금저축", "IRP", "퇴직연금"]


def _status(pct: float) -> str:
    if pct >= 80:
        return "danger"
    if pct >= 60:
        return "warning"
    return "safe"


@router.get("/summary")
def get_tax_summary():
    today      = date.today()
    year_start = f"{today.year}-01-01"
    year_end   = today.isoformat()

    # ── 올해 이자+배당 수입 합계 ──────────────────────────────────
    fin_res = supabase.table("income_log") \
        .select("amount") \
        .in_("income_type", ["interest", "dividend"]) \
        .gte("income_date", year_start) \
        .lte("income_date", year_end) \
        .execute()

    financial_income_ytd = sum(float(r["amount"]) for r in (fin_res.data or []))
    fin_remaining        = FINANCIAL_THRESHOLD - financial_income_ytd
    fin_pct              = round(financial_income_ytd / FINANCIAL_THRESHOLD * 100, 1)

    # ── 올해 사적연금 수령액 합계 (account_name 기준) ─────────────
    pen_res = supabase.table("income_log") \
        .select("amount") \
        .in_("account_name", PENSION_ACCOUNTS) \
        .gte("income_date", year_start) \
        .lte("income_date", year_end) \
        .execute()

    pension_income_ytd = sum(float(r["amount"]) for r in (pen_res.data or []))
    pen_remaining      = PENSION_THRESHOLD - pension_income_ytd
    pen_pct            = round(pension_income_ytd / PENSION_THRESHOLD * 100, 1)

    return {
        # 금융소득
        "financial_income_ytd": financial_income_ytd,
        "threshold":            FINANCIAL_THRESHOLD,
        "remaining":            fin_remaining,
        "utilization_pct":      fin_pct,
        "status":               _status(fin_pct),
        # 연금소득
        "pension_income_ytd":      pension_income_ytd,
        "pension_threshold":       PENSION_THRESHOLD,
        "pension_remaining":       pen_remaining,
        "pension_utilization_pct": pen_pct,
        "pension_status":          _status(pen_pct),
    }
