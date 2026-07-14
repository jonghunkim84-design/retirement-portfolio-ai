"""실물자산 순수 함수 단위 테스트.

실행: backend/ 디렉터리에서 `pytest tests/test_real_assets.py -v`
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routers.real_assets import calc_property_tax_base, summarize_real_assets


# ── calc_property_tax_base ───────────────────────────────────────

def test_house_conversion_brackets():
    # 공시가 3억 이하 43% / 3~6억 44% / 6억 초과 45%
    assert calc_property_tax_base("house", 0, 300_000_000) == 300_000_000 * 0.43
    assert calc_property_tax_base("house", 0, 500_000_000) == 500_000_000 * 0.44
    assert calc_property_tax_base("house", 0, 900_000_000) == 900_000_000 * 0.45


def test_house_falls_back_to_market_value():
    # 공시가 미입력 → 시세 기준
    assert calc_property_tax_base("house", 250_000_000, None) == 250_000_000 * 0.43


def test_building_full_and_jeonse_30pct():
    assert calc_property_tax_base("building", 0, 400_000_000) == 400_000_000
    # 전세는 보증금(시세 필드) × 30% — 공시가 무시
    assert calc_property_tax_base("jeonse", 500_000_000, 999) == 500_000_000 * 0.30


def test_other_category_not_levied():
    assert calc_property_tax_base("other", 50_000_000, 50_000_000) == 0.0


# ── summarize_real_assets ────────────────────────────────────────

def _rows():
    return [
        {"category": "house", "market_value": 900_000_000, "official_price": 600_000_000,
         "loan_amount": 200_000_000, "acquisition_price": 700_000_000, "is_active": True},
        {"category": "jeonse", "market_value": 300_000_000, "official_price": None,
         "loan_amount": 0, "acquisition_price": None, "is_active": True},
        {"category": "other", "market_value": 30_000_000, "official_price": None,
         "loan_amount": 0, "acquisition_price": None, "is_active": True},
        # 비활성 — 모든 집계에서 제외
        {"category": "building", "market_value": 999_999_999, "official_price": None,
         "loan_amount": 0, "acquisition_price": None, "is_active": False},
    ]


def test_summary_totals_exclude_inactive():
    s = summarize_real_assets(_rows())
    assert s["count"] == 3
    assert s["total_market_value"] == 1_230_000_000
    assert s["total_loan"] == 200_000_000
    assert s["net_value"] == 1_030_000_000


def test_summary_tax_base_and_deduction():
    s = summarize_real_assets(_rows())
    # 주택 공시가 6억 × 44% + 전세 3억 × 30% + 기타 0 = 2.64억 + 0.9억 = 3.54억
    assert s["tax_base_total"] == round(600_000_000 * 0.44 + 300_000_000 * 0.30)
    # (3.54억 − 대출 2억)/만원 − 기본공제 1억(=10,000만원) = 15,400 − 10,000 = 5,400만원
    assert s["property_tax_base_manwon"] == 5_400


def test_summary_tax_base_floor_zero():
    rows = [{"category": "house", "market_value": 100_000_000, "official_price": None,
             "loan_amount": 90_000_000, "is_active": True}]
    s = summarize_real_assets(rows)
    # 환산 4,300만 − 대출 9,000만 − 공제 1억 → 0으로 클램프
    assert s["property_tax_base_manwon"] == 0


def test_summary_category_breakdown_sorted():
    s = summarize_real_assets(_rows())
    assert [c["category"] for c in s["by_category"]] == ["house", "jeonse", "other"]
    assert s["by_category"][0]["value"] == 900_000_000
