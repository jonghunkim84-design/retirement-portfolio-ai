"""/decision-engine/run 의 market_input 확장 테스트 (지시서 04 단계 E) — 기존 로그 형식 호환.

실행: backend/ 디렉터리에서 `pytest tests/test_market_input_api.py -v`
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.test_decision_api import db, client, run  # noqa: F401  (픽스처 재사용)


def test_market_input_legacy_shape_unchanged(client):
    r = run(client, market_input={"drawdown": 0.3})
    assert r["inputs_snapshot"]["market_input"] == {"index_name": None, "drawdown": 0.3}     # 새 항목은 값이 없으면 남기지 않음
    r = run(client, market_input={"index_name": "KOSPI", "drawdown": 0.1})
    assert r["inputs_snapshot"]["market_input"] == {"index_name": "KOSPI", "drawdown": 0.1}


def test_market_input_manual_source_kept_and_extras_validated(client):
    r = run(client, market_input={"drawdown": 0.2, "source": "manual"})
    assert r["inputs_snapshot"]["market_input"]["source"] == "manual"
    bad = [{"drawdown": 0.2, "source": "robot"}, {"drawdown": 0.2, "lookback_days": 10},
           {"drawdown": 0.2, "components": [{"region": "미국", "series_code": "US500", "drawdown": 0.1, "typo": 1}]},
           {"drawdown": 0.2, "excluded_share": 1.5}, {"drawdown": 0.2, "extra": 1}]
    for mi in bad:
        assert client.post("/decision-engine/run", json={"market_input": mi}).status_code == 422, mi




def test_auto_source_with_components_kept_in_snapshot_and_engine_reads_only_drawdown(client):
    mi = {"index_name": "가중 하락률(3버킷 지역 가중)", "drawdown": 0.2, "source": "auto", "lookback_days": 365,
          "data_date": "2026-09-18", "unreliable": False, "excluded_share": 0.1,
          "components": [{"region": "미국", "series_code": "US500", "drawdown": 0.2, "share": 0.9, "is_proxy": False}]}
    r = run(client, market_input=mi)
    assert r["inputs_snapshot"]["market_input"] == mi
    assert r["regime"]["drawdown"] == 0.2 and r["regime"]["status"] == "downturn"
