from fastapi import APIRouter
from datetime import date, timedelta
from utils import get_config, get_active_assets, calculate_buckets, LABEL_MAP

router = APIRouter()

PENSION_KEYWORDS = ["연금저축", "IRP", "irp", "퇴직연금", "개인연금"]


def _is_pension(account_name: str) -> bool:
    return any(k in account_name for k in PENSION_KEYWORDS)


@router.get("")
def get_rebalance():
    config  = get_config()
    assets  = get_active_assets()
    buckets = calculate_buckets(assets, config)

    targets   = config.get("portfolio", {})
    threshold = targets.get("rebalance_threshold", 0.1)

    target_map = {
        "cash":   targets.get("target_cash",   0.25),
        "bond":   targets.get("target_bond",   0.25),
        "equity": targets.get("target_equity", 0.35),
        "income": targets.get("target_income", 0.15),
    }
    current_map = {
        "cash":   buckets["cash_ratio"],
        "bond":   buckets["bond_ratio"],
        "equity": buckets["equity_ratio"],
        "income": buckets["income_ratio"],
    }

    total = buckets["total"]
    comparisons = []
    adjustments = []

    for k in target_map:
        label    = LABEL_MAP[k]
        cur_pct  = current_map[k]
        tgt_pct  = target_map[k]
        diff_pct = cur_pct - tgt_pct
        cur_amt  = total * cur_pct
        tgt_amt  = total * tgt_pct
        diff_amt = tgt_amt - cur_amt  # positive = buy, negative = sell

        comparisons.append({
            "key": k, "label": label,
            "current_pct": round(cur_pct * 100, 1),
            "target_pct":  round(tgt_pct * 100, 1),
            "diff_pct":    round(diff_pct * 100, 1),
            "current_amt": round(cur_amt),
            "target_amt":  round(tgt_amt),
            "diff_amt":    round(diff_amt),
            "needs_action": abs(diff_pct) >= threshold,
            "action": "매수" if diff_amt > 0 else "매도",
        })

        if abs(diff_pct) >= threshold:
            # 해당 자산군의 개별 자산 목록
            if k == "bond":
                related = [a for a in assets if a["asset_type"] in ("bond", "tdf", "fund")]
            else:
                related = [a for a in assets if a["asset_type"] == k]

            related_total = sum(a["current_value"] for a in related)
            items = []
            for a in related:
                w = a["current_value"] / related_total if related_total > 0 else 0
                items.append({
                    "id": a["id"],
                    "asset_name":   a["asset_name"],
                    "account_name": a["account_name"],
                    "current_value": a["current_value"],
                    "trade_amount": round(abs(diff_amt) * w),
                    "is_pension": _is_pension(a["account_name"]),
                })
            adjustments.append({
                "key": k, "label": label,
                "action": "매수" if diff_amt > 0 else "매도",
                "amount": round(abs(diff_amt)),
                "items": items,
            })

    # 세금효율 순서 분류
    pension_assets  = [a for a in assets if _is_pension(a["account_name"])]
    general_assets  = [a for a in assets if not _is_pension(a["account_name"])]

    return {
        "comparisons":    comparisons,
        "adjustments":    adjustments,
        "needs_rebalance": any(c["needs_action"] for c in comparisons),
        "total":          total,
        "threshold_pct":  round(threshold * 100),
        "pension_assets": [{"id": a["id"], "asset_name": a["asset_name"],
                            "account_name": a["account_name"],
                            "current_value": a["current_value"]} for a in pension_assets],
        "general_assets": [{"id": a["id"], "asset_name": a["asset_name"],
                            "account_name": a["account_name"],
                            "current_value": a["current_value"]} for a in general_assets],
    }


# ── 만기 자산 재배분 가이드 ──────────────────────────────────────────
@router.get("/maturity-guide")
def get_maturity_guide():
    config  = get_config()
    assets  = get_active_assets()
    buckets = calculate_buckets(assets, config)
    targets = config.get("portfolio", {})
    today   = date.today()

    monthly_expense = float(config.get("user", {}).get("monthly_expense", 5_000_000))
    b1_months = round(buckets["b1"] / monthly_expense, 1) if monthly_expense else 0
    total = buckets["total"]

    target_map = {
        "cash":   targets.get("target_cash",   0.25),
        "bond":   targets.get("target_bond",   0.25),
        "equity": targets.get("target_equity", 0.35),
        "income": targets.get("target_income", 0.15),
    }

    # ── B1/B2/B3 버킷별 현황 ──────────────────────────────────────
    b1_cur = buckets["cash_ratio"]
    b2_cur = buckets["bond_ratio"]
    b3_cur = buckets["equity_ratio"] + buckets["income_ratio"]
    b1_tgt = target_map["cash"]
    b2_tgt = target_map["bond"]
    b3_tgt = target_map["equity"] + target_map["income"]

    bucket_status = [
        {
            "bucket": "B1", "name": "현금성 자산", "color": "blue",
            "asset_types": ["cash"],
            "current_pct": round(b1_cur * 100, 1),
            "target_pct":  round(b1_tgt * 100, 1),
            "deviation":   round((b1_cur - b1_tgt) * 100, 1),
            "current_amt": round(total * b1_cur),
            "target_amt":  round(total * b1_tgt),
            "shortage":    round(max(0.0, (b1_tgt - b1_cur) * total)),
        },
        {
            "bucket": "B2", "name": "채권/TDF/펀드", "color": "green",
            "asset_types": ["bond", "tdf", "fund"],
            "current_pct": round(b2_cur * 100, 1),
            "target_pct":  round(b2_tgt * 100, 1),
            "deviation":   round((b2_cur - b2_tgt) * 100, 1),
            "current_amt": round(total * b2_cur),
            "target_amt":  round(total * b2_tgt),
            "shortage":    round(max(0.0, (b2_tgt - b2_cur) * total)),
        },
        {
            "bucket": "B3", "name": "주식형/인컴", "color": "purple",
            "asset_types": ["equity", "income"],
            "current_pct": round(b3_cur * 100, 1),
            "target_pct":  round(b3_tgt * 100, 1),
            "deviation":   round((b3_cur - b3_tgt) * 100, 1),
            "current_amt": round(total * b3_cur),
            "target_amt":  round(total * b3_tgt),
            "shortage":    round(max(0.0, (b3_tgt - b3_cur) * total)),
        },
    ]

    # ── 우선순위 결정 ──────────────────────────────────────────────
    # 규칙 1: B1 안전망 < 6개월 → B1 최우선
    # 규칙 2: 부족 금액 큰 버킷 순
    # 규칙 3: 모두 적정이면 B2 (안정적 중간 버킷)
    def _priority(b: dict) -> float:
        if b["bucket"] == "B1" and b1_months < 6:
            return -1e15          # 절대 최우선
        return -b["shortage"]     # 부족액 내림차순

    sorted_buckets = sorted(bucket_status, key=_priority)
    primary = sorted_buckets[0]

    # 이유 문장 생성
    reasons: list[str] = []
    if b1_months < 6:
        reasons.append(
            f"현금성 자산(B1)이 생활비 {b1_months:.1f}개월치 — "
            f"안전 기준(6개월) 미달로 최우선 보충 필요"
        )
    for b in bucket_status:
        if b["shortage"] > 0:
            reasons.append(
                f"{b['name']}({b['bucket']}) {abs(b['deviation']):.1f}%p 부족 "
                f"(부족액 약 {b['shortage'] / 1e4:,.0f}만원)"
            )
    if not reasons:
        reasons.append("현재 모든 버킷이 목표 비율에 근접합니다. "
                       "만기 자산은 기존 유형과 동일하게 재투자하거나 "
                       "B2(채권/TDF)로 편입해 안정성을 높이세요.")

    # ── 만기 예정 자산 (90일 이내) ────────────────────────────────
    cutoff = (today + timedelta(days=90)).isoformat()
    maturing = sorted(
        [a for a in assets
         if a.get("maturity_date") and a["maturity_date"][:10] <= cutoff],
        key=lambda a: a["maturity_date"]
    )

    maturity_items = []
    for a in maturing:
        md        = date.fromisoformat(a["maturity_date"][:10])
        days_left = (md - today).days
        is_pension = _is_pension(a.get("account_name", ""))
        maturity_items.append({
            "id":             a["id"],
            "asset_name":     a["asset_name"],
            "account_name":   a["account_name"],
            "asset_type":     a.get("asset_type"),
            "current_value":  float(a["current_value"]),
            "maturity_date":  a["maturity_date"][:10],
            "days_left":      days_left,
            "urgency":        "긴급" if days_left <= 7
                              else "주의" if days_left <= 30
                              else "예정",
            "is_pension":     is_pension,
            "account_note":   "IRP/연금저축 내 재투자" if is_pension else "자유롭게 이동 가능",
            "recommended_bucket":      primary["bucket"],
            "recommended_bucket_name": primary["name"],
        })

    return {
        "bucket_status":       bucket_status,
        "priority_order":      [b["bucket"] for b in sorted_buckets],
        "primary_bucket":      primary,
        "reasons":             reasons,
        "maturing_assets":     maturity_items,
        "maturity_total":      sum(float(a["current_value"]) for a in maturing),
        "maturing_count":      len(maturing),
        "b1_months_covered":   b1_months,
        "monthly_expense":     monthly_expense,
        "total":               total,
    }
