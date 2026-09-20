"""분기 인출 판단 실행 API (지시서 03) — 읽기 전용.

DB 에서 입력을 읽어 02 점검 결과와 함께 판단 엔진(decision_engine)에 넘기고 결과를 반환한다.
**DB 에 쓰지 않는다** (저장은 /decision-log). 기준일 as_of 는 여기서만 정한다 (기본값 오늘).
"""
from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from database import supabase
from utils import get_active_assets, get_config, calculate_buckets
from tax_constants import PRIVATE_PENSION_ANNUAL_LIMIT
from routers.pension_tax import calc_limit_breakdown          # 수정 없이 호출만 (year 인자, 오늘 날짜 미사용)
from withdrawal_check import compute_withdrawal_check
from decision_engine import compute_decision

router = APIRouter()

RULE_CODES = ("R-01", "R-02", "R-03", "R-04", "R-05", "R-06", "R-07")


class MarketComponent(BaseModel):
    """자동 계산(04)의 지역별 구성 내역 — 입력 스냅샷에 그대로 남는다."""
    model_config = ConfigDict(extra="forbid")
    region: str = Field(max_length=30)
    series_code: str = Field(max_length=30)
    drawdown: float = Field(ge=0, le=1)
    share: Optional[float] = Field(default=None, ge=0, le=1)
    is_proxy: Optional[bool] = None


class MarketInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    index_name: Optional[str] = Field(default=None, max_length=50)
    drawdown: Optional[float] = Field(default=None, ge=0, le=1)     # 고점 대비 하락률 (0~1)
    # 지시서 04 — 출처와 구성 내역 (엔진은 읽지 않고 입력 스냅샷에 남기기만 한다). 모두 선택.
    source: Optional[Literal["auto", "manual"]] = None
    lookback_days: Optional[int] = Field(default=None, ge=30, le=1095)
    data_date: Optional[str] = Field(default=None, max_length=10)
    unreliable: Optional[bool] = None
    excluded_share: Optional[float] = Field(default=None, ge=0, le=1)
    components: Optional[list[MarketComponent]] = Field(default=None, max_length=20)


_BASE_MARKET_FIELDS = ("index_name", "drawdown")


def _market_input_dict(m: Optional[MarketInput]) -> Optional[dict]:
    """기존 로그와 같은 형식(index_name·drawdown 항상 포함)을 유지하고, 새 항목은 값이 있을 때만 덧붙인다."""
    if m is None:
        return None
    return {k: v for k, v in m.model_dump().items() if k in _BASE_MARKET_FIELDS or v is not None}


class RunBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    market_input: Optional[MarketInput] = None
    as_of: Optional[date] = None


@router.post("/run")
def run_decision(body: Optional[RunBody] = None):
    body = body or RunBody()
    as_of = body.as_of or date.today()

    assets = get_active_assets()
    profiles = supabase.table("holding_profiles").select("holding_id,bucket").execute().data or []
    cashflow = supabase.table("cashflow_items").select("*").execute().data or []
    base = supabase.table("withdrawal_baseline").select("*").eq("id", 1).execute().data
    rule_rows = supabase.table("ips_rules").select("rule_code,enabled,parameters").in_("rule_code", list(RULE_CODES)).execute().data or []
    withdrawals = supabase.table("withdrawals").select("*").execute().data or []
    cfg = get_config()

    rules = {r["rule_code"]: {"enabled": r.get("enabled", True), "parameters": r.get("parameters") or {}} for r in rule_rows}
    baseline = base[0] if base else None

    # 02 점검 결과 (실효 버킷·순인출 필요액·규칙 판정)를 그대로 재사용
    check = compute_withdrawal_check(as_of=as_of, assets=assets, profiles=profiles, cashflow_items=cashflow,
                                     baseline=baseline, rules=rules, withdrawals=withdrawals)

    # 자산군 금액은 기존 리밸런싱이 쓰는 함수 그대로
    b = calculate_buckets(assets, cfg)
    class_totals = {"cash": b["cash_total"], "bond": b["bond_total"], "equity": b["equity_total"], "income": b["income_total"]}
    portfolio = cfg.get("portfolio", {})
    targets = {"cash": portfolio.get("target_cash", 0.25), "bond": portfolio.get("target_bond", 0.25),
               "equity": portfolio.get("target_equity", 0.35), "income": portfolio.get("target_income", 0.15)}

    # R-07 참고 정보: 올해 연금 한도 사용액 (세금 금액은 계산하지 않는다)
    pension_usage, extra_warnings = None, []
    try:
        usage = calc_limit_breakdown(as_of.year, withdrawals, cfg.get("pension_plan") or {})
        pension_usage = {"year": as_of.year, **usage, "annual_limit": PRIVATE_PENSION_ANNUAL_LIMIT}
    except Exception:
        extra_warnings.append({"code": "pension_usage_unavailable", "values": {}})

    result = compute_decision(
        as_of=as_of, check=check, rules=rules, assets=assets, targets=targets,
        rebalance_threshold=portfolio.get("rebalance_threshold"), class_totals=class_totals,
        market_input=_market_input_dict(body.market_input),
        pension_usage=pension_usage,
    )
    result["warnings"] = result["warnings"] + extra_warnings
    return result
