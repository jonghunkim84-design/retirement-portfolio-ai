"""몬테카를로 라우트 스모크 테스트 (DB 모킹).

실행: backend/ 디렉터리에서 `pytest tests/test_simulation_api.py -v`
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import routers.simulation as sim


def test_montecarlo_route_smoke(monkeypatch):
    config = {
        "user": {"birth_year": 1960, "monthly_expense": 3_000_000},
        "inflation": {"assumed_rate": 0.025},
        "income": {"national_pension": {"start_date": "2025-01", "base_amount": 1_000_000}},
        "estate_plan": {"target_amount": 200_000_000},
    }
    assets = [
        {"asset_type": "cash",   "current_value": 200_000_000},
        {"asset_type": "bond",   "current_value": 200_000_000},
        {"asset_type": "equity", "current_value": 200_000_000},
    ]
    monkeypatch.setattr(sim, "get_config", lambda: config)
    monkeypatch.setattr(sim, "get_active_assets", lambda: assets)

    body = sim.MonteCarloIn(return_rate_pct=4.0, runs=300, seed=11)
    res = sim.monte_carlo(body)

    assert res["runs"] == 300
    assert 0 <= res["success_prob"] <= 100
    assert res["estate_success_prob"] is not None
    assert res["estate_success_prob"] <= res["success_prob"]
    # 백분위 순서 보장
    assert res["percentiles"]["p5"][-1] <= res["percentiles"]["p50"][-1] <= res["percentiles"]["p95"][-1]
    # 시그마: 현금 1/3·채권 1/3·주식 1/3 → (0.01+0.05+0.15)/3 = 7.0%
    assert abs(res["assumptions"]["sigma_pct"] - 7.0) < 0.11
    # 연 수 = 2026(66세) ~ 95세
    assert res["ages"][0] == 66 and res["ages"][-1] == 95
