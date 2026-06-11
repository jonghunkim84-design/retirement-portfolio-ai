"""
일일 Cron(시세 갱신 → 만기 비활성화 → 알림) 검증 테스트.

작업지시서 3단계 v2 '작업 3. 검증' 시나리오 5종:
1. Cron 진입점이 시세→만기→알림 순서로 실행 + 메일에 시세 요약 전달
2. 시세 단계 전체 장애 시에도 만기·알림 단계 정상 실행
3. 1종목 조회 실패 시 나머지 종목 정상 갱신 (부분 실패 격리)
4. 티커 없는 자산은 갱신 대상에서 제외
5. 수동 버튼(POST /price/update)이 Cron과 동일 함수 사용

실행: backend/ 디렉터리에서 `pytest tests/test_daily_cron.py -v`
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import notifier
import routers.price as price
from notifier import _price_summary_line


# ── 페이크 Supabase (assets 테이블 전용) ─────────────────────────

class _FakeQuery:
    def __init__(self, store, table_name, mode, payload=None):
        self.store = store
        self.table_name = table_name
        self.mode = mode          # 'select' | 'update'
        self.payload = payload
        self._id = None

    def eq(self, col, val):
        if col == "id":
            self._id = val
        return self

    def execute(self):
        if self.mode == "select":
            return type("R", (), {"data": list(self.store["rows"])})()
        # update
        self.store["updates"].append({"id": self._id, "payload": dict(self.payload)})
        return type("R", (), {"data": []})()


class _FakeTable:
    def __init__(self, store, name):
        self.store = store
        self.name = name

    def select(self, *_):
        return _FakeQuery(self.store, self.name, "select")

    def update(self, payload):
        return _FakeQuery(self.store, self.name, "update", payload)


class FakeSupabase:
    def __init__(self, rows):
        self.store = {"rows": rows, "updates": []}

    def table(self, name):
        return _FakeTable(self.store, name)


def _setup_price(monkeypatch, rows, price_fn):
    fake = FakeSupabase(rows)
    monkeypatch.setattr(price, "supabase", fake)
    monkeypatch.setattr(price, "get_price", price_fn)
    monkeypatch.setattr(price.time, "sleep", lambda *_: None)
    return fake


# ── 시나리오 1: 실행 순서 + 메일에 시세 요약 전달 ──────────────────

def test_scenario1_order_and_summary_in_email(monkeypatch):
    calls = []
    summary = {"updated": 2, "failed": 1,
               "details": [{"asset_name": "○○ETF", "status": "failed"}]}
    captured_alerts = {}

    monkeypatch.setattr("routers.price.run_price_update",
                        lambda: calls.append("price") or summary)
    monkeypatch.setattr(notifier, "auto_deactivate_expired",
                        lambda: calls.append("deactivate") or [])
    monkeypatch.setattr(notifier, "collect_alerts",
                        lambda: calls.append("alerts") or {"maturing": [], "losing": []})
    monkeypatch.setattr(notifier, "collect_pension_alerts", lambda: [])
    monkeypatch.setattr(notifier, "send_alert_email",
                        lambda alerts: captured_alerts.update(alerts) or True)

    result = notifier.run_daily_alert()

    assert calls == ["price", "deactivate", "alerts"], "시세→만기→알림 순서여야 함"
    assert captured_alerts["price_summary"] == summary
    assert result["sent"] is True
    assert result["price_updated"] == 2
    assert result["price_failed"] == 1


# ── 시나리오 2: 시세 전체 장애 → 만기·알림 계속 실행 ───────────────

def test_scenario2_price_failure_isolated(monkeypatch):
    calls = []

    def boom():
        raise RuntimeError("시세 소스 전체 장애")

    monkeypatch.setattr("routers.price.run_price_update", boom)
    monkeypatch.setattr(notifier, "auto_deactivate_expired",
                        lambda: calls.append("deactivate") or [])
    monkeypatch.setattr(notifier, "collect_alerts",
                        lambda: calls.append("alerts") or {"maturing": [], "losing": []})
    monkeypatch.setattr(notifier, "collect_pension_alerts", lambda: [])
    monkeypatch.setattr(notifier, "send_alert_email",
                        lambda alerts: calls.append("send") or True)

    result = notifier.run_daily_alert()

    assert calls == ["deactivate", "alerts", "send"], "시세 장애에도 ②③은 실행되어야 함"
    assert result["sent"] is True
    assert result["price_updated"] is None


# ── 시나리오 3: 1종목 실패 → 나머지 정상 갱신 ─────────────────────

def test_scenario3_partial_failure(monkeypatch):
    rows = [
        {"id": 1, "asset_name": "A_ETF", "ticker": "069500", "quantity": 10, "is_active": True},
        {"id": 2, "asset_name": "B_ETF", "ticker": "420770", "quantity": 5,  "is_active": True},
        {"id": 3, "asset_name": "C_ETF", "ticker": "999999", "quantity": 3,  "is_active": True},
    ]

    def fake_get_price(ticker):
        if ticker == "999999":
            return None, None, "failed"
        return 10_000.0, "2026-06-12", "FDR"

    fake = _setup_price(monkeypatch, rows, fake_get_price)
    result = price.run_price_update()

    assert result["updated"] == 2
    assert result["failed"] == 1
    failed = [d for d in result["details"] if d["status"] == "failed"]
    assert failed[0]["asset_name"] == "C_ETF"
    # 성공 2종목의 가격 update가 실제로 실행됨
    price_updates = [u for u in fake.store["updates"] if "unit_price" in u["payload"]]
    assert {u["id"] for u in price_updates} == {1, 2}


# ── 시나리오 4: 티커 없는 자산 → 갱신 대상 제외 ───────────────────

def test_scenario4_no_ticker_excluded(monkeypatch):
    rows = [
        {"id": 1, "asset_name": "정기예금", "ticker": None, "quantity": 1, "is_active": True},
        {"id": 2, "asset_name": "A_ETF", "ticker": "069500", "quantity": 10, "is_active": True},
    ]
    _setup_price(monkeypatch, rows, lambda t: (10_000.0, "2026-06-12", "FDR"))
    result = price.run_price_update()

    assert result["updated"] + result["failed"] == 1
    assert all(d["asset_name"] != "정기예금" for d in result["details"])


# ── 시나리오 5: 수동 버튼 = Cron과 동일 함수 ──────────────────────

def test_scenario5_manual_button_uses_same_function(monkeypatch):
    sentinel = {"updated": 7, "failed": 0, "details": []}
    monkeypatch.setattr(price, "run_price_update", lambda: sentinel)
    assert price.update_prices() is sentinel


# ── 메일 요약 한 줄 포맷 ──────────────────────────────────────────

def test_price_summary_line_formats():
    assert _price_summary_line(None) == ""
    assert _price_summary_line({"updated": 0, "failed": 0, "details": []}) == ""  # 대상 0건 → 생략
    assert _price_summary_line({"updated": 12, "failed": 0, "details": []}) == "시세 갱신: 12종목 성공"
    line = _price_summary_line({
        "updated": 12, "failed": 1,
        "details": [{"asset_name": "○○ETF", "status": "failed"}],
    })
    assert line == "시세 갱신: 12종목 성공, 1종목 실패(○○ETF)"
