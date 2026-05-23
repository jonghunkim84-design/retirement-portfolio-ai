from fastapi import APIRouter, HTTPException
from datetime import datetime
from pydantic import BaseModel
from database import supabase
from utils import get_config

router = APIRouter()


@router.get("")
def read_config():
    return get_config()


@router.put("")
def update_config(body: dict):
    supabase.table("user_config").update({
        "value":      body,
        "updated_at": datetime.now().isoformat(),
    }).eq("key", "config").execute()
    return {"ok": True}


# ── 국민연금 시나리오 확정 ───────────────────────────────────────────
class PensionScenarioIn(BaseModel):
    offset: int   # -5 / -3 / -1 / 0 / +1 / +3 / +5


@router.post("/pension-scenario")
def set_pension_scenario(body: PensionScenarioIn):
    if body.offset not in (-5, -3, -1, 0, 1, 3, 5):
        raise HTTPException(status_code=400, detail="offset must be one of -5,-3,-1,0,1,3,5")

    config  = get_config()
    pension = config.get("income", {}).get("national_pension", {})

    # 표준 기준값 (최초 설정 시 저장되는 불변값)
    standard_base  = pension.get("standard_base")  or pension.get("base_amount", 0)
    standard_start = pension.get("standard_start_date") or pension.get("start_date", "")

    if not standard_start or not standard_base:
        raise HTTPException(status_code=400, detail="국민연금 기준 정보가 설정되지 않았습니다")

    sy, sm = map(int, standard_start.split("-"))
    offset = body.offset

    # 새 개시 연도 / 월
    new_start = f"{sy + offset:04d}-{sm:02d}"

    # 시나리오별 수령액 배율 (오늘 가격 기준)
    if offset < 0:
        factor = 1.0 + 0.06  * offset   # 조기: 6%/년 감액 (offset 음수)
    elif offset > 0:
        factor = 1.0 + 0.072 * offset   # 연기: 7.2%/년 증액
    else:
        factor = 1.0

    new_base = round(standard_base * factor)

    # config 갱신 (표준값은 보존, 운용값만 변경)
    config["income"]["national_pension"].update({
        "standard_base":       standard_base,
        "standard_start_date": standard_start,
        "scenario_offset":     offset,
        "base_amount":         new_base,
        "start_date":          new_start,
        "inflation_adjusted":  False,
    })

    supabase.table("user_config").update({
        "value":      config,
        "updated_at": datetime.now().isoformat(),
    }).eq("key", "config").execute()

    return {
        "ok":                  True,
        "offset":              offset,
        "start_date":          new_start,
        "base_amount":         new_base,
        "standard_base":       standard_base,
        "standard_start_date": standard_start,
    }
