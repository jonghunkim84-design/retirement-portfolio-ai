from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import date
from collections import defaultdict
from database import supabase
from utils import get_config

router = APIRouter()

CATEGORY_LABEL = {
    'living':  '생활비',
    'housing': '주거·관리',
    'medical': '의료·건강',
    'family':  '경조사·가족',
    'leisure': '여행·여가',
    'other':   '기타',
}
VALID_CATEGORIES = set(CATEGORY_LABEL.keys())


class ExpenseIn(BaseModel):
    expense_date: str   # YYYY-MM-DD
    amount:       float
    category:     str = 'other'
    memo:         Optional[str] = ''

    @field_validator('expense_date')
    @classmethod
    def date_not_future(cls, v: str) -> str:
        if v > date.today().isoformat():
            raise ValueError('미래 날짜는 입력할 수 없습니다')
        return v

    @field_validator('amount')
    @classmethod
    def amount_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('금액은 0보다 커야 합니다')
        return v

    @field_validator('category')
    @classmethod
    def coerce_category(cls, v: str) -> str:
        return v if v in VALID_CATEGORIES else 'other'


def _ym_offset(ym: str, n: int) -> str:
    """YYYY-MM 문자열에서 n개월 전 반환."""
    y, m = int(ym[:4]), int(ym[5:7])
    total = y * 12 + (m - 1) - n
    return f"{total // 12}-{(total % 12) + 1:02d}"


# ── 요약 집계 (경로 충돌 방지 위해 /{id} 보다 먼저 등록) ─────────
@router.get("/summary")
def get_expense_summary():
    today    = date.today()
    config   = get_config()
    setting  = float(config.get("user", {}).get("monthly_expense", 5_000_000))

    res  = supabase.table("expenses").select("*").order("expense_date").execute()
    rows = res.data or []

    # ── 월별 집계 (카테고리별) ─────────────────────────────────────
    monthly: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for r in rows:
        ym  = r["expense_date"][:7]
        cat = r.get("category") or "other"
        monthly[ym][cat] += float(r["amount"])

    current_ym = today.strftime("%Y-%m")
    cutoff_24  = _ym_offset(current_ym, 23)   # 24개월 전
    cutoff_12  = _ym_offset(current_ym, 11)   # 12개월 전

    # ── 최근 24개월 월별 리스트 ───────────────────────────────────
    monthly_list = []
    for ym in sorted(monthly.keys()):
        if ym >= cutoff_24:
            cats  = dict(monthly[ym])
            total = sum(cats.values())
            monthly_list.append({"month": ym, "total": round(total), **{k: round(v) for k, v in cats.items()}})

    # ── 이번 달 합계 ─────────────────────────────────────────────
    this_month_total = round(sum(monthly[current_ym].values())) if current_ym in monthly else 0

    # ── 최근 12개월: 데이터 있는 달만 평균 (결측월 제외) ──────────
    recent_12 = {ym for ym in monthly if ym >= cutoff_12}
    months_with_data = len(recent_12)
    sum_12 = sum(sum(monthly[ym].values()) for ym in recent_12)
    monthly_avg_12 = round(sum_12 / months_with_data) if months_with_data > 0 else 0

    insufficient_data = months_with_data < 3

    # ── 최근 12개월 카테고리 합계 ─────────────────────────────────
    cat_totals: dict[str, float] = defaultdict(float)
    for ym in recent_12:
        for cat, val in monthly[ym].items():
            cat_totals[cat] += val
    cat_sum = sum(cat_totals.values())
    category_breakdown = [
        {
            "category": cat,
            "label":    CATEGORY_LABEL.get(cat, cat),
            "amount":   round(amt),
            "pct":      round(amt / cat_sum * 100, 1) if cat_sum > 0 else 0,
        }
        for cat, amt in sorted(cat_totals.items(), key=lambda x: -x[1])
    ]

    # ── 설정값 대비 차이 ──────────────────────────────────────────
    diff_abs = monthly_avg_12 - setting if months_with_data > 0 else 0
    diff_pct = round(diff_abs / setting * 100, 1) if setting > 0 and months_with_data > 0 else 0

    return {
        "monthly_list":            monthly_list,
        "this_month_total":        this_month_total,
        "this_month_ym":           current_ym,
        "monthly_avg_12":          monthly_avg_12,
        "months_with_data":        months_with_data,
        "insufficient_data":       insufficient_data,
        "category_breakdown":      category_breakdown,
        "monthly_expense_setting": setting,
        "diff_abs":                diff_abs,
        "diff_pct":                diff_pct,
    }


# ── 목록 조회 ─────────────────────────────────────────────────────
@router.get("")
def list_expenses(year: Optional[int] = None, month: Optional[int] = None, limit: int = 500):
    q = supabase.table("expenses").select("*")
    if year and month:
        if month == 12:
            end_ym = f"{year + 1}-01-01"
        else:
            end_ym = f"{year}-{month + 1:02d}-01"
        q = q.gte("expense_date", f"{year}-{month:02d}-01").lt("expense_date", end_ym)
    elif year:
        q = q.gte("expense_date", f"{year}-01-01").lt("expense_date", f"{year + 1}-01-01")
    res = q.order("expense_date", desc=True).limit(limit).execute()
    return res.data or []


# ── 등록 ──────────────────────────────────────────────────────────
@router.post("")
def create_expense(body: ExpenseIn):
    data = body.model_dump()
    res  = supabase.table("expenses").insert(data).execute()
    return res.data[0] if res.data else data


# ── 수정 ──────────────────────────────────────────────────────────
@router.put("/{expense_id}")
def update_expense(expense_id: int, body: ExpenseIn):
    data = body.model_dump()
    res  = supabase.table("expenses").update(data).eq("id", expense_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="지출 기록을 찾을 수 없습니다")
    return res.data[0]


# ── 삭제 ──────────────────────────────────────────────────────────
@router.delete("/{expense_id}")
def delete_expense(expense_id: int):
    supabase.table("expenses").delete().eq("id", expense_id).execute()
    return {"ok": True}
