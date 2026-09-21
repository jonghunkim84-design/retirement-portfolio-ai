"""
시장 노출도·시나리오 계산(market_exposure) 테스트 — 네트워크·운영 DB 없이 고정 as_of 로 검증.

실행: backend/ 디렉터리에서 `pytest tests/test_market_exposure.py -v`
"""
import inspect
import sys
import os
from datetime import date, timedelta

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import market_exposure as mx
from withdrawal_check import compute_withdrawal_check

AS_OF = date(2026, 9, 18)

RULES = {
    "R-01": {"enabled": True, "parameters": {"min_years": 2, "target_years": 3}},
    "R-02": {"enabled": True, "parameters": {"target_years": 5}},
    "R-05": {"enabled": True, "parameters": {"upper_multiplier": 1.2, "cut_ratio": 0.1}},
    "R-06": {"enabled": True, "parameters": {"lower_multiplier": 0.8, "raise_ratio": 0.1}},
}


def A(id, typ, value, name=None, maturity=None, active=True):
    return {"id": id, "asset_name": name or f"{typ}{id}", "asset_type": typ, "current_value": value,
            "is_active": active, "maturity_date": maturity, "account_name": None}


def P(holding_id, **kw):
    return {"holding_id": holding_id, "bucket": None, "currency": "KRW", "fx_hedged": False, **kw}


def daily(start, end, fn):
    out, d, i = [], start, 0
    while d <= end:
        out.append({"obs_date": d.isoformat(), "value": fn(i, d), "flag": None, "source": "fdr"})
        d += timedelta(days=1)
        i += 1
    return out


SER = {
    "KS11": {"code": "KS11", "name": "KOSPI", "category": "equity_index", "frequency": "daily", "is_proxy": False},
    "US500": {"code": "US500", "name": "S&P 500", "category": "equity_index", "frequency": "daily", "is_proxy": False},
    "EEM": {"code": "EEM", "name": "EEM", "category": "etf_proxy", "frequency": "daily", "is_proxy": True},
    "KR_10Y": {"code": "KR_10Y", "name": "국고채 10년", "category": "rate", "frequency": "daily", "is_proxy": False},
    "US10Y": {"code": "US10Y", "name": "미국 10년", "category": "rate", "frequency": "daily", "is_proxy": False},
    "USD_KRW": {"code": "USD_KRW", "name": "원/달러", "category": "fx", "frequency": "daily", "is_proxy": False},
    "KR_CPI": {"code": "KR_CPI", "name": "CPI", "category": "cpi", "frequency": "monthly", "is_proxy": False},
}
BENCH = {"한국": "KS11", "미국": "US500", "신흥국": "EEM"}


def flat_obs(value=100.0, start=date(2025, 1, 1), end=AS_OF):
    return daily(start, end, lambda i, d: value)


# ═══ 하락률 ═══════════════════════════════════════════════════════════════

def test_drawdown_peak_today_is_zero():
    obs = daily(date(2025, 9, 1), AS_OF, lambda i, d: 100 + i)               # 계속 상승 → 최신이 고점
    r = mx.compute_drawdown(SER["KS11"], obs, AS_OF, 365)
    assert r["value"] == 0.0 and r["peak_date"] == AS_OF.isoformat() and r["reason"] is None


def test_drawdown_basic_value_and_peak_date():
    obs = daily(date(2025, 9, 1), AS_OF, lambda i, d: 120.0 if d == date(2026, 3, 1) else (90.0 if d == AS_OF else 100.0))
    r = mx.compute_drawdown(SER["KS11"], obs, AS_OF, 365)
    assert r["value"] == pytest.approx(1 - 90 / 120) and r["peak_date"] == "2026-03-01"


def test_drawdown_ignores_peak_outside_lookback():
    obs = daily(date(2024, 1, 1), AS_OF, lambda i, d: 200.0 if d == date(2025, 6, 1) else 100.0)
    r = mx.compute_drawdown(SER["KS11"], obs, AS_OF, 365)                     # 2025-06-01 은 기간 밖
    assert r["value"] == 0.0 and r["peak_value"] == 100.0
    r2 = mx.compute_drawdown(SER["KS11"], obs, AS_OF, 600)                    # 기간을 넓히면 포함
    assert r2["value"] == pytest.approx(0.5)


def test_drawdown_window_boundary_inclusive_at_start_day():
    start = AS_OF - timedelta(days=365)
    obs = daily(start - timedelta(days=5), AS_OF, lambda i, d: 150.0 if d == start else 100.0)
    assert mx.compute_drawdown(SER["KS11"], obs, AS_OF, 365)["peak_value"] == 150.0     # 시작일 당일은 포함
    obs2 = daily(start - timedelta(days=5), AS_OF, lambda i, d: 150.0 if d == start - timedelta(days=1) else 100.0)
    assert mx.compute_drawdown(SER["KS11"], obs2, AS_OF, 365)["peak_value"] == 100.0    # 전날은 제외


def test_drawdown_uses_only_data_up_to_as_of():
    obs = daily(date(2025, 9, 1), AS_OF + timedelta(days=5), lambda i, d: 1.0 if d > AS_OF else 100.0)
    assert mx.compute_drawdown(SER["KS11"], obs, AS_OF, 365)["latest_value"] == 100.0


def test_drawdown_no_data_insufficient_and_stale():
    assert mx.compute_drawdown(SER["KS11"], [], AS_OF, 365)["reason"] == "no_data"
    short = daily(date(2026, 9, 1), AS_OF, lambda i, d: 100.0)                # 기간 시작에서 너무 멀다
    assert mx.compute_drawdown(SER["KS11"], short, AS_OF, 365)["reason"] == "insufficient_history"
    old = daily(date(2025, 9, 1), AS_OF - timedelta(days=7), lambda i, d: 100.0)
    r = mx.compute_drawdown(SER["KS11"], old, AS_OF, 365)
    assert r["stale"] is True and r["value"] is None and r["reason"] == "stale"
    fresh = daily(date(2025, 9, 1), AS_OF - timedelta(days=6), lambda i, d: 100.0)
    assert mx.compute_drawdown(SER["KS11"], fresh, AS_OF, 365)["stale"] is False    # 7일 미만은 정상


def test_drawdown_reports_flagged_dates_but_still_uses_them():
    obs = flat_obs(100.0, date(2025, 9, 1))
    obs[-1] = {**obs[-1], "value": 80.0, "flag": "jump_suspect"}
    r = mx.compute_drawdown(SER["KS11"], obs, AS_OF, 365)
    assert r["value"] == pytest.approx(0.2) and r["flagged_dates"] == [AS_OF.isoformat()]


def _flagged(obs, date_str, value):
    return [({**o, "value": value, "flag": "jump_suspect"} if o["obs_date"] == date_str else o) for o in obs]


def test_flagged_observation_is_excluded_from_peak():
    base = daily(date(2025, 9, 1), AS_OF, lambda i, d: 100.0 if d < AS_OF else 90.0)
    spike = _flagged(base, "2026-03-01", 150.0)                               # 이상치가 최고값
    r = mx.compute_drawdown(SER["KS11"], spike, AS_OF, 365)
    assert r["peak_value"] == 100.0 and r["value"] == pytest.approx(0.10)       # 150 이 아니라 100 이 고점
    assert r["excluded_flagged"] == 1 and r["flagged_dates"] == ["2026-03-01"]
    unflagged = [{**o, "value": 150.0} if o["obs_date"] == "2026-03-01" else o for o in base]
    assert mx.compute_drawdown(SER["KS11"], unflagged, AS_OF, 365)["value"] == pytest.approx(1 - 90 / 150)   # 플래그가 없으면 고점으로 인정


def test_flagged_outside_lookback_is_not_counted():
    base = daily(date(2024, 1, 1), AS_OF, lambda i, d: 100.0)
    r = mx.compute_drawdown(SER["KS11"], _flagged(base, "2025-01-01", 500.0), AS_OF, 365)
    assert r["excluded_flagged"] == 0 and r["flagged_dates"] == []


def test_flagged_latest_is_still_used_as_latest_and_in_changes():
    base = daily(date(2025, 9, 1), AS_OF, lambda i, d: 100.0)
    obs = _flagged(base, AS_OF.isoformat(), 70.0)                              # 최신값이 이상치(급락)
    r = mx.compute_drawdown(SER["KS11"], obs, AS_OF, 365)
    assert r["latest_value"] == 70.0 and r["value"] == pytest.approx(0.30)     # 최신값에는 포함
    s = mx.summarize_series(SER["KS11"], obs, AS_OF)
    assert s["latest_value"] == 70.0 and s["latest_flag"] == "jump_suspect"
    assert s["change_1m"]["value"] == pytest.approx(-0.30)                     # 변화율에도 포함


def test_flagged_high_latest_clamps_to_zero_and_all_flagged_is_insufficient():
    base = daily(date(2025, 9, 1), AS_OF, lambda i, d: 100.0)
    assert mx.compute_drawdown(SER["KS11"], _flagged(base, AS_OF.isoformat(), 130.0), AS_OF, 365)["value"] == 0.0
    all_flagged = [{**o, "flag": "jump_suspect"} for o in base]
    r = mx.compute_drawdown(SER["KS11"], all_flagged, AS_OF, 365)
    assert r["value"] is None and r["reason"] == "insufficient_history" and r["excluded_flagged"] == sum(1 for o in base if o["obs_date"] >= r["window_start"])   # 기간 안의 이상치만 센다


def test_weighted_drawdown_excludes_flagged_peak_and_reports_count_per_region():
    obs = {**OBS, "US500": _flagged(OBS["US500"], "2026-03-01", 400.0)}          # 미국 지수에 이상치 고점
    r = wd([A(1, "equity", 600), A(2, "equity", 400)], [P(1, region="미국"), P(2, region="한국")], obs=obs)
    by = {x["region"]: x for x in r["regions"]}
    assert by["미국"]["drawdown"] == pytest.approx(0.20) and by["미국"]["excluded_flagged"] == 1
    assert by["한국"]["excluded_flagged"] == 0
    assert r["weighted_drawdown"] == pytest.approx((600 * 0.20 + 400 * 0.10) / 1000)


def test_monthly_stale_uses_month_end_and_60_days():
    obs = [{"obs_date": "2026-08-01", "value": 120.0}, {"obs_date": "2025-08-01", "value": 116.0}]
    s = mx.summarize_series(SER["KR_CPI"], obs, AS_OF)
    assert s["stale"] is False and s["yoy"] == pytest.approx(120 / 116 - 1)
    assert mx.summarize_series(SER["KR_CPI"], obs, date(2026, 10, 29))["stale"] is False    # 8/31 + 59일
    assert mx.summarize_series(SER["KR_CPI"], obs, date(2026, 10, 30))["stale"] is True     # 60일 이상


def test_summary_changes_rate_in_pp_and_index_in_ratio():
    rate = daily(date(2026, 1, 1), AS_OF, lambda i, d: 3.0 if d <= date(2026, 8, 18) else 3.3)
    s = mx.summarize_series(SER["KR_10Y"], rate, AS_OF)
    assert s["change_1m"]["unit"] == "pp" and s["change_1m"]["value"] == pytest.approx(0.3)
    idx = daily(date(2026, 1, 1), AS_OF, lambda i, d: 100.0 if d <= date(2026, 8, 18) else 110.0)
    s = mx.summarize_series(SER["KS11"], idx, AS_OF)
    assert s["change_1m"]["unit"] == "ratio" and s["change_1m"]["value"] == pytest.approx(0.10)
    assert s["change_3m"]["value"] is None or s["change_3m"]["unit"] == "ratio"


# ═══ 지역 매칭 (trim) ══════════════════════════════════════════════════════

def test_resolve_region_trims_and_reports_original_on_failure():
    assert mx.resolve_region("  미국 ", BENCH)["series_code"] == "US500"
    assert mx.resolve_region("　한국 ", BENCH)["series_code"] == "KS11"      # 전각·NBSP 공백
    miss = mx.resolve_region(" 인도 ", BENCH)
    assert miss["series_code"] is None and miss["reason"] == "region_no_benchmark"
    assert miss["region"] == "인도" and miss["original"] == " 인도 "
    assert mx.resolve_region("   ", BENCH)["reason"] == "region_missing"
    assert mx.resolve_region(None, BENCH)["reason"] == "region_missing"


# ═══ 가중 하락률 ═══════════════════════════════════════════════════════════

def obs_dd(dd):
    """as_of 에서 고점 대비 dd 만큼 하락한 1년 관측값."""
    return daily(date(2025, 9, 1), AS_OF, lambda i, d: 100.0 if d < AS_OF else 100.0 * (1 - dd))


OBS = {"KS11": obs_dd(0.10), "US500": obs_dd(0.20), "EEM": obs_dd(0.30)}


def wd(assets, profiles, obs=None, benchmarks=None, lookback=365):
    return mx.compute_weighted_drawdown(as_of=AS_OF, assets=assets, profiles=profiles,
                                        benchmarks=BENCH if benchmarks is None else benchmarks,
                                        series=SER, observations=OBS if obs is None else obs, lookback_days=lookback)


def test_weighted_drawdown_weights_by_value():
    assets = [A(1, "equity", 600), A(2, "equity", 400), A(3, "cash", 9999)]
    profs = [P(1, region="미국"), P(2, region=" 한국 ")]
    r = wd(assets, profs)
    assert r["weighted_drawdown"] == pytest.approx((600 * 0.20 + 400 * 0.10) / 1000)
    assert r["excluded_value"] == 0 and r["unreliable"] is False
    assert {x["region"]: x["share_of_bucket3"] for x in r["regions"]} == {"미국": 0.6, "한국": 0.4}


def test_weighted_drawdown_excludes_missing_region_and_unmapped_with_original_value():
    assets = [A(1, "equity", 600), A(2, "equity", 200), A(3, "equity", 100), A(4, "income", 100)]
    profs = [P(1, region="미국"), P(2, region=" 인도 "), P(3, region=None)]
    r = wd(assets, profs)                                    # 자산 4 는 프로필 없음 → 지역 미입력
    assert r["weighted_drawdown"] == pytest.approx(0.20)
    reasons = {g["reason"]: g for g in r["excluded_by_reason"]}
    assert reasons["region_no_benchmark"]["regions"] == [" 인도 "]        # 원래 입력값 표시
    assert reasons["region_missing"]["count"] == 2
    assert r["excluded_share"] == pytest.approx(0.4)


def test_weighted_drawdown_unreliable_only_when_excluded_over_half():
    profs = [P(1, region="미국")]
    over = wd([A(1, "equity", 490), A(2, "equity", 510)], profs)                 # 제외 51%
    assert over["unreliable"] is True and over["weighted_drawdown"] == pytest.approx(0.20)
    exact = wd([A(1, "equity", 500), A(2, "equity", 500)], profs)                # 정확히 50% 는 아님(초과만)
    assert exact["excluded_share"] == 0.5 and exact["unreliable"] is False


def test_weighted_drawdown_stale_series_excluded_and_no_benchmark_row():
    stale = {**OBS, "US500": daily(date(2025, 9, 1), AS_OF - timedelta(days=10), lambda i, d: 100.0)}
    r = wd([A(1, "equity", 500), A(2, "equity", 500)], [P(1, region="미국"), P(2, region="한국")], obs=stale)
    assert r["weighted_drawdown"] == pytest.approx(0.10)
    assert [g["reason"] for g in r["excluded_by_reason"]] == ["stale"]
    r = wd([A(1, "equity", 500)], [P(1, region="미국")], benchmarks={})
    assert r["weighted_drawdown"] is None and r["reasons"][0]["code"] == "no_included_assets"


def test_weighted_drawdown_uses_effective_bucket_override_and_skips_inactive():
    assets = [A(1, "bond", 500), A(2, "equity", 500), A(3, "equity", 500, active=False)]
    profs = [P(1, region="한국", bucket=3), P(2, region="미국", bucket=2)]     # 채권이 3버킷으로, 주식이 2버킷으로
    r = wd(assets, profs)
    assert r["bucket3_value"] == 500 and r["weighted_drawdown"] == pytest.approx(0.10)


def test_weighted_drawdown_no_bucket3():
    r = wd([A(1, "cash", 100)], [])
    assert r["weighted_drawdown"] is None and r["reasons"][0]["code"] == "no_bucket3_assets"


# ═══ 노출도 ═══════════════════════════════════════════════════════════════

def expo(assets, profiles, bench=None):
    return mx.compute_exposure(as_of=AS_OF, assets=assets, profiles=profiles, benchmarks=BENCH if bench is None else bench)


def rate_row(e, aid):
    return next(r for r in e["rate"]["rows"] if r["asset_id"] == aid)


def test_exposure_bond_duration_input():
    e = expo([A(1, "bond", 1_000_000)], [P(1, bond_modified_duration=5.0)])
    r = rate_row(e, 1)
    assert r["price_change_per_1pp"] == pytest.approx(-0.05 * 1_000_000) and r["basis"] == "input"


def test_exposure_bond_maturity_proxy_marked_assumed():
    e = expo([A(1, "bond", 1_000_000, maturity="2029-09-18")], [])              # 잔존 3년
    r = rate_row(e, 1)
    assert r["basis"] == "assumed_maturity" and r["duration"] == pytest.approx(3.0, abs=0.01)
    assert e["rate"]["assumed_count"] == 1


def test_exposure_bond_no_duration_no_maturity_and_matured_excluded():
    e = expo([A(1, "bond", 100), A(2, "bond", 200, maturity="2026-09-18"), A(3, "bond", 300, maturity="2026-09-19")], [])
    reasons = {x["asset_id"]: x["reason"] for x in e["rate"]["excluded"]}
    assert reasons[1] == "no_duration_no_maturity" and reasons[2] == "maturity_passed"     # 만기일 당일=경과
    assert rate_row(e, 3)["basis"] == "assumed_maturity"                                    # 내일 만기는 잔존 1일
    assert e["completeness"]["rate_excluded"]["value"] == 300


def test_exposure_floating_bond_and_cash_have_interest_only():
    e = expo([A(1, "bond", 1_000_000), A(2, "cash", 2_000_000)], [P(1, bond_rate_type="floating")])
    b, c = rate_row(e, 1), rate_row(e, 2)
    assert b["price_change_per_1pp"] == 0 and b["interest_change_per_1pp"] == pytest.approx(10_000)
    assert c["price_change_per_1pp"] == 0 and c["interest_change_per_1pp"] == pytest.approx(20_000)
    assert e["rate"]["interest_change_per_1pp"] == pytest.approx(30_000)


def test_exposure_tdf_splits_bond_part_and_equity_part():
    e = expo([A(1, "tdf", 1_000_000)], [P(1, equity_share_pct=0.6, bond_modified_duration=4.0, region="글로벌")])
    r = rate_row(e, 1)
    assert r["amount"] == pytest.approx(400_000) and r["price_change_per_1pp"] == pytest.approx(-0.04 * 400_000)
    assert e["equity"]["rows"][0]["amount"] == pytest.approx(600_000)


def test_exposure_tdf_missing_share_or_duration_excluded_with_reason():
    e = expo([A(1, "fund", 100), A(2, "fund", 200)], [P(2, equity_share_pct=0.5)])
    assert {x["asset_id"]: x["reason"] for x in e["rate"]["excluded"]} == {1: "no_equity_share", 2: "no_duration"}
    assert [x["reason"] for x in e["equity"]["excluded"]] == ["no_equity_share"]


def test_exposure_income_sensitivity_and_missing():
    e = expo([A(1, "income", 1_000_000), A(2, "income", 500_000)], [P(1, rate_sensitivity=6.0)])
    assert rate_row(e, 1)["price_change_per_1pp"] == pytest.approx(-60_000) and rate_row(e, 1)["basis"] == "assumed_sensitivity"
    assert e["rate"]["excluded"][0]["reason"] == "no_rate_sensitivity"


def test_exposure_equity_by_region_with_unknown_and_trim():
    e = expo([A(1, "equity", 600), A(2, "equity", 300), A(3, "equity", 100), A(4, "cash", 1000)],
             [P(1, region=" 미국 "), P(2, region="인도")])
    by = {g["region"]: g for g in e["equity"]["by_region"]}
    assert by["미국"]["amount"] == 600 and by["미국"]["has_benchmark"] is True and by["미국"]["share_of_equity"] == pytest.approx(0.6)
    assert by["인도"]["has_benchmark"] is False and by[None]["amount"] == 100
    assert e["equity"]["unknown_region_amount"] == 100


def test_exposure_fx_unhedged_by_currency_hedged_excluded_and_unclear_listed():
    assets = [A(1, "equity", 100), A(2, "equity", 200), A(3, "equity", 300), A(4, "equity", 400)]
    profs = [P(1, currency="USD"), P(2, currency="USD", fx_hedged=True), P(3, currency="EUR"),
             P(4, region="미국")]                                                          # 통화 KRW 인 해외 지역 자산
    e = expo(assets, profs)
    assert e["fx"]["by_currency"] == {"USD": 100, "EUR": 300} and e["fx"]["hedged_value"] == 200
    assert e["fx"]["unclear"][0]["reason"] == "foreign_region_currency_krw" and e["fx"]["unclear"][0]["value"] == 400


def test_exposure_totals_by_bucket_and_inactive_skipped():
    e = expo([A(1, "bond", 1_000_000, maturity="2029-09-18"), A(2, "bond", 1_000_000, active=False)], [])
    assert e["total_assets"] == 1_000_000
    assert e["rate"]["price_change_per_1pp_by_bucket"][2] < 0 and e["rate"]["price_change_per_1pp_by_bucket"][1] == 0


# ═══ 시나리오 ═════════════════════════════════════════════════════════════

CASH = [
    {"item_type": "expense_essential", "name": "필수", "monthly_amount": 2_000_000, "inflation_linked": True,
     "start_date": None, "end_date": None},
    {"item_type": "expense_discretionary", "name": "선택", "monthly_amount": 1_000_000, "inflation_linked": False,
     "start_date": None, "end_date": None},
]
SC_ASSETS = [A(1, "cash", 40_000_000), A(2, "bond", 60_000_000, maturity="2031-09-18"),
             A(3, "equity", 50_000_000), A(4, "equity", 30_000_000), A(5, "equity", 20_000_000)]
SC_PROFS = [P(2, bond_modified_duration=5.0), P(3, region="미국"), P(4, region="한국"),
            P(5, region="미국", currency="USD")]


def scen(kind, params, assets=None, profiles=None, cashflow=None, **kw):
    return mx.compute_scenario(as_of=AS_OF, kind=kind, params=params, assets=assets or SC_ASSETS,
                               profiles=SC_PROFS if profiles is None else profiles,
                               cashflow_items=CASH if cashflow is None else cashflow, rules=RULES,
                               benchmarks=BENCH, **kw)


def test_scenario_rate_up_and_down_symmetric_linear():
    up = scen("rate", {"delta_pp": 1.0})
    assert up["change"]["total"] == pytest.approx(-0.05 * 60_000_000)
    assert up["change"]["by_bucket"]["2"] == pytest.approx(-3_000_000)
    down = scen("rate", {"delta_pp": -1.0})
    assert down["change"]["total"] == pytest.approx(3_000_000)
    assert up["need_note"]["interest_change_per_year_ref"] == pytest.approx(0.01 * 40_000_000)   # 현금 이자 참고값


def test_scenario_equity_uniform_and_by_region():
    u = scen("equity", {"mode": "uniform", "pct": 0.2})
    assert u["change"]["total"] == pytest.approx(-0.2 * 100_000_000)
    r = scen("equity", {"mode": "by_region", "by_region": {"미국": 0.3, "한국": 0.1}})
    assert r["change"]["total"] == pytest.approx(-(0.3 * 70_000_000 + 0.1 * 30_000_000))
    assert r["change"]["by_bucket"]["3"] == pytest.approx(r["change"]["total"])
    d = scen("equity", {"mode": "by_region", "by_region": {" 미국 ": 0.5}, "default_pct": 0.1})     # 키 공백 정규화 + 기본값
    assert d["change"]["total"] == pytest.approx(-(0.5 * 70_000_000 + 0.1 * 30_000_000))


def test_scenario_fx_only_unhedged_matching_currency_and_zero_equity_change():
    down = scen("fx", {"currency": "USD", "pct": -0.10})
    assert down["change"]["total"] == pytest.approx(-2_000_000)
    assert [x["asset_id"] for x in down["change"]["by_asset"]] == [5]               # 외화 자산만, 주가 변화는 0
    up = scen("fx", {"currency": "USD", "pct": 0.10})
    assert up["change"]["total"] == pytest.approx(2_000_000)
    hedged = scen("fx", {"currency": "USD", "pct": -0.1}, profiles=SC_PROFS[:3] + [P(5, currency="USD", fx_hedged=True)])
    assert hedged["change"]["total"] == 0 and hedged["reasons"][0]["code"] == "no_affected_assets"


def test_scenario_inflation_raises_only_linked_expense_and_keeps_assets():
    s = scen("inflation", {"delta_pp": 2.0})
    assert s["change"]["total"] == 0
    assert s["after"]["annual_need_total"] == pytest.approx(before_need() + 2_000_000 * 12 * 0.02)   # 필수(연동)만 +2%
    assert s["after"]["annual_need_essential"] == pytest.approx(2_000_000 * 12 * 1.02)
    assert s["need_note"]["linked_expense_items"] == 1
    none_linked = scen("inflation", {"delta_pp": 2.0}, cashflow=[{**CASH[0], "inflation_linked": False}, CASH[1]])
    assert none_linked["reasons"][0]["code"] == "no_inflation_linked_items"
    assert none_linked["after"]["annual_need_total"] == none_linked["before"]["annual_need_total"]


def before_need():
    return compute_withdrawal_check(as_of=AS_OF, assets=SC_ASSETS, profiles=SC_PROFS, cashflow_items=CASH,
                                    baseline=None, rules=RULES)["net_need"]["annual_total"]


def test_scenario_coverage_years_and_r01_state_change():
    # 1버킷(현금) 4천만 / 연 필요 3,600만 = 1.11년 → R-01 below_min(2년) 이므로 상태 변화 없음.
    base = scen("equity", {"mode": "uniform", "pct": 0.2})
    assert base["before"]["buckets"][1]["years_total"] == pytest.approx(40_000_000 / 36_000_000)
    # 물가 충격: 필요액 증가 → 연수 감소
    infl = scen("inflation", {"delta_pp": 20.0})
    assert infl["after"]["buckets"][1]["years_total"] < infl["before"]["buckets"][1]["years_total"]
    # 상태 변화가 생기는 구성: 1버킷 7,600만(2.11년, target 3년 미만이라 below_target) → 물가 +9.5%p 로 min(2년) 아래
    assets = [A(1, "cash", 76_000_000), A(2, "equity", 10_000_000)]
    ok = scen("inflation", {"delta_pp": 1.0}, assets=assets, profiles=[])
    assert ok["r01"] == {"before": "below_target", "after": "below_target", "changed": False}
    worse = scen("inflation", {"delta_pp": 20.0}, assets=assets, profiles=[])
    assert worse["r01"]["before"] == "below_target" and worse["r01"]["after"] == "below_min" and worse["r01"]["changed"] is True


def test_scenario_before_equals_direct_withdrawal_check_and_essential_years_present():
    s = scen("rate", {"delta_pp": 1.0})
    direct = compute_withdrawal_check(as_of=AS_OF, assets=SC_ASSETS, profiles=SC_PROFS, cashflow_items=CASH,
                                      baseline=None, rules=RULES)
    for b in (1, 2, 3):
        d = next(x for x in direct["buckets"] if x["bucket"] == b)
        assert s["before"]["buckets"][b]["years_total"] == d["years_total"]
        assert s["before"]["buckets"][b]["years_essential"] == d["years_essential"]
    assert s["before"]["r01_status"] == direct["rules"]["R-01"]["status"]
    assert s["after"]["buckets"][2]["value"] == pytest.approx(57_000_000)


def test_scenario_reports_essential_years_before_income_deduction():
    # 필수생활비 총액 연 2,400만 원 기준(정기수입 차감 전): 1버킷 4,000만 원 = 1.667년
    s = scen("rate", {"delta_pp": 1.0})
    assert s["before"]["annual_need_essential_gross"] == 24_000_000
    assert s["before"]["buckets"][1]["years_essential_gross"] == pytest.approx(40_000_000 / 24_000_000)
    # 정기수입이 필수생활비 이상이어도 차감 전 기준은 계산된다 (차감 후 기준은 None)
    income = {"item_type": "income_regular", "name": "연금", "monthly_amount": 2_500_000, "start_date": None, "end_date": None}
    s2 = scen("rate", {"delta_pp": 1.0}, cashflow=CASH + [income])
    assert s2["before"]["buckets"][1]["years_essential"] is None
    assert s2["before"]["buckets"][1]["years_essential_gross"] == pytest.approx(40_000_000 / 24_000_000)
    # 정기수입이 필수를 거의 충당해 순 필요액이 아주 작아도 차감 전 기준은 안정적이다
    almost = {**income, "monthly_amount": 1_990_000}
    s3 = scen("rate", {"delta_pp": 1.0}, cashflow=CASH + [almost])
    assert s3["before"]["buckets"][1]["years_essential"] > 300                  # 순 기준은 폭주
    assert s3["before"]["buckets"][1]["years_essential_gross"] == pytest.approx(40_000_000 / 24_000_000)
    # 필수생활비 항목이 없으면 None
    s4 = scen("rate", {"delta_pp": 1.0}, cashflow=[CASH[1]])
    assert s4["before"]["buckets"][1]["years_essential_gross"] is None


def test_scenario_inflation_lowers_gross_essential_years():
    s = scen("inflation", {"delta_pp": 2.0})
    b, a = s["before"]["buckets"][1]["years_essential_gross"], s["after"]["buckets"][1]["years_essential_gross"]
    assert a == pytest.approx(b / 1.02)                                         # 연동 필수 항목이 2% 늘어 연수가 줄어든다


def test_scenario_asset_value_never_negative():
    s = scen("equity", {"mode": "uniform", "pct": 1.0})
    assert all(x["after"] >= 0 for x in s["change"]["by_asset"])


def test_scenario_excluded_assets_reported():
    s = scen("rate", {"delta_pp": 1.0}, assets=SC_ASSETS + [A(9, "bond", 1_000_000)])
    assert s["excluded"] == [{"asset_id": 9, "asset_name": "bond9", "value": 1_000_000, "reason": "no_duration_no_maturity"}]


@pytest.mark.parametrize("kind,params,code", [
    ("rate", {"delta_pp": 0}, "delta_pp_out_of_range"), ("rate", {"delta_pp": 11}, "delta_pp_out_of_range"),
    ("rate", {}, "invalid_params"), ("equity", {"mode": "uniform", "pct": 0}, "pct_out_of_range"),
    ("equity", {"mode": "uniform", "pct": 1.01}, "pct_out_of_range"), ("equity", {"mode": "x"}, "unknown_mode"),
    ("equity", {"mode": "by_region", "by_region": {}}, "pct_out_of_range"),
    ("fx", {"pct": 0.6}, "pct_out_of_range"), ("inflation", {"delta_pp": -1}, "delta_pp_out_of_range"),
    ("shock", {}, "unknown_kind"),
])
def test_scenario_validation_errors(kind, params, code):
    with pytest.raises(mx.ScenarioParamError) as e:
        mx.validate_scenario(kind, params)
    assert e.value.args[0] == code


def test_scenario_validation_boundaries_are_inclusive():
    assert mx.validate_scenario("fx", {"currency": "usd", "pct": 0.5}) == {"currency": "USD", "pct": 0.5}
    assert mx.validate_scenario("fx", {"pct": -0.5})["pct"] == -0.5
    assert mx.validate_scenario("rate", {"delta_pp": 10})["delta_pp"] == 10
    assert mx.validate_scenario("equity", {"pct": 1.0})["pct"] == 1.0
    assert mx.validate_scenario("inflation", {"delta_pp": 20})["delta_pp"] == 20


def test_presets_all_valid_and_kinds_covered():
    from scenario_presets import SCENARIO_PRESETS
    assert {p["kind"] for p in SCENARIO_PRESETS} == {"rate", "equity", "fx", "inflation"}
    for p in SCENARIO_PRESETS:
        mx.validate_scenario(p["kind"], p["params"])


# ═══ 신호 → 내 자산 ═════════════════════════════════════════════════════════

def sig_obs(code_changes):
    """지표별 1개월 전 값 → 최신 값 (변화량)."""
    out = {}
    for code, (old, new) in code_changes.items():
        out[code] = daily(date(2026, 1, 1), AS_OF, lambda i, d, o=old, n=new: o if d <= date(2026, 8, 18) else n)
    return out


def impact(assets, profiles, obs, **kw):
    return mx.compute_signal_impact(as_of=AS_OF, assets=assets, profiles=profiles, cashflow_items=CASH, rules=RULES,
                                    series=SER, observations=obs, benchmarks=BENCH, **kw)


def test_signal_impact_domestic_bond_uses_kr_rate_and_foreign_uses_us_rate():
    assets = [A(1, "bond", 100_000_000), A(2, "bond", 100_000_000)]
    profs = [P(1, bond_modified_duration=5.0), P(2, bond_modified_duration=5.0, currency="USD")]
    r = impact(assets, profs, sig_obs({"KR_10Y": (3.0, 3.2), "US10Y": (4.0, 4.4)}))
    by = {s["market"]: s for s in r["signals"] if s["kind"] == "rate"}
    assert by["KR"]["estimated_impact"] == pytest.approx(-0.05 * 100_000_000 * 0.2)
    assert by["US"]["estimated_impact"] == pytest.approx(-0.05 * 100_000_000 * 0.4)
    assert r["total_impact"] == pytest.approx(by["KR"]["estimated_impact"] + by["US"]["estimated_impact"])


def test_signal_impact_missing_kr_rate_is_not_replaced_by_us_rate():
    assets = [A(1, "bond", 100_000_000)]
    r = impact(assets, [P(1, bond_modified_duration=5.0)], sig_obs({"US10Y": (4.0, 5.0)}))
    sig = r["signals"][0]
    assert sig["market"] == "KR" and sig["estimated_impact"] is None and sig["reason"] == "no_data"
    assert r["total_impact"] == 0 and r["excluded"][0]["reason"] == "rate_no_data"
    assert r["after"]["total_assets"] == r["before"]["total_assets"]


def test_signal_impact_unclear_market_excluded_with_reason():
    assets = [A(1, "bond", 100_000_000)]
    profs = [P(1, bond_modified_duration=5.0, region="미국")]                       # 원화 표시 해외 채권
    r = impact(assets, profs, sig_obs({"KR_10Y": (3.0, 3.2), "US10Y": (4.0, 4.4)}))
    assert r["signals"] == [] and r["excluded"][0]["reason"] == "rate_market_unclear"


def test_signal_impact_equity_fx_and_years_effect():
    assets = [A(1, "cash", 50_000_000), A(2, "equity", 100_000_000), A(3, "equity", 50_000_000)]
    profs = [P(2, region="미국"), P(3, region="인도", currency="USD")]
    obs = sig_obs({"US500": (100.0, 90.0), "USD_KRW": (1400.0, 1330.0)})
    r = impact(assets, profs, obs)
    eq = next(s for s in r["signals"] if s["kind"] == "equity" and s["region"] == "미국")
    assert eq["estimated_impact"] == pytest.approx(-10_000_000)
    fx = next(s for s in r["signals"] if s["kind"] == "fx")
    assert fx["estimated_impact"] == pytest.approx(50_000_000 * (1330 / 1400 - 1))
    ex = [e for e in r["excluded"] if e["signal"] == "equity"]
    assert ex[0]["reason"] == "region_no_benchmark" and ex[0]["region"] == "인도"
    assert r["after"]["total_assets"] == pytest.approx(r["before"]["total_assets"] + r["total_impact"])
    assert r["after"]["buckets"][3]["years_total"] < r["before"]["buckets"][3]["years_total"]


def test_signal_impact_stale_series_excluded():
    old = {"KR_10Y": daily(date(2026, 1, 1), AS_OF - timedelta(days=20), lambda i, d: 3.0)}
    r = impact([A(1, "bond", 10_000_000)], [P(1, bond_modified_duration=5.0)], old)
    assert r["signals"][0]["reason"] == "stale" and r["signals"][0]["estimated_impact"] is None


# ═══ 순수성 ═══════════════════════════════════════════════════════════════

def test_module_has_no_today_call_no_io_and_requires_date_as_of():
    src = inspect.getsource(mx)
    for banned in ("date.today(", "datetime.now(", "datetime.today(", "import httpx", "database", "supabase", "requests"):
        assert banned not in src, banned
    with pytest.raises(TypeError):
        mx.compute_exposure(as_of="2026-09-18", assets=[], profiles=[])
    with pytest.raises(TypeError):
        mx.compute_weighted_drawdown(as_of=None, assets=[], profiles=[], benchmarks={}, series={}, observations={})


def test_inputs_are_not_mutated():
    import copy
    assets, profs, cash = copy.deepcopy(SC_ASSETS), copy.deepcopy(SC_PROFS), copy.deepcopy(CASH)
    mx.compute_scenario(as_of=AS_OF, kind="inflation", params={"delta_pp": 2.0}, assets=assets, profiles=profs,
                        cashflow_items=cash, rules=RULES)
    mx.compute_scenario(as_of=AS_OF, kind="equity", params={"mode": "uniform", "pct": 0.2}, assets=assets,
                        profiles=profs, cashflow_items=cash, rules=RULES)
    assert assets == SC_ASSETS and profs == SC_PROFS and cash == CASH
