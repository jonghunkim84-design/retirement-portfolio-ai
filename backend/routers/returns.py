from fastapi import APIRouter
from datetime import date, datetime
from database import supabase
from utils import get_active_assets, calculate_buckets, get_config

router = APIRouter()


def _calc_asset_return(a: dict, today: date) -> dict:
    """자산 1개의 수익률 계산"""
    inv = a.get("investment_amount")
    cur = float(a.get("current_value", 0))
    pd_str = a.get("purchase_date")

    holding_days = None
    if pd_str:
        try:
            pd = date.fromisoformat(pd_str)
            holding_days = (today - pd).days
        except Exception:
            pass

    total_return = None
    annual_return = None
    if inv and inv > 0 and cur > 0:
        total_return = round((cur - inv) / inv * 100, 2)
        # 연환산은 보유 365일 이상인 경우에만 계산 (단기 보유 시 왜곡 방지)
        if holding_days and holding_days >= 365:
            annual_return = round(((cur / inv) ** (365 / holding_days) - 1) * 100, 2)

    return {
        **a,
        "holding_days":        holding_days,
        "total_return":        total_return,
        "annual_return":       annual_return,
        "under_one_year":      (holding_days is not None and holding_days < 365),
    }


@router.get("/assets")
def get_asset_returns():
    """자산별 수익률 목록"""
    today = date.today()
    assets = get_active_assets()
    results = [_calc_asset_return(a, today) for a in assets]

    # 포트폴리오 가중평균 연환산 수익률
    total_cur = sum(float(a["current_value"]) for a in assets)
    weighted_annual = None
    if total_cur > 0:
        valid = [r for r in results if r["annual_return"] is not None]
        if valid:
            weighted_annual = round(
                sum(r["annual_return"] * float(r["current_value"]) for r in valid)
                / sum(float(r["current_value"]) for r in valid),
                2
            )

    # 투자금 합계 vs 현재가 합계
    total_inv = sum(float(a["investment_amount"]) for a in assets if a.get("investment_amount"))

    return {
        "assets":           results,
        "total_current":    total_cur,
        "total_invested":   total_inv,
        "portfolio_total_return": round((total_cur - total_inv) / total_inv * 100, 2) if total_inv > 0 else None,
        "portfolio_annual_return": weighted_annual,
    }


@router.post("/snapshot")
def save_snapshot():
    """오늘 날짜 포트폴리오 스냅샷 저장 (이미 있으면 업데이트)"""
    today = date.today()
    config = get_config()
    assets = get_active_assets()
    buckets = calculate_buckets(assets, config)

    data = {
        "snapshot_date": today.isoformat(),
        "total_value":   float(buckets["total"]),
        "b1_value":      float(buckets["b1"]),
        "b2_value":      float(buckets["b2"]),
        "b3_value":      float(buckets["b3"]),
    }

    # upsert: 같은 날짜면 덮어씀
    res = supabase.table("portfolio_snapshots").upsert(data, on_conflict="snapshot_date").execute()
    return res.data[0] if res.data else data


@router.get("/snapshots")
def get_snapshots():
    """스냅샷 이력 전체 (최근 36개월)"""
    res = supabase.table("portfolio_snapshots") \
        .select("*").order("snapshot_date", desc=True).limit(36).execute()
    return res.data or []


@router.get("/annual")
def get_annual_returns():
    """연간 수익률 계산 (스냅샷 + 인출 이력 기반, Modified Dietz)"""
    today = date.today()
    current_year = today.year

    # 스냅샷 전체 조회
    snap_res = supabase.table("portfolio_snapshots").select("*").order("snapshot_date").execute()
    snapshots = {s["snapshot_date"]: s for s in (snap_res.data or [])}

    # 인출 이력 전체 조회
    wd_res = supabase.table("withdrawal_log").select("date,actual_amount,amount").execute()
    withdrawals = wd_res.data or []

    results = []
    # 스냅샷이 있는 연도 범위 계산
    if snapshots:
        dates = sorted(snapshots.keys())
        min_year = int(dates[0][:4])
        max_year = min(current_year - 1, int(dates[-1][:4]))

        for year in range(min_year, max_year + 1):
            # 연초: 해당 연도 1월 중 가장 이른 스냅샷
            start_snaps = [v for k, v in snapshots.items() if k.startswith(f"{year}-01")]
            # 연말: 해당 연도 12월 중 가장 늦은 스냅샷
            end_snaps   = [v for k, v in snapshots.items() if k.startswith(f"{year}-12")]

            if not start_snaps or not end_snaps:
                continue

            start_val = float(sorted(start_snaps, key=lambda x: x["snapshot_date"])[0]["total_value"])
            end_val   = float(sorted(end_snaps,   key=lambda x: x["snapshot_date"])[-1]["total_value"])

            # 해당 연도 실제 인출액 합계
            year_wd = sum(
                float(w.get("actual_amount") or w.get("amount") or 0)
                for w in withdrawals
                if (w.get("date") or "").startswith(str(year))
            )

            # Modified Dietz (간소화: 인출을 연중간 발생으로 가정 → 가중치 0.5)
            denom = start_val + year_wd * 0.5
            ret = round((end_val - start_val + year_wd) / denom * 100, 2) if denom > 0 else None

            results.append({
                "year":        year,
                "start_value": start_val,
                "end_value":   end_val,
                "withdrawals": year_wd,
                "return_rate": ret,
            })

    return results
