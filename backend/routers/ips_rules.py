"""IPS 규칙 설정 API (지시서 03) — parameters·enabled 만 수정할 수 있다 (rule_code·category·name 은 수정 불가)."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from database import supabase
from ips_rules_validation import validate_parameters

router = APIRouter()


class IpsRuleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")        # rule_code, category 등 다른 필드는 거부
    parameters: Optional[dict] = None
    enabled: Optional[bool] = None


@router.get("")
def list_rules():
    rows = supabase.table("ips_rules").select("*").execute().data or []
    return sorted(rows, key=lambda r: r["rule_code"])


@router.put("/{rule_code}")
def update_rule(rule_code: str, body: IpsRuleUpdate):
    if body.parameters is None and body.enabled is None:
        raise HTTPException(status_code=422, detail=[{"field": "body", "msg": "parameters 또는 enabled 가 필요합니다"}])
    cur = supabase.table("ips_rules").select("*").eq("rule_code", rule_code).execute().data
    if not cur:
        raise HTTPException(status_code=404, detail="규칙을 찾을 수 없습니다")

    data = {"updated_at": datetime.now().isoformat()}
    if body.parameters is not None:
        errors = validate_parameters(rule_code, body.parameters)
        if errors:
            raise HTTPException(status_code=422, detail=errors)        # 필드별 오류 [{field, msg}]
        data["parameters"] = body.parameters
    if body.enabled is not None:
        data["enabled"] = body.enabled
    try:
        res = supabase.table("ips_rules").update(data).eq("rule_code", rule_code).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return res.data[0]
