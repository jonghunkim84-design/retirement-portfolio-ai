"""시장 노출도·시나리오 계산 (지시서 04 §7) — 순수 함수 모듈.

- DB·네트워크 접근 없음, 오늘 날짜 호출 없음: 모든 계산은 기준일 `as_of` 를 인자로 받는다.
- 데이터가 없으면 추정해서 채우지 않고 None + 사유 코드를 돌려준다. 문장은 화면에서 조립한다.
- 02(withdrawal_check)의 계산 함수를 충격 반영 입력으로 다시 호출한다. 같은 계산을 새로 만들지 않는다.
- 판단 엔진(decision_engine)은 건드리지 않는다. 가중 하락률은 화면이 입력칸에 채우는 값을 만들 뿐이다.

입력 형태
  series          {code: {code, name, category, frequency, is_proxy, sources?}}   (market_series)
  observations    {code: [{obs_date, value, flag?, source?}, ...]}                 (market_observations)
  benchmarks      {region: series_code}                                             (region_benchmarks)
  assets/profiles/cashflow_items/baseline/rules/withdrawals 는 withdrawal_check 와 같은 형태
"""
from datetime import date, datetime, timedelta
from typing import Optional

import calendar

from utils import BUCKET_MAP
from withdrawal_check import (
    compute_withdrawal_check, effective_bucket, minus_months, _num, _to_date,
)

STALE_DAYS = {"daily": 7, "monthly": 60}            # 최신 관측일이 이 일수 이상 오래되면 stale
HISTORY_TOLERANCE_DAYS = {"daily": 10, "monthly": 20}   # 변화 계산의 기준 시점 허용 오차
WINDOW_START_TOLERANCE_DAYS = 7                     # 고점 기간 시작일에서 이만큼 이내에 첫 관측이 있어야 함
UNRELIABLE_EXCLUDED_SHARE = 0.5                     # 제외 비중이 이 값을 넘으면 unreliable (초과)
EQUITY_LIKE = ("equity", "income")
DAYS_PER_YEAR = 365.25

ASSUMPTIONS_EXPOSURE = [
    "금리 노출은 선형 근사(−수정듀레이션 × 금리 변화 × 금액) — 볼록성·신용 스프레드 미반영",
    "만기만 있는 채권은 잔존만기(년)를 듀레이션 대용으로 씀 (assumed 표시)",
    "리츠·인컴 금리 민감도는 사용자 입력 가정값이며 듀레이션처럼 부호를 해석(양수 = 금리 상승 시 하락)",
    "현금·변동금리 채권은 가격 변화 0, 연간 이자 변화는 금리 변화 × 금액 (참고값)",
    "원화 채권(프로필 없음 포함)은 한국 금리, 통화 USD 는 미국 금리에 대응. 대응이 불명확하면 신호 영향에서 제외",
    "환율 노출은 환헤지하지 않은 외화(KRW 아님) 자산 금액. 통화 미입력 해외 자산은 별도 표시",
    "주식성 금액 = 주식 + 리츠·인컴 + TDF·펀드의 주식 부분(금액 × 주식 비중)",
    "자산 금액은 assets.current_value(원화) 기준이며 실물자산은 제외",
]
ASSUMPTIONS_SCENARIO = [
    "충격은 한 번에 하나만 적용(단일 충격) — 복합 시나리오·순서위험은 다루지 않음",
    "충격 직후의 즉시 영향이며 이후 수익·리밸런싱·인출은 반영하지 않음",
    "커버 연수는 02 점검과 같은 계산(수익률 0%, 물가 미반영)을 충격 반영 입력으로 다시 호출한 결과",
]


# ── 도우미 ─────────────────────────────────────────────────────────────────

def normalize_region(value) -> Optional[str]:
    """앞뒤 공백(전각·NBSP 포함)을 제거한다. 비어 있으면 None."""
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def resolve_region(value, benchmarks: dict) -> dict:
    """지역 값 → 기준 지표 코드. 앞뒤 공백 제거 후 비교한다.
    실패하면 series_code=None 과 사유(region_missing / region_no_benchmark)를 돌려주고,
    매칭 실패 사유에는 사용자가 입력한 원래 값(original)을 함께 담는다."""
    region = normalize_region(value)
    if region is None:
        return {"region": None, "series_code": None, "reason": "region_missing", "original": value}
    code = benchmarks.get(region)
    if code is None:
        return {"region": region, "series_code": None, "reason": "region_no_benchmark", "original": value}
    return {"region": region, "series_code": code, "reason": None, "original": value}


def _month_end(d: date) -> date:
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def _prep(obs: Optional[list], as_of: date) -> list:
    """관측값 → as_of 이하의 (일자, 값, flag, source) 목록, 일자순."""
    rows = []
    for o in obs or []:
        d = _to_date(o.get("obs_date"))
        if d is None or d > as_of or o.get("value") is None:
            continue
        rows.append((d, float(o["value"]), o.get("flag"), o.get("source")))
    rows.sort(key=lambda r: r[0])
    return rows


def _frequency(series: dict, source: Optional[str]) -> str:
    for s in series.get("sources") or []:
        if s.get("source") == source and s.get("frequency"):
            return s["frequency"]
    return series.get("frequency", "daily")


def _is_stale(freq: str, last_date: date, as_of: date) -> bool:
    ref = _month_end(last_date) if freq == "monthly" else last_date
    return (as_of - ref).days >= STALE_DAYS[freq]


def _value_at_or_before(rows: list, target: date, tol_days: int):
    """target 이하의 마지막 관측. target 과 tol_days 이상 벌어지면 None."""
    best = None
    for r in rows:
        if r[0] <= target:
            best = r
        else:
            break
    if best is None or (target - best[0]).days > tol_days:
        return None
    return best


# ── 7.1 지표 요약 ───────────────────────────────────────────────────────────

def compute_drawdown(series: dict, obs: list, as_of: date, lookback_days: int) -> dict:
    """고점 대비 하락률 = 1 − 최신값 ÷ (as_of−lookback_days ~ as_of) 기간 최고값. 고점 당일이면 0.

    이상치 플래그가 달린 관측값은 기간 최고값(극값) 계산에서 제외한다(excluded_flagged 에 건수).
    최신값·변화율에는 그대로 포함한다."""
    rows = _prep(obs, as_of)
    out = {"value": None, "latest_value": None, "latest_date": None, "peak_value": None, "peak_date": None,
           "window_start": (as_of - timedelta(days=lookback_days)).isoformat(), "stale": None,
           "flagged_dates": [], "excluded_flagged": 0, "reason": None}
    if not rows:
        out["reason"] = "no_data"
        return out
    last = rows[-1]
    out["latest_value"], out["latest_date"] = last[1], last[0].isoformat()
    out["stale"] = _is_stale(_frequency(series, last[3]), last[0], as_of)
    start = as_of - timedelta(days=lookback_days)
    window = [r for r in rows if r[0] >= start]
    out["flagged_dates"] = [r[0].isoformat() for r in window if r[2]]
    out["excluded_flagged"] = len(out["flagged_dates"])
    if out["stale"]:
        out["reason"] = "stale"
        return out
    if len(window) < 2 or (window[0][0] - start).days > WINDOW_START_TOLERANCE_DAYS:
        out["reason"] = "insufficient_history"
        return out
    candidates = [r for r in window if not r[2]]                 # 이상치는 고점 후보에서 제외
    if not candidates:
        out["reason"] = "insufficient_history"
        return out
    peak = max(candidates, key=lambda r: (r[1], r[0]))
    out["peak_value"], out["peak_date"] = peak[1], peak[0].isoformat()
    out["value"] = max(0.0, 1 - last[1] / peak[1]) if peak[1] > 0 else None
    if out["value"] is None:
        out["reason"] = "invalid_peak"
    return out


def _change(series: dict, rows: list, months: int) -> dict:
    """최신 관측 대비 n개월 전 변화. 금리는 %p, 그 외는 비율(%). 기준 시점 데이터가 없으면 None."""
    if not rows:
        return {"value": None, "reason": "no_data"}
    last = rows[-1]
    freq = _frequency(series, last[3])
    ref = _value_at_or_before(rows, minus_months(last[0], months), HISTORY_TOLERANCE_DAYS[freq])
    if ref is None:
        return {"value": None, "reason": "insufficient_history"}
    if series.get("category") == "rate":
        return {"value": last[1] - ref[1], "unit": "pp", "reason": None, "ref_date": ref[0].isoformat()}
    if ref[1] == 0:
        return {"value": None, "reason": "invalid_reference"}
    return {"value": last[1] / ref[1] - 1, "unit": "ratio", "reason": None, "ref_date": ref[0].isoformat()}


def summarize_series(series: dict, obs: list, as_of: date, lookback_days: int = 365) -> dict:
    rows = _prep(obs, as_of)
    out = {"code": series["code"], "name": series.get("name"), "category": series.get("category"),
           "is_proxy": bool(series.get("is_proxy")), "latest_value": None, "latest_date": None,
           "latest_flag": None, "latest_source": None, "stale": None,
           "change_1m": None, "change_3m": None, "drawdown": None, "yoy": None, "reason": None}
    if not rows:
        out["reason"] = "no_data"
        return out
    last = rows[-1]
    out.update(latest_value=last[1], latest_date=last[0].isoformat(), latest_flag=last[2], latest_source=last[3],
               stale=_is_stale(_frequency(series, last[3]), last[0], as_of))
    out["change_1m"] = _change(series, rows, 1)
    out["change_3m"] = _change(series, rows, 3)
    if series.get("category") in ("equity_index", "etf_proxy"):
        out["drawdown"] = compute_drawdown(series, obs, as_of, lookback_days)
    if series.get("category") == "cpi":
        prior = _value_at_or_before(rows, minus_months(last[0], 12), HISTORY_TOLERANCE_DAYS["monthly"])
        out["yoy"] = (last[1] / prior[1] - 1) if prior and prior[1] else None
        if out["yoy"] is None:
            out["reason"] = "insufficient_history"
    return out


def summarize_all(series: dict, observations: dict, as_of: date, lookback_days: int = 365) -> list:
    return [summarize_series(s, observations.get(code), as_of, lookback_days) for code, s in sorted(series.items())]


# ── 7.2 가중 하락률 (시장 국면 자동 계산) ─────────────────────────────────────

def compute_weighted_drawdown(*, as_of: date, assets: list, profiles: list, benchmarks: dict,
                              series: dict, observations: dict, lookback_days: int = 365) -> dict:
    """3버킷 자산의 지역별 금액으로 가중한 고점 대비 하락률(현지 통화 기준, 시장 상황 판정용).

    제외 사유: region_missing(지역 미입력) · region_no_benchmark(대응 지수 없음, 원래 값 표시) ·
              series_missing/no_data/stale/insufficient_history(데이터 부족).
    제외 비중이 50%를 넘으면 unreliable=True (결과는 그대로 돌려주되 신뢰하지 말 것)."""
    _check_as_of(as_of)
    prof = {p["holding_id"]: p for p in profiles}
    dd_cache: dict = {}
    included_rows: dict = {}
    excluded, b3_total = [], 0.0
    for a in assets:
        if not a.get("is_active", True):
            continue
        if effective_bucket(a, prof.get(a.get("id")))["effective_bucket"] != 3:
            continue
        value = _num(a.get("current_value"))
        b3_total += value
        res = resolve_region((prof.get(a.get("id")) or {}).get("region"), benchmarks)
        reason, dd = res["reason"], None
        if reason is None:
            code = res["series_code"]
            if code not in series:
                reason = "series_missing"
            else:
                if code not in dd_cache:
                    dd_cache[code] = compute_drawdown(series[code], observations.get(code), as_of, lookback_days)
                dd = dd_cache[code]
                reason = dd["reason"] if dd["value"] is None else None
        if reason:
            excluded.append({"asset_id": a.get("id"), "asset_name": a.get("asset_name"), "value": value,
                             "reason": reason, "region": res["region"], "original_region": res["original"]})
            continue
        row = included_rows.setdefault(res["region"], {
            "region": res["region"], "series_code": res["series_code"], "series_name": series[res["series_code"]].get("name"),
            "is_proxy": bool(series[res["series_code"]].get("is_proxy")), "drawdown": dd["value"],
            "latest_date": dd["latest_date"], "peak_date": dd["peak_date"], "flagged_dates": dd["flagged_dates"],
            "excluded_flagged": dd["excluded_flagged"], "value": 0.0, "asset_count": 0})
        row["value"] += value
        row["asset_count"] += 1

    included = sum(r["value"] for r in included_rows.values())
    excluded_value = sum(e["value"] for e in excluded)
    reasons = []
    if b3_total <= 0:
        reasons.append({"code": "no_bucket3_assets"})
    elif included <= 0:
        reasons.append({"code": "no_included_assets"})
    weighted = (sum(r["value"] * r["drawdown"] for r in included_rows.values()) / included) if included > 0 else None
    share = (excluded_value / b3_total) if b3_total > 0 else None
    for r in included_rows.values():
        r["share_of_bucket3"] = r["value"] / b3_total if b3_total > 0 else None

    by_reason: dict = {}
    for e in excluded:
        g = by_reason.setdefault(e["reason"], {"reason": e["reason"], "count": 0, "value": 0.0, "regions": []})
        g["count"] += 1
        g["value"] += e["value"]
        if e["reason"] == "region_no_benchmark" and e["original_region"] not in g["regions"]:
            g["regions"].append(e["original_region"])          # 매칭 실패한 지역의 원래 입력값
    for g in by_reason.values():
        g["share_of_bucket3"] = g["value"] / b3_total if b3_total > 0 else None

    dates = [r["latest_date"] for r in included_rows.values()]
    return {
        "as_of": as_of.isoformat(), "lookback_days": lookback_days,
        "weighted_drawdown": weighted, "bucket3_value": b3_total,
        "included_value": included, "excluded_value": excluded_value, "excluded_share": share,
        "unreliable": bool(share is not None and share > UNRELIABLE_EXCLUDED_SHARE),
        "regions": sorted(included_rows.values(), key=lambda r: -r["value"]),
        "excluded": excluded, "excluded_by_reason": sorted(by_reason.values(), key=lambda g: -g["value"]),
        "latest_date": max(dates) if dates else None, "reasons": reasons,
        "assumptions": ["하락률은 각 지역 기준지수의 현지 통화 기준(원화 환산 손익은 시나리오에서 다룸)",
                        "고점 = as_of 이전 lookback_days 기간의 최고값(이상치 플래그가 달린 관측은 제외), 최신값 = as_of 이하 마지막 관측(이상치 포함)",
                        "지역 미입력·대응 지수 없음·데이터 부족(stale 포함) 자산은 제외하고 나머지 금액으로 가중"],
    }


# ── 7.3 노출도 지도 ─────────────────────────────────────────────────────────

def _check_as_of(as_of):
    if not isinstance(as_of, date) or isinstance(as_of, datetime):
        raise TypeError("as_of 는 date 여야 합니다")


def _rate_market(profile: Optional[dict]) -> dict:
    """채권·리츠 등의 금리 대응 시장. 원화(프로필 없음 포함)=KR, USD=US, 그 외 불명확."""
    p = profile or {}
    cur = (str(p.get("currency") or "KRW")).strip().upper()
    region = normalize_region(p.get("region"))
    if cur == "KRW":
        if region in (None, "한국"):
            return {"market": "KR", "reason": None}
        return {"market": None, "reason": "rate_market_unclear"}       # 원화 표시 해외 자산 등
    if cur == "USD":
        return {"market": "US", "reason": None}
    return {"market": None, "reason": "rate_market_unclear"}


def compute_exposure(*, as_of: date, assets: list, profiles: list, benchmarks: Optional[dict] = None) -> dict:
    """자산별 금리·주가·환율 노출과 데이터 완성도. 버킷별·전체로 합산한다."""
    _check_as_of(as_of)
    benchmarks = benchmarks or {}
    prof = {p["holding_id"]: p for p in profiles}
    rate, rate_excl, equity, equity_excl, fx, fx_hedged, fx_unclear = [], [], [], [], [], [], []
    total = 0.0
    for a in assets:
        if not a.get("is_active", True):
            continue
        aid, name, typ = a.get("id"), a.get("asset_name"), a.get("asset_type")
        value = _num(a.get("current_value"))
        total += value
        p = prof.get(aid)
        pp = p or {}
        bucket = effective_bucket(a, p)["effective_bucket"]
        base = {"asset_id": aid, "asset_name": name, "asset_type": typ, "bucket": bucket, "value": value}
        mk = _rate_market(p)
        dur, share = pp.get("bond_modified_duration"), pp.get("equity_share_pct")
        dur = None if dur is None else float(dur)
        share = None if share is None else float(share)

        # 금리
        def add_duration_row(kind, amount, duration, basis):
            rate.append({**base, "kind": kind, "amount": amount, "duration": duration, "basis": basis,
                         "price_change_per_1pp": -duration * 0.01 * amount, "interest_change_per_1pp": None,
                         "rate_market": mk["market"], "market_reason": mk["reason"]})
        if typ == "cash":
            rate.append({**base, "kind": "cash", "amount": value, "duration": 0.0, "basis": "input",
                         "price_change_per_1pp": 0.0, "interest_change_per_1pp": 0.01 * value,
                         "rate_market": mk["market"], "market_reason": mk["reason"]})
        elif typ == "bond":
            if pp.get("bond_rate_type") == "floating":
                rate.append({**base, "kind": "floating", "amount": value, "duration": 0.0, "basis": "input",
                             "price_change_per_1pp": 0.0, "interest_change_per_1pp": 0.01 * value,
                             "rate_market": mk["market"], "market_reason": mk["reason"]})
            elif dur is not None:
                add_duration_row("bond", value, dur, "input")
            else:
                mat = _to_date(a.get("maturity_date"))
                if mat is None:
                    rate_excl.append({**base, "reason": "no_duration_no_maturity"})
                elif mat <= as_of:
                    rate_excl.append({**base, "reason": "maturity_passed"})
                else:
                    add_duration_row("bond", value, (mat - as_of).days / DAYS_PER_YEAR, "assumed_maturity")
        elif typ in ("tdf", "fund"):
            if share is None:
                rate_excl.append({**base, "reason": "no_equity_share"})
            elif dur is None:
                rate_excl.append({**base, "reason": "no_duration"})
            else:
                add_duration_row("bond_part", (1 - share) * value, dur, "input")
        elif typ == "income":
            sens = pp.get("rate_sensitivity")
            if sens is None:
                rate_excl.append({**base, "reason": "no_rate_sensitivity"})
            else:
                add_duration_row("income", value, float(sens), "assumed_sensitivity")

        # 주가 (주식성 금액)
        region = normalize_region(pp.get("region"))
        if typ in EQUITY_LIKE:
            equity.append({**base, "amount": value, "region": region, "has_benchmark": region in benchmarks})
        elif typ in ("tdf", "fund"):
            if share is None:
                equity_excl.append({**base, "reason": "no_equity_share"})
            else:
                equity.append({**base, "amount": share * value, "region": region, "has_benchmark": region in benchmarks})

        # 환율
        cur = (str(pp.get("currency") or "KRW")).strip().upper()
        if cur != "KRW":
            (fx_hedged if pp.get("fx_hedged") else fx).append({**base, "currency": cur})
        elif region not in (None, "한국") and not pp.get("fx_hedged"):
            fx_unclear.append({**base, "region": region, "reason": "foreign_region_currency_krw"})

    def by_bucket(rows, key):
        out = {1: 0.0, 2: 0.0, 3: 0.0}
        for r in rows:
            if r["bucket"] in out and r.get(key) is not None:
                out[r["bucket"]] += r[key]
        return out

    eq_by_region: dict = {}
    for r in equity:
        g = eq_by_region.setdefault(r["region"], {"region": r["region"], "amount": 0.0, "has_benchmark": r["has_benchmark"], "asset_count": 0})
        g["amount"] += r["amount"]
        g["asset_count"] += 1
    equity_total = sum(r["amount"] for r in equity)
    for g in eq_by_region.values():
        g["share_of_equity"] = g["amount"] / equity_total if equity_total > 0 else None
        g["share_of_total"] = g["amount"] / total if total > 0 else None

    fx_by_cur: dict = {}
    for r in fx:
        fx_by_cur[r["currency"]] = fx_by_cur.get(r["currency"], 0.0) + r["value"]
    fx_total = sum(fx_by_cur.values())

    def share_of_total(rows):
        v = sum(r["value"] for r in rows)
        return {"count": len(rows), "value": v, "share_of_total": (v / total) if total > 0 else None}

    return {
        "as_of": as_of.isoformat(), "total_assets": total,
        "rate": {"rows": rate, "excluded": rate_excl,
                 "price_change_per_1pp": sum(r["price_change_per_1pp"] for r in rate),
                 "interest_change_per_1pp": sum(r["interest_change_per_1pp"] or 0.0 for r in rate),
                 "price_change_per_1pp_by_bucket": by_bucket(rate, "price_change_per_1pp"),
                 "assumed_count": sum(1 for r in rate if r["basis"] != "input")},
        "equity": {"rows": equity, "excluded": equity_excl, "total": equity_total,
                   "by_region": sorted(eq_by_region.values(), key=lambda g: -g["amount"]),
                   "by_bucket": by_bucket(equity, "amount"),
                   "unknown_region_amount": sum(r["amount"] for r in equity if r["region"] is None)},
        "fx": {"rows": fx, "by_currency": fx_by_cur, "total": fx_total, "hedged": fx_hedged, "unclear": fx_unclear,
               "hedged_value": sum(r["value"] for r in fx_hedged)},
        "completeness": {"rate_excluded": share_of_total(rate_excl), "equity_excluded": share_of_total(equity_excl),
                         "fx_unclear": share_of_total(fx_unclear)},
        "assumptions": list(ASSUMPTIONS_EXPOSURE),
    }


# ── 7.4 단일 시나리오 ───────────────────────────────────────────────────────

class ScenarioParamError(ValueError):
    """시나리오 입력 오류. args[0] 는 사유 코드."""


def validate_scenario(kind: str, params: dict) -> dict:
    """입력을 검증·정규화한다. 잘못되면 ScenarioParamError(사유 코드)."""
    p = dict(params or {})
    try:
        if kind == "rate":
            d = float(p["delta_pp"])
            if not -10 <= d <= 10 or d == 0:
                raise ScenarioParamError("delta_pp_out_of_range")
            return {"delta_pp": d}
        if kind == "inflation":
            d = float(p["delta_pp"])
            if not 0 < d <= 20:
                raise ScenarioParamError("delta_pp_out_of_range")
            return {"delta_pp": d}
        if kind == "equity":
            mode = p.get("mode", "uniform")
            if mode == "uniform":
                x = float(p["pct"])
                if not 0 < x <= 1:
                    raise ScenarioParamError("pct_out_of_range")
                return {"mode": "uniform", "pct": x}
            if mode == "by_region":
                by = {normalize_region(k): float(v) for k, v in (p.get("by_region") or {}).items()}
                default = float(p.get("default_pct", 0.0))
                if not by or None in by or any(not 0 <= v <= 1 for v in by.values()) or not 0 <= default <= 1:
                    raise ScenarioParamError("pct_out_of_range")
                return {"mode": "by_region", "by_region": by, "default_pct": default}
            raise ScenarioParamError("unknown_mode")
        if kind == "fx":
            y = float(p["pct"])
            cur = str(p.get("currency", "USD")).strip().upper()
            if not -0.5 <= y <= 0.5 or y == 0:
                raise ScenarioParamError("pct_out_of_range")
            return {"currency": cur, "pct": y}
    except (KeyError, TypeError, ValueError) as e:
        if isinstance(e, ScenarioParamError):
            raise
        raise ScenarioParamError("invalid_params") from None
    raise ScenarioParamError("unknown_kind")


def _coverage(check: dict) -> dict:
    b = {x["bucket"]: x for x in check["buckets"]}
    return {
        "total_assets": check["total_assets"],
        "annual_need_total": check["net_need"]["annual_total"],
        "annual_need_essential": check["net_need"]["annual_essential"],
        "buckets": {k: {"value": v["value"], "years_total": v["years_total"], "years_essential": v["years_essential"]}
                    for k, v in b.items()},
        "cumulative": check["cumulative"],
        "r01_status": check["rules"]["R-01"]["status"], "r01_reason": check["rules"]["R-01"]["reason"],
    }


def _apply_changes(assets: list, changes: dict) -> list:
    """자산별 금액 변화(changes: {asset_id: delta})를 반영한 복사본. 금액은 0 아래로 내려가지 않는다."""
    out = []
    for a in assets:
        b = dict(a)
        if a.get("id") in changes:
            b["current_value"] = max(0.0, _num(a.get("current_value")) + changes[a["id"]])
        out.append(b)
    return out


def _run_check(as_of, assets, ctx):
    return compute_withdrawal_check(as_of=as_of, assets=assets, profiles=ctx["profiles"],
                                    cashflow_items=ctx["cashflow_items"], baseline=ctx.get("baseline"),
                                    rules=ctx["rules"], withdrawals=ctx.get("withdrawals"))


def _bucket_changes(rows_changes: list, assets: list, profiles: list) -> dict:
    prof = {p["holding_id"]: p for p in profiles}
    out = {1: 0.0, 2: 0.0, 3: 0.0, None: 0.0}
    by_id = {a.get("id"): a for a in assets}
    for aid, delta in rows_changes:
        b = effective_bucket(by_id[aid], prof.get(aid))["effective_bucket"]
        out[b if b in (1, 2, 3) else None] += delta
    return out


def compute_scenario(*, as_of: date, kind: str, params: dict, assets: list, profiles: list,
                     cashflow_items: list, rules: dict, baseline: Optional[dict] = None,
                     withdrawals: Optional[list] = None, benchmarks: Optional[dict] = None,
                     label: Optional[str] = None) -> dict:
    """단일 충격(금리·주가·환율·물가)을 하나 적용한다. 결과: 금액 변화(전체·버킷·자산)와
    충격 전후 커버 연수·R-01 상태(02 계산 함수 재호출)."""
    _check_as_of(as_of)
    p = validate_scenario(kind, params)
    exp = compute_exposure(as_of=as_of, assets=assets, profiles=profiles, benchmarks=benchmarks)
    ctx = {"profiles": profiles, "cashflow_items": cashflow_items, "rules": rules,
           "baseline": baseline, "withdrawals": withdrawals}
    changes: dict = {}
    excluded: list = []
    cashflow_after = cashflow_items
    need_note = None

    if kind == "rate":
        for r in exp["rate"]["rows"]:
            if r["price_change_per_1pp"]:
                changes[r["asset_id"]] = changes.get(r["asset_id"], 0.0) + r["price_change_per_1pp"] * p["delta_pp"]
        excluded = [{"asset_id": e["asset_id"], "asset_name": e["asset_name"], "value": e["value"], "reason": e["reason"]}
                    for e in exp["rate"]["excluded"]]
        interest_ref = exp["rate"]["interest_change_per_1pp"] * p["delta_pp"]
        need_note = {"interest_change_per_year_ref": interest_ref}
    elif kind == "equity":
        for r in exp["equity"]["rows"]:
            if p["mode"] == "uniform":
                x = p["pct"]
            else:
                x = p["by_region"].get(r["region"], p["default_pct"])
            if x:
                changes[r["asset_id"]] = changes.get(r["asset_id"], 0.0) - x * r["amount"]
        excluded = [{"asset_id": e["asset_id"], "asset_name": e["asset_name"], "value": e["value"], "reason": e["reason"]}
                    for e in exp["equity"]["excluded"]]
    elif kind == "fx":
        for r in exp["fx"]["rows"]:
            if r["currency"] == p["currency"]:
                changes[r["asset_id"]] = changes.get(r["asset_id"], 0.0) + p["pct"] * r["value"]
        excluded = [{"asset_id": e["asset_id"], "asset_name": e["asset_name"], "value": e["value"], "reason": e["reason"]}
                    for e in exp["fx"]["unclear"]]
    elif kind == "inflation":
        cashflow_after = []
        linked = 0
        for it in cashflow_items:
            it = dict(it)
            if it.get("inflation_linked") and it.get("item_type") in ("expense_essential", "expense_discretionary"):
                it["monthly_amount"] = _num(it.get("monthly_amount")) * (1 + p["delta_pp"] / 100)
                linked += 1
            cashflow_after.append(it)
        need_note = {"linked_expense_items": linked}

    before = compute_withdrawal_check(as_of=as_of, assets=assets, profiles=profiles, cashflow_items=cashflow_items,
                                      baseline=baseline, rules=rules, withdrawals=withdrawals)
    shocked_assets = _apply_changes(assets, changes)
    after = compute_withdrawal_check(as_of=as_of, assets=shocked_assets, profiles=profiles, cashflow_items=cashflow_after,
                                     baseline=baseline, rules=rules, withdrawals=withdrawals)

    by_id = {a.get("id"): a for a in assets}
    per_asset = [{"asset_id": aid, "asset_name": by_id[aid].get("asset_name"), "before": _num(by_id[aid].get("current_value")),
                  "change": d, "after": max(0.0, _num(by_id[aid].get("current_value")) + d)}
                 for aid, d in sorted(changes.items(), key=lambda kv: kv[1])]
    per_bucket = _bucket_changes(list(changes.items()), assets, profiles)
    b_before, b_after = _coverage(before), _coverage(after)
    reasons = []
    if not changes and kind != "inflation":
        reasons.append({"code": "no_affected_assets"})
    if kind == "inflation" and need_note["linked_expense_items"] == 0:
        reasons.append({"code": "no_inflation_linked_items"})
    return {
        "as_of": as_of.isoformat(), "kind": kind, "label": label, "params": p,
        "change": {"total": sum(changes.values()), "by_bucket": {str(k): v for k, v in per_bucket.items() if k is not None},
                   "unassigned": per_bucket[None], "by_asset": per_asset},
        "before": b_before, "after": b_after,
        "r01": {"before": b_before["r01_status"], "after": b_after["r01_status"],
                "changed": b_before["r01_status"] != b_after["r01_status"]},
        "need_note": need_note,
        "excluded": excluded, "reasons": reasons,
        "assumptions": ASSUMPTIONS_EXPOSURE + ASSUMPTIONS_SCENARIO
        + (["물가 충격은 inflation_linked=true 인 생활비(필수·선택) 항목만 증액하고 정기수입·자산 가격은 그대로 둠"] if kind == "inflation" else []),
    }


# ── 7.5 최근 시장 변화의 영향 (신호 → 내 자산) ─────────────────────────────────

RATE_SERIES_BY_MARKET = {"KR": "KR_10Y", "US": "US10Y"}
FX_SERIES_BY_CURRENCY = {"USD": "USD_KRW", "EUR": "EUR_KRW", "JPY": "JPY_KRW"}


def _month_change(series: dict, obs: list, as_of: date, months: int = 1):
    """(변화값, 사유, 요약) — 데이터가 없거나 지연이면 값 None + 사유."""
    rows = _prep(obs, as_of)
    if not rows:
        return None, "no_data", None
    last = rows[-1]
    if _is_stale(_frequency(series, last[3]), last[0], as_of):
        return None, "stale", {"latest_date": last[0].isoformat()}
    ch = _change(series, rows, months)
    if ch["value"] is None:
        return None, ch["reason"], {"latest_date": last[0].isoformat()}
    return ch["value"], None, {"latest_date": last[0].isoformat(), "ref_date": ch["ref_date"], "unit": ch["unit"]}


def compute_signal_impact(*, as_of: date, assets: list, profiles: list, cashflow_items: list, rules: dict,
                          series: dict, observations: dict, benchmarks: Optional[dict] = None,
                          baseline: Optional[dict] = None, withdrawals: Optional[list] = None) -> dict:
    """실제 관측된 1개월 변화 × 내 노출 = 추정 영향액(참고). 예측이 아니라 이미 일어난 변화의 영향 추정이다.
    한국 금리 지표가 없으면 미국 금리로 대체하지 않고 해당 자산을 제외하며 사유를 표시한다."""
    _check_as_of(as_of)
    benchmarks = benchmarks or {}
    exp = compute_exposure(as_of=as_of, assets=assets, profiles=profiles, benchmarks=benchmarks)
    changes: dict = {}
    signals, excluded = [], []

    def add(aid, delta):
        changes[aid] = changes.get(aid, 0.0) + delta

    # 금리: 시장(KR/US)별로 1개월 변화(%p) × 금리 노출
    for market, code in RATE_SERIES_BY_MARKET.items():
        rows = [r for r in exp["rate"]["rows"] if r["rate_market"] == market and r["price_change_per_1pp"]]
        if not rows:
            continue
        exposure = sum(r["price_change_per_1pp"] for r in rows)
        s = series.get(code)
        val, reason, meta = (None, "series_missing", None) if s is None else _month_change(s, observations.get(code), as_of)
        sig = {"kind": "rate", "market": market, "series_code": code, "observed_change_pp": val,
               "exposure_per_1pp": exposure, "estimated_impact": None if val is None else exposure * val,
               "reason": reason, "meta": meta, "asset_count": len(rows)}
        signals.append(sig)
        if val is None:
            excluded += [{"asset_id": r["asset_id"], "asset_name": r["asset_name"], "value": r["value"],
                          "signal": "rate", "reason": f"rate_{reason}"} for r in rows]
        else:
            for r in rows:
                add(r["asset_id"], r["price_change_per_1pp"] * val)
    for r in exp["rate"]["rows"]:
        if r["rate_market"] is None and r["price_change_per_1pp"]:
            excluded.append({"asset_id": r["asset_id"], "asset_name": r["asset_name"], "value": r["value"],
                             "signal": "rate", "reason": r["market_reason"]})

    # 주가: 지역 기준지수의 1개월 변화(현지 통화) × 지역별 주식성 금액
    by_region: dict = {}
    for r in exp["equity"]["rows"]:
        by_region.setdefault(r["region"], []).append(r)
    for region, rows in by_region.items():
        amount = sum(r["amount"] for r in rows)
        res = resolve_region(region, benchmarks)
        if res["reason"]:
            reason = "region_missing" if region is None else "region_no_benchmark"
            signals.append({"kind": "equity", "region": region, "series_code": None, "observed_change": None,
                            "exposure": amount, "estimated_impact": None, "reason": reason, "asset_count": len(rows)})
            excluded += [{"asset_id": r["asset_id"], "asset_name": r["asset_name"], "value": r["amount"],
                          "signal": "equity", "reason": reason, "region": region} for r in rows]
            continue
        code = res["series_code"]
        s = series.get(code)
        val, reason, meta = (None, "series_missing", None) if s is None else _month_change(s, observations.get(code), as_of)
        signals.append({"kind": "equity", "region": region, "series_code": code, "is_proxy": bool(s and s.get("is_proxy")),
                        "observed_change": val, "exposure": amount, "estimated_impact": None if val is None else amount * val,
                        "reason": reason, "meta": meta, "asset_count": len(rows)})
        if val is None:
            excluded += [{"asset_id": r["asset_id"], "asset_name": r["asset_name"], "value": r["amount"],
                          "signal": "equity", "reason": f"equity_{reason}", "region": region} for r in rows]
        else:
            for r in rows:
                add(r["asset_id"], r["amount"] * val)

    # 환율: 통화별 원화 환율 1개월 변화 × 비헤지 외화 금액
    for cur, amount in exp["fx"]["by_currency"].items():
        rows = [r for r in exp["fx"]["rows"] if r["currency"] == cur]
        code = FX_SERIES_BY_CURRENCY.get(cur)
        s = series.get(code) if code else None
        val, reason, meta = ((None, "no_fx_series", None) if code is None else (None, "series_missing", None) if s is None
                             else _month_change(s, observations.get(code), as_of))
        signals.append({"kind": "fx", "currency": cur, "series_code": code, "observed_change": val, "exposure": amount,
                        "estimated_impact": None if val is None else amount * val, "reason": reason, "meta": meta,
                        "asset_count": len(rows)})
        if val is None:
            excluded += [{"asset_id": r["asset_id"], "asset_name": r["asset_name"], "value": r["value"],
                          "signal": "fx", "reason": f"fx_{reason}"} for r in rows]
        else:
            for r in rows:
                add(r["asset_id"], r["value"] * val)

    ctx = {"profiles": profiles, "cashflow_items": cashflow_items, "rules": rules,
           "baseline": baseline, "withdrawals": withdrawals}
    before = _coverage(_run_check(as_of, assets, ctx))
    after = _coverage(_run_check(as_of, _apply_changes(assets, changes), ctx))
    return {
        "as_of": as_of.isoformat(), "signals": signals,
        "total_impact": sum(s["estimated_impact"] for s in signals if s["estimated_impact"] is not None),
        "before": before, "after": after, "excluded": excluded,
        "assumptions": ASSUMPTIONS_EXPOSURE + [
            "관측된 1개월 변화(최신 관측일 기준)를 현재 노출에 곱한 참고값 — 예측이 아니며 실제 손익과 다를 수 있음",
            "국내 채권은 한국 국고채 10년, 해외(USD) 채권은 미국 국채 10년 변화를 사용(채권별 만기 차이는 미반영)",
            "주식 변화는 지역 기준지수의 현지 통화 변화이고 환율 영향은 환율 신호로 따로 더함(교차 효과 미반영)",
        ],
    }
