"""IPS 규칙(ips_rules.parameters) 검증 — 순수 함수 (지시서 03, 6장).

규칙별 허용 키와 값의 범위를 검사하고, 알 수 없는 키는 거부한다. 오류는 필드별 [{"field", "msg"}] 로 반환한다.
값의 단위: 연수는 년, 비율·배수는 0~1 소수 또는 배수(화면에서 % 변환) — 저장 형식 그대로 검증한다.
"""
import math
from typing import Callable, Optional

RULE_CODES = ("R-01", "R-02", "R-03", "R-04", "R-05", "R-06", "R-07")
R03_MODES = ("config", "relative")


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _check(params: dict, key: str, ok: Callable[[float], bool], msg: str, errors: list, required: bool = True):
    if key not in params:
        if required:
            errors.append({"field": key, "msg": "값이 필요합니다"})
        return None
    v = params[key]
    if not _is_num(v):
        errors.append({"field": key, "msg": "숫자를 입력하세요"})
        return None
    if not ok(v):
        errors.append({"field": key, "msg": msg})
        return None
    return v


def _unknown_keys(params: dict, allowed: tuple, errors: list):
    for k in params:
        if k not in allowed:
            errors.append({"field": str(k), "msg": "알 수 없는 항목입니다"})


def validate_parameters(rule_code: str, params) -> list:
    """오류 목록을 반환한다. 빈 목록이면 유효."""
    errors: list = []
    if rule_code not in RULE_CODES:
        return [{"field": "rule_code", "msg": "알 수 없는 규칙입니다"}]
    if not isinstance(params, dict):
        return [{"field": "parameters", "msg": "parameters 는 객체여야 합니다"}]

    if rule_code == "R-01":
        _unknown_keys(params, ("min_years", "target_years"), errors)
        mn = _check(params, "min_years", lambda v: v > 0, "0보다 커야 합니다", errors)
        tg = _check(params, "target_years", lambda v: v > 0, "0보다 커야 합니다", errors)
        if mn is not None and tg is not None and mn > tg:
            errors.append({"field": "min_years", "msg": "최소 연수는 목표 연수 이하여야 합니다"})
    elif rule_code == "R-02":
        _unknown_keys(params, ("target_years",), errors)
        _check(params, "target_years", lambda v: v > 0, "0보다 커야 합니다", errors)
    elif rule_code == "R-03":
        _unknown_keys(params, ("mode", "relative", "min_abs"), errors)
        mode = params.get("mode", "config")                # {} 도 config 로 해석 (하위 호환)
        if mode not in R03_MODES:
            errors.append({"field": "mode", "msg": "config 또는 relative 여야 합니다"})
        relative_mode = mode == "relative"
        _check(params, "relative", lambda v: 0 < v <= 1, "0보다 크고 1 이하여야 합니다", errors, required=relative_mode)
        _check(params, "min_abs", lambda v: 0 <= v <= 1, "0 이상 1 이하여야 합니다", errors, required=relative_mode)
    elif rule_code == "R-04":
        _unknown_keys(params, ("drawdown_threshold", "lookback_days"), errors)
        _check(params, "drawdown_threshold", lambda v: 0 < v < 1, "0보다 크고 1보다 작아야 합니다", errors)
        _check(params, "lookback_days", lambda v: 30 <= v <= 1095 and float(v).is_integer(),
               "30 이상 1095 이하의 정수(일)여야 합니다", errors, required=False)     # 선택 — 없으면 365일
    elif rule_code == "R-05":
        _unknown_keys(params, ("upper_multiplier", "cut_ratio"), errors)
        _check(params, "upper_multiplier", lambda v: v > 1, "1보다 커야 합니다", errors)
        _check(params, "cut_ratio", lambda v: 0 < v < 1, "0보다 크고 1보다 작아야 합니다", errors)
    elif rule_code == "R-06":
        _unknown_keys(params, ("lower_multiplier", "raise_ratio"), errors)
        _check(params, "lower_multiplier", lambda v: 0 < v < 1, "0보다 크고 1보다 작아야 합니다", errors)
        _check(params, "raise_ratio", lambda v: 0 < v < 1, "0보다 크고 1보다 작아야 합니다", errors)
    elif rule_code == "R-07":
        _unknown_keys(params, (), errors)                  # 값이 없는 규칙 — 어떤 키도 허용하지 않는다
    return errors
