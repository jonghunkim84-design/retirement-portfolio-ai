"""
연금 계획 가정값 검증 테스트 (4단계 작업 3)

지시서 검증 시나리오 중 백엔드에서 검증 가능한 항목:
- 시나리오 6: 물가상승률 음수 입력 거부 (400)
- 물가상승률 0% 입력 허용 (민감도 확인용)
- 시나리오 7: 목표 수익률 10% 저장 허용 (8% 초과 경고는 프론트 표시)
- 목표 수익률 0~15% 범위 밖 거부, null(미설정) 허용
- 시나리오 4 전제: 4.5% 저장 시 config JSON에 그대로 기록

실행: backend/ 디렉터리에서 `pytest tests/test_assumptions.py -v`
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi import HTTPException

import routers.config as config_router


# ── 페이크 Supabase (user_config 테이블 전용) ──────────────────────

class _FakeTable:
    def __init__(self):
        self.updated = None

    def update(self, payload):
        self.updated = payload
        return self

    def eq(self, col, val):
        return self

    def execute(self):
        return type("R", (), {"data": [{}]})()


class _FakeSupabase:
    def __init__(self):
        self.tables = {}

    def table(self, name):
        self.tables.setdefault(name, _FakeTable())
        return self.tables[name]


@pytest.fixture
def fake_db(monkeypatch):
    db = _FakeSupabase()
    monkeypatch.setattr(config_router, "supabase", db)
    return db


# ── 물가상승률 검증 ────────────────────────────────────────────────

def test_negative_inflation_rejected(fake_db):
    """시나리오 6: 음수 물가상승률은 400 거부"""
    with pytest.raises(HTTPException) as e:
        config_router.update_config({"inflation": {"assumed_rate": -0.01}})
    assert e.value.status_code == 400
    assert fake_db.tables == {}  # 저장 시도 자체가 없어야 함


def test_zero_inflation_allowed(fake_db):
    """시나리오 1 전제: 0% 입력 허용 (민감도 확인 용도)"""
    assert config_router.update_config({"inflation": {"assumed_rate": 0}}) == {"ok": True}


# ── 목표 연수익률 검증 ──────────────────────────────────────────────

def test_target_return_10_saved(fake_db):
    """시나리오 7: 10%는 저장 허용 — 8% 초과 경고는 프론트에서만 표시"""
    assert config_router.update_config({"plan": {"target_annual_return": 10}}) == {"ok": True}


@pytest.mark.parametrize("bad", [-1, -0.1, 15.1, 100])
def test_target_return_out_of_range_rejected(fake_db, bad):
    with pytest.raises(HTTPException) as e:
        config_router.update_config({"plan": {"target_annual_return": bad}})
    assert e.value.status_code == 400


@pytest.mark.parametrize("ok", [0, 8, 15])
def test_target_return_boundary_allowed(fake_db, ok):
    assert config_router.update_config({"plan": {"target_annual_return": ok}}) == {"ok": True}


def test_target_return_null_allowed(fake_db):
    """미설정(null)·plan 키 자체 부재 모두 허용 — 실현 수익률 제안값 폴백"""
    assert config_router.update_config({"plan": {"target_annual_return": None}}) == {"ok": True}
    assert config_router.update_config({}) == {"ok": True}


def test_target_return_45_persisted(fake_db):
    """시나리오 4 전제: 4.5 저장 시 config JSON에 그대로 기록"""
    assert config_router.update_config({"plan": {"target_annual_return": 4.5}}) == {"ok": True}
    saved = fake_db.tables["user_config"].updated["value"]
    assert saved["plan"]["target_annual_return"] == 4.5
