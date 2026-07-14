"""실물자산 (부동산 등 비금융자산) CRUD + 요약 API.

설계 원칙: 금융자산(assets)과 완전 분리.
- 리밸런싱·4% 인출률·위험점수·버킷 계산에는 절대 포함하지 않는다.
- 순자산 합산 표시와 건보료 재산 과세표준 추정에만 사용한다.

건보료 재산 과세표준 환산율은 프론트 HealthInsurance.jsx와 동일:
  주택 공시가 3억 이하 43% / 3~6억 44% / 6억 초과 45%
  건물·상가·토지 100% / 전세보증금 30% / 기타 0% (차량 등 — 2024년 이후 미부과)
"""
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from database import supabase
from utils import get_active_assets
from tax_constants import HEALTH_INSURANCE_2026

router = APIRouter()

CATEGORIES = {"house", "building", "jeonse", "other"}
CATEGORY_LABELS = {
    "house":    "주택",
    "building": "건물·상가·토지",
    "jeonse":   "전세보증금",
    "other":    "기타 실물자산",
}


# ── 순수 계산 함수 (테스트에서 직접 import) ─────────────────────────

def calc_property_tax_base(category: str, market_value: float, official_price: Optional[float]) -> float:
    """실물자산 1건 → 건보료 재산 과세표준 (원).

    주택·건물은 공시가격 기준(미입력 시 시세로 대체), 전세는 보증금(시세 필드) 기준.
    """
    base = official_price if official_price else market_value
    if category == "house":
        if base <= 300_000_000:
            return base * 0.43
        if base <= 600_000_000:
            return base * 0.44
        return base * 0.45
    if category == "building":
        return base
    if category == "jeonse":
        return market_value * 0.30
    return 0.0  # other — 건보료 재산 미부과


def summarize_real_assets(rows: list) -> dict:
    """활성 실물자산 목록 → 합계·순가치·건보료 과세표준 추정."""
    active = [r for r in rows if r.get("is_active", True)]

    total_market = sum(float(r.get("market_value") or 0) for r in active)
    total_loan   = sum(float(r.get("loan_amount") or 0) for r in active)
    total_acq    = sum(float(r.get("acquisition_price") or 0) for r in active)

    by_category = {}
    tax_base_total = 0.0
    for r in active:
        cat = r.get("category") or "other"
        by_category[cat] = by_category.get(cat, 0) + float(r.get("market_value") or 0)
        tax_base_total += calc_property_tax_base(
            cat, float(r.get("market_value") or 0),
            float(r["official_price"]) if r.get("official_price") else None,
        )

    # 건보료 재산 과세표준 (만원): 환산 합계 − 담보대출 − 기본공제 1억
    deduction_manwon = HEALTH_INSURANCE_2026["basic_property_deduction"]  # 10,000만원
    net_tax_base_manwon = max(
        0.0, (tax_base_total - total_loan) / 10_000 - deduction_manwon
    )

    return {
        "count":               len(active),
        "total_market_value":  round(total_market),
        "total_loan":          round(total_loan),
        "net_value":           round(total_market - total_loan),
        "total_acquisition":   round(total_acq),
        "by_category": [
            {"category": c, "label": CATEGORY_LABELS.get(c, c), "value": round(v)}
            for c, v in sorted(by_category.items(), key=lambda x: -x[1])
        ],
        "tax_base_total":         round(tax_base_total),
        "property_tax_base_manwon": round(net_tax_base_manwon),
    }


def get_property_tax_base_manwon() -> Optional[float]:
    """활성 실물자산 기반 건보료 재산 과세표준 (만원, 공제 후).

    테이블 미생성·조회 실패 시 None — 호출부는 기본값 0으로 동작.
    """
    try:
        res = supabase.table("real_assets").select("*").eq("is_active", True).execute()
        rows = res.data or []
    except Exception:
        return None
    if not rows:
        return None
    return summarize_real_assets(rows)["property_tax_base_manwon"]


# ── Pydantic 모델 ────────────────────────────────────────────────

class RealAssetIn(BaseModel):
    name: str
    category: str = "house"
    market_value: float = 0
    official_price: Optional[float] = None
    loan_amount: float = 0
    acquisition_price: Optional[float] = None
    acquisition_date: Optional[str] = None
    address: Optional[str] = None
    memo: Optional[str] = None
    is_active: bool = True

    @field_validator("category")
    @classmethod
    def category_valid(cls, v):
        if v not in CATEGORIES:
            raise ValueError(f"분류 값이 유효하지 않습니다: {v}")
        return v

    @field_validator("market_value", "loan_amount")
    @classmethod
    def non_negative(cls, v):
        if v < 0:
            raise ValueError("금액은 0 이상이어야 합니다")
        return v

    @field_validator("acquisition_date")
    @classmethod
    def acq_not_future(cls, v):
        if v and v > str(date.today()):
            raise ValueError("취득일은 오늘 이후 날짜를 입력할 수 없습니다.")
        return v


# ── 라우터 ───────────────────────────────────────────────────────

@router.get("")
def list_real_assets():
    res = supabase.table("real_assets").select("*").order("category").order("name").execute()
    return res.data or []


@router.get("/summary")
def real_assets_summary():
    """실물자산 합계 + 금융자산 합산 순자산 + 건보료 과세표준 추정."""
    res = supabase.table("real_assets").select("*").execute()
    summary = summarize_real_assets(res.data or [])

    financial_total = sum(a["current_value"] for a in get_active_assets())
    summary["financial_total"] = round(financial_total)
    summary["combined_net_worth"] = round(financial_total + summary["net_value"])
    return summary


@router.post("")
def create_real_asset(body: RealAssetIn):
    data = body.model_dump()
    data["updated_at"] = datetime.now().isoformat()
    try:
        res = supabase.table("real_assets").insert(data).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return res.data[0]


@router.put("/{real_asset_id}")
def update_real_asset(real_asset_id: int, body: RealAssetIn):
    data = body.model_dump()
    data["updated_at"] = datetime.now().isoformat()
    try:
        res = supabase.table("real_assets").update(data).eq("id", real_asset_id).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not res.data:
        raise HTTPException(status_code=404, detail="실물자산을 찾을 수 없습니다")
    return res.data[0]


@router.delete("/{real_asset_id}")
def delete_real_asset(real_asset_id: int):
    res = supabase.table("real_assets").delete().eq("id", real_asset_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="실물자산을 찾을 수 없습니다")
    return {"ok": True}


@router.patch("/{real_asset_id}/toggle")
def toggle_real_asset(real_asset_id: int):
    cur = supabase.table("real_assets").select("is_active").eq("id", real_asset_id).execute()
    if not cur.data:
        raise HTTPException(status_code=404, detail="실물자산을 찾을 수 없습니다")
    new_state = not cur.data[0]["is_active"]
    res = supabase.table("real_assets").update({
        "is_active": new_state,
        "updated_at": datetime.now().isoformat(),
    }).eq("id", real_asset_id).execute()
    return res.data[0]
