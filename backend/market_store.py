"""시장·노출 API 의 DB 읽기 도우미 (지시서 04 단계 E). 읽기 전용 — 쓰기는 market_data 의 수집 함수만 한다.

db 클라이언트를 인자로 받는다(라우터가 자기 모듈의 supabase 를 넘김). 계산은 하지 않는다.
PostgREST 는 한 번에 최대 1000행만 돌려주므로 관측값은 range 로 나누어 읽는다.
"""
from datetime import date, timedelta
from typing import Iterable, Optional

from withdrawal_check import minus_months

PAGE = 1000
DEFAULT_LOOKBACK_DAYS = 365
CHECK_RULE_CODES = ("R-01", "R-02", "R-05", "R-06")


def load_series(db) -> dict:
    rows = db.table("market_series").select("*").execute().data or []
    return {r["code"]: r for r in rows}


def load_benchmarks(db) -> dict:
    rows = db.table("region_benchmarks").select("region,series_code").execute().data or []
    return {r["region"]: r["series_code"] for r in rows}


def load_observations(db, codes: Iterable[str], start: date, end: date) -> dict:
    """{code: [{obs_date, value, flag, source}]} — [start, end] 구간, 일자순. 1000행씩 나누어 읽는다."""
    codes = list(codes)
    out = {c: [] for c in codes}
    if not codes:
        return out
    offset = 0
    while True:
        rows = (db.table("market_observations").select("series_code,obs_date,value,flag,source")
                .in_("series_code", codes).gte("obs_date", start.isoformat()).lte("obs_date", end.isoformat())
                .order("obs_date").range(offset, offset + PAGE - 1).execute().data or [])
        for r in rows:
            out.setdefault(r["series_code"], []).append(r)
        if len(rows) < PAGE:
            return out
        offset += PAGE


def load_r04(db) -> dict:
    """R-04 규칙: {enabled, threshold, lookback_days, lookback_source}. 규칙이 없거나 값이 없으면 기본 365일."""
    rows = db.table("ips_rules").select("rule_code,enabled,parameters").eq("rule_code", "R-04").execute().data or []
    rule = rows[0] if rows else None
    params = (rule or {}).get("parameters") or {}
    lb = params.get("lookback_days")
    return {
        "rule": ({"enabled": rule.get("enabled", True), "parameters": params} if rule else None),
        "threshold": params.get("drawdown_threshold"),
        "lookback_days": int(lb) if isinstance(lb, (int, float)) and not isinstance(lb, bool) else DEFAULT_LOOKBACK_DAYS,
        "lookback_source": "rule" if isinstance(lb, (int, float)) and not isinstance(lb, bool) else "default",
        "enabled": bool(rule and rule.get("enabled", True)),
    }


def obs_window_start(as_of: date, lookback_days: int) -> date:
    """요약·하락률·CPI 전년비에 필요한 관측 구간의 시작일. 월별 지표의 전년 동월(약 13개월 전) 관측까지 닿도록 여유를 둔다."""
    return as_of - timedelta(days=max(lookback_days, 400) + 60)


def load_portfolio_inputs(db, as_of: date) -> dict:
    """노출도·시나리오 계산 입력 (02 점검 라우터와 같은 읽기). 프로필은 전체 컬럼."""
    assets = db.table("assets").select("*").eq("is_active", True).execute().data or []
    profiles = db.table("holding_profiles").select("*").execute().data or []
    cashflow = db.table("cashflow_items").select("*").execute().data or []
    base = db.table("withdrawal_baseline").select("*").eq("id", 1).execute().data
    rule_rows = (db.table("ips_rules").select("rule_code,enabled,parameters")
                 .in_("rule_code", list(CHECK_RULE_CODES)).execute().data or [])
    withdrawals = (db.table("withdrawals").select("withdrawal_date,amount")
                   .gte("withdrawal_date", minus_months(as_of, 12).isoformat()).execute().data or [])
    rules = {r["rule_code"]: {"enabled": r.get("enabled", True), "parameters": r.get("parameters") or {}}
             for r in rule_rows}
    return {"assets": assets, "profiles": profiles, "cashflow_items": cashflow,
            "baseline": base[0] if base else None, "rules": rules, "withdrawals": withdrawals}
