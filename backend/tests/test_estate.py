"""상속·증여세 계산 순수 함수 단위 테스트.

실행: backend/ 디렉터리에서 `pytest tests/test_estate.py -v`
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routers.estate import (
    calc_transfer_tax,
    expand_gift_occurrences,
    calc_gift_taxes_for_recipient,
    calc_inheritance_tax,
    build_gift_schedule,
    compare_gift_vs_inheritance,
)


# ── calc_transfer_tax (누진세율) ─────────────────────────────────

def test_transfer_tax_brackets():
    assert calc_transfer_tax(0) == 0
    assert calc_transfer_tax(100_000_000) == 10_000_000                       # 1억 × 10%
    assert calc_transfer_tax(500_000_000) == 500_000_000 * 0.2 - 10_000_000   # 9,000만
    assert calc_transfer_tax(1_000_000_000) == 1_000_000_000 * 0.3 - 60_000_000
    assert calc_transfer_tax(5_000_000_000) == 5_000_000_000 * 0.5 - 460_000_000


# ── expand_gift_occurrences ──────────────────────────────────────

def test_expand_one_time_and_recurring():
    one = {"gift_type": "one_time", "amount": 50_000_000, "start_year": 2027}
    assert expand_gift_occurrences(one) == [(2027, 50_000_000)]

    rec = {"gift_type": "recurring", "amount": 10_000_000, "start_year": 2027, "end_year": 2030}
    assert expand_gift_occurrences(rec) == [(y, 10_000_000) for y in range(2027, 2031)]


# ── calc_gift_taxes_for_recipient (10년 합산) ────────────────────

def test_adult_child_within_deduction_is_tax_free():
    # 성인 자녀 공제 5,000만 — 한도 내 증여는 면세
    taxes = calc_gift_taxes_for_recipient([(2027, 50_000_000)], "adult_child")
    assert taxes[0]["tax"] == 0


def test_adult_child_over_deduction():
    # 1.5억 증여: 과세표준 1억 → 10% = 1,000만
    taxes = calc_gift_taxes_for_recipient([(2027, 150_000_000)], "adult_child")
    assert taxes[0]["taxable"] == 100_000_000
    assert taxes[0]["tax"] == 10_000_000


def test_ten_year_aggregation_incremental_tax():
    # 매년 3,000만 × 3년 (성인 자녀): 누적 9,000만 − 공제 5,000만 = 4,000만 과세
    taxes = calc_gift_taxes_for_recipient(
        [(2027, 30_000_000), (2028, 30_000_000), (2029, 30_000_000)], "adult_child")
    assert taxes[0]["tax"] == 0                    # 누적 3,000만 < 공제
    assert taxes[1]["tax"] == 1_000_000            # 누적 6,000만 → 과세 1,000만 × 10%
    assert taxes[2]["tax"] == 3_000_000            # 누적 9,000만 → 4,000만 × 10% − 기납부 100만
    assert sum(t["tax"] for t in taxes) == 4_000_000


def test_gifts_outside_10yr_window_not_aggregated():
    # 11년 간격 — 각각 별도 공제 적용
    taxes = calc_gift_taxes_for_recipient(
        [(2027, 50_000_000), (2038, 50_000_000)], "adult_child")
    assert taxes[0]["tax"] == 0
    assert taxes[1]["tax"] == 0
    assert taxes[1]["window_sum"] == 50_000_000    # 2027년 건은 창 밖


def test_spouse_600m_deduction():
    taxes = calc_gift_taxes_for_recipient([(2027, 600_000_000)], "spouse")
    assert taxes[0]["tax"] == 0


def test_grandchild_generation_skip_surcharge():
    # 손자녀 1.5억: 과세표준 1억 × 10% × 1.3 = 1,300만
    taxes = calc_gift_taxes_for_recipient([(2027, 150_000_000)], "grandchild")
    assert taxes[0]["tax"] == 13_000_000


# ── calc_inheritance_tax ─────────────────────────────────────────

def test_inheritance_below_deduction_is_zero():
    # 5억 자산, 배우자 有 → 공제 10억+금융공제 → 세금 0
    r = calc_inheritance_tax(500_000_000, 500_000_000, has_spouse=True)
    assert r["tax"] == 0


def test_inheritance_deductions_composition():
    # 총 20억 (금융 8억), 배우자 有
    r = calc_inheritance_tax(2_000_000_000, 800_000_000, has_spouse=True)
    assert r["spouse_deduction"] == 500_000_000
    assert r["financial_deduction"] == 160_000_000            # 8억 × 20% < 2억 한도
    assert r["total_deduction"] == 500_000_000 + 500_000_000 + 160_000_000
    assert r["taxable"] == 2_000_000_000 - 1_160_000_000
    # 8.4억 → 30% − 6,000만 = 1.92억
    assert r["tax"] == round(840_000_000 * 0.3 - 60_000_000)


def test_inheritance_financial_deduction_capped():
    r = calc_inheritance_tax(3_000_000_000, 1_500_000_000, has_spouse=False)
    assert r["financial_deduction"] == 200_000_000            # 1.5억 초과분 캡


# ── build_gift_schedule ──────────────────────────────────────────

def test_schedule_merges_same_year():
    plans = [
        {"gift_type": "one_time", "amount": 50_000_000, "start_year": 2027, "is_active": True},
        {"gift_type": "recurring", "amount": 10_000_000, "start_year": 2027, "end_year": 2029, "is_active": True},
        {"gift_type": "one_time", "amount": 999, "start_year": 2027, "is_active": False},  # 제외
    ]
    sched = build_gift_schedule(plans)
    assert sched == {2027: 60_000_000, 2028: 10_000_000, 2029: 10_000_000}


# ── compare_gift_vs_inheritance ──────────────────────────────────

def test_comparison_gift_saves_tax():
    # 총 30억 (금융 10억), 배우자 有, 자녀 2명에게 각 1.5억 사전증여
    plans = [
        {"gift_type": "one_time", "amount": 150_000_000, "start_year": 2027,
         "relationship": "adult_child", "recipient_name": "첫째", "is_active": True},
        {"gift_type": "one_time", "amount": 150_000_000, "start_year": 2027,
         "relationship": "adult_child", "recipient_name": "둘째", "is_active": True},
    ]
    r = compare_gift_vs_inheritance(3_000_000_000, 1_000_000_000, True, plans)
    assert r["with_gift"]["total_gifts"] == 300_000_000
    assert r["with_gift"]["gift_tax"] == 20_000_000           # 각 1,000만
    # 한계세율 40% 구간에서 3억 차감 → 상속세 절감 1.2억 > 증여세 2,000만
    assert r["savings"] > 0
    assert r["no_gift"]["total_cost"] == r["with_gift"]["total_cost"] + r["savings"]
