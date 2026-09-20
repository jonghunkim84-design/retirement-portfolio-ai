"""노출도 지도·단일 시나리오·최근 시장 변화의 영향 API (지시서 04 단계 E) — 모두 읽기 전용, DB 에 쓰지 않는다.

- GET  /exposure                    노출도 지도와 데이터 완성도
- GET  /exposure/scenario/presets   시나리오 프리셋 목록(scenario_presets.py)
- POST /exposure/scenario           단일 시나리오 실행 (프리셋 id 또는 kind+params)
- GET  /exposure/signals            최근 시장 변화 × 내 노출 = 추정 영향
"""
from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

import market_exposure as mx
import market_store as store
from database import supabase
from scenario_presets import SCENARIO_PRESETS

router = APIRouter()

PROVENANCE = {
    "observed": ["assets[].current_value", "지표 관측값(market_observations)"],
    "assumed": ["듀레이션 대용(잔존만기)", "리츠·인컴 금리 민감도", "TDF·펀드 주식 비중", "충격 크기(시나리오 입력)"],
}


class ScenarioBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preset_id: Optional[str] = Field(default=None, max_length=40)
    kind: Optional[Literal["rate", "equity", "fx", "inflation"]] = None
    params: Optional[dict] = None
    as_of: Optional[date] = None


@router.get("")
def get_exposure(as_of: Optional[date] = None):
    as_of = as_of or date.today()
    inputs = store.load_portfolio_inputs(supabase, as_of)
    out = mx.compute_exposure(as_of=as_of, assets=inputs["assets"], profiles=inputs["profiles"],
                              benchmarks=store.load_benchmarks(supabase))
    return {**out, "provenance": PROVENANCE}


@router.get("/scenario/presets")
def scenario_presets():
    return SCENARIO_PRESETS


@router.post("/scenario")
def run_scenario(body: ScenarioBody):
    as_of = body.as_of or date.today()
    kind, params, label = body.kind, body.params, None
    if body.preset_id:
        preset = next((p for p in SCENARIO_PRESETS if p["id"] == body.preset_id), None)
        if preset is None:
            raise HTTPException(status_code=422, detail=[{"field": "preset_id", "msg": "unknown_preset"}])
        kind, params, label = preset["kind"], preset["params"], preset["label"]
    if kind is None:
        raise HTTPException(status_code=422, detail=[{"field": "kind", "msg": "kind_required"}])
    try:
        mx.validate_scenario(kind, params or {})
    except mx.ScenarioParamError as e:
        raise HTTPException(status_code=422, detail=[{"field": "params", "msg": e.args[0]}])
    inputs = store.load_portfolio_inputs(supabase, as_of)
    out = mx.compute_scenario(as_of=as_of, kind=kind, params=params or {}, assets=inputs["assets"],
                              profiles=inputs["profiles"], cashflow_items=inputs["cashflow_items"],
                              rules=inputs["rules"], baseline=inputs["baseline"], withdrawals=inputs["withdrawals"],
                              benchmarks=store.load_benchmarks(supabase), label=label)
    return {**out, "provenance": PROVENANCE}


@router.get("/signals")
def get_signals(as_of: Optional[date] = None):
    as_of = as_of or date.today()
    inputs = store.load_portfolio_inputs(supabase, as_of)
    series = store.load_series(supabase)
    obs = store.load_observations(supabase, series.keys(), store.obs_window_start(as_of, 0), as_of)
    out = mx.compute_signal_impact(as_of=as_of, assets=inputs["assets"], profiles=inputs["profiles"],
                                   cashflow_items=inputs["cashflow_items"], rules=inputs["rules"], series=series,
                                   observations=obs, benchmarks=store.load_benchmarks(supabase),
                                   baseline=inputs["baseline"], withdrawals=inputs["withdrawals"])
    return {**out, "provenance": PROVENANCE}
