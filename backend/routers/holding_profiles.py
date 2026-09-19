from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import date, datetime
from database import supabase
from utils import BUCKET_MAP, get_active_assets

router = APIRouter()


class HoldingProfileIn(BaseModel):
    role: Literal['living_expense', 'stability', 'income', 'growth']
    bucket: Optional[Literal[1, 2, 3]] = None          # None = BUCKET_MAP 기본값을 따름
    sub_class: Optional[str] = None
    equity_share_pct: Optional[float] = Field(default=None, ge=0, le=1)
    currency: str = 'KRW'
    fx_hedged: bool = False
    region: Optional[str] = None
    sector: Optional[str] = None
    bond_modified_duration: Optional[float] = Field(default=None, ge=0)
    bond_rate_type: Optional[Literal['fixed', 'floating']] = None
    credit_grade: Optional[str] = None
    reit_property_type: Optional[str] = None
    rate_sensitivity: Optional[float] = None
    expense_ratio: Optional[float] = Field(default=None, ge=0)
    liquidity_note: Optional[str] = None
    value_source: Literal['observed', 'assumed'] = 'assumed'
    as_of_date: Optional[date] = None                   # None = 오늘


def profile_warnings(asset: Optional[dict], profile: dict) -> list:
    """채권(asset_type='bond')은 수정듀레이션·만기가 모두 없을 때만 경고. tdf·fund 는 제외."""
    warnings = []
    if (asset and asset.get("asset_type") == "bond"
            and profile.get("bond_modified_duration") is None
            and not asset.get("maturity_date")):
        warnings.append({
            "code": "bond_duration_missing",
            "message": "채권인데 수정듀레이션과 만기(assets.maturity_date)가 모두 비어 있습니다.",
        })
    return warnings


def _get_asset(asset_id: int) -> Optional[dict]:
    res = supabase.table("assets").select("*").eq("id", asset_id).execute()
    return res.data[0] if res.data else None


@router.get("")
def list_profiles():
    rows = supabase.table("holding_profiles").select("*").order("holding_id").execute().data or []
    assets_by_id = {}
    if rows:
        ids = [r["holding_id"] for r in rows]
        found = supabase.table("assets").select("*").in_("id", ids).execute().data or []
        assets_by_id = {a["id"]: a for a in found}
    return [{**r, "warnings": profile_warnings(assets_by_id.get(r["holding_id"]), r)} for r in rows]


@router.get("/missing")
def list_missing():
    """속성이 아직 입력되지 않은 활성(is_active=true) 보유상품."""
    assets = get_active_assets()
    have = {r["holding_id"] for r in
            (supabase.table("holding_profiles").select("holding_id").execute().data or [])}
    items = [
        {
            "asset_id": a["id"],
            "asset_name": a["asset_name"],
            "account_name": a.get("account_name"),
            "asset_type": a["asset_type"],
            "default_bucket": BUCKET_MAP.get(a["asset_type"]),
        }
        for a in assets if a["id"] not in have
    ]
    return {"count": len(items), "items": items}


@router.get("/{holding_id}")
def get_profile(holding_id: int):
    res = supabase.table("holding_profiles").select("*").eq("holding_id", holding_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="보유상품 속성을 찾을 수 없습니다")
    row = res.data[0]
    return {**row, "warnings": profile_warnings(_get_asset(holding_id), row)}


@router.put("/{holding_id}")
def upsert_profile(holding_id: int, body: HoldingProfileIn):
    """holding_id 기준 upsert (UNIQUE). 저장은 경고와 무관하게 허용."""
    asset = _get_asset(holding_id)
    if not asset:
        raise HTTPException(status_code=404, detail="자산을 찾을 수 없습니다")
    data = body.model_dump(mode="json")
    if data["as_of_date"] is None:
        data["as_of_date"] = str(date.today())
    data["holding_id"] = holding_id
    data["updated_at"] = datetime.now().isoformat()
    try:
        res = supabase.table("holding_profiles").upsert(data, on_conflict="holding_id").execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    row = res.data[0]
    return {**row, "warnings": profile_warnings(asset, row)}


@router.delete("/{holding_id}")
def delete_profile(holding_id: int):
    res = supabase.table("holding_profiles").delete().eq("holding_id", holding_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="보유상품 속성을 찾을 수 없습니다")
    return {"ok": True}
