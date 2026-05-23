from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from database import supabase

router = APIRouter()


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
    investment_amount: Optional[float] = None   # 입금액 (매수 원금)


@router.get("")
def list_assets():
    res = supabase.table("assets").select("*").order("account_name").order("asset_name").execute()
    return res.data or []


@router.post("")
def create_asset(body: AssetIn):
    data = body.model_dump()
    data["created_at"] = datetime.now().isoformat()
    data["updated_at"] = datetime.now().isoformat()
    res = supabase.table("assets").insert(data).execute()
    return res.data[0]


@router.put("/{asset_id}")
def update_asset(asset_id: int, body: AssetIn):
    data = body.model_dump()
    data["updated_at"] = datetime.now().isoformat()
    res = supabase.table("assets").update(data).eq("id", asset_id).execute()
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
