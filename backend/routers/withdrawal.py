from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import date
from database import supabase
from utils import get_config, get_active_assets, calculate_buckets, get_pension_info

router = APIRouter()


class WithdrawalIn(BaseModel):
    year:   int
    month:  int
    actual_amount: float
    note:   Optional[str] = None


@router.get("")
def list_withdrawals(limit: int = 24):
    res = supabase.table("withdrawal_log").select("*").order("date", desc=True).limit(limit).execute()
    return res.data or []


@router.post("")
def save_withdrawal(body: WithdrawalIn):
    target_date = f"{body.year:04d}-{body.month:02d}-01"

    exists = supabase.table("withdrawal_log").select("id,amount") \
        .eq("date", target_date).execute()

    if exists.data:
        supabase.table("withdrawal_log").update({
            "actual_amount": body.actual_amount,
            "note":          body.note or "",
        }).eq("date", target_date).execute()
        return {"ok": True, "action": "updated", "date": target_date}
    else:
        # 권장 인출액 계산
        config  = get_config()
        assets  = get_active_assets()
        buckets = calculate_buckets(assets, config)
        pension = get_pension_info(config)
        monthly = config.get("user", {}).get("monthly_expense", 5000000)
        recommended = max(0, monthly - pension["income"])

        supabase.table("withdrawal_log").insert({
            "date":           target_date,
            "amount":         recommended,
            "actual_amount":  body.actual_amount,
            "guardrail_applied": False,
            "note":           body.note or "",
        }).execute()
        return {"ok": True, "action": "created", "date": target_date}


@router.get("/current-month")
def get_current_month():
    today       = date.today()
    target_date = f"{today.year:04d}-{today.month:02d}-01"
    config  = get_config()
    pension = get_pension_info(config)
    monthly = config.get("user", {}).get("monthly_expense", 5000000)
    recommended = max(0, monthly - pension["income"])

    res = supabase.table("withdrawal_log").select("*").eq("date", target_date).execute()
    existing = res.data[0] if res.data else None

    return {
        "year":          today.year,
        "month":         today.month,
        "recommended":   recommended,
        "actual_amount": existing.get("actual_amount") if existing else None,
        "guardrail":     existing.get("guardrail_applied", False) if existing else False,
        "pension_income": pension["income"],
        "monthly_expense": monthly,
    }
