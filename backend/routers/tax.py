from fastapi import APIRouter
from datetime import date
from database import supabase

router = APIRouter()

FINANCIAL_THRESHOLD = 20_000_000


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

    # ── 올해 금융소득 합계 (이자+배당+기타, 근로소득 제외) ──────────
    fin_res = supabase.table("income_log") \
        .select("amount") \
        .in_("income_type", ["interest", "dividend", "other"]) \
        .gte("income_date", year_start) \
        .lte("income_date", year_end) \
        .execute()

    financial_income_ytd = sum(float(r["amount"]) for r in (fin_res.data or []))
    fin_remaining        = FINANCIAL_THRESHOLD - financial_income_ytd
    fin_pct              = round(financial_income_ytd / FINANCIAL_THRESHOLD * 100, 1)

    return {
        "financial_income_ytd": financial_income_ytd,
        "threshold":            FINANCIAL_THRESHOLD,
        "remaining":            fin_remaining,
        "utilization_pct":      fin_pct,
        "status":               _status(fin_pct),
    }
