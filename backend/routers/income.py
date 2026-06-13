from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import date
from database import supabase
from utils import get_config, get_pension_info

router = APIRouter()

INCOME_TYPE_LABEL = {
    "interest": "이자",
    "dividend": "배당",
    "earned":   "근로소득",
    "other":    "기타",
}


class IncomeIn(BaseModel):
    income_date:  str           # YYYY-MM-DD
    asset_name:   str
    account_name: Optional[str] = ""
    asset_type:   Optional[str] = ""
    income_type:  str = "interest"
    amount:       float
    note:         Optional[str] = ""


# ── 목록 조회 ─────────────────────────────────────────────────────
@router.get("")
def list_income(limit: int = 200):
    res = supabase.table("income_log") \
        .select("*").order("income_date", desc=True).limit(limit).execute()
    return res.data or []


# ── 등록 ──────────────────────────────────────────────────────────
@router.post("")
def create_income(body: IncomeIn):
    data = body.model_dump()
    res = supabase.table("income_log").insert(data).execute()
    return res.data[0] if res.data else data


# ── 수정 ──────────────────────────────────────────────────────────
@router.put("/{income_id}")
def update_income(income_id: int, body: IncomeIn):
    data = body.model_dump()
    res = supabase.table("income_log").update(data).eq("id", income_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="수입 기록을 찾을 수 없습니다")
    return res.data[0]


# ── 삭제 ──────────────────────────────────────────────────────────
@router.delete("/{income_id}")
def delete_income(income_id: int):
    supabase.table("income_log").delete().eq("id", income_id).execute()
    return {"ok": True}


# ── 요약 통계 ─────────────────────────────────────────────────────
@router.get("/summary")
def get_income_summary():
    today        = date.today()
    current_year = today.year

    # 전체 이력
    res = supabase.table("income_log").select("*").order("income_date").execute()
    rows = res.data or []

    # 설정 (월 생활비)
    config  = get_config()
    pension = get_pension_info(config)
    monthly_expense = float(config.get("user", {}).get("monthly_expense", 5000000))

    # ── 올해 수입 ──────────────────────────────────────────────────
    this_year = [r for r in rows if r["income_date"][:4] == str(current_year)]
    total_this_year = sum(float(r["amount"]) for r in this_year)

    # ── 월별 집계 (올해) ───────────────────────────────────────────
    monthly: dict = {}
    for r in this_year:
        ym  = r["income_date"][:7]          # "YYYY-MM"
        typ = r["income_type"]
        monthly.setdefault(ym, {"interest": 0, "dividend": 0, "earned": 0, "other": 0})
        monthly[ym][typ] = monthly[ym].get(typ, 0) + float(r["amount"])

    monthly_list = [
        {"month": ym, **vals, "total": sum(vals.values())}
        for ym, vals in sorted(monthly.items())
    ]

    # 올해 수입 있는 달만 기준으로 월 평균 계산 (없으면 전체 12개월)
    denom = max(len(monthly_list), 1)
    monthly_avg = round(total_this_year / denom)

    # ── 자산별 집계 (전체) ─────────────────────────────────────────
    by_asset: dict = {}
    for r in rows:
        key = r["asset_name"]
        by_asset.setdefault(key, {
            "asset_name":   key,
            "account_name": r.get("account_name", ""),
            "asset_type":   r.get("asset_type", ""),
            "total":        0,
            "interest":     0,
            "dividend":     0,
            "earned":       0,
            "other":        0,
            "count":        0,
        })
        by_asset[key]["total"]             += float(r["amount"])
        by_asset[key][r.get("income_type","other")] += float(r["amount"])
        by_asset[key]["count"]             += 1

    by_asset_list = sorted(by_asset.values(), key=lambda x: -x["total"])

    # ── 누적 합계 ──────────────────────────────────────────────────
    total_all = sum(float(r["amount"]) for r in rows)

    # ── 생활비 자급률 (설정 기반) ──────────────────────────────────
    self_suf = round(monthly_avg / monthly_expense * 100, 1) if monthly_expense else 0

    # ── 실측 자급률 (실지출 12개월 평균 기반, 3개월 이상 데이터 시) ──
    actual_self_suf       = None
    expense_monthly_avg   = None
    expense_months_count  = 0
    try:
        from collections import defaultdict as _dd
        exp_res = supabase.table("expenses").select("expense_date,amount").execute()
        exp_rows = exp_res.data or []
        if exp_rows:
            today_str  = today.strftime("%Y-%m")
            def _ym_offset(ym: str, n: int) -> str:
                y, m = int(ym[:4]), int(ym[5:7])
                t = y * 12 + (m - 1) - n
                return f"{t // 12}-{(t % 12) + 1:02d}"
            cutoff_12 = _ym_offset(today_str, 11)
            ym_sums: dict = _dd(float)
            for r in exp_rows:
                ym = r["expense_date"][:7]
                if ym >= cutoff_12:
                    ym_sums[ym] += float(r["amount"])
            expense_months_count = len(ym_sums)
            if expense_months_count >= 3:
                expense_monthly_avg = round(sum(ym_sums.values()) / expense_months_count)
                actual_self_suf     = round(monthly_avg / expense_monthly_avg * 100, 1) \
                                      if expense_monthly_avg else None
    except Exception:
        pass

    # ── 소득 유형별 합계 (올해) ────────────────────────────────────
    type_totals = {"interest": 0, "dividend": 0, "earned": 0, "other": 0}
    for r in this_year:
        typ = r.get("income_type", "other")
        if typ in type_totals:
            type_totals[typ] += float(r["amount"])
        else:
            type_totals["other"] += float(r["amount"])

    return {
        "total_this_year":      total_this_year,
        "total_all":            total_all,
        "monthly_avg":          monthly_avg,
        "self_sufficiency":     self_suf,
        "actual_self_suf":      actual_self_suf,
        "expense_monthly_avg":  expense_monthly_avg,
        "expense_months_count": expense_months_count,
        "monthly_expense":      monthly_expense,
        "pension_income":       float(pension["income"]),
        "monthly_list":         monthly_list,
        "by_asset":             by_asset_list,
        "type_totals":          type_totals,
        "current_year":         current_year,
    }
