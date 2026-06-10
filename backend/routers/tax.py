from fastapi import APIRouter
from datetime import date
from database import supabase

router = APIRouter()

THRESHOLD = 20_000_000


@router.get("/summary")
def get_tax_summary():
    today      = date.today()
    year_start = f"{today.year}-01-01"
    year_end   = today.isoformat()

    # 올해 이자+배당 수입 합계 (income_log 직접 조회)
    res = supabase.table("income_log") \
        .select("amount") \
        .in_("income_type", ["interest", "dividend"]) \
        .gte("income_date", year_start) \
        .lte("income_date", year_end) \
        .execute()

    financial_income_ytd = sum(float(r["amount"]) for r in (res.data or []))

    remaining       = THRESHOLD - financial_income_ytd
    utilization_pct = round(financial_income_ytd / THRESHOLD * 100, 1)

    if utilization_pct >= 80:
        status = "danger"
    elif utilization_pct >= 60:
        status = "warning"
    else:
        status = "safe"

    return {
        "financial_income_ytd": financial_income_ytd,
        "threshold":            THRESHOLD,
        "remaining":            remaining,
        "utilization_pct":      utilization_pct,
        "status":               status,
    }
