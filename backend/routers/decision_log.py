"""의사결정 로그 API (지시서 03) — 판단과 실행 여부·이탈 사유만 기록한다 (자산 잔액·인출 기록은 변경하지 않는다).

- 같은 period 에 기록이 있으면 POST 는 409. 화면에서 확인받은 경우에만 ?overwrite=true 로 교체한다.
- executed=false 이면 deviation_reason 이 필수. 저장 시 engine_output 에 엔진 출력 전체(입력 스냅샷 포함)를 담는다.
"""
import re
from datetime import date, datetime
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from database import supabase
from decision_engine import period_of

router = APIRouter()

PERIOD_RE = re.compile(r"^\d{4}-Q[1-4]$")
REQUIRED_KEYS = ("as_of", "period", "inputs_snapshot", "payment", "regime", "refill", "conclusion",
                 "applied_rules", "skipped_rules", "assumptions")
CONCLUSION_TYPES = ("pay_only", "pay_and_refill", "hold", "needs_user_judgment")


class LogIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    engine_output: dict                                   # /decision-engine/run 결과 전체
    selected_payment_kind: Literal["base", "recommended"]  # 사용자가 실제 적용할 지급액


class LogPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    executed: Optional[bool] = None
    deviation_reason: Optional[str] = None


def _err(field: str, msg: str, status: int = 422):
    return HTTPException(status_code=status, detail=[{"field": field, "msg": msg}])


def _validate_engine_output(eo: dict) -> None:
    missing = [k for k in REQUIRED_KEYS if k not in eo]
    if missing:
        raise _err("engine_output", f"엔진 출력에 필요한 항목이 없습니다: {', '.join(missing)}")
    if not isinstance(eo["period"], str) or not PERIOD_RE.match(eo["period"]):
        raise _err("engine_output.period", "period 형식이 올바르지 않습니다 (예: 2026-Q4)")
    try:
        as_of = date.fromisoformat(str(eo["as_of"]))
    except ValueError:
        raise _err("engine_output.as_of", "as_of 형식이 올바르지 않습니다")
    if period_of(as_of) != eo["period"]:
        raise _err("engine_output.period", "period 가 as_of 와 일치하지 않습니다")
    if not isinstance(eo["conclusion"], dict) or eo["conclusion"].get("type") not in CONCLUSION_TYPES:
        raise _err("engine_output.conclusion", "결론 유형이 올바르지 않습니다")
    if not isinstance(eo["payment"], dict) or not isinstance(eo["payment"].get("base_quarterly"), int):
        raise _err("engine_output.payment", "지급액 정보가 올바르지 않습니다")


@router.get("")
def list_logs():
    """최신 분기부터."""
    rows = supabase.table("decision_log").select("*").execute().data or []
    return sorted(rows, key=lambda r: (r["period"], r["id"]), reverse=True)


@router.post("")
def create_log(body: LogIn, overwrite: bool = False):
    eo = body.engine_output
    _validate_engine_output(eo)
    pay = eo["payment"]
    if body.selected_payment_kind == "recommended":
        if not isinstance(pay.get("recommended_quarterly"), int):
            raise _err("selected_payment_kind", "권고 지급액이 없는 판단입니다 (기본 지급액만 선택할 수 있습니다)")
        amount = pay["recommended_quarterly"]
    else:
        amount = pay["base_quarterly"]

    period = eo["period"]
    stored = {**eo, "selected_payment": {"kind": body.selected_payment_kind, "amount": amount}}
    applied = [str(c) for c in (eo.get("applied_rules") or [])]

    existing = supabase.table("decision_log").select("*").eq("period", period).execute().data or []
    now = datetime.now().isoformat()
    if existing:
        if not overwrite:
            first = min(existing, key=lambda r: r["id"])
            raise HTTPException(status_code=409, detail={
                "code": "period_exists", "period": period, "existing_id": first["id"],
                "message": f"{period} 기록이 이미 있습니다. 덮어쓰려면 확인이 필요합니다.",
            })
        target = min(existing, key=lambda r: r["id"])
        # 판단이 바뀌었으므로 이전 실행 여부·이탈 사유는 초기화한다
        res = supabase.table("decision_log").update({
            "engine_output": stored, "applied_rules": applied, "executed": None, "deviation_reason": None,
            "updated_at": now,
        }).eq("id", target["id"]).execute()
        return res.data[0]

    try:
        res = supabase.table("decision_log").insert({
            "period": period, "engine_output": stored, "applied_rules": applied,
            "executed": None, "deviation_reason": None, "updated_at": now,          # 새 판단은 실행 여부 미확인으로 시작
        }).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return res.data[0]


@router.patch("/{log_id}")
def update_log(log_id: int, body: LogPatch):
    fields = body.model_fields_set
    if not fields:
        raise _err("body", "executed 또는 deviation_reason 이 필요합니다")
    cur = supabase.table("decision_log").select("*").eq("id", log_id).execute().data
    if not cur:
        raise HTTPException(status_code=404, detail="기록을 찾을 수 없습니다")
    cur = cur[0]

    executed = body.executed if "executed" in fields else cur.get("executed")
    reason = body.deviation_reason if "deviation_reason" in fields else cur.get("deviation_reason")
    reason = reason.strip() if isinstance(reason, str) else reason

    if executed is False:
        if not reason:
            raise _err("deviation_reason", "다르게 실행한 경우 사유를 입력해야 합니다")
    else:
        if reason and "deviation_reason" in fields:
            raise _err("deviation_reason", "사유는 '다르게 실행함'일 때만 입력합니다")
        reason = None                                   # 실행함·미확인이면 이전 사유를 지운다

    res = supabase.table("decision_log").update({
        "executed": executed, "deviation_reason": reason, "updated_at": datetime.now().isoformat(),
    }).eq("id", log_id).execute()
    return res.data[0]
