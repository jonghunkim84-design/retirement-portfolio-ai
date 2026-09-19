"""생활비·버킷 점검 계산 (지시서 02, 설계서 4.1·4.2·4.8) — 순수 함수 모듈.

- DB 접근 없음, 오늘 날짜 호출 없음: 모든 계산은 기준일 `as_of` 를 인자로 받는다 (라우터에서만 오늘을 넣는다).
- 규칙 임계값은 ips_rules.parameters 에서 받은 값만 쓴다 (코드 상수 없음). enabled=false 이거나 값이 없으면 판정은 None.
- 0으로 나누는 경우는 오류가 아니라 None + 사유 코드로 반환한다.
- 범위: "현황 점검"까지. 인출원 선택·보충 판단(03), 수익률·물가·시나리오(04·05)는 포함하지 않는다.
"""
import calendar
from datetime import date, datetime
from typing import Optional

from utils import BUCKET_MAP

EPS = 1e-9   # 경계값 비교용 (배수·연수 계산의 부동소수 오차 흡수)

ASSUMPTIONS = [
    "수익률 0% 가정 — 자산 증식·이자 수익 미반영, 단순 나눗셈",
    "물가 상승 미반영 — 생활비는 기준일 유효 항목의 월액 × 12 로 고정",
    "투자자산 = assets 중 is_active=true 의 current_value 합계 (실물자산 제외)",
    "정기수입은 기준일에 유효한 항목만 합산 (개시 전 수입은 '예정 수입'으로 별도 표시)",
    "실적 인출률은 기준일 이전 12개월(달력) 인출 기록 합계 ÷ 현재 투자자산 (참고용, 가드레일 판정에는 쓰지 않음)",
    "버킷은 재지정값(holding_profiles.bucket)이 있으면 그 값, 없으면 자산유형 기본값(BUCKET_MAP)",
]

# 출력 항목이 관측값인지, 입력에서 파생된 값인지, 가정에 의존하는지 구분
PROVENANCE = {
    "observed": ["assets[].value", "net_need.gross", "withdrawal_rate.actual_12m_total", "baseline"],
    "derived": ["net_need.annual_total", "buckets[].years_*", "cumulative", "withdrawal_rate.initial",
                "withdrawal_rate.current_plan", "rules.*.ratio"],
    "assumed": ["buckets[].years_* (수익률 0%)", "net_need (물가 미반영)", "rules.*.suggestion_amount / shortfall (참고 수치)"],
}


# ── 작은 도우미 ────────────────────────────────────────────────────

def _to_date(v) -> Optional[date]:
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return date.fromisoformat(str(v)[:10])


def _num(v, default=0.0) -> float:
    if v is None or v == "":
        return default
    return float(v)


def _lt(a: float, b: float) -> bool:
    return a < b - EPS


def _gt(a: float, b: float) -> bool:
    return a > b + EPS


def _minus_months(d: date, months: int) -> date:
    y, m = divmod(d.year * 12 + (d.month - 1) - months, 12)
    m += 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def _param(rule: Optional[dict], key: str) -> Optional[float]:
    if not rule or not rule.get("enabled", True):
        return None
    params = rule.get("parameters") or {}
    v = params.get(key)
    return None if v is None else float(v)


def _rule_state(rule: Optional[dict]) -> Optional[str]:
    """규칙이 없거나 꺼져 있으면 사유 코드, 사용 가능하면 None."""
    if not rule:
        return "rule_missing"
    if not rule.get("enabled", True):
        return "rule_disabled"
    return None


# ── 4.1 실효 버킷 ─────────────────────────────────────────────────

def effective_bucket(asset: dict, profile: Optional[dict], bucket_map: dict = BUCKET_MAP) -> dict:
    """재지정값이 있으면 그 값(override), 없으면 BUCKET_MAP 기본값(default). 유형을 모르면 bucket=None."""
    default = bucket_map.get(asset.get("asset_type"))
    override = (profile or {}).get("bucket")
    if override is not None:
        return {"default_bucket": default, "effective_bucket": int(override), "bucket_source": "override"}
    return {"default_bucket": default, "effective_bucket": default, "bucket_source": "default"}


# ── 4.2 순인출 필요액 ─────────────────────────────────────────────

def is_effective(item: dict, as_of: date) -> bool:
    start, end = _to_date(item.get("start_date")), _to_date(item.get("end_date"))
    return (start is None or start <= as_of) and (end is None or end >= as_of)


def compute_net_need(cashflow_items: list, as_of: date) -> dict:
    essential = discretionary = income = 0.0
    upcoming_income, upcoming_expense = [], []
    ended = 0
    active_expense_items = active_income_items = 0

    for it in cashflow_items:
        monthly = _num(it.get("monthly_amount"))
        start, end = _to_date(it.get("start_date")), _to_date(it.get("end_date"))
        kind = it.get("item_type")
        if start is not None and start > as_of:                      # 개시 전 — 합산하지 않고 예정 목록으로
            row = {"name": it.get("name"), "monthly_amount": monthly, "start_date": start.isoformat()}
            (upcoming_income if kind == "income_regular" else upcoming_expense).append(row)
            continue
        if end is not None and end < as_of:                          # 종료됨
            ended += 1
            continue
        if kind == "expense_essential":
            essential += monthly
            active_expense_items += 1
        elif kind == "expense_discretionary":
            discretionary += monthly
            active_expense_items += 1
        elif kind == "income_regular":
            income += monthly
            active_income_items += 1

    e_year, d_year, i_year = essential * 12, discretionary * 12, income * 12
    annual_total = max(0.0, e_year + d_year - i_year)
    annual_essential = max(0.0, e_year - i_year)
    return {
        "annual_total": annual_total,
        "annual_essential": annual_essential,
        "monthly_total": annual_total / 12,
        "monthly_essential": annual_essential / 12,
        "gross": {"essential_annual": e_year, "discretionary_annual": d_year, "income_annual": i_year},
        "upcoming_income": upcoming_income,
        "upcoming_expense": upcoming_expense,
        "counts": {"active_expense": active_expense_items, "active_income": active_income_items,
                   "upcoming": len(upcoming_income) + len(upcoming_expense), "ended": ended},
    }


# ── 4.3 버킷별 잔액과 커버 연수 ───────────────────────────────────

def _years(value: float, annual_need: float) -> Optional[float]:
    return None if annual_need <= 0 else value / annual_need


def compute_buckets(assets: list, profiles_by_id: dict, net: dict, bucket_map: dict = BUCKET_MAP) -> dict:
    rows, per = [], {1: [0.0, 0], 2: [0.0, 0], 3: [0.0, 0]}
    unassigned_value, unassigned_count = 0.0, 0
    for a in assets:
        if not a.get("is_active", True):
            continue
        value = _num(a.get("current_value"))
        eb = effective_bucket(a, profiles_by_id.get(a.get("id")), bucket_map)
        rows.append({
            "id": a.get("id"), "asset_name": a.get("asset_name"), "account_name": a.get("account_name"),
            "asset_type": a.get("asset_type"), "value": value, **eb,
            "has_profile": a.get("id") in profiles_by_id,
        })
        b = eb["effective_bucket"]
        if b in per:
            per[b][0] += value
            per[b][1] += 1
        else:
            unassigned_value += value
            unassigned_count += 1

    total = sum(r["value"] for r in rows)
    need_t, need_e = net["annual_total"], net["annual_essential"]
    buckets = [{
        "bucket": b, "value": per[b][0], "asset_count": per[b][1],
        "years_total": _years(per[b][0], need_t), "years_essential": _years(per[b][0], need_e),
    } for b in (1, 2, 3)]
    b1, b2 = per[1][0], per[2][0]
    cumulative = {
        "b1_b2_years_total": _years(b1 + b2, need_t), "b1_b2_years_essential": _years(b1 + b2, need_e),
        "all_years_total": _years(total, need_t), "all_years_essential": _years(total, need_e),
    }
    return {"total_assets": total, "buckets": buckets, "cumulative": cumulative, "assets": rows,
            "unassigned": {"count": unassigned_count, "value": unassigned_value}}


# ── 4.4 버킷 규칙 판정 (R-01, R-02) ────────────────────────────────

def evaluate_bucket_rules(buckets: dict, net: dict, rules: dict) -> dict:
    need = net["annual_total"]
    by_bucket = {b["bucket"]: b for b in buckets["buckets"]}
    out = {}

    # R-01: 1버킷 연수(전체 기준)
    r1 = rules.get("R-01")
    res = {"status": None, "years": by_bucket[1]["years_total"], "min_years": _param(r1, "min_years"),
           "target_years": _param(r1, "target_years"), "shortfall": None, "reason": None}
    reason = _rule_state(r1)
    if reason is None and (res["min_years"] is None or res["target_years"] is None):
        reason = "rule_parameters_invalid"
    if reason is None and res["years"] is None:
        reason = "no_net_need"
    if reason:
        res["reason"] = reason
    else:
        y = res["years"]
        res["status"] = "below_min" if _lt(y, res["min_years"]) else "below_target" if _lt(y, res["target_years"]) else "ok"
        res["shortfall"] = max(0.0, res["target_years"] * need - by_bucket[1]["value"])
    out["R-01"] = res

    # R-02: 2버킷 단독 연수
    r2 = rules.get("R-02")
    res = {"status": None, "years": by_bucket[2]["years_total"], "target_years": _param(r2, "target_years"),
           "shortfall": None, "reason": None}
    reason = _rule_state(r2)
    if reason is None and res["target_years"] is None:
        reason = "rule_parameters_invalid"
    if reason is None and res["years"] is None:
        reason = "no_net_need"
    if reason:
        res["reason"] = reason
    else:
        res["status"] = "below_target" if _lt(res["years"], res["target_years"]) else "ok"
        res["shortfall"] = max(0.0, res["target_years"] * need - by_bucket[2]["value"])
    out["R-02"] = res
    return out


# ── 4.5 인출률과 가드레일 (R-05, R-06) ─────────────────────────────

def compute_withdrawal_rate(baseline: Optional[dict], net: dict, total_assets: float,
                            withdrawals: Optional[list], as_of: date) -> dict:
    reasons = {}
    # 초기 인출률
    initial = None
    if not baseline:
        reasons["initial"] = "baseline_missing"
    else:
        pv = _num(baseline.get("initial_portfolio_value"))
        if pv <= 0:
            reasons["initial"] = "baseline_portfolio_zero"
        else:
            initial = _num(baseline.get("initial_annual_withdrawal")) / pv
    # 현재 인출률 (계획 기준 — 가드레일 판정에 사용)
    current_plan = None
    if total_assets <= 0:
        reasons["current_plan"] = "no_assets"
    else:
        current_plan = net["annual_total"] / total_assets
    # 현재 인출률 (실적 기준, 참고): (as_of − 12개월, as_of] 인출 기록 합계
    actual_total, actual_count, current_actual = None, 0, None
    if withdrawals is None:
        reasons["current_actual"] = "withdrawals_not_provided"
    else:
        start = _minus_months(as_of, 12)
        rows = [w for w in withdrawals if (d := _to_date(w.get("withdrawal_date"))) is not None and start < d <= as_of]
        actual_count = len(rows)
        if not rows:
            reasons["current_actual"] = "no_withdrawals_12m"
        else:
            actual_total = sum(_num(w.get("amount")) for w in rows)
            if total_assets <= 0:
                reasons["current_actual"] = "no_assets"
            else:
                current_actual = actual_total / total_assets
    # 초기 대비 비율
    ratio = None
    if initial is None:
        reasons["ratio"] = reasons["initial"]
    elif current_plan is None:
        reasons["ratio"] = reasons["current_plan"]
    elif initial <= 0:
        reasons["ratio"] = "initial_rate_zero"
    else:
        ratio = current_plan / initial
    return {"initial": initial, "current_plan": current_plan, "current_actual": current_actual,
            "actual_12m_total": actual_total, "actual_12m_count": actual_count,
            "ratio_to_initial": ratio, "reasons": reasons}


def evaluate_guardrails(rate: dict, net: dict, rules: dict) -> dict:
    ratio = rate["ratio_to_initial"]
    out = {}

    r5 = rules.get("R-05")
    up, cut = _param(r5, "upper_multiplier"), _param(r5, "cut_ratio")
    res = {"status": None, "ratio": ratio, "upper_multiplier": up, "cut_ratio": cut,
           "suggestion_amount": None, "reason": None}
    reason = _rule_state(r5) or ("rule_parameters_invalid" if up is None or cut is None else None) \
        or (rate["reasons"].get("ratio") if ratio is None else None)
    if reason:
        res["reason"] = reason
    elif _gt(ratio, up):
        res["status"] = "upper_breach"
        res["suggestion_amount"] = net["gross"]["discretionary_annual"] * cut     # 필수생활비는 감액 대상 아님
    else:
        res["status"] = "within"
    out["R-05"] = res

    r6 = rules.get("R-06")
    lo, raise_r = _param(r6, "lower_multiplier"), _param(r6, "raise_ratio")
    res = {"status": None, "ratio": ratio, "lower_multiplier": lo, "raise_ratio": raise_r,
           "suggestion_amount": None, "reason": None}
    reason = _rule_state(r6) or ("rule_parameters_invalid" if lo is None or raise_r is None else None) \
        or (rate["reasons"].get("ratio") if ratio is None else None)
    if reason:
        res["reason"] = reason
    elif _lt(ratio, lo):
        res["status"] = "lower_breach"
        res["suggestion_amount"] = net["annual_total"] * raise_r
    else:
        res["status"] = "within"
    out["R-06"] = res

    s5, s6 = out["R-05"]["status"], out["R-06"]["status"]
    out["guardrail"] = ("upper_breach" if s5 == "upper_breach" else "lower_breach" if s6 == "lower_breach"
                        else "within" if "within" in (s5, s6) else None)
    return out


# ── 4.6 데이터 완성도 ─────────────────────────────────────────────

def compute_completeness(bucket_result: dict, baseline: Optional[dict], net: dict) -> dict:
    rows = bucket_result["assets"]
    total = bucket_result["total_assets"]
    default_rows = [r for r in rows if r["bucket_source"] == "default"]
    default_value = sum(r["value"] for r in default_rows)
    return {
        "active_assets": len(rows),
        "default_bucket_count": len(default_rows),
        "default_bucket_value_share": (default_value / total) if total > 0 else None,
        "no_profile_count": sum(1 for r in rows if not r["has_profile"]),
        "unassigned_count": bucket_result["unassigned"]["count"],
        "baseline_set": bool(baseline),
        "cashflow_set": net["counts"]["active_expense"] > 0,
    }


# ── 4.7 통합 ─────────────────────────────────────────────────────

def compute_withdrawal_check(*, as_of: date, assets: list, profiles: list, cashflow_items: list,
                             baseline: Optional[dict], rules: dict, withdrawals: Optional[list] = None,
                             bucket_map: dict = BUCKET_MAP) -> dict:
    """모든 입력을 인자로 받아 점검 결과를 만든다.

    rules: {"R-01": {"enabled": bool, "parameters": {...}}, ...}  (ips_rules 를 rule_code 로 색인)
    profiles: holding_profiles 행 목록 (holding_id, bucket)
    """
    if not isinstance(as_of, date) or isinstance(as_of, datetime):
        raise TypeError("as_of 는 date 여야 합니다")
    profiles_by_id = {p["holding_id"]: p for p in profiles}

    net = compute_net_need(cashflow_items, as_of)
    b = compute_buckets(assets, profiles_by_id, net, bucket_map)
    bucket_rules = evaluate_bucket_rules(b, net, rules)
    rate = compute_withdrawal_rate(baseline, net, b["total_assets"], withdrawals, as_of)
    guard = evaluate_guardrails(rate, net, rules)

    reasons = []
    if net["annual_total"] <= 0:
        reasons.append({"field": "net_need", "code": "no_net_need"})
    for rule_code, r in {**bucket_rules, "R-05": guard["R-05"], "R-06": guard["R-06"]}.items():
        if r["reason"]:
            reasons.append({"field": f"rules.{rule_code}", "code": r["reason"]})
    for field, code in rate["reasons"].items():
        reasons.append({"field": f"withdrawal_rate.{field}", "code": code})
    if b["unassigned"]["count"]:
        reasons.append({"field": "buckets", "code": "unassigned_assets"})

    return {
        "as_of": as_of.isoformat(),
        "total_assets": b["total_assets"],
        "net_need": net,
        "buckets": b["buckets"],
        "cumulative": b["cumulative"],
        "assets": b["assets"],
        "unassigned": b["unassigned"],
        "rules": {**bucket_rules, "R-05": guard["R-05"], "R-06": guard["R-06"], "guardrail": guard["guardrail"]},
        "withdrawal_rate": rate,
        "baseline": ({"withdrawal_start_date": str(baseline.get("withdrawal_start_date"))[:10],
                      "initial_portfolio_value": _num(baseline.get("initial_portfolio_value")),
                      "initial_annual_withdrawal": _num(baseline.get("initial_annual_withdrawal"))}
                     if baseline else None),
        "completeness": compute_completeness(b, baseline, net),
        "assumptions": list(ASSUMPTIONS),
        "provenance": PROVENANCE,
        "reasons": reasons,
    }
