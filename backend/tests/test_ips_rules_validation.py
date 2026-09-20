"""IPS 규칙 검증 순수 함수 테스트 (지시서 03, 단계 D).

실행: backend/ 디렉터리에서 `pytest tests/test_ips_rules_validation.py -v`
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from ips_rules_validation import validate_parameters, RULE_CODES


def fields(errors):
    return sorted(e["field"] for e in errors)


VALID = [
    ("R-01", {"min_years": 1.0, "target_years": 2.0}),
    ("R-01", {"min_years": 2, "target_years": 2}),                       # 최소 = 목표 허용
    ("R-02", {"target_years": 5}),
    ("R-03", {}),                                                       # {} 는 config 로 해석 (하위 호환)
    ("R-03", {"mode": "config"}),
    ("R-03", {"mode": "config", "relative": 0.2, "min_abs": 0.03}),     # config 모드에서 남은 값이 있어도 범위만 맞으면 허용
    ("R-03", {"mode": "relative", "relative": 0.2, "min_abs": 0.03}),
    ("R-03", {"mode": "relative", "relative": 1, "min_abs": 0}),         # 경계값
    ("R-04", {"drawdown_threshold": 0.15}),
    ("R-05", {"upper_multiplier": 1.2, "cut_ratio": 0.1}),
    ("R-06", {"lower_multiplier": 0.8, "raise_ratio": 0.1}),
    ("R-07", {}),
]


@pytest.mark.parametrize("code, params", VALID)
def test_valid_parameters(code, params):
    assert validate_parameters(code, params) == []


INVALID = [
    # R-01: 0 < min_years ≤ target_years
    ("R-01", {"min_years": 0, "target_years": 2}, ["min_years"]),
    ("R-01", {"min_years": -1, "target_years": 2}, ["min_years"]),
    ("R-01", {"min_years": 3, "target_years": 2}, ["min_years"]),
    ("R-01", {"min_years": 1, "target_years": 0}, ["target_years"]),
    ("R-01", {"min_years": 1}, ["target_years"]),
    ("R-01", {}, ["min_years", "target_years"]),
    # R-02: target_years > 0
    ("R-02", {"target_years": 0}, ["target_years"]),
    ("R-02", {"target_years": -5}, ["target_years"]),
    ("R-02", {}, ["target_years"]),
    # R-03: mode ∈ {config, relative}, relative 면 0 < relative ≤ 1, 0 ≤ min_abs ≤ 1
    ("R-03", {"mode": "auto"}, ["mode"]),
    ("R-03", {"mode": "relative"}, ["min_abs", "relative"]),
    ("R-03", {"mode": "relative", "relative": 0.2}, ["min_abs"]),
    ("R-03", {"mode": "relative", "relative": 0, "min_abs": 0.03}, ["relative"]),
    ("R-03", {"mode": "relative", "relative": 1.01, "min_abs": 0.03}, ["relative"]),
    ("R-03", {"mode": "relative", "relative": 0.2, "min_abs": -0.01}, ["min_abs"]),
    ("R-03", {"mode": "relative", "relative": 0.2, "min_abs": 1.01}, ["min_abs"]),
    # R-04: 0 < drawdown_threshold < 1
    ("R-04", {"drawdown_threshold": 0}, ["drawdown_threshold"]),
    ("R-04", {"drawdown_threshold": 1}, ["drawdown_threshold"]),
    ("R-04", {"drawdown_threshold": 1.5}, ["drawdown_threshold"]),
    ("R-04", {}, ["drawdown_threshold"]),
    # R-05: upper_multiplier > 1, 0 < cut_ratio < 1
    ("R-05", {"upper_multiplier": 1, "cut_ratio": 0.1}, ["upper_multiplier"]),
    ("R-05", {"upper_multiplier": 0.9, "cut_ratio": 0.1}, ["upper_multiplier"]),
    ("R-05", {"upper_multiplier": 1.2, "cut_ratio": 0}, ["cut_ratio"]),
    ("R-05", {"upper_multiplier": 1.2, "cut_ratio": 1}, ["cut_ratio"]),
    # R-06: 0 < lower_multiplier < 1, 0 < raise_ratio < 1
    ("R-06", {"lower_multiplier": 1, "raise_ratio": 0.1}, ["lower_multiplier"]),
    ("R-06", {"lower_multiplier": 0, "raise_ratio": 0.1}, ["lower_multiplier"]),
    ("R-06", {"lower_multiplier": 0.8, "raise_ratio": 1}, ["raise_ratio"]),
    ("R-06", {"lower_multiplier": 0.8, "raise_ratio": 0}, ["raise_ratio"]),
]


@pytest.mark.parametrize("code, params, expected_fields", INVALID)
def test_invalid_parameters_report_the_offending_fields(code, params, expected_fields):
    errors = validate_parameters(code, params)
    assert fields(errors) == expected_fields
    assert all(set(e) == {"field", "msg"} and e["msg"] for e in errors)


@pytest.mark.parametrize("code, params", [
    ("R-01", {"min_years": 1, "target_years": 2, "extra": 1}),
    ("R-02", {"target_years": 5, "min_years": 1}),
    ("R-03", {"mode": "config", "band": 0.1}),
    ("R-04", {"drawdown_threshold": 0.15, "x": 1}),
    ("R-05", {"upper_multiplier": 1.2, "cut_ratio": 0.1, "lower_multiplier": 0.8}),
    ("R-06", {"lower_multiplier": 0.8, "raise_ratio": 0.1, "cut_ratio": 0.1}),
    ("R-07", {"anything": 1}),
])
def test_unknown_keys_are_rejected(code, params):
    errors = validate_parameters(code, params)
    assert any(e["msg"] == "알 수 없는 항목입니다" for e in errors)


@pytest.mark.parametrize("bad", ["1", None, True, False, [1], {"a": 1}, float("nan"), float("inf"), float("-inf")])
def test_non_numeric_and_non_finite_values_are_rejected(bad):
    errors = validate_parameters("R-02", {"target_years": bad})
    assert fields(errors) == ["target_years"] and errors[0]["msg"] == "숫자를 입력하세요"


def test_parameters_must_be_an_object_and_rule_must_exist():
    assert fields(validate_parameters("R-01", [1, 2])) == ["parameters"]
    assert fields(validate_parameters("R-01", None)) == ["parameters"]
    assert fields(validate_parameters("R-99", {})) == ["rule_code"]


def test_all_seven_rules_are_covered():
    assert RULE_CODES == ("R-01", "R-02", "R-03", "R-04", "R-05", "R-06", "R-07")
    for code in RULE_CODES:                                             # 빈 값은 모든 규칙에서 예외 없이 처리된다
        assert isinstance(validate_parameters(code, {}), list)
