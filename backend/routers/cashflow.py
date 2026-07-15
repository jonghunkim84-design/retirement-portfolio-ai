from fastapi import APIRouter
from datetime import date
from database import supabase
from utils import get_active_assets, get_config, get_pension_info, get_monthly_withdrawal_totals

router = APIRouter()


def _add_months(d: date, n: int) -> date:
    """날짜에 n개월 더하기 (항상 1일 반환)"""
    month = d.month - 1 + n
    year  = d.year + month // 12
    month = month % 12 + 1
    return d.replace(year=year, month=month, day=1)


@router.get("/monthly")
def get_monthly_cashflow():
    """과거 3개월 + 현재 + 향후 12개월 = 16개월 현금흐름 캘린더"""
    today  = date.today()
    config = get_config()
    assets = get_active_assets()
    pension = get_pension_info(config)

    monthly_expense      = float(config.get("user", {}).get("monthly_expense", 5000000))
    pension_income       = float(pension["income"])
    recommended_wd       = max(0.0, monthly_expense - pension_income)

    # 인출 이력 — withdrawals 건별 기록의 월별 합계 (withdrawal_log 폐지)
    wd_totals = get_monthly_withdrawal_totals()

    # 실지출 이력 (expenses 테이블, YYYY-MM → 합계)
    from collections import defaultdict as _dd
    exp_res  = supabase.table("expenses").select("expense_date,amount").execute()
    exp_map: dict[str, float] = _dd(float)
    for r in (exp_res.data or []):
        exp_map[r["expense_date"][:7]] += float(r["amount"])

    months_data = []
    for i in range(-3, 13):          # -3 ~ +12 = 16개월
        m         = _add_months(today, i)
        month_str = m.strftime("%Y-%m")
        is_past    = i < 0
        is_current = i == 0
        is_future  = i > 0

        # 만기 자산
        maturing = [
            a for a in assets
            if (a.get("maturity_date") or "")[:7] == month_str
        ]
        maturity_total = sum(float(a["current_value"]) for a in maturing)

        # 인출 내역 (실적 있으면 실적, 없으면 권장액)
        actual_wd   = wd_totals.get(month_str)
        planned_wd  = recommended_wd
        display_wd  = actual_wd if actual_wd is not None else planned_wd

        # 실지출 데이터 (과거 달만, 기록 있는 경우)
        actual_expense = exp_map.get(month_str) if is_past else None

        inflow = maturity_total + pension_income
        net    = inflow - display_wd

        months_data.append({
            "month":        month_str,
            "month_label":  f"{m.year}년 {m.month}월",
            "year":         m.year,
            "month_num":    m.month,
            "is_past":      is_past,
            "is_current":   is_current,
            "is_future":    is_future,
            "actual_expense": actual_expense,
            "maturing_assets": [
                {
                    "id":            a["id"],
                    "asset_name":    a["asset_name"],
                    "account_name":  a["account_name"],
                    "asset_type":    a.get("asset_type"),
                    "current_value": float(a["current_value"]),
                    "maturity_date": a.get("maturity_date"),
                }
                for a in maturing
            ],
            "maturity_count":    len(maturing),
            "maturity_total":    maturity_total,
            "pension_income":    pension_income,
            "planned_withdrawal":  planned_wd,
            "actual_withdrawal":   actual_wd,
            "display_withdrawal":  display_wd,
            "has_actual":          actual_wd is not None,
            "inflow":              inflow,
            "net_cashflow":        net,
        })

    # 향후 12개월(현재 포함) 요약
    future12 = [m for m in months_data if m["is_current"] or m["is_future"]][:13]
    summary  = {
        "total_maturity_12m":   sum(m["maturity_total"]   for m in future12),
        "total_withdrawal_12m": sum(m["display_withdrawal"] for m in future12),
        "total_pension_12m":    pension_income * 12,
        "net_12m":              sum(m["net_cashflow"] for m in future12),
        "months_with_maturity": sum(1 for m in future12 if m["maturity_count"] > 0),
    }

    return {
        "months":               months_data,
        "summary":              summary,
        "recommended_withdrawal": recommended_wd,
        "pension_income":       pension_income,
        "monthly_expense":      monthly_expense,
    }
