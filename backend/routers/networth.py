from fastapi import APIRouter
from pydantic import BaseModel
from datetime import date, datetime
from typing import Optional
from database import supabase
from utils import get_config, get_active_assets, calculate_buckets

router = APIRouter()


class SnapshotIn(BaseModel):
    snapshot_date: date
    total_value: float
    b1_value: Optional[float] = 0.0
    b2_value: Optional[float] = 0.0
    b3_value: Optional[float] = 0.0
    note: Optional[str] = ""


# ── 이력 조회 ────────────────────────────────────────────────────────
@router.get("/history")
def get_history():
    res = supabase.table("portfolio_snapshots") \
        .select("*").order("snapshot_date").execute()
    rows = res.data or []

    snapshots = [
        {
            "id":    r["id"],
            "date":  r["snapshot_date"],
            "total": float(r["total_value"]),
            "b1":    float(r.get("b1_value") or 0),
            "b2":    float(r.get("b2_value") or 0),
            "b3":    float(r.get("b3_value") or 0),
            "note":  r.get("note") or "",
        }
        for r in rows
    ]

    # ── 월별 집계 (각 월의 마지막 스냅샷) ──────────────────────────
    monthly_map: dict = {}
    for s in snapshots:
        monthly_map[s["date"][:7]] = s
    monthly_list = list(monthly_map.values())

    # ── 연도별 집계 (각 연도 마지막 스냅샷 + YoY 성장) ─────────────
    annual_map: dict = {}
    for s in snapshots:
        annual_map[int(s["date"].split("-")[0])] = s

    annual_list = []
    years = sorted(annual_map.keys())
    for i, yr in enumerate(years):
        s    = annual_map[yr]
        prev = annual_map.get(years[i - 1]) if i > 0 else None
        yoy_change = round(s["total"] - prev["total"]) if prev else None
        yoy_pct    = round(yoy_change / prev["total"] * 100, 2) \
                     if prev and prev["total"] else None
        annual_list.append({
            "year": yr, "date": s["date"],
            "total": s["total"], "b1": s["b1"], "b2": s["b2"], "b3": s["b3"],
            "yoy_change": yoy_change, "yoy_pct": yoy_pct,
        })

    # ── 전체 통계 ──────────────────────────────────────────────────
    stats: dict = {}
    if snapshots:
        first, last = snapshots[0], snapshots[-1]
        total_change = last["total"] - first["total"]
        total_pct    = round(total_change / first["total"] * 100, 2) \
                       if first["total"] else 0

        fd = datetime.strptime(first["date"], "%Y-%m-%d").date()
        ld = datetime.strptime(last["date"],  "%Y-%m-%d").date()
        yrs_elapsed = (ld - fd).days / 365.25
        cagr = (
            round(((last["total"] / first["total"]) ** (1 / yrs_elapsed) - 1) * 100, 2)
            if yrs_elapsed > 0.1 and first["total"] > 0 else None
        )
        stats = {
            "first_date":   first["date"],
            "latest_date":  last["date"],
            "latest_total": last["total"],
            "first_total":  first["total"],
            "total_change": round(total_change),
            "total_pct":    total_pct,
            "cagr":         cagr,
            "count":        len(snapshots),
        }

    return {
        "snapshots":      snapshots,
        "monthly_list":   monthly_list,
        "annual_summary": annual_list,
        "stats":          stats,
    }


# ── 스냅샷 추가 / 수정 ────────────────────────────────────────────────
@router.post("")
def upsert_snapshot(body: SnapshotIn):
    data = {
        "snapshot_date": body.snapshot_date.isoformat(),
        "total_value":   body.total_value,
        "b1_value":      body.b1_value or 0.0,
        "b2_value":      body.b2_value or 0.0,
        "b3_value":      body.b3_value or 0.0,
        "note":          body.note or "",
    }
    res = supabase.table("portfolio_snapshots") \
        .upsert(data, on_conflict="snapshot_date").execute()
    return res.data[0] if res.data else data


# ── 오늘 현재 자산으로 즉시 저장 ───────────────────────────────────────
@router.post("/today")
def save_today():
    config  = get_config()
    assets  = get_active_assets()
    buckets = calculate_buckets(assets, config)
    today   = date.today()
    data = {
        "snapshot_date": today.isoformat(),
        "total_value":   float(buckets["total"]),
        "b1_value":      float(buckets["b1"]),
        "b2_value":      float(buckets["b2"]),
        "b3_value":      float(buckets["b3"]),
        "note":          "수동 저장",
    }
    res = supabase.table("portfolio_snapshots") \
        .upsert(data, on_conflict="snapshot_date").execute()
    return res.data[0] if res.data else data


# ── 스냅샷 삭제 ───────────────────────────────────────────────────────
@router.delete("/{snapshot_id}")
def delete_snapshot(snapshot_id: int):
    supabase.table("portfolio_snapshots").delete().eq("id", snapshot_id).execute()
    return {"deleted": snapshot_id}
