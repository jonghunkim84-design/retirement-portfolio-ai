"""시장 지표 API (지시서 04 단계 E).

- GET  /market/series                 지표 정의 + 최신값·변화·stale
- GET  /market/series/{code}/history  이력(차트용)
- GET  /market/regime                 3버킷 지역 가중 하락률과 R-04 대비 판정 참고 (읽기 전용)
- POST /market/refresh                증분 수집 — 화면의 "데이터 갱신" 버튼 (require_user)
- GET  /market/refresh                증분 수집 — Vercel 크론 (require_cron, cron_router)

기준일 as_of 는 여기서만 정한다(기본값 오늘). 계산은 market_exposure(순수 함수)가 한다.
"""
import logging
import os
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

import market_data
import market_exposure as mx
import market_store as store
from database import supabase
from decision_engine import evaluate_regime          # 호출만 (수정 없음)

router = APIRouter()
cron_router = APIRouter()
logger = logging.getLogger(__name__)

MAX_HISTORY_DAYS = 1095
INDEX_NAME = "가중 하락률(3버킷 지역 가중)"


def _series_meta(s: dict) -> dict:
    return {"code": s["code"], "name": s.get("name"), "category": s.get("category"), "frequency": s.get("frequency"),
            "currency": s.get("currency"), "unit": s.get("unit"), "is_proxy": bool(s.get("is_proxy")),
            "enabled": bool(s.get("enabled", True)), "note": s.get("note"),
            "sources": [x.get("source") for x in (s.get("sources") or [])]}


@router.get("/series")
def list_series(as_of: Optional[date] = None):
    as_of = as_of or date.today()
    r04 = store.load_r04(supabase)
    series = store.load_series(supabase)
    obs = store.load_observations(supabase, series.keys(), store.obs_window_start(as_of, r04["lookback_days"]), as_of)
    summaries = {s["code"]: s for s in mx.summarize_all(series, obs, as_of, r04["lookback_days"])}
    skip = ("code", "name", "category", "is_proxy")
    return {
        "as_of": as_of.isoformat(), "lookback_days": r04["lookback_days"],
        "series": [{**_series_meta(series[c]), **{k: v for k, v in summaries[c].items() if k not in skip}}
                   for c in sorted(series)],
        "provenance": "observed",
    }


@router.get("/series/{code}/history")
def series_history(code: str, days: int = Query(365, ge=1, le=MAX_HISTORY_DAYS), as_of: Optional[date] = None):
    as_of = as_of or date.today()
    series = store.load_series(supabase)
    if code not in series:
        raise HTTPException(status_code=404, detail="알 수 없는 지표입니다")
    start = as_of - timedelta(days=days)
    rows = store.load_observations(supabase, [code], start, as_of)[code]
    return {"as_of": as_of.isoformat(), "start": start.isoformat(), "series": _series_meta(series[code]),
            "points": [{"date": r["obs_date"], "value": r["value"], "flag": r.get("flag"), "source": r.get("source")}
                       for r in rows],
            "provenance": "observed"}


@router.get("/regime")
def market_regime(as_of: Optional[date] = None):
    as_of = as_of or date.today()
    r04 = store.load_r04(supabase)
    series = store.load_series(supabase)
    benchmarks = store.load_benchmarks(supabase)
    inputs = store.load_portfolio_inputs(supabase, as_of)
    obs = store.load_observations(supabase, sorted(set(benchmarks.values())),
                                  store.obs_window_start(as_of, r04["lookback_days"]), as_of)
    result = mx.compute_weighted_drawdown(as_of=as_of, assets=inputs["assets"], profiles=inputs["profiles"],
                                          benchmarks=benchmarks, series=series, observations=obs,
                                          lookback_days=r04["lookback_days"])
    w = result["weighted_drawdown"]
    judgement, suggested = None, None
    if w is not None:
        judgement = evaluate_regime({"drawdown": w, "index_name": INDEX_NAME}, r04["rule"])
        suggested = {
            "index_name": INDEX_NAME, "drawdown": w, "source": "auto", "lookback_days": r04["lookback_days"],
            "data_date": result["latest_date"], "unreliable": result["unreliable"],
            "excluded_share": result["excluded_share"],
            "components": [{"region": r["region"], "series_code": r["series_code"], "drawdown": r["drawdown"],
                            "share": r["share_of_bucket3"], "is_proxy": r["is_proxy"]} for r in result["regions"]],
        }
    return {**result, "lookback_source": r04["lookback_source"],
            "rule": {"enabled": r04["enabled"], "threshold": r04["threshold"]},
            "judgement": judgement, "suggested_input": suggested, "provenance": "observed"}


def _run_refresh() -> dict:
    out = market_data.refresh_all(supabase, date.today(), env=os.environ)
    for r in out["results"]:
        r.pop("sample", None)
    return out


@router.post("/refresh")
def refresh_by_user():
    """화면 버튼용. 수집 결과(지표별 성공·실패·건수)를 반환한다."""
    return _run_refresh()


@cron_router.get("/refresh")
def refresh_by_cron():
    """Vercel 크론 전용(매일 22:00 UTC). /alert/daily 와 독립적으로 실행된다."""
    out = _run_refresh()
    logger.info("[Cron] 시장 지표 수집 완료 — ok=%s failed=%s skipped=%s stored=%s",
                out["ok"], out["failed"], out["skipped"], out["stored"])
    return out
