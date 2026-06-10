"""인출 기록 CRUD — withdrawals 테이블.

기존 withdrawal.py(withdrawal_log 테이블)와 별개:
- withdrawal_log: 포트폴리오 월간 인출 계획 관리
- withdrawals: 실제 연금 수령 인출 기록 (연금소득세 한도 계산에 사용)
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import date
from database import supabase

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
