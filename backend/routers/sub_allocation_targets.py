from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Literal
from datetime import datetime
from database import supabase

router = APIRouter()

ASSET_CLASSES = ('cash', 'bond', 'equity', 'income')
_SUM_TOLERANCE = 0.0001


class SubAllocationIn(BaseModel):
    asset_class: Literal['cash', 'bond', 'equity', 'income']
    sub_class: str = Field(min_length=1)
    target_pct: float = Field(ge=0, le=1)     # 자산군 내 비중, 0~1 소수
    band_pct: float = Field(default=0, ge=0, le=1)   # 허용 폭(±), 0~1 소수


def summarize_targets(rows: list) -> list:
    """자산군별 target_pct 합계. 합계가 1.0 이 아니면 sum_warning=True (저장은 허용)."""
    sums = {}
    for r in rows:
        sums[r["asset_class"]] = sums.get(r["asset_class"], 0.0) + float(r["target_pct"])
    return [
        {
            "asset_class": c,
            "target_pct_sum": round(sums[c], 6),
            "sum_warning": abs(sums[c] - 1.0) > _SUM_TOLERANCE,
        }
        for c in ASSET_CLASSES if c in sums
    ]


@router.get("")
def list_targets():
    rows = (supabase.table("sub_allocation_targets").select("*")
            .order("asset_class").order("sub_class").execute().data or [])
    return {"items": rows, "summaries": summarize_targets(rows)}


@router.post("")
def create_target(body: SubAllocationIn):
    data = body.model_dump(mode="json")
    data["updated_at"] = datetime.now().isoformat()
    try:
        res = supabase.table("sub_allocation_targets").insert(data).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return res.data[0]


@router.put("/{target_id}")
def update_target(target_id: int, body: SubAllocationIn):
    data = body.model_dump(mode="json")
    data["updated_at"] = datetime.now().isoformat()
    try:
        res = supabase.table("sub_allocation_targets").update(data).eq("id", target_id).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not res.data:
        raise HTTPException(status_code=404, detail="항목을 찾을 수 없습니다")
    return res.data[0]


@router.delete("/{target_id}")
def delete_target(target_id: int):
    res = supabase.table("sub_allocation_targets").delete().eq("id", target_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="항목을 찾을 수 없습니다")
    return {"ok": True}
