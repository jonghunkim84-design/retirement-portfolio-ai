"""인출 기록 CRUD + 월별 요약 — withdrawals 테이블 (단일 인출 데이터 소스).

withdrawal_log(월간 계획) 테이블은 폐지됨 — 건별 인출 기록의 월별 합계가
현금흐름·대시보드·수익률·AI 요약·인출 관리 화면에 공용으로 쓰인다.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import date
from database import supabase
from utils import (
    get_config, get_active_assets, calculate_buckets,
    get_pension_info, get_monthly_withdrawal_totals,
)

router = APIRouter()

_VALID_TAX_TYPES = {"pension_savings", "retirement_pension", "isa", "regular"}


class WithdrawalIn(BaseModel):
    withdrawal_date: date
    amount: float
    account_name: str
    tax_account_type: str
    memo: Optional[str] = None


class WithdrawalUpdate(BaseModel):
    withdrawal_date: Optional[date] = None
    amount: Optional[float] = None
    account_name: Optional[str] = None
    tax_account_type: Optional[str] = None
    memo: Optional[str] = None


def _validate_in(body: WithdrawalIn):
    if body.withdrawal_date > date.today():
        raise HTTPException(status_code=422, detail="미래 날짜는 기록할 수 없습니다")
    if body.amount <= 0:
        raise HTTPException(status_code=422, detail="금액은 0보다 커야 합니다")
    if body.tax_account_type not in _VALID_TAX_TYPES:
        raise HTTPException(status_code=422, detail=f"tax_account_type은 {sorted(_VALID_TAX_TYPES)} 중 하나여야 합니다")


@router.get("/summary")
def withdrawals_summary(months: int = 24):
    """인출 관리 화면용 요약 — 월별 합계·인출률(실적)·비상자금."""
    config  = get_config()
    assets  = get_active_assets()
    buckets = calculate_buckets(assets, config)
    pension = get_pension_info(config)

    monthly_expense = float(config.get("user", {}).get("monthly_expense", 5_000_000))
    recommended     = max(0.0, monthly_expense - pension["income"])

    totals = get_monthly_withdrawal_totals()
    monthly = [
        {"month": m, "total": round(v)}
        for m, v in sorted(totals.items())[-months:]
    ]

    today = date.today()
    this_month = today.strftime("%Y-%m")
    ytd_total = sum(v for m, v in totals.items() if m.startswith(str(today.year)))
    last_12 = sum(v for m, v in sorted(totals.items(), reverse=True)[:12])

    total_assets = buckets["total"]
    return {
        "monthly":              monthly,
        "current_month":        this_month,
        "current_month_total":  round(totals.get(this_month, 0)),
        "ytd_total":            round(ytd_total),
        "last_12m_total":       round(last_12),
        # 인출률: 최근 12개월 실적 기준 (실적 없으면 None)
        "withdrawal_rate_pct":  round(last_12 / total_assets * 100, 2) if total_assets > 0 and last_12 > 0 else None,
        "emergency_months":     buckets["months_covered"],
        "monthly_expense":      monthly_expense,
        "pension_income":       pension["income"],
        "recommended":          round(recommended),
        "total_assets":         round(total_assets),
    }


@router.get("")
def list_withdrawals(year: Optional[int] = None):
    """인출 기록 목록. year 파라미터로 연도 필터 지원."""
    q = supabase.table("withdrawals").select("*")
    if year:
        q = q.gte("withdrawal_date", f"{year}-01-01").lte("withdrawal_date", f"{year}-12-31")
    res = q.order("withdrawal_date", desc=True).execute()
    return res.data or []


@router.post("", status_code=201)
def create_withdrawal(body: WithdrawalIn):
    _validate_in(body)
    res = supabase.table("withdrawals").insert({
        "withdrawal_date": body.withdrawal_date.isoformat(),
        "amount":          body.amount,
        "account_name":    body.account_name,
        "tax_account_type": body.tax_account_type,
        "memo":            body.memo or "",
    }).execute()
    return res.data[0] if res.data else {"ok": True}


@router.put("/{withdrawal_id}")
def update_withdrawal(withdrawal_id: int, body: WithdrawalUpdate):
    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    if "withdrawal_date" in update_data:
        d = update_data["withdrawal_date"]
        if isinstance(d, date) and d > date.today():
            raise HTTPException(status_code=422, detail="미래 날짜는 기록할 수 없습니다")
        update_data["withdrawal_date"] = d.isoformat() if isinstance(d, date) else d
    if "amount" in update_data and update_data["amount"] <= 0:
        raise HTTPException(status_code=422, detail="금액은 0보다 커야 합니다")
    if "tax_account_type" in update_data and update_data["tax_account_type"] not in _VALID_TAX_TYPES:
        raise HTTPException(status_code=422, detail=f"유효하지 않은 tax_account_type")
    if not update_data:
        raise HTTPException(status_code=400, detail="변경할 항목이 없습니다")
    supabase.table("withdrawals").update(update_data).eq("id", withdrawal_id).execute()
    return {"ok": True}


@router.delete("/{withdrawal_id}", status_code=204)
def delete_withdrawal(withdrawal_id: int):
    supabase.table("withdrawals").delete().eq("id", withdrawal_id).execute()
