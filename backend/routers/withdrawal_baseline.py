from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from datetime import date, datetime
from database import supabase

router = APIRouter()

BASELINE_ID = 1   # 단일 행 (DB CHECK id = 1)


class WithdrawalBaselineIn(BaseModel):
    withdrawal_start_date: date
    initial_portfolio_value: float = Field(ge=0)
    initial_annual_withdrawal: float = Field(ge=0)


@router.get("")
def get_baseline():
    """미설정이면 null. 초기 인출률은 저장·계산하지 않는다 (이후 단계)."""
    res = supabase.table("withdrawal_baseline").select("*").eq("id", BASELINE_ID).execute()
    return res.data[0] if res.data else None


@router.put("")
def upsert_baseline(body: WithdrawalBaselineIn):
    data = body.model_dump(mode="json")
    data["id"] = BASELINE_ID
    data["updated_at"] = datetime.now().isoformat()
    try:
        res = supabase.table("withdrawal_baseline").upsert(data, on_conflict="id").execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return res.data[0]


@router.delete("")
def delete_baseline():
    res = supabase.table("withdrawal_baseline").delete().eq("id", BASELINE_ID).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="인출 기준점이 설정되어 있지 않습니다")
    return {"ok": True}
