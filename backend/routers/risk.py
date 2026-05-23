from fastapi import APIRouter
from datetime import date
from database import supabase
from utils import get_config, get_active_assets, calculate_buckets, calculate_risk

router = APIRouter()


@router.post("/calculate")
def calculate_and_save():
    config  = get_config()
    assets  = get_active_assets()
    buckets = calculate_buckets(assets, config)
    risk    = calculate_risk(buckets, config)

    today = str(date.today())

    # upsert (날짜가 같으면 업데이트)
    existing = supabase.table("risk_scores").select("id").eq("date", today).execute()
    if existing.data:
        supabase.table("risk_scores").update({
            "total_score": risk["total_score"],
            "cash_score":  risk["cash_score"],
            "seq_score":   risk["seq_score"],
            "conc_score":  risk["conc_score"],
            "level":       risk["level"],
        }).eq("date", today).execute()
    else:
        supabase.table("risk_scores").insert({
            "date":        today,
            "total_score": risk["total_score"],
            "cash_score":  risk["cash_score"],
            "seq_score":   risk["seq_score"],
            "conc_score":  risk["conc_score"],
            "level":       risk["level"],
        }).execute()

    # 버킷 스냅샷도 함께 저장
    bucket_existing = supabase.table("bucket_snapshots").select("id").eq("date", today).execute()
    snap_data = {
        "date":    today,
        "bucket1": buckets["b1"],
        "bucket2": buckets["b2"],
        "bucket3": buckets["b3"],
        "total":   buckets["total"],
    }
    if bucket_existing.data:
        supabase.table("bucket_snapshots").update(snap_data).eq("date", today).execute()
    else:
        supabase.table("bucket_snapshots").insert(snap_data).execute()

    return {"risk": risk, "buckets": buckets, "date": today}


@router.get("/history")
def get_history(limit: int = 12):
    res = supabase.table("risk_scores").select("*").order("date", desc=True).limit(limit).execute()
    return res.data or []


@router.get("/current")
def get_current():
    config  = get_config()
    assets  = get_active_assets()
    buckets = calculate_buckets(assets, config)
    risk    = calculate_risk(buckets, config)
    return {"risk": risk, "buckets": buckets}
