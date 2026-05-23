from fastapi import APIRouter
from datetime import date
from database import supabase
from utils import get_active_assets, get_config, get_pension_info

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

    # 인출 이력 (date 앞 7자리 → YYYY-MM 키)
    wd_res = supabase.table("withdrawal_log").select("*").order("date").execute()
    wd_map = {w["date"][:7]: w for w in (wd_res.data or [])}

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

        # 인출 내역
        wd = wd_map.get(month_str)
        actual_wd   = float(wd["actual_amount"]) if wd and wd.get("actual_amount") else None
        planned_wd  = float(wd["amount"])        if wd and wd.get("amount")         else recommended_wd
        display_wd  = actual_wd if actual_wd is not None else planned_wd

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
