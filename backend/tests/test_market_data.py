"""
시장 지표 수집 모듈(market_data) 테스트 — 네트워크·운영 DB 없이 가짜 DB·가짜 fetcher 로 검증.

실행: backend/ 디렉터리에서 `pytest tests/test_market_data.py -v`
"""
import inspect
import sys
import os
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import market_data as md

TODAY = date(2026, 9, 20)
KEY = "SECRETKEY1234567890"


# ── 가짜 Supabase (market_series / market_observations) ─────────────────────

class _Q:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.filters, self._order, self._limit, self._upsert = [], None, None, None

    def select(self, *_): return self
    def eq(self, c, v): self.filters.append(("eq", c, v)); return self
    def lt(self, c, v): self.filters.append(("lt", c, v)); return self
    def order(self, c, desc=False): self._order = (c, desc); return self
    def limit(self, n): self._limit = n; return self
    def upsert(self, rows, on_conflict=None):
        self._upsert = (rows, on_conflict); return self

    def execute(self):
        if self.db.fail_upsert and self._upsert:
            raise RuntimeError("db down")
        if self._upsert:
            rows, key = self._upsert
            assert key == "series_code,obs_date"
            store = self.db.obs
            for r in rows:
                store[(r["series_code"], r["obs_date"])] = dict(r)
            return type("R", (), {"data": rows})()
        rows = self.db.series if self.table == "market_series" else list(self.db.obs.values())
        for op, c, v in self.filters:
            rows = [r for r in rows if (r.get(c) == v if op == "eq" else r.get(c) < v)]
        if self._order:
            rows = sorted(rows, key=lambda r: r[self._order[0]], reverse=self._order[1])
        if self._limit:
            rows = rows[: self._limit]
        return type("R", (), {"data": [dict(r) for r in rows]})()


class FakeDB:
    def __init__(self, series, obs=None):
        self.series = series
        self.obs = {(o["series_code"], o["obs_date"]): o for o in (obs or [])}
        self.fail_upsert = False

    def table(self, name): return _Q(self, name)


def S(code="KS11", category="equity_index", frequency="daily", sources=None, enabled=True):
    return {"code": code, "category": category, "frequency": frequency, "enabled": enabled,
            "sources": sources if sources is not None else [{"source": "fdr", "symbol": code}]}


def days(n, start=date(2026, 9, 1), base=100.0, step=1.0):
    return [(start + timedelta(days=i), base + i * step) for i in range(n)]


# ── 순수 함수 ──────────────────────────────────────────────────────────────

def test_ecos_time_parse_daily_and_monthly_first_day():
    assert md.parse_ecos_time("D", "20260918") == date(2026, 9, 18)
    assert md.parse_ecos_time("M", "202608") == date(2026, 8, 1)


def test_parse_ecos_response_rows_and_no_data():
    payload = {"StatisticSearch": {"list_total_count": 2, "row": [
        {"TIME": "20260917", "DATA_VALUE": "4.035"}, {"TIME": "20260918", "DATA_VALUE": ""}]}}
    rows, total = md.parse_ecos_response(payload, "D")
    assert rows == [(date(2026, 9, 17), 4.035)] and total == 2          # 빈 값은 건너뜀
    assert md.parse_ecos_response({"RESULT": {"CODE": "INFO-200", "MESSAGE": "없음"}}, "D") == ([], 0)


def test_parse_ecos_error_raises_without_leaking():
    try:
        md.parse_ecos_response({"RESULT": {"CODE": "ERROR-100", "MESSAGE": "인증키 오류"}}, "D")
        assert False
    except md.MarketDataError as e:
        assert "ERROR-100" in str(e)


def test_parse_fred_csv_skips_missing():
    text = "observation_date,DGS10\n2026-09-15,4.90\n2026-09-16,.\n2026-09-17,4.94\n"
    assert md.parse_fred_csv(text) == [(date(2026, 9, 15), 4.90), (date(2026, 9, 17), 4.94)]


def test_clean_rows_drops_nonpositive_for_index_but_keeps_zero_rate():
    rows = [(date(2026, 9, 1), 0.0), (date(2026, 9, 2), -1.0), (date(2026, 9, 3), 10.0),
            (date(2026, 9, 4), float("nan"))]
    assert md.clean_rows("equity_index", rows) == [(date(2026, 9, 3), 10.0)]
    assert md.clean_rows("fx", rows) == [(date(2026, 9, 3), 10.0)]
    assert md.clean_rows("rate", rows) == [(date(2026, 9, 1), 0.0), (date(2026, 9, 2), -1.0), (date(2026, 9, 3), 10.0)]


def test_clean_rows_dedups_and_sorts():
    rows = [(date(2026, 9, 3), 2.0), (date(2026, 9, 1), 1.0), (date(2026, 9, 3), 3.0)]
    assert md.clean_rows("equity_index", rows) == [(date(2026, 9, 1), 1.0), (date(2026, 9, 3), 3.0)]


def test_flag_boundaries_pct_strict_greater():
    # 경계: 정확히 15% 는 정상, 초과만 이상치 (>)
    rows = [(date(2026, 9, 1), 100.0), (date(2026, 9, 2), 115.0), (date(2026, 9, 3), 132.3)]
    f = md.flag_rows("equity_index", rows, None)
    assert [r["flag"] for r in f] == [None, None, md.FLAG_JUMP]          # 100→115 = 15%(정상), 115→132.3 = 15.04%(초과)


def test_flag_uses_previous_db_value_for_first_row():
    f = md.flag_rows("fx", [(date(2026, 9, 5), 1500.0)], prev_value=1400.0)   # +7.1% > 5%
    assert f[0]["flag"] == md.FLAG_JUMP
    assert md.flag_rows("fx", [(date(2026, 9, 5), 1500.0)], prev_value=None)[0]["flag"] is None


def test_flag_rate_absolute_and_boundary():
    f = md.flag_rows("rate", [(date(2026, 9, 1), 3.0), (date(2026, 9, 2), 4.0), (date(2026, 9, 3), 5.01)], None)
    assert [r["flag"] for r in f] == [None, None, md.FLAG_JUMP]          # 1.0%p 는 정상, 1.01%p 는 이상치


def test_is_stale_daily_five_business_days():
    last = date(2026, 9, 11)                                             # 금요일
    assert md.is_stale("daily", last, date(2026, 9, 18)) is False        # 영업일 5 (월~금)
    assert md.is_stale("daily", last, date(2026, 9, 19)) is False        # 토요일 — 영업일 그대로 5
    assert md.is_stale("daily", last, date(2026, 9, 21)) is True         # 월요일 → 6
    assert md.is_stale("daily", None, TODAY) is True


def test_is_stale_monthly_60_days_from_month_end():
    last = date(2026, 8, 1)                                              # 8월분 → 말일 8/31 기준
    assert md.is_stale("monthly", last, date(2026, 10, 30)) is False     # 60일
    assert md.is_stale("monthly", last, date(2026, 10, 31)) is True      # 61일


def test_source_frequency_override():
    s = S("KR_10Y", "rate", "daily", [{"source": "ecos", "symbol": "x"}, {"source": "fred", "symbol": "y", "frequency": "monthly"}])
    assert md.source_frequency(s, "ecos") == "daily"
    assert md.source_frequency(s, "fred") == "monthly"


def test_module_never_calls_date_today_and_no_price_import():
    src = inspect.getsource(md)
    assert "date.today(" not in src and "datetime.now()" not in src
    assert "routers.price" not in src and "import price" not in src


# ── 수집 ──────────────────────────────────────────────────────────────────

def test_plan_window_incremental_initial_and_full():
    s = S()
    assert md.plan_window(s, None, TODAY) == (TODAY - timedelta(days=45), TODAY)
    assert md.plan_window(s, date(2026, 9, 10), TODAY) == (date(2026, 8, 31), TODAY)   # 마지막 - 겹침 10일
    assert md.plan_window(s, date(2026, 9, 10), TODAY, full_days=1095) == (TODAY - timedelta(days=1095), TODAY)


def test_collect_stores_rows_with_source_and_flag():
    db = FakeDB([S()])
    rows = [(date(2026, 9, 1), 100.0), (date(2026, 9, 2), 130.0)]
    r = md.collect_series(db, S(), TODAY, env={}, fetchers={"fdr": lambda *a, **k: rows})
    assert r["status"] == "ok" and r["stored"] == 2 and r["flagged"] == 1 and r["source"] == "fdr"
    saved = db.obs[("KS11", "2026-09-02")]
    assert saved["flag"] == md.FLAG_JUMP and saved["source"] == "fdr"
    assert db.obs[("KS11", "2026-09-01")]["flag"] is None


def test_collect_incremental_uses_db_last_value_for_flag_and_window():
    seen = {}
    def fdr(sym, start, end, **k):
        seen["start"] = start
        return [(date(2026, 9, 12), 150.0)]
    db = FakeDB([S()], [{"series_code": "KS11", "obs_date": "2026-09-10", "value": 100.0, "source": "fdr", "flag": None}])
    r = md.collect_series(db, S(), TODAY, env={}, fetchers={"fdr": fdr})
    assert seen["start"] == date(2026, 8, 31)
    assert db.obs[("KS11", "2026-09-12")]["flag"] == md.FLAG_JUMP        # DB 의 직전 값(100) 대비 +50%


def test_collect_dry_run_writes_nothing():
    db = FakeDB([S()])
    r = md.collect_series(db, S(), TODAY, env={}, fetchers={"fdr": lambda *a, **k: days(3)}, apply=False)
    assert r["stored"] == 0 and r["stored_candidate"] == 3 and db.obs == {}


def test_priority_falls_back_to_next_source_and_records_actual_source():
    s = S("KR_10Y", "rate", "daily", [{"source": "ecos", "symbol": "a", "params": {}}, {"source": "fred", "symbol": "b"}])
    def bad_ecos(*a, **k): raise md.MarketDataError("ECOS 오류 ERROR-500")
    db = FakeDB([s])
    r = md.collect_series(db, s, TODAY, env={"ECOS_API_KEY": KEY},
                          fetchers={"ecos": bad_ecos, "fred": lambda *a, **k: [(date(2026, 8, 1), 4.2)]})
    assert r["status"] == "ok" and r["source"] == "fred"
    assert db.obs[("KR_10Y", "2026-08-01")]["source"] == "fred"
    assert r["attempts"][0] == {"source": "ecos", "ok": False, "reason": "ECOS 오류 ERROR-500"}


def test_ecos_only_series_without_key_is_skipped_with_reason_no_fallback_to_other_country():
    s = S("KR_3Y", "rate", "daily", [{"source": "ecos", "symbol": "817Y002", "params": {}}])
    called = []
    r = md.collect_series(FakeDB([s]), s, TODAY, env={}, fetchers={"ecos": lambda *a, **k: called.append(1) or [], "fdr": lambda *a, **k: called.append(2) or []})
    assert r["status"] == "skipped" and r["reason"] == md.REASON_KEY_MISSING and called == []


def test_key_missing_then_fred_fallback_used_for_series_with_fred():
    s = S("KR_10Y", "rate", "daily", [{"source": "ecos", "symbol": "a"}, {"source": "fred", "symbol": "b"}])
    r = md.collect_series(FakeDB([s]), s, TODAY, env={}, fetchers={"fred": lambda *a, **k: [(date(2026, 8, 1), 4.2)]})
    assert r["status"] == "ok" and r["source"] == "fred"
    assert r["attempts"][0]["reason"] == md.REASON_KEY_MISSING


def test_error_reason_masks_api_key():
    s = S("KR_3Y", "rate", "daily", [{"source": "ecos", "symbol": "a"}])
    def leaky(*a, **k): raise RuntimeError(f"GET https://ecos.bok.or.kr/api/StatisticSearch/{KEY}/json failed")
    r = md.collect_series(FakeDB([s]), s, TODAY, env={"ECOS_API_KEY": KEY}, fetchers={"ecos": leaky})
    assert r["status"] == "failed" and r["reason"] == md.REASON_ALL_FAILED
    assert KEY not in repr(r)


def test_all_rows_nonpositive_is_failed_and_stores_nothing():
    db = FakeDB([S()])
    r = md.collect_series(db, S(), TODAY, env={}, fetchers={"fdr": lambda *a, **k: [(date(2026, 9, 1), 0.0)]})
    assert r["status"] == "failed" and db.obs == {}


def test_refresh_isolates_failures_and_counts():
    series = [S("A"), S("B"), S("C", sources=[])]
    def fdr(sym, *a, **k):
        if sym == "B": raise RuntimeError("boom")
        return days(2)
    db = FakeDB(series)
    out = md.refresh_all(db, TODAY, env={}, fetchers={"fdr": fdr})
    status = {r["code"]: r["status"] for r in out["results"]}
    assert status == {"A": "ok", "B": "failed", "C": "skipped"}
    assert out["ok"] == 1 and out["failed"] == 1 and out["skipped"] == 1 and out["stored"] == 2


def test_refresh_storage_error_is_isolated_per_series():
    db = FakeDB([S("A"), S("B")])
    db.fail_upsert = True
    out = md.refresh_all(db, TODAY, env={}, fetchers={"fdr": lambda *a, **k: days(2)})
    assert out["failed"] == 2 and out["ok"] == 0


def test_refresh_disabled_and_only_filter():
    db = FakeDB([S("A"), S("B", enabled=False), S("C")])
    # 가짜 DB 는 eq('enabled', True) 필터를 지원한다
    out = md.refresh_all(db, TODAY, env={}, fetchers={"fdr": lambda *a, **k: days(2)}, only=["A"])
    assert [r["code"] for r in out["results"]] == ["A"]


def test_refresh_time_budget_defers_rest():
    ticks = iter([0, 0, 1000, 1000, 1000])
    db = FakeDB([S("A"), S("B")])
    out = md.refresh_all(db, TODAY, env={}, fetchers={"fdr": lambda *a, **k: days(2)},
                         time_budget_s=10, clock=lambda: next(ticks))
    st = {r["code"]: (r["status"], r.get("reason")) for r in out["results"]}
    assert st["A"][0] == "ok" and st["B"] == ("skipped", md.REASON_TIME_BUDGET)
