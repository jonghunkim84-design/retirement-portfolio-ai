"""
시장 지표 수집 모듈 (지시서 04 C단계) — 네트워크(FDR·ECOS·FRED) + 저장(market_observations).

역할
- market_series.sources 의 원천 우선순위(fdr / ecos / fred)대로 지표를 가져와 market_observations 에 upsert 한다.
- 증분 수집: 마지막 관측일 이후(+겹침 구간)만 가져온다. 관측값이 없으면 initial_days 만큼만 가져온다
  (3년치 초기 적재는 scripts/market_initial_load.py 가 full_days 를 넘겨 실행한다).
- 이상치는 저장하되 flag 를 단다(최신값·변화율에는 포함, 고점 계산에서는 제외, 화면에 경고). 0 이하·결측은 저장하지 않는다
  (지수·ETF·환율·CPI 지수 기준. 금리는 0·음수가 유효할 수 있어 결측만 거른다).
- 실패는 지표별로 격리한다. 한 지표가 실패해도 나머지는 계속 수집한다.

규칙
- 오늘 날짜는 인자(today)로 받는다. 이 모듈은 시스템 날짜를 직접 조회하지 않는다.
- DB 클라이언트(db)와 fetchers 는 인자로 주입한다(테스트에서 가짜로 교체). 이 모듈은 database 를 import 하지 않는다.
- ECOS 키는 URL 에 들어가므로 예외 메시지·사유·로그에 절대 남기지 않는다(_mask 로 제거).
- price.py 는 import 하지 않는다. FinanceDataReader 는 여기서 직접 호출한다.
"""
from __future__ import annotations

import calendar
import logging
import os
import time
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Optional

logger = logging.getLogger(__name__)

# ── 이상치 기준 (전 관측 대비) ──────────────────────────────────────────────
# level/index: 변화율 초과, percent: 절대 변화(%p) 초과
JUMP_LIMITS = {
    "equity_index": ("pct", 0.15),
    "etf_proxy":    ("pct", 0.15),
    "fx":           ("pct", 0.05),
    "rate":         ("abs", 1.0),
    "cpi":          ("pct", 0.03),
}
FLAG_JUMP = "jump_suspect"

# 0 이하를 저장하지 않는 분류 (금리는 제외)
POSITIVE_ONLY = {"equity_index", "etf_proxy", "fx", "cpi"}

# 지연 기준
STALE_DAILY_BUSINESS_DAYS = 5
STALE_MONTHLY_DAYS = 60

# 겹침 재수집 구간(일) — 늦게 확정·정정되는 값을 반영
OVERLAP_DAYS = {"daily": 10, "monthly": 100}
# 관측값이 없을 때 refresh 가 가져오는 기본 기간(일)
INITIAL_DAYS = {"daily": 45, "monthly": 400}

UPSERT_CHUNK = 500
ECOS_PAGE = 1000

# 사유 코드 (화면에서 문장으로 조립)
REASON_NO_SOURCES = "no_sources"
REASON_KEY_MISSING = "ecos_key_missing"
REASON_ALL_FAILED = "all_sources_failed"
REASON_EMPTY = "empty_response"
REASON_TIME_BUDGET = "time_budget_exceeded"


class MarketDataError(Exception):
    """원천 조회 실패. 메시지에는 키가 들어가지 않아야 한다."""


# ═════════════════════════ 순수 함수 ═════════════════════════

def _mask(text, secrets: Optional[list] = None) -> str:
    out = str(text)
    for s in secrets or []:
        if s:
            out = out.replace(s, "***")
    return out


def month_start(d: date) -> date:
    return d.replace(day=1)


def month_end(d: date) -> date:
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def parse_ecos_time(cycle: str, t: str) -> date:
    """ECOS TIME 문자열 → 일자. 월별은 그 달 1일(FRED 월별과 같은 관례)."""
    t = str(t).strip()
    if cycle == "D":
        return datetime.strptime(t, "%Y%m%d").date()
    if cycle == "M":
        return datetime.strptime(t, "%Y%m").date().replace(day=1)
    raise MarketDataError(f"지원하지 않는 ECOS 주기: {cycle}")


def parse_ecos_response(payload: dict, cycle: str) -> tuple[list[tuple[date, float]], int]:
    """ECOS StatisticSearch JSON → ([(일자, 값)], 전체 건수). 데이터 없음(INFO-200)은 빈 목록."""
    if "StatisticSearch" in payload:
        block = payload["StatisticSearch"]
        rows = []
        for r in block.get("row", []):
            v = r.get("DATA_VALUE")
            if v in (None, ""):
                continue
            try:
                rows.append((parse_ecos_time(cycle, r["TIME"]), float(str(v).replace(",", ""))))
            except (ValueError, KeyError):
                continue
        return rows, int(block.get("list_total_count", len(rows)))
    result = payload.get("RESULT") or {}
    code = str(result.get("CODE", ""))
    if code == "INFO-200":
        return [], 0
    raise MarketDataError(f"ECOS 오류 {code or 'unknown'}")


def parse_fred_csv(text: str) -> list[tuple[date, float]]:
    """FRED fredgraph.csv → [(일자, 값)]. '.' 또는 빈 값(결측)은 건너뛴다."""
    lines = text.strip().splitlines()
    rows = []
    for line in lines[1:]:
        parts = line.split(",")
        if len(parts) < 2 or parts[1].strip() in (".", ""):
            continue
        try:
            rows.append((date.fromisoformat(parts[0].strip()), float(parts[1])))
        except ValueError:
            continue
    return rows


def clean_rows(category: str, rows: list[tuple[date, float]]) -> list[tuple[date, float]]:
    """결측·NaN 제거, 분류별 0 이하 제거, 일자 중복 제거(마지막 값), 일자순 정렬."""
    by_date: dict[date, float] = {}
    for d, v in rows:
        if v is None or v != v:                      # None, NaN
            continue
        if category in POSITIVE_ONLY and v <= 0:
            continue
        by_date[d] = float(v)
    return sorted(by_date.items())


def flag_rows(category: str, rows: list[tuple[date, float]],
              prev_value: Optional[float]) -> list[dict]:
    """정렬된 (일자, 값) 목록에 이상치 flag 를 단다. 직전 관측(DB 의 마지막 값 포함) 대비 비교."""
    kind, limit = JUMP_LIMITS.get(category, ("pct", 0.15))
    out = []
    prev = prev_value
    for d, v in rows:
        flag = None
        if prev is not None:
            if kind == "abs":
                jump = abs(v - prev) > limit
            else:
                jump = prev != 0 and abs(v / prev - 1) > limit
            if jump:
                flag = FLAG_JUMP
        out.append({"obs_date": d, "value": v, "flag": flag})
        prev = v
    return out


def _business_days_between(start: date, end: date) -> int:
    n, d = 0, start
    while d < end:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return n


def is_stale(frequency: str, last_obs: Optional[date], today: date) -> bool:
    """지연 여부. daily: 마지막 관측 이후 5영업일 초과. monthly: 그 달 말일 이후 60일 초과. 관측 없음=지연."""
    if last_obs is None:
        return True
    if frequency == "monthly":
        return (today - month_end(last_obs)).days > STALE_MONTHLY_DAYS
    return _business_days_between(last_obs, today) > STALE_DAILY_BUSINESS_DAYS


def source_frequency(series: dict, source_name: Optional[str]) -> str:
    """관측값의 원천 기준 주기. sources 원소에 frequency 가 있으면 그것, 없으면 series.frequency."""
    for s in series.get("sources") or []:
        if s.get("source") == source_name and s.get("frequency"):
            return s["frequency"]
    return series["frequency"]


# ═════════════════════════ 네트워크 (원천별 조회) ═════════════════════════

def fetch_fdr(symbol: str, start: date, end: date, **_) -> list[tuple[date, float]]:
    import FinanceDataReader as fdr
    df = fdr.DataReader(symbol, str(start), str(end))
    if df is None or df.empty or "Close" not in df.columns:
        return []
    return [(idx.date(), float(v)) for idx, v in df["Close"].items() if v == v]


def fetch_ecos(symbol: str, start: date, end: date, params: Optional[dict] = None,
               api_key: str = "", **_) -> list[tuple[date, float]]:
    import httpx
    params = params or {}
    cycle, item = params.get("cycle", "D"), params.get("item", "")
    fmt = "%Y%m%d" if cycle == "D" else "%Y%m"
    s, e = start.strftime(fmt), end.strftime(fmt)
    rows: list[tuple[date, float]] = []
    first = 1
    try:
        while True:
            last = first + ECOS_PAGE - 1
            url = (f"https://ecos.bok.or.kr/api/StatisticSearch/{api_key}/json/kr/"
                   f"{first}/{last}/{symbol}/{cycle}/{s}/{e}/{item}")
            r = httpx.get(url, timeout=30)
            page, total = parse_ecos_response(r.json(), cycle)
            rows.extend(page)
            if last >= total or not page:
                break
            first = last + 1
    except MarketDataError:
        raise
    except Exception as exc:                      # 네트워크·JSON 오류: URL(키 포함)이 섞일 수 있어 마스킹
        raise MarketDataError(f"ECOS 조회 실패: {type(exc).__name__}: {_mask(exc, [api_key])}") from None
    return rows


def fetch_fred(symbol: str, start: date, end: date, **_) -> list[tuple[date, float]]:
    import httpx
    try:
        r = httpx.get("https://fred.stlouisfed.org/graph/fredgraph.csv",
                      params={"id": symbol}, timeout=30, follow_redirects=True)
        if r.status_code != 200:
            raise MarketDataError(f"FRED HTTP {r.status_code}")
        rows = parse_fred_csv(r.text)
    except MarketDataError:
        raise
    except Exception as exc:
        raise MarketDataError(f"FRED 조회 실패: {type(exc).__name__}") from None
    return [(d, v) for d, v in rows if start <= d <= end]


DEFAULT_FETCHERS: dict[str, Callable] = {"fdr": fetch_fdr, "ecos": fetch_ecos, "fred": fetch_fred}


# ═════════════════════════ 저장·수집 ═════════════════════════

def _last_obs(db, code: str, before: Optional[date] = None) -> Optional[dict]:
    q = db.table("market_observations").select("obs_date,value").eq("series_code", code)
    if before is not None:
        q = q.lt("obs_date", before.isoformat())
    res = q.order("obs_date", desc=True).limit(1).execute()
    return res.data[0] if res.data else None


def plan_window(series: dict, last_obs_date: Optional[date], today: date,
                full_days: Optional[int] = None, initial_days: Optional[int] = None) -> tuple[date, date]:
    """수집 구간 [start, end]. full_days 가 있으면 관측값 유무와 무관하게 today-full_days 부터(초기 적재)."""
    freq = series["frequency"]
    if full_days is not None:
        return today - timedelta(days=full_days), today
    if last_obs_date is None:
        return today - timedelta(days=initial_days or INITIAL_DAYS[freq]), today
    return last_obs_date - timedelta(days=OVERLAP_DAYS[freq]), today


def fetch_with_priority(series: dict, start: date, end: date, env: dict,
                        fetchers: Optional[dict] = None) -> dict:
    """원천 우선순위대로 시도해 처음 성공(1건 이상)한 원천의 결과를 돌려준다.
    반환: {rows, source, attempts:[{source, ok, reason}]}. 모두 실패면 rows=[]·source=None."""
    fetchers = fetchers or DEFAULT_FETCHERS
    sources = series.get("sources") or []
    attempts = []
    if not sources:
        return {"rows": [], "source": None, "attempts": [], "reason": REASON_NO_SOURCES}
    ecos_key = env.get("ECOS_API_KEY", "")
    for src in sources:
        name = src.get("source")
        if name == "ecos" and not ecos_key:
            attempts.append({"source": name, "ok": False, "reason": REASON_KEY_MISSING})
            continue
        fn = fetchers.get(name)
        if fn is None:
            attempts.append({"source": name, "ok": False, "reason": "unknown_source"})
            continue
        try:
            rows = fn(src.get("symbol", ""), start, end, params=src.get("params"), api_key=ecos_key)
        except Exception as exc:
            attempts.append({"source": name, "ok": False, "reason": _mask(exc, [ecos_key])[:200]})
            continue
        if not rows:
            attempts.append({"source": name, "ok": False, "reason": REASON_EMPTY})
            continue
        attempts.append({"source": name, "ok": True, "reason": None})
        return {"rows": rows, "source": name, "attempts": attempts, "reason": None}
    only_key_missing = all(a["reason"] == REASON_KEY_MISSING for a in attempts)
    return {"rows": [], "source": None, "attempts": attempts,
            "reason": REASON_KEY_MISSING if only_key_missing else REASON_ALL_FAILED}


def collect_series(db, series: dict, today: date, env: Optional[dict] = None,
                   fetchers: Optional[dict] = None, full_days: Optional[int] = None,
                   initial_days: Optional[int] = None, apply: bool = True) -> dict:
    """지표 1개 수집. apply=False 면 조회·검증만 하고 저장하지 않는다(예상 건수 확인용)."""
    env = os.environ if env is None else env
    code = series["code"]
    last = _last_obs(db, code)
    last_date = date.fromisoformat(last["obs_date"]) if last else None
    start, end = plan_window(series, last_date, today, full_days, initial_days)

    got = fetch_with_priority(series, start, end, env, fetchers)
    result = {"code": code, "start": start.isoformat(), "end": end.isoformat(),
              "source": got["source"], "attempts": got["attempts"],
              "fetched": len(got["rows"]), "stored": 0, "flagged": 0,
              "status": "ok", "reason": None, "last_date": last["obs_date"] if last else None}
    if not got["rows"]:
        result["status"] = "skipped" if got["reason"] in (REASON_KEY_MISSING, REASON_NO_SOURCES) else "failed"
        result["reason"] = got["reason"]
        return result

    rows = clean_rows(series["category"], got["rows"])
    result["dropped"] = len(got["rows"]) - len(rows)
    if not rows:
        result["status"] = "failed"
        result["reason"] = REASON_EMPTY
        return result

    prev = _last_obs(db, code, before=rows[0][0])
    flagged = flag_rows(series["category"], rows, float(prev["value"]) if prev else None)
    result["flagged"] = sum(1 for r in flagged if r["flag"])
    result["last_date"] = flagged[-1]["obs_date"].isoformat()
    result["sample"] = [(r["obs_date"].isoformat(), r["value"]) for r in flagged[-1:]]
    result["stored_candidate"] = len(flagged)

    if apply:
        now = datetime.now(timezone.utc).isoformat()
        payload = [{"series_code": code, "obs_date": r["obs_date"].isoformat(), "value": r["value"],
                    "source": got["source"], "flag": r["flag"], "fetched_at": now} for r in flagged]
        for i in range(0, len(payload), UPSERT_CHUNK):
            db.table("market_observations").upsert(
                payload[i:i + UPSERT_CHUNK], on_conflict="series_code,obs_date").execute()
        result["stored"] = len(payload)
    return result


def refresh_all(db, today: date, env: Optional[dict] = None, fetchers: Optional[dict] = None,
                only: Optional[list] = None, full_days: Optional[int] = None,
                apply: bool = True, time_budget_s: float = 240.0,
                clock: Callable[[], float] = time.monotonic) -> dict:
    """활성 지표 전체를 순서대로 수집. 지표별 실패는 격리하고, 시간 예산을 넘으면 남은 지표는 건너뛴다."""
    q = db.table("market_series").select("*").eq("enabled", True)
    series_list = q.execute().data or []
    if only:
        series_list = [s for s in series_list if s["code"] in only]
    t0 = clock()
    results = []
    for s in sorted(series_list, key=lambda x: x["code"]):
        if clock() - t0 > time_budget_s:
            results.append({"code": s["code"], "status": "skipped", "reason": REASON_TIME_BUDGET,
                            "fetched": 0, "stored": 0, "flagged": 0})
            continue
        try:
            results.append(collect_series(db, s, today, env, fetchers, full_days, apply=apply))
        except Exception as exc:                   # 저장 실패 등 예상 밖 오류도 지표 단위로 격리
            logger.warning("market collect failed: %s: %s", s["code"], type(exc).__name__)
            results.append({"code": s["code"], "status": "failed", "reason": type(exc).__name__,
                            "fetched": 0, "stored": 0, "flagged": 0})
    return {
        "as_of": today.isoformat(),
        "results": results,
        "ok": sum(1 for r in results if r["status"] == "ok"),
        "failed": sum(1 for r in results if r["status"] == "failed"),
        "skipped": sum(1 for r in results if r["status"] == "skipped"),
        "stored": sum(r.get("stored", 0) for r in results),
    }
