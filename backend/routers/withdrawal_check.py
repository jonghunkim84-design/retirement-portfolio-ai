"""생활비·버킷 점검 API (지시서 02) — 읽기 전용.

DB 에서 입력을 읽어 withdrawal_check 계산 모듈에 넘기고 결과를 그대로 반환한다.
기준일 as_of 는 여기서만 정한다 (기본값 오늘). 계산 모듈은 오늘 날짜를 읽지 않는다.
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter

from database import supabase
from utils import get_active_assets
from withdrawal_check import compute_withdrawal_check, minus_months

router = APIRouter()

RULE_CODES = ("R-01", "R-02", "R-05", "R-06")


@router.get("")
def get_withdrawal_check(as_of: Optional[date] = None):
    """as_of(YYYY-MM-DD)는 검증·재현용 선택 파라미터. 형식이 틀리면 422."""
    as_of = as_of or date.today()

    assets = get_active_assets()
    profiles = supabase.table("holding_profiles").select("holding_id,bucket").execute().data or []
    cashflow = supabase.table("cashflow_items").select("*").execute().data or []
    base = supabase.table("withdrawal_baseline").select("*").eq("id", 1).execute().data
    rule_rows = supabase.table("ips_rules").select("rule_code,enabled,parameters").in_("rule_code", list(RULE_CODES)).execute().data or []
    # 실적 인출률(참고)용: 기준일 이전 12개월 창의 시작일 이후 기록만 읽는다 (창의 정확한 경계는 계산 모듈이 판정)
    withdrawals = (supabase.table("withdrawals").select("withdrawal_date,amount")
                   .gte("withdrawal_date", minus_months(as_of, 12).isoformat()).execute().data or [])

    rules = {r["rule_code"]: {"enabled": r.get("enabled", True), "parameters": r.get("parameters") or {}}
             for r in rule_rows}

    return compute_withdrawal_check(
        as_of=as_of, assets=assets, profiles=profiles, cashflow_items=cashflow,
        baseline=base[0] if base else None, rules=rules, withdrawals=withdrawals,
    )
