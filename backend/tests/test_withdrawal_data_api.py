"""
인출 판단 시스템 데이터 기반 API 테스트 (지시서 01, 단계 D)

대상: holding_profiles / cashflow_items / withdrawal_baseline / sub_allocation_targets
- 모든 테스트는 메모리 상의 가짜 Supabase 를 사용한다 (운영 DB 접근 없음).
- 검증 규칙, 채권 경고 조건, upsert, missing 목록, 자산군별 합계 경고, updated_at 갱신.

실행: backend/ 디렉터리에서 `pytest tests/test_withdrawal_data_api.py -v`
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

import utils
import routers.holding_profiles as hp
import routers.cashflow_items as ci
import routers.withdrawal_baseline as wb
import routers.sub_allocation_targets as sat


# ── 가짜 Supabase (체이닝 쿼리 빌더 최소 구현) ─────────────────────────

class _Res:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.mode = "select"
        self.payload = None
        self.on_conflict = None
        self.filters = []
        self.orders = []

    def select(self, *_):
        self.mode = "select"
        return self

    def insert(self, payload):
        self.mode, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.mode, self.payload = "update", payload
        return self

    def upsert(self, payload, on_conflict=None):
        self.mode, self.payload, self.on_conflict = "upsert", payload, on_conflict
        return self

    def delete(self):
        self.mode = "delete"
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: r.get(col) == val)
        return self

    def in_(self, col, vals):
        self.filters.append(lambda r: r.get(col) in vals)
        return self

    def order(self, col, **_):
        self.orders.append(col)
        return self

    def _matches(self, rows):
        return [r for r in rows if all(f(r) for f in self.filters)]

    def _check_unique(self, rows, new, skip=None):
        for cols in self.db.unique.get(self.name, []):
            for r in rows:
                if r is skip:
                    continue
                if all(r.get(c) == new.get(c) for c in cols):
                    raise Exception(f"duplicate key value violates unique constraint {cols}")

    def execute(self):
        rows = self.db.tables.setdefault(self.name, [])
        if self.mode == "select":
            out = self._matches(rows)
            for col in reversed(self.orders):
                out = sorted(out, key=lambda r: (r.get(col) is None, r.get(col)))
            return _Res([dict(r) for r in out])
        if self.mode == "insert":
            new = {"id": self.db.next_id(self.name), "created_at": "CREATED", **self.payload}
            self._check_unique(rows, new)
            rows.append(new)
            return _Res([dict(new)])
        if self.mode == "update":
            hit = self._matches(rows)
            for r in hit:
                merged = {**r, **self.payload}
                self._check_unique(rows, merged, skip=r)
                r.update(self.payload)
            return _Res([dict(r) for r in hit])
        if self.mode == "upsert":
            key = self.on_conflict
            existing = next((r for r in rows if r.get(key) == self.payload.get(key)), None)
            if existing is not None:
                existing.update(self.payload)
                return _Res([dict(existing)])
            new = {"created_at": "CREATED", **self.payload}
            if "id" not in new:
                new["id"] = self.db.next_id(self.name)
            rows.append(new)
            return _Res([dict(new)])
        if self.mode == "delete":
            hit = self._matches(rows)
            self.db.tables[self.name] = [r for r in rows if r not in hit]
            return _Res([dict(r) for r in hit])
        raise AssertionError(self.mode)


class FakeDB:
    def __init__(self):
        self.tables = {}
        self._ids = {}
        self.unique = {"sub_allocation_targets": [("asset_class", "sub_class")]}

    def next_id(self, name):
        self._ids[name] = self._ids.get(name, 0) + 1
        return self._ids[name]

    def table(self, name):
        return _Query(self, name)


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()
    for mod in (utils, hp, ci, wb, sat):
        monkeypatch.setattr(mod, "supabase", fake)
    return fake


def _add_asset(db, id_, asset_type, name=None, active=True, maturity=None):
    db.tables.setdefault("assets", []).append({
        "id": id_, "asset_name": name or f"자산{id_}", "account_name": "계좌",
        "asset_type": asset_type, "is_active": active, "maturity_date": maturity,
    })


def _profile(**over):
    base = dict(role="stability")
    base.update(over)
    return hp.HoldingProfileIn(**base)


# ── 입력 검증 ─────────────────────────────────────────────────────

@pytest.mark.parametrize("over", [
    {"bucket": 4},
    {"bucket": 0},
    {"role": "unknown"},
    {"equity_share_pct": 1.5},
    {"equity_share_pct": -0.1},
    {"bond_modified_duration": -1},
    {"expense_ratio": -0.01},
    {"bond_rate_type": "mixed"},
    {"value_source": "guess"},
])
def test_profile_validation_rejects(over):
    with pytest.raises(ValidationError):
        _profile(**over)


def test_profile_validation_accepts_edges():
    p = _profile(bucket=None, equity_share_pct=0, bond_modified_duration=0)
    assert p.bucket is None and p.value_source == "assumed" and p.currency == "KRW"
    assert _profile(bucket=3, equity_share_pct=1).bucket == 3


def test_cashflow_validation():
    base = dict(item_type="expense_essential", name="관리비", monthly_amount=100000)
    ci.CashflowItemIn(**base)
    with pytest.raises(ValidationError):
        ci.CashflowItemIn(**{**base, "monthly_amount": -1})
    with pytest.raises(ValidationError):
        ci.CashflowItemIn(**{**base, "item_type": "other"})
    with pytest.raises(ValidationError):
        ci.CashflowItemIn(**{**base, "start_date": "2026-05-01", "end_date": "2026-04-30"})


def test_baseline_validation():
    ok = dict(withdrawal_start_date="2025-09-01", initial_portfolio_value=1e9, initial_annual_withdrawal=4e7)
    wb.WithdrawalBaselineIn(**ok)
    with pytest.raises(ValidationError):
        wb.WithdrawalBaselineIn(**{**ok, "initial_portfolio_value": -1})
    with pytest.raises(ValidationError):
        wb.WithdrawalBaselineIn(**{**ok, "initial_annual_withdrawal": -1})


def test_sub_allocation_validation():
    sat.SubAllocationIn(asset_class="bond", sub_class="단기채", target_pct=0.4, band_pct=0.05)
    with pytest.raises(ValidationError):
        sat.SubAllocationIn(asset_class="bond", sub_class="x", target_pct=1.1)
    with pytest.raises(ValidationError):
        sat.SubAllocationIn(asset_class="tdf", sub_class="x", target_pct=0.5)
    with pytest.raises(ValidationError):
        sat.SubAllocationIn(asset_class="bond", sub_class="x", target_pct=0.5, band_pct=-0.1)


# ── 채권 경고 조건 ───────────────────────────────────────────────

def test_bond_warning_only_when_duration_and_maturity_both_missing(db):
    _add_asset(db, 1, "bond")
    res = hp.upsert_profile(1, _profile())
    assert [w["code"] for w in res["warnings"]] == ["bond_duration_missing"]
    assert db.tables["holding_profiles"], "경고가 있어도 저장은 허용"


def test_bond_no_warning_with_duration(db):
    _add_asset(db, 1, "bond")
    assert hp.upsert_profile(1, _profile(bond_modified_duration=3.2))["warnings"] == []


def test_bond_no_warning_with_asset_maturity(db):
    _add_asset(db, 1, "bond", maturity="2028-01-01")
    assert hp.upsert_profile(1, _profile())["warnings"] == []


@pytest.mark.parametrize("asset_type", ["tdf", "fund", "cash", "equity", "income"])
def test_no_bond_warning_for_other_types(db, asset_type):
    _add_asset(db, 1, asset_type)
    assert hp.upsert_profile(1, _profile())["warnings"] == []


# ── upsert / 조회 / 삭제 ─────────────────────────────────────────

def test_put_is_upsert_by_holding_id(db):
    _add_asset(db, 7, "equity")
    hp.upsert_profile(7, _profile(role="growth", sub_class="해외선진주식"))
    hp.upsert_profile(7, _profile(role="growth", sub_class="국내주식"))
    rows = db.tables["holding_profiles"]
    assert len(rows) == 1
    assert rows[0]["holding_id"] == 7 and rows[0]["sub_class"] == "국내주식"
    assert rows[0]["created_at"] == "CREATED"          # 재저장 시 created_at 유지
    assert rows[0]["as_of_date"]                        # 미입력 시 오늘 날짜


def test_put_unknown_asset_404(db):
    with pytest.raises(HTTPException) as e:
        hp.upsert_profile(999, _profile())
    assert e.value.status_code == 404


def test_get_single_list_delete(db):
    _add_asset(db, 1, "bond")
    _add_asset(db, 2, "equity")
    hp.upsert_profile(1, _profile())
    hp.upsert_profile(2, _profile(role="growth"))
    assert hp.get_profile(2)["role"] == "growth"
    listed = hp.list_profiles()
    assert [r["holding_id"] for r in listed] == [1, 2]
    assert listed[0]["warnings"] and not listed[1]["warnings"]
    assert hp.delete_profile(1) == {"ok": True}
    with pytest.raises(HTTPException) as e:
        hp.get_profile(1)
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        hp.delete_profile(1)
    assert e.value.status_code == 404


def test_bucket_null_is_stored_as_none(db):
    _add_asset(db, 1, "cash")
    hp.upsert_profile(1, _profile(bucket=None))
    assert hp.get_profile(1)["bucket"] is None
    hp.upsert_profile(1, _profile(bucket=2))
    assert hp.get_profile(1)["bucket"] == 2


# ── /missing ─────────────────────────────────────────────────────

def test_missing_lists_active_assets_without_profile(db):
    _add_asset(db, 1, "cash", name="예금")
    _add_asset(db, 2, "bond", name="국고채")
    _add_asset(db, 3, "equity", name="주식ETF")
    _add_asset(db, 4, "tdf", name="TDF2040")
    _add_asset(db, 5, "income", name="리츠", active=False)     # 비활성 → 제외
    hp.upsert_profile(2, _profile())                            # 속성 있음 → 제외
    res = hp.list_missing()
    assert res["count"] == 3
    by_id = {i["asset_id"]: i for i in res["items"]}
    assert set(by_id) == {1, 3, 4}
    assert by_id[1]["asset_name"] == "예금" and by_id[1]["asset_type"] == "cash"
    assert by_id[1]["default_bucket"] == utils.BUCKET_MAP["cash"] == 1
    assert by_id[3]["default_bucket"] == 3
    assert by_id[4]["default_bucket"] == 2


def test_bucket_map_untouched():
    assert utils.BUCKET_MAP == {"cash": 1, "bond": 2, "tdf": 2, "fund": 2, "equity": 3, "income": 3}


# ── 자산군별 합계·경고 ───────────────────────────────────────────

def test_sub_allocation_sum_warning(db):
    for cls, sub, pct in [("bond", "단기채", 0.4), ("bond", "중기채", 0.3), ("bond", "장기채", 0.3),
                          ("equity", "국내", 0.5), ("equity", "해외선진", 0.4)]:
        sat.create_target(sat.SubAllocationIn(asset_class=cls, sub_class=sub, target_pct=pct, band_pct=0.05))
    res = sat.list_targets()
    assert len(res["items"]) == 5
    s = {x["asset_class"]: x for x in res["summaries"]}
    assert s["bond"]["target_pct_sum"] == 1.0 and s["bond"]["sum_warning"] is False   # 0.4+0.3+0.3 부동소수 오차 허용
    assert s["equity"]["target_pct_sum"] == 0.9 and s["equity"]["sum_warning"] is True
    assert "cash" not in s


def test_sub_allocation_over_100_warns():
    s = sat.summarize_targets([{"asset_class": "cash", "target_pct": 0.7},
                               {"asset_class": "cash", "target_pct": 0.5}])
    assert s == [{"asset_class": "cash", "target_pct_sum": 1.2, "sum_warning": True}]


def test_sub_allocation_duplicate_is_400(db):
    body = sat.SubAllocationIn(asset_class="bond", sub_class="단기채", target_pct=0.5)
    sat.create_target(body)
    with pytest.raises(HTTPException) as e:
        sat.create_target(body)
    assert e.value.status_code == 400


# ── CRUD 기본 동작 ───────────────────────────────────────────────

def test_cashflow_crud(db):
    row = ci.create_item(ci.CashflowItemIn(item_type="income_regular", name="국민연금", monthly_amount=1_500_000))
    assert row["id"] == 1
    upd = ci.update_item(1, ci.CashflowItemIn(item_type="income_regular", name="국민연금", monthly_amount=1_600_000))
    assert upd["monthly_amount"] == 1_600_000
    assert len(ci.list_items()) == 1
    assert ci.delete_item(1) == {"ok": True}
    for fn in (lambda: ci.delete_item(1),
               lambda: ci.update_item(1, ci.CashflowItemIn(item_type="income_regular", name="x"))):
        with pytest.raises(HTTPException) as e:
            fn()
        assert e.value.status_code == 404


def test_baseline_single_row_upsert(db):
    assert wb.get_baseline() is None
    body = wb.WithdrawalBaselineIn(withdrawal_start_date="2025-09-01",
                                   initial_portfolio_value=1_000_000_000, initial_annual_withdrawal=40_000_000)
    wb.upsert_baseline(body)
    wb.upsert_baseline(wb.WithdrawalBaselineIn(withdrawal_start_date="2025-10-01",
                                               initial_portfolio_value=1_100_000_000, initial_annual_withdrawal=44_000_000))
    rows = db.tables["withdrawal_baseline"]
    assert len(rows) == 1 and rows[0]["id"] == 1
    assert wb.get_baseline()["initial_portfolio_value"] == 1_100_000_000
    assert wb.delete_baseline() == {"ok": True}
    with pytest.raises(HTTPException) as e:
        wb.delete_baseline()
    assert e.value.status_code == 404


# ── updated_at 갱신 (모든 수정 API) ──────────────────────────────

def _stale(db, table):
    for r in db.tables[table]:
        r["updated_at"] = "STALE"


def test_updated_at_refreshed_on_every_write(db):
    # cashflow_items: POST, PUT
    ci_body = ci.CashflowItemIn(item_type="expense_essential", name="관리비", monthly_amount=1)
    assert ci.create_item(ci_body)["updated_at"] != "STALE"
    _stale(db, "cashflow_items")
    assert ci.update_item(1, ci_body)["updated_at"] != "STALE"

    # sub_allocation_targets: POST, PUT
    sat_body = sat.SubAllocationIn(asset_class="cash", sub_class="예금", target_pct=1)
    assert sat.create_target(sat_body)["updated_at"] != "STALE"
    _stale(db, "sub_allocation_targets")
    assert sat.update_target(1, sat_body)["updated_at"] != "STALE"

    # withdrawal_baseline: PUT (insert, update)
    wb_body = wb.WithdrawalBaselineIn(withdrawal_start_date="2025-09-01",
                                      initial_portfolio_value=1, initial_annual_withdrawal=1)
    assert wb.upsert_baseline(wb_body)["updated_at"] != "STALE"
    _stale(db, "withdrawal_baseline")
    assert wb.upsert_baseline(wb_body)["updated_at"] != "STALE"

    # holding_profiles: PUT (insert, update)
    _add_asset(db, 1, "cash")
    assert hp.upsert_profile(1, _profile())["updated_at"] != "STALE"
    _stale(db, "holding_profiles")
    assert hp.upsert_profile(1, _profile())["updated_at"] != "STALE"
