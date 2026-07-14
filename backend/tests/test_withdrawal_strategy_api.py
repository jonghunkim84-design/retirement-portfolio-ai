"""인출 순서 최적화 라우트 스모크 테스트 (DB 모킹).

실행: backend/ 디렉터리에서 `pytest tests/test_withdrawal_strategy_api.py -v`
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import routers.withdrawal_strategy as ws


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *a, **k):  return self
    def in_(self, *a, **k):     return self
    def gte(self, *a, **k):     return self
    def lte(self, *a, **k):     return self
    def order(self, *a, **k):   return self
    def eq(self, *a, **k):      return self

    def execute(self):
        class R:  # noqa
            pass
        r = R()
        r.data = self._rows
        return r


class _FakeSupabase:
    def __init__(self, tables):
        self._tables = tables

    def table(self, name):
        return _FakeQuery(self._tables.get(name, []))


def test_summary_route_smoke(monkeypatch):
    assets = [
        {"tax_account_type": "regular",            "current_value": 200_000_000, "investment_amount": 180_000_000},
        {"tax_account_type": "isa",                "current_value": 50_000_000,  "investment_amount": 40_000_000},
        {"tax_account_type": "retirement_pension", "current_value": 100_000_000, "investment_amount": 100_000_000},
        {"tax_account_type": "pension_savings",    "current_value": 80_000_000,  "investment_amount": 70_000_000},
        {"tax_account_type": None,                 "current_value": 10_000_000,  "investment_amount": 10_000_000},
    ]
    config = {
        "user": {"birth_year": 1960, "monthly_expense": 5_000_000},
        "pension_plan": {},
        "income": {"national_pension": {"start_date": "2023-01", "base_amount": 1_000_000}},
        "inflation": {"assumed_rate": 0.025},
    }

    monkeypatch.setattr(ws, "supabase", _FakeSupabase({
        "withdrawals": [],
        "income_log":  [{"amount": 4_000_000}, {"amount": 3_000_000}],
    }))
    monkeypatch.setattr(ws, "get_config", lambda: config)
    monkeypatch.setattr(ws, "get_active_assets", lambda: assets)

    res = ws.get_strategy_summary(annual_need=None, property_tax_base=20_000, earned_income=0)

    # 잔액 집계: 미분류 1,000만은 일반계좌로 합산
    assert res["balances"]["regular"] == 210_000_000
    assert res["balances"]["isa"] == 50_000_000

    # 기본 필요 인출액 = 연 생활비 6,000만 − 국민연금 (양수)
    assert 0 < res["inputs"]["annual_need"] < 60_000_000

    # 66세 → 5.5%
    assert res["inputs"]["age"] == 66
    assert res["inputs"]["age_rate_pct"] == 5.5

    # 시나리오 3개, 최적 플래그 정확히 1개 이상, 권장이 최적이어야 함
    assert len(res["scenarios"]) == 3
    best = [s for s in res["scenarios"] if s["is_best"]]
    assert best and best[0]["id"] == "recommended"

    # 연금 계획 미설정 + 미분류 자산 경고 포함
    joined = " ".join(res["warnings"])
    assert "미분류" in joined or "미설정" in joined

    # 사다리 풀 7종
    assert len(res["pools"]) == 7
