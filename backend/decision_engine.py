"""분기 인출 판단 엔진 (지시서 03, 설계서 4.7) — 순수 함수 모듈.

판단과 근거 제시까지만 한다. 매매 실행·자산 잔액 변경·인출 기록 생성은 하지 않는다.
- DB 접근 없음, 오늘 날짜 호출 없음: 모든 계산은 기준일 `as_of` 를 인자로 받는다.
- 02 의 `withdrawal_check.compute_withdrawal_check` 결과(check)를 입력으로 재사용하고 같은 계산을 다시 하지 않는다.
- 규칙 임계값은 ips_rules 에서 받은 값(`rules`)만 쓴다. 비활성·누락 규칙은 적용하지 않고 skipped_rules 에 사유를 남긴다.
- 사람이 읽는 문장은 만들지 않는다: summary_code 와 reasons 는 코드와 수치만 반환한다 (문장은 화면에서 조립).
- 금액은 원 단위 정수, 반올림은 `to_won` 한 곳(half-up)에서만 한다.
"""
import math
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

EPS = 1e-9          # 연수·비중 경계 비교용 (부동소수 오차 흡수)
WON_TOLERANCE = 0.5  # 금액 비교 허용 오차 (반올림 1원 미만)

CLASSES = ("cash", "bond", "equity", "income")
# 자산유형 → 자산군. utils.calculate_buckets(리밸런싱과 같은 체계: tdf·fund 는 bond)와 같아야 하며 테스트가 일치를 고정한다.
CLASS_OF_TYPE = {"cash": "cash", "bond": "bond", "tdf": "bond", "fund": "bond", "equity": "equity", "income": "income"}
DEFAULT_TARGETS = {"cash": 0.25, "bond": 0.25, "equity": 0.35, "income": 0.15}   # rebalance.py 기본값과 동일
DEFAULT_THRESHOLD = 0.1                                                          # rebalance.py 기본값과 동일

# 계좌 유형별 확인 항목 코드 (문장은 화면에서). 연금·ISA 는 계좌 안 매도 시 현금이 계좌에 남는다는 안내를 붙인다.
ACCOUNT_ITEMS = {
    "pension_savings":    ["pension_annual_limit", "private_pension_separate_tax", "early_withdrawal_restriction", "in_account_cash"],
    "retirement_pension": ["pension_annual_limit", "private_pension_separate_tax", "early_withdrawal_restriction", "in_account_cash"],
    "isa":                ["isa_holding_period", "isa_early_termination_penalty", "in_account_cash"],
    "regular":            ["capital_gain_and_dividend_tax"],
}
PENSION_TYPES = ("pension_savings", "retirement_pension")

ASSUMPTIONS = [
    "판단과 근거 제시까지만 합니다 — 매매 실행, 자산 잔액 변경, 인출 기록 생성은 하지 않습니다",
    "지급액은 순인출 필요액(생활비 계획 기준)의 4분의 1입니다 — 수익률·물가 미반영",
    "시장 국면은 사용자가 입력한 기준지수 하락률로만 판정합니다 (입력이 없으면 정상 국면으로 간주)",
    "세금 금액은 계산하지 않고 계좌별 확인 항목만 제시합니다",
    "버킷은 재지정값이 있으면 그 값, 없으면 자산유형 기본값입니다",
]


# ── 공통 도우미 ────────────────────────────────────────────────────

def to_won(x: float) -> int:
    """원 단위 정수 반올림 (half-up). 금액 반올림은 여기서만 한다."""
    return int(Decimal(str(x)).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def period_of(as_of: date) -> str:
    """분기는 as_of 로 결정한다. 예: 2026-10-05 → '2026-Q4'."""
    return f"{as_of.year}-Q{(as_of.month - 1) // 3 + 1}"


def _lt(a: float, b: float) -> bool:
    return a < b - EPS


def _ge(a: float, b: float) -> bool:
    return a >= b - EPS


def _rule(rules: dict, code: str) -> Optional[dict]:
    return (rules or {}).get(code)


def _rule_unavailable(rule: Optional[dict]) -> Optional[str]:
    if not rule:
        return "rule_missing"
    if not rule.get("enabled", True):
        return "rule_disabled"
    return None


def _param(rule: Optional[dict], key: str) -> Optional[float]:
    v = ((rule or {}).get("parameters") or {}).get(key)
    return None if v is None else float(v)


# ── 시장 국면 (R-04) ──────────────────────────────────────────────

def evaluate_regime(market_input: Optional[dict], rule: Optional[dict]) -> dict:
    """하락률 ≥ drawdown_threshold 이면 downturn (경계값과 같으면 downturn)."""
    reason = _rule_unavailable(rule)
    thr = _param(rule, "drawdown_threshold") if reason is None else None
    if reason is None and thr is None:
        reason = "rule_parameters_invalid"
    drawdown = (market_input or {}).get("drawdown")
    index_name = (market_input or {}).get("index_name")
    if drawdown is not None:
        drawdown = float(drawdown)
        if not (0.0 <= drawdown <= 1.0):
            raise ValueError("drawdown 은 0~1 사이여야 합니다")
    base = {"drawdown": drawdown, "threshold": thr, "index_name": index_name, "reason": reason}
    if reason:                                   # 규칙이 꺼져 있으면 국면 판정을 하지 않고 정상으로 처리
        return {**base, "status": "not_applied"}
    if drawdown is None:
        return {**base, "status": "assumed_normal", "reason": "no_market_input"}
    return {**base, "status": "downturn" if _ge(drawdown, thr) else "normal"}


# ── 자산군 비중과 허용 폭 (R-03) ───────────────────────────────────

def class_analysis(class_totals: dict, targets: dict, threshold: Optional[float], rule: Optional[dict]) -> dict:
    """자산군별 현재 금액·비중·목표 대비 이탈과 허용 폭 초과 여부.

    허용 폭 판정은 기존 리밸런싱과 같이 |현재 비중 − 목표 비중| ≥ 허용 폭 (이상 = 초과).
    mode=config(기본, {} 도 config): 기존 rebalance_threshold 공통값. 0 이면 threshold_zero 경고.
    mode=relative: 허용 폭 = max(목표 비중 × relative, min_abs).
    """
    total = sum(float(class_totals.get(c, 0.0)) for c in CLASSES)
    out = {"total": total, "mode": None, "applied": False, "skip_reason": None, "warnings": [], "classes": {}}
    reason = _rule_unavailable(rule)
    mode, band_for = None, None
    if reason is None:
        params = (rule or {}).get("parameters") or {}
        mode = params.get("mode", "config")
        if mode == "config":
            thr = DEFAULT_THRESHOLD if threshold is None else float(threshold)
            band_for = lambda tgt: thr
            if thr == 0:
                out["warnings"].append({"code": "threshold_zero", "values": {"rebalance_threshold": 0.0}})
        elif mode == "relative":
            rel, min_abs = _param(rule, "relative"), _param(rule, "min_abs")
            if rel is None or min_abs is None or not (0 < rel <= 1) or not (0 <= min_abs <= 1):
                reason = "rule_parameters_invalid"
            else:
                band_for = lambda tgt: max(tgt * rel, min_abs)
        else:
            reason = "rule_parameters_invalid"
    out["mode"] = mode
    out["skip_reason"] = reason
    out["applied"] = reason is None

    for c in CLASSES:
        amount = float(class_totals.get(c, 0.0))
        weight = amount / total if total > 0 else None
        target = float(targets.get(c, DEFAULT_TARGETS[c]))
        diff_ratio = None if weight is None else weight - target
        diff_amount = None if total <= 0 else amount - target * total
        band = band_for(target) if band_for else None
        over_band = bool(band is not None and diff_ratio is not None and _ge(abs(diff_ratio), band))
        # 초과분은 목표보다 큰(과다) 자산군에서만 생긴다 — 부족한 자산군은 매수 대상이지 매도 원천이 아니다
        excess = diff_amount if (over_band and diff_amount is not None and diff_amount > 0) else 0.0
        out["classes"][c] = {"amount": amount, "weight": weight, "target": target, "diff_ratio": diff_ratio,
                             "diff_amount": diff_amount, "band": band, "over_band": over_band, "excess": excess}
    return out


# ── 지급액 (1단계) ────────────────────────────────────────────────

def plan_payment(check: dict, b1_balance: float) -> dict:
    net = check["net_need"]
    annual = net["annual_total"]
    base = to_won(annual / 4)
    r5, r6 = check["rules"]["R-05"], check["rules"]["R-06"]
    recommended = raise_room = None
    if r5["status"] == "upper_breach":
        g = net["gross"]                         # 필수생활비는 줄이지 않는다: (필수 + 선택 × (1 − cut_ratio) − 정기수입) ÷ 4
        recommended = to_won(max(0.0, g["essential_annual"] + g["discretionary_annual"] * (1 - r5["cut_ratio"])
                                 - g["income_annual"]) / 4)
    if r6["status"] == "lower_breach":           # 참고로만 — 기본 지급액은 바꾸지 않는다
        raise_room = to_won(annual * r6["raise_ratio"] / 4)
    return {"base_quarterly": base, "recommended_quarterly": recommended, "raise_room_quarterly": raise_room,
            "source_bucket": 1, "bucket1_balance": to_won(b1_balance),
            "shortfall_before_refill": max(0, base - to_won(b1_balance))}


# ── 매도 원천 선택 (5단계) ────────────────────────────────────────

def _fill(need: float, candidates: list, sold: dict, class_used: dict, class_limit: Optional[dict],
          rule: str, out: list) -> float:
    """candidates 순서대로 need 를 채운다. 자산별 잔액과 (있으면) 자산군 한도를 넘지 않는다. 남은 need 를 반환."""
    remaining = need
    for a in candidates:
        if remaining <= EPS:
            break
        avail = a["value"] - sold.get(a["id"], 0.0)
        if avail <= EPS:
            continue
        cap = remaining
        if class_limit is not None:
            room = class_limit.get(a["asset_class"], 0.0) - class_used.get(a["asset_class"], 0.0)
            if room <= EPS:
                continue
            cap = min(cap, room)
        amt = min(avail, cap)
        sold[a["id"]] = sold.get(a["id"], 0.0) + amt
        class_used[a["asset_class"]] = class_used.get(a["asset_class"], 0.0) + amt
        out.append({"asset": a, "amount": amt, "rule": rule})
        remaining -= amt
    return remaining


def _by_value(assets: list) -> list:
    return sorted(assets, key=lambda a: (-a["value"], a["id"]))


def select_sells(*, need: float, assets: list, analysis: dict, regime_downturn: bool, required: bool) -> list:
    """매도 목록(자산별 금액, 근거 규칙). 1버킷 자산은 제외, 하락 국면에서는 2버킷 자산만.

    우선순위: 1) 허용 폭을 초과한 자산군의 초과분 → 2) (정상 국면·보충 필수일 때) 목표 대비 초과 폭이 큰 자산군
             → 3) (하락 국면) 나머지 2버킷 자산
    """
    eligible = [a for a in assets if a["effective_bucket"] in ((2,) if regime_downturn else (2, 3)) and a["value"] > 0]
    classes = analysis["classes"]
    sold, class_used, picked = {}, {}, []
    remaining = need

    # 1) 허용 폭 초과 자산군 — 초과가 큰 순, 자산군 초과분이 한도
    over = sorted((c for c in CLASSES if classes[c]["excess"] > 0), key=lambda c: (-classes[c]["excess"], CLASSES.index(c)))
    limit1 = {c: classes[c]["excess"] for c in over}
    cand1 = [a for c in over for a in _by_value([x for x in eligible if x["asset_class"] == c])]
    remaining = _fill(remaining, cand1, sold, class_used, limit1, "R-03", picked)

    if remaining > EPS and required:
        if not regime_downturn:
            # 2) 허용 폭 안이라도 목표를 넘는 자산군 — 초과 폭이 큰 순, 목표 대비 초과분이 한도
            above = sorted((c for c in CLASSES if (classes[c]["diff_amount"] or 0) > 0 and classes[c]["excess"] <= 0),
                           key=lambda c: (-classes[c]["diff_amount"], CLASSES.index(c)))
            limit2 = {c: classes[c]["diff_amount"] for c in above}
            cand2 = [a for c in above for a in _by_value([x for x in eligible if x["asset_class"] == c])]
            remaining = _fill(remaining, cand2, sold, class_used, limit2, "R-01", picked)
        else:
            # 3) 하락 국면 — 2버킷 자산에서 (자산군 한도 없이), 과다 자산군의 자산을 먼저, 금액이 큰 순
            def key(a):
                d = classes[a["asset_class"]]["diff_amount"] or 0.0
                return (-d, -a["value"], a["id"])
            remaining = _fill(remaining, sorted(eligible, key=key), sold, class_used, None, "R-04", picked)
    return picked


def _finalize_sells(picked: list, raw_by_id: dict) -> list:
    """부동소수 금액 → 원 단위 정수. 자산별 합계가 잔액(내림)을 넘지 않도록 마지막 항목에서 조정."""
    rows, per_asset = [], {}
    for p in picked:
        a = p["asset"]
        amt = to_won(p["amount"])
        limit = int(math.floor(a["value"] + 1e-9))
        used = per_asset.get(a["id"], 0)
        amt = max(0, min(amt, limit - used))
        per_asset[a["id"]] = used + amt
        if amt <= 0:
            continue
        rows.append({"asset_id": a["id"], "asset_name": a["asset_name"], "asset_class": a["asset_class"],
                     "bucket": a["effective_bucket"], "bucket_source": a["bucket_source"],
                     "account_type": (raw_by_id.get(a["id"]) or {}).get("tax_account_type"),
                     "amount": amt, "rule": p["rule"]})
    return rows


# ── 통합 ─────────────────────────────────────────────────────────

def compute_decision(*, as_of: date, check: dict, rules: dict, assets: Optional[list] = None,
                     targets: Optional[dict] = None, rebalance_threshold: Optional[float] = None,
                     class_totals: Optional[dict] = None, market_input: Optional[dict] = None,
                     pension_usage: Optional[dict] = None) -> dict:
    """분기 판단.

    check: withdrawal_check.compute_withdrawal_check 결과 (실효 버킷·금액·순인출 필요액·규칙 판정 재사용)
    rules: {"R-01": {"enabled", "parameters"}, ... "R-07"}  (ips_rules 를 rule_code 로 색인)
    assets: 활성 자산 원본 행 (계좌 유형 tax_account_type 조회용)
    class_totals: {"cash","bond","equity","income"} 금액 — utils.calculate_buckets 결과를 넘기면 그 값을 쓰고,
                  없으면 check 의 자산 목록에서 CLASS_OF_TYPE 로 합산한다.
    pension_usage: {"year","pension_savings_ytd","retirement_pension_ytd","ytd_total","annual_limit"} (R-07 참고 정보)
    """
    if not isinstance(as_of, date) or isinstance(as_of, datetime):
        raise TypeError("as_of 는 date 여야 합니다")

    raw_by_id = {a["id"]: a for a in (assets or [])}
    rows = []
    for a in check["assets"]:
        rows.append({"id": a["id"], "asset_name": a["asset_name"], "asset_type": a["asset_type"],
                     "asset_class": CLASS_OF_TYPE.get(a["asset_type"]), "value": float(a["value"]),
                     "effective_bucket": a["effective_bucket"], "bucket_source": a["bucket_source"],
                     "account_type": (raw_by_id.get(a["id"]) or {}).get("tax_account_type")})
    if class_totals is None:
        class_totals = {c: sum(r["value"] for r in rows if r["asset_class"] == c) for c in CLASSES}
    targets = {**DEFAULT_TARGETS, **(targets or {})}

    net = check["net_need"]
    annual = net["annual_total"]
    b1 = check["buckets"][0]["value"]

    analysis = class_analysis(class_totals, targets, rebalance_threshold, _rule(rules, "R-03"))
    regime = evaluate_regime(market_input, _rule(rules, "R-04"))
    payment = plan_payment(check, b1)

    skipped, warnings = [], list(analysis["warnings"])
    for code in ("R-01", "R-04", "R-07"):
        r = _rule_unavailable(_rule(rules, code))
        if r:
            skipped.append({"code": code, "reason": r})
    if regime["reason"] == "no_market_input":
        skipped.append({"code": "R-04", "reason": "no_market_input"})
    if regime["reason"] == "rule_parameters_invalid" and not any(s["code"] == "R-04" for s in skipped):
        skipped.append({"code": "R-04", "reason": "rule_parameters_invalid"})
    if analysis["skip_reason"]:
        skipped.append({"code": "R-03", "reason": analysis["skip_reason"]})
    for code in ("R-05", "R-06"):
        st = check["rules"][code]
        if st["status"] is None and st["reason"]:
            skipped.append({"code": code, "reason": st["reason"]})

    r01 = _rule(rules, "R-01")
    r01_reason = _rule_unavailable(r01)
    min_y, target_y = _param(r01, "min_years"), _param(r01, "target_years")
    if r01_reason is None and (min_y is None or target_y is None):
        r01_reason = "rule_parameters_invalid"
        skipped.append({"code": "R-01", "reason": r01_reason})

    downturn = regime["status"] == "downturn"
    refill = {"required": False, "case": None, "reason": None, "target_amount": None, "need_amount": 0,
              "hard_need_amount": 0, "covered_amount": 0, "shortfall_amount": 0, "sells": []}
    b1_info = {"balance": to_won(b1), "after_payment": to_won(b1 - payment["base_quarterly"]),
               "years_before_refill": None, "years_after_refill": None, "after_refill": None}
    reasons, sells = [], []

    if annual <= 0:
        ctype, code = "hold", "no_net_need"
        reasons.append({"code": "no_net_need", "values": {"annual_total": 0}})
    elif r01_reason:
        ctype, code = "pay_only", "r01_not_applied"
        reasons.append({"code": "r01_not_applied", "values": {"reason": r01_reason}})
    else:
        after = b1 - payment["base_quarterly"]
        years = after / annual
        b1_info["years_before_refill"] = years
        min_amt, target_amt = min_y * annual, target_y * annual
        below_min = _lt(years, min_y)
        below_target = _lt(years, target_y)
        base_vals = {"years_after_payment": years, "min_years": min_y, "target_years": target_y}
        if payment["shortfall_before_refill"] > 0:
            reasons.append({"code": "payment_exceeds_bucket1", "values": {"shortfall": payment["shortfall_before_refill"]}})

        hard_need = need = 0.0
        case, required = None, False
        if downturn:
            if below_min:
                case, required = "downturn_below_min", True
                hard_need = need = min_amt - after            # 하락 국면은 min_years 까지만 (target 까지 채우지 않는다)
            else:
                code, ctype = "downturn_above_min", "pay_only"
                reasons.append({"code": "downturn_above_min", "values": {**base_vals, "drawdown": regime["drawdown"],
                                                                        "threshold": regime["threshold"]}})
        else:
            if below_min:
                case, required = "below_min", True
                need, hard_need = target_amt - after, min_amt - after
            elif below_target:
                over_classes = [c for c in CLASSES if analysis["classes"][c]["excess"] > 0]
                if over_classes:
                    case = "below_target_excess"
                    need = target_amt - after
                else:
                    code, ctype = "below_target_no_excess", "pay_only"
                    reasons.append({"code": "below_target_no_excess", "values": {**base_vals, "r03_applied": analysis["applied"]}})
            else:
                code, ctype = "above_target", "pay_only"
                reasons.append({"code": "above_target", "values": base_vals})

        refill.update({"case": case, "required": required, "need_amount": to_won(need) if case else 0,
                       "hard_need_amount": to_won(hard_need) if case else 0,
                       "target_amount": to_won(target_amt) if not downturn else to_won(min_amt)})
        if case:
            picked = select_sells(need=need, assets=rows, analysis=analysis, regime_downturn=downturn, required=required)
            sells = _finalize_sells(picked, raw_by_id)
            covered = sum(s["amount"] for s in sells)
            refill["covered_amount"] = covered
            refill["shortfall_amount"] = max(0, to_won(need) - covered)
            refill["reason"] = case
            hard_unmet = required and (hard_need - covered) > WON_TOLERANCE
            if hard_unmet:
                ctype = "needs_user_judgment"
                code = "downturn_unresolved" if downturn else "below_min_unresolved"
                reasons.append({"code": code, "values": {**base_vals, "shortfall_to_min": to_won(hard_need - covered),
                                                          "covered": covered, "downturn": downturn}})
            elif sells:
                ctype = "pay_and_refill"
                code = {"below_min": "below_min_refill", "below_target_excess": "below_target_excess_refill",
                        "downturn_below_min": "downturn_refill_to_min"}[case]
                reasons.append({"code": code, "values": {**base_vals, "need": to_won(need), "covered": covered}})
                if refill["shortfall_amount"] > 0:
                    reasons.append({"code": "target_not_fully_covered", "values": {"shortfall": refill["shortfall_amount"]}})
            else:
                ctype, code = "pay_only", "below_target_excess_unfillable"
                reasons.append({"code": code, "values": base_vals})
            b1_info["after_refill"] = to_won(after + covered)
            b1_info["years_after_refill"] = (after + covered) / annual
        else:
            b1_info["after_refill"] = b1_info["after_payment"]
            b1_info["years_after_refill"] = years
    refill["sells"] = sells

    account_checks = []
    if _rule_unavailable(_rule(rules, "R-07")) is None:
        seen = set()
        for s in sells:
            if s["asset_id"] in seen:
                continue
            seen.add(s["asset_id"])
            t = s["account_type"]
            ref = None
            if t in PENSION_TYPES and pension_usage:
                used = float(pension_usage.get("ytd_total", 0.0))
                limit = pension_usage.get("annual_limit")
                ref = {"year": pension_usage.get("year"), "pension_savings_ytd": pension_usage.get("pension_savings_ytd"),
                       "retirement_pension_ytd": pension_usage.get("retirement_pension_ytd"), "ytd_total": used,
                       "annual_limit": limit, "remaining": None if limit is None else max(0.0, float(limit) - used)}
            account_checks.append({"asset_id": s["asset_id"], "asset_name": s["asset_name"], "account_type": t,
                                   "items": list(ACCOUNT_ITEMS.get(t, [])), "reference": ref})

    skipped_codes = {s["code"] for s in skipped}
    applied = sorted(c for c in ("R-01", "R-03", "R-04", "R-05", "R-06", "R-07")
                     if c not in skipped_codes and (c != "R-04" or regime["status"] in ("normal", "downturn")))
    r2 = check["rules"]["R-02"]
    return {
        "as_of": as_of.isoformat(), "period": period_of(as_of),
        "inputs_snapshot": {
            "net_need": {"annual_total": net["annual_total"], "annual_essential": net["annual_essential"], "gross": net["gross"]},
            "buckets": [{"bucket": b["bucket"], "value": b["value"], "years_total": b["years_total"]} for b in check["buckets"]],
            "class_weights": analysis["classes"], "class_mode": analysis["mode"], "targets": targets,
            "rebalance_threshold": rebalance_threshold,
            "rules": {k: {"enabled": v.get("enabled", True), "parameters": v.get("parameters") or {}}
                      for k, v in (rules or {}).items()},
            "market_input": market_input, "assets": rows,
        },
        "payment": payment,
        "regime": regime,
        "refill": refill,
        "bucket1_after": b1_info,
        "bucket2_reference": {"years": r2["years"], "target_years": r2["target_years"], "status": r2["status"]},
        "account_checks": account_checks,
        "conclusion": {"type": ctype, "summary_code": code, "reasons": reasons},
        "applied_rules": applied, "skipped_rules": skipped, "warnings": warnings,
        "assumptions": list(ASSUMPTIONS),
    }
