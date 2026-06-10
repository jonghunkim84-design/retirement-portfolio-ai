from fastapi import APIRouter
from datetime import date, timedelta
from database import supabase
from utils import get_config, get_active_assets, calculate_buckets, get_pension_info, calculate_estimated_return

router = APIRouter()


@router.get("")
def get_dashboard():
    config  = get_config()
    assets  = get_active_assets()
    buckets = calculate_buckets(assets, config)
    pension = get_pension_info(config)

    # 최신 위험 점수
    risk_res = supabase.table("risk_scores").select("*").order("date", desc=True).limit(1).execute()
    risk = risk_res.data[0] if risk_res.data else {
        "total_score": 0, "cash_score": 0, "seq_score": 0,
        "conc_score": 0, "level": "green", "date": None
    }

    # 최신 AI 요약
    summ_res = supabase.table("recommendations").select("message,date") \
        .eq("rule_id", "ai_summary").order("date", desc=True).limit(1).execute()
    ai_summary = summ_res.data[0] if summ_res.data else None

    # 최근 인출 이력 (3개월)
    wd_res = supabase.table("withdrawal_log").select("*").order("date", desc=True).limit(3).execute()
    withdrawal_history = wd_res.data or []

    monthly_expense        = config.get("user", {}).get("monthly_expense", 5000000)
    recommended_withdrawal = max(0, monthly_expense - pension["income"])

    # ── 연간 인출률 ─────────────────────────────────────────────
    withdrawal_rate = (
        round(recommended_withdrawal * 12 / buckets["total"] * 100, 2)
        if buckets["total"] > 0 else 0
    )

    # ── 버킷 편차 (현재 - 목표, %p 단위) ─────────────────────────
    portfolio_cfg = config.get("portfolio", {})
    bucket_deviations = {
        "cash":   round((buckets["cash_ratio"]   - portfolio_cfg.get("target_cash",   0.25)) * 100, 1),
        "bond":   round((buckets["bond_ratio"]   - portfolio_cfg.get("target_bond",   0.25)) * 100, 1),
        "equity": round((buckets["equity_ratio"] - portfolio_cfg.get("target_equity", 0.35)) * 100, 1),
        "income": round((buckets["income_ratio"] - portfolio_cfg.get("target_income", 0.15)) * 100, 1),
    }

    # ── 60일 내 만기 자산 ─────────────────────────────────────────
    today_dt = date.today()
    cutoff   = today_dt + timedelta(days=60)
    maturing_60d = []
    for a in assets:
        mat_str = a.get("maturity_date")
        if mat_str:
            try:
                mat_date = date.fromisoformat(str(mat_str)[:10])
                if today_dt <= mat_date <= cutoff:
                    maturing_60d.append({
                        "id":            a["id"],
                        "asset_name":    a["asset_name"],
                        "account_name":  a.get("account_name", ""),
                        "asset_type":    a.get("asset_type", ""),
                        "current_value": float(a["current_value"]),
                        "maturity_date": str(mat_date),
                        "days_left":     (mat_date - today_dt).days,
                    })
            except Exception:
                pass
    maturing_60d.sort(key=lambda x: x["days_left"])

    # ── 추정 명목 수익률 ─────────────────────────────────────────
    estimated_return_rate = calculate_estimated_return(assets)

    # ── 비상 유동성 ───────────────────────────────────────────────
    personal_savings_cash = sum(
        a["current_value"] for a in assets
        if a.get("account_name") == "개인저축" and a.get("asset_type") == "cash"
    )
    emergency_months = round(personal_savings_cash / monthly_expense, 1) if monthly_expense else 0

    # ── 비상 유동성 비율 (전체 현금성 / 월 생활비) ───────────────────
    cash_total       = sum(a["current_value"] for a in assets if a.get("asset_type") == "cash")
    monthly_expenses = config.get("user", {}).get("monthly_expense", 0)
    liquidity_months = round(cash_total / monthly_expenses, 1) if monthly_expenses else None
    liquidity = {
        "cash_total":       cash_total,
        "monthly_expenses": monthly_expenses,
        "months":           liquidity_months,
    }

    # ── 이번달 실제 인출액 ────────────────────────────────────────
    current_month_prefix = f"{today_dt.year:04d}-{today_dt.month:02d}"
    current_wd = next(
        (w for w in withdrawal_history if (w.get("date") or "").startswith(current_month_prefix)),
        None
    )
    actual_this_month = current_wd.get("actual_amount") if current_wd else None
    net_withdrawal    = float(actual_this_month) if actual_this_month is not None else recommended_withdrawal

    # ── 오늘 스냅샷 자동 저장 ─────────────────────────────────────
    try:
        supabase.table("portfolio_snapshots").upsert({
            "snapshot_date": today_dt.isoformat(),
            "total_value":   float(buckets["total"]),
            "b1_value":      float(buckets["b1"]),
            "b2_value":      float(buckets["b2"]),
            "b3_value":      float(buckets["b3"]),
        }, on_conflict="snapshot_date").execute()
    except Exception:
        pass

    return {
        "config":                 config,
        "buckets":                buckets,
        "risk":                   risk,
        "ai_summary":             ai_summary,
        "withdrawal_history":     withdrawal_history,
        "pension":                pension,
        "net_withdrawal":         net_withdrawal,
        "recommended_withdrawal": recommended_withdrawal,
        "emergency_liquidity": {
            "cash_amount": personal_savings_cash,
            "months":      emergency_months,
        },
        "estimated_return_rate": estimated_return_rate,
        # ── 신규 필드 ──────────────────────────────────────────
        "withdrawal_rate":    withdrawal_rate,
        "bucket_deviations":  bucket_deviations,
        "maturing_60d":       maturing_60d,
        "liquidity":          liquidity,
    }
