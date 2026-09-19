from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator
from typing import Optional, Literal
from datetime import date, datetime
from database import supabase

router = APIRouter()


class CashflowItemIn(BaseModel):
    item_type: Literal['expense_essential', 'expense_discretionary', 'income_regular']
    name: str = Field(min_length=1)
    monthly_amount: float = Field(default=0, ge=0)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    inflation_linked: bool = False

    @model_validator(mode='after')
    def end_not_before_start(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError('종료일은 시작일보다 앞설 수 없습니다.')
        return self


@router.get("")
def list_items():
    res = supabase.table("cashflow_items").select("*").order("item_type").order("name").execute()
    return res.data or []


@router.post("")
def create_item(body: CashflowItemIn):
    data = body.model_dump(mode="json")
    data["updated_at"] = datetime.now().isoformat()
    try:
        res = supabase.table("cashflow_items").insert(data).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return res.data[0]


@router.put("/{item_id}")
def update_item(item_id: int, body: CashflowItemIn):
    data = body.model_dump(mode="json")
    data["updated_at"] = datetime.now().isoformat()
    try:
        res = supabase.table("cashflow_items").update(data).eq("id", item_id).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not res.data:
        raise HTTPException(status_code=404, detail="항목을 찾을 수 없습니다")
    return res.data[0]


@router.delete("/{item_id}")
def delete_item(item_id: int):
    res = supabase.table("cashflow_items").delete().eq("id", item_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="항목을 찾을 수 없습니다")
    return {"ok": True}
