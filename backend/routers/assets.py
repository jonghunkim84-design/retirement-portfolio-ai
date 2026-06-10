from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator, model_validator
from typing import Optional
from datetime import date, datetime
from database import supabase

router = APIRouter()

_TAX_ACCOUNT_TYPES = {'pension_savings', 'retirement_pension', 'isa', 'regular'}


class AssetIn(BaseModel):
    account_name: str
    asset_name: str
    ticker: Optional[str] = None
    asset_type: str
    quantity: float = 0
    unit_price: float = 0
    current_value: float = 0
    purchase_date: Optional[str] = None
    is_active: bool = True
    maturity_date: Optional[str] = None
    investment_amount: Optional[float] = None
    tax_account_type: Optional[str] = None

    @field_validator('purchase_date')
    @classmethod
    def purchase_not_future(cls, v):
        if v and v > str(date.today()):
            raise ValueError('매입일은 오늘 이후 날짜를 입력할 수 없습니다.')
        return v

    @field_validator('tax_account_type')
    @classmethod
    def tax_type_valid(cls, v):
        if v is not None and v not in _TAX_ACCOUNT_TYPES:
            raise ValueError(f'세제 분류 값이 유효하지 않습니다: {v}')
        return v

    @model_validator(mode='after')
    def check_maturity_after_purchase(self):
        if self.maturity_date and self.purchase_date:
            if self.maturity_date <= self.purchase_date:
                raise ValueError('만기일은 매입일보다 이후여야 합니다.')
        return self


@router.get("")
def list_assets():
    res = supabase.table("assets").select("*").order("account_name").order("asset_name").execute()
    return res.data or []


@router.post("")
def create_asset(body: AssetIn):
    data = body.model_dump()
    data["created_at"] = datetime.now().isoformat()
    data["updated_at"] = datetime.now().isoformat()
    try:
        res = supabase.table("assets").insert(data).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return res.data[0]


@router.put("/{asset_id}")
def update_asset(asset_id: int, body: AssetIn):
    data = body.model_dump()
    data["updated_at"] = datetime.now().isoformat()
    try:
        res = supabase.table("assets").update(data).eq("id", asset_id).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not res.data:
        raise HTTPException(status_code=404, detail="자산을 찾을 수 없습니다")
    return res.data[0]


@router.delete("/{asset_id}")
def delete_asset(asset_id: int):
    res = supabase.table("assets").delete().eq("id", asset_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="자산을 찾을 수 없습니다")
    return {"ok": True}


@router.patch("/{asset_id}/toggle")
def toggle_active(asset_id: int):
    cur = supabase.table("assets").select("is_active").eq("id", asset_id).execute()
    if not cur.data:
        raise HTTPException(status_code=404, detail="자산을 찾을 수 없습니다")
    new_state = not cur.data[0]["is_active"]
    res = supabase.table("assets").update({
        "is_active": new_state,
        "updated_at": datetime.now().isoformat()
    }).eq("id", asset_id).execute()
    return res.data[0]
