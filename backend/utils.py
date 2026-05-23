from datetime import date
from database import supabase

BUCKET_MAP = {
    "cash": 1, "bond": 2, "tdf": 2,
    "fund": 2, "equity": 3, "income": 3,
}

# 자산 유형별 연간 기대수익률 (명목, 장기 평균 가정)
EXPECTED_RETURN = {
    "cash":   0.02,   # 현금성: 예금·MMF ~2%
    "bond":   0.04,   # 채권:   국내외 채권 ~4%
    "tdf":    0.05,   # TDF:    생애주기 펀드 ~5%
    "fund":   0.05,   # 펀드:   혼합형 ~5%
    "equity": 0.08,   # 주식형: 장기 주식 ~8%
    "income": 0.05,   # 리츠/인컴: ~5%
}

LABEL_MAP = {"cash": "현금성", "bond": "채권/TDF/펀드", "equity": "주식형", "income": "리츠/인컴"}


def get_config() -> dict:
    res = supabase.table("user_config").select("value").eq("key", "config").execute()
    return res.data[0]["value"] if res.data else {}


def get_active_assets() -> list:
    res = supabase.table("assets").select("*").eq("is_active", True).execute()
    return res.data or []


def calculate_buckets(assets: list, config: dict) -> dict:
    monthly = config.get("user", {}).get("monthly_expense", 5000000)

    b1 = sum(a["current_value"] for a in assets if BUCKET_MAP.get(a["asset_type"], 0) == 1)
    b2 = sum(a["current_value"] for a in assets if BUCKET_MAP.get(a["asset_type"], 0) == 2)
    b3 = sum(a["current_value"] for a in assets if BUCKET_MAP.get(a["asset_type"], 0) == 3)
    total = sum(a["current_value"] for a in assets)
    if total == 0:
        total = 1  # prevent division by zero

    type_sums: dict = {}
    for a in assets:
        t = a["asset_type"]
        type_sums[t] = type_sums.get(t, 0) + a["current_value"]

    cash_total  = type_sums.get("cash", 0)
    bond_total  = type_sums.get("bond", 0) + type_sums.get("tdf", 0) + type_sums.get("fund", 0)
    equity_total = type_sums.get("equity", 0)
    income_total = type_sums.get("income", 0)

    return {
        "b1": b1, "b2": b2, "b3": b3,
        "total": b1 + b2 + b3,
        "months_covered": round(b1 / monthly, 1) if monthly else 0,
        "cash_ratio":   round(cash_total  / total, 4),
        "bond_ratio":   round(bond_total  / total, 4),
        "equity_ratio": round(equity_total / total, 4),
        "income_ratio": round(income_total / total, 4),
        "cash_total": cash_total,
        "bond_total": bond_total,
        "equity_total": equity_total,
        "income_total": income_total,
    }


def calculate_risk(buckets: dict, config: dict) -> dict:
    targets = config.get("portfolio", {})
    months  = buckets["months_covered"]

    # 현금 위험
    if months >= 12:
        cash_score = 0
    elif months >= 6:
        cash_score = 30
    elif months >= 3:
        cash_score = 60
    else:
        cash_score = 100

    # 순서 위험 (equity + income 비중)
    eq_ratio = buckets["equity_ratio"] + buckets["income_ratio"]
    if eq_ratio > 0.50 and months < 6:
        seq_score = 100
    elif eq_ratio > 0.50:
        seq_score = 70
    elif eq_ratio > 0.35:
        seq_score = 50
    else:
        seq_score = 20

    # 집중 위험
    current_map = {
        "cash":   buckets["cash_ratio"],
        "bond":   buckets["bond_ratio"],
        "equity": buckets["equity_ratio"],
        "income": buckets["income_ratio"],
    }
    target_map = {
        "cash":   targets.get("target_cash",   0.25),
        "bond":   targets.get("target_bond",   0.25),
        "equity": targets.get("target_equity", 0.35),
        "income": targets.get("target_income", 0.15),
    }
    max_dev = max(abs(current_map[k] - target_map[k]) for k in target_map)
    if max_dev >= 0.20:
        conc_score = 100
    elif max_dev >= 0.10:
        conc_score = 50
    else:
        conc_score = 0

    total_score = round(cash_score * 0.4 + seq_score * 0.4 + conc_score * 0.2, 1)
    level = "green" if total_score <= 25 else ("yellow" if total_score <= 55 else "red")

    return {
        "total_score": total_score,
        "cash_score":  cash_score,
        "seq_score":   seq_score,
        "conc_score":  conc_score,
        "level":       level,
        "max_deviation": round(max_dev * 100, 1),
        "deviations": {
            k: round((current_map[k] - target_map[k]) * 100, 1)
            for k in target_map
        },
    }


def calculate_estimated_return(assets: list) -> float:
    """자산 유형별 기대수익률 가중평균 → 포트폴리오 추정 명목 수익률 (%)"""
    total = sum(a["current_value"] for a in assets)
    if total == 0:
        return 5.0  # 데이터 없을 때 기본값
    weighted = sum(
        a["current_value"] * EXPECTED_RETURN.get(a["asset_type"], 0.05)
        for a in assets
    )
    return round(weighted / total * 100, 1)


def get_pension_info(config: dict) -> dict:
    pension = config.get("income", {}).get("national_pension", {})
    start   = pension.get("start_date")
    base    = pension.get("base_amount", 0)
    infl    = config.get("inflation", {}).get("assumed_rate", 0.025)
    inflation_adjusted = pension.get("inflation_adjusted", True)
    today   = date.today()

    # inflation_adjusted=False → base_amount 는 오늘(입력 시점) 가격 기준
    # 개시 시점까지의 물가 상승분을 반영해 명목 수령액으로 변환
    if start and not inflation_adjusted:
        py, pm = map(int, start.split("-"))
        yrs_to_start = max(0.0, (py - today.year) + (pm - today.month) / 12)
        base = round(base * (1 + infl) ** yrs_to_start)

    income, months_to = 0, 0
    if start:
        py, pm = map(int, start.split("-"))
        if today >= date(py, pm, 1):
            # 개시 후 → 개시 시점 명목액 기준으로 추가 물가 반영
            yrs    = (today.year - py) + (today.month - pm) / 12
            income = round(base * (1 + infl) ** yrs)
        else:
            months_to = (py - today.year) * 12 + (pm - today.month)

    return {
        "income":          income,
        "months_to_start": months_to,
        "base_amount":     base,   # 개시 시점 명목 월 수령액
        "start_date":      start,
    }
