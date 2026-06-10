"""연금소득세 계산 API.

계산 모델 (보수적 단순화):
- pension_savings 인출: 전액 연간 1,500만원 한도 대상
- retirement_pension 인출: 퇴직금 원금 소진 이전은 한도 제외,
  소진 이후(운용수익 재원)는 한도 대상.
  소진 경계에 걸치는 인출 건: 원금 부분 제외 + 운용수익 부분만 한도 포함 (비례 분할).
"""
import calendar
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database import supabase
from utils import get_config
from tax_constants import PRIVATE_PENSION_ANNUAL_LIMIT, PENSION_TAX_RATES

router = APIRouter()


# ── 날짜 유틸 ───────────────────────────────────────────────────

def _add_months(d: date, months: int) -> date:
    """d에 months 개월을 더한 날짜. 말일은 해당 월 마지막 날로 클램프."""
    total = d.month - 1 + months
    year = d.year + total // 12
    month = total % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


# ── 설정 헬퍼 ───────────────────────────────────────────────────

def _get_age(config: dict) -> Optional[int]:
    birth_year = config.get("user", {}).get("birth_year")
    return (date.today().year - int(birth_year)) if birth_year else None


def _get_tax_rate_info(age: Optional[int]) -> dict:
    if age is None:
        return {"age": None, "rate": None, "rate_pct": None, "bracket": "나이 미설정"}
    for (lo, hi), rate in PENSION_TAX_RATES.items():
        if lo <= age <= hi:
            return {"age": age, "rate": rate, "rate_pct": round(rate * 100, 1), "bracket": f"{lo}~{hi}세"}
    if age < 55:
        return {"age": age, "rate": None, "rate_pct": None, "bracket": "55세 미만 (사적연금 개시 전)"}
    return {"age": age, "rate": 0.033, "rate_pct": 3.3, "bracket": "80세 이상"}


def _limit_status(pct: float) -> str:
    if pct >= 100:
        return "danger"
    if pct >= 80:
        return "warning"
    return "safe"


# ── 핵심 계산 함수 (테스트에서 직접 import 가능하도록 public) ────

def calc_depletion(
    severance_principal: float,
    pension_start_date: date,
    monthly_pension_amount: float,
    rp_records: list,
) -> dict:
    """
    퇴직금 원금 소진 예측.

    rp_records: retirement_pension 계좌 인출 기록 dict 목록
      (각 dict에 'withdrawal_date': 'YYYY-MM-DD', 'amount': float 포함)

    인출 기록이 있으면 실적 우선, 없으면 계획값으로 추정.
    반환: remaining_principal, withdrawn_principal, depletion_date,
          is_estimate, assumption, is_depleted, months_remaining
    """
    today = date.today()

    post_start = sorted(
        [r for r in rp_records if date.fromisoformat(r["withdrawal_date"]) >= pension_start_date],
        key=lambda r: r["withdrawal_date"],
    )

    if post_start:
        cumulative = 0.0
        depletion_date = None
        for rec in post_start:
            cumulative += float(rec["amount"])
            if depletion_date is None and cumulative >= severance_principal:
                depletion_date = date.fromisoformat(rec["withdrawal_date"])
                break

        withdrawn = min(cumulative, severance_principal)
        remaining = max(0.0, severance_principal - cumulative)
        is_depleted = cumulative >= severance_principal

        if is_depleted:
            return {
                "remaining_principal": 0.0,
                "withdrawn_principal": withdrawn,
                "depletion_date": depletion_date.isoformat() if depletion_date else None,
                "is_estimate": False,
                "assumption": "실제 인출 기록 기준",
                "is_depleted": True,
                "months_remaining": 0,
            }

        if monthly_pension_amount > 0:
            months_rem = int(remaining / monthly_pension_amount)
            return {
                "remaining_principal": remaining,
                "withdrawn_principal": withdrawn,
                "depletion_date": _add_months(today, months_rem).isoformat(),
                "is_estimate": True,
                "assumption": (
                    f"실적 기준 잔여 원금 {remaining:,.0f}원, "
                    f"월 {monthly_pension_amount:,.0f}원 수령 기준 추정"
                ),
                "is_depleted": False,
                "months_remaining": months_rem,
            }
        return {
            "remaining_principal": remaining,
            "withdrawn_principal": withdrawn,
            "depletion_date": None,
            "is_estimate": True,
            "assumption": "월 수령액 미설정 — 소진 시점 추정 불가",
            "is_depleted": False,
            "months_remaining": None,
        }

    # 인출 기록 없음 — 계획값으로 추정
    if monthly_pension_amount <= 0:
        return {
            "remaining_principal": severance_principal,
            "withdrawn_principal": 0.0,
            "depletion_date": None,
            "is_estimate": True,
            "assumption": "월 수령액 미설정 — 소진 시점 추정 불가",
            "is_depleted": False,
            "months_remaining": None,
        }

    months_elapsed = max(
        0,
        (today.year - pension_start_date.year) * 12 + (today.month - pension_start_date.month),
    )
    est_withdrawn = min(months_elapsed * monthly_pension_amount, severance_principal)
    remaining = max(0.0, severance_principal - est_withdrawn)

    if remaining <= 0:
        total_months = int(severance_principal / monthly_pension_amount)
        dep_date = _add_months(pension_start_date, total_months - 1)
        return {
            "remaining_principal": 0.0,
            "withdrawn_principal": severance_principal,
            "depletion_date": dep_date.isoformat(),
            "is_estimate": True,
            "assumption": f"월 {monthly_pension_amount:,.0f}원 수령 기준 추정 (인출 기록 없음)",
            "is_depleted": True,
            "months_remaining": 0,
        }

    months_rem = int(remaining / monthly_pension_amount)
    return {
        "remaining_principal": remaining,
        "withdrawn_principal": est_withdrawn,
        "depletion_date": _add_months(today, months_rem).isoformat(),
        "is_estimate": True,
        "assumption": f"월 {monthly_pension_amount:,.0f}원 수령 기준 추정 (인출 기록 없음)",
        "is_depleted": False,
        "months_remaining": months_rem,
    }


def calc_retirement_pension_limit_ytd(
    year: int,
    all_withdrawals: list,
    pension_start_date: Optional[date],
    severance_principal: Optional[float],
) -> float:
    """
    retirement_pension 계좌의 당해 연도 연간 한도 대상 금액.

    원금 구간 인출은 한도 제외, 원금 소진 이후(운용수익 재원)는 한도 대상.
    소진 경계 인출 건은 비례 분할 (원금 부분 제외 + 운용수익 부분만 포함).

    설정 미입력 시 보수적으로 전액 한도 대상 처리.
    """
    if not pension_start_date or not severance_principal:
        return sum(
            float(r["amount"])
            for r in all_withdrawals
            if (
                r["tax_account_type"] == "retirement_pension"
                and date.fromisoformat(r["withdrawal_date"]).year == year
            )
        )

    year_start = date(year, 1, 1)
    year_end   = date(year, 12, 31)

    # 개시일 이후 retirement_pension 기록 전체 (날짜 오름차순)
    rp_all = sorted(
        [
            r for r in all_withdrawals
            if r["tax_account_type"] == "retirement_pension"
            and date.fromisoformat(r["withdrawal_date"]) >= pension_start_date
        ],
        key=lambda r: r["withdrawal_date"],
    )

    # 연도 시작 이전 누적
    cum_before = sum(
        float(r["amount"])
        for r in rp_all
        if date.fromisoformat(r["withdrawal_date"]) < year_start
    )

    limit_ytd  = 0.0
    cumulative = cum_before

    for rec in rp_all:
        rec_date = date.fromisoformat(rec["withdrawal_date"])
        if not (year_start <= rec_date <= year_end):
            continue

        amount = float(rec["amount"])

        if cumulative >= severance_principal:
            # 이미 소진 → 전액 한도 대상
            limit_ytd += amount
        else:
            remaining_principal = severance_principal - cumulative
            if amount > remaining_principal:
                # 경계 비례 분할: 운용수익 부분만 한도 포함
                limit_ytd += amount - remaining_principal

        cumulative += amount

    return limit_ytd


# ── Pydantic 모델 ────────────────────────────────────────────────

class PensionPlanIn(BaseModel):
    severance_principal: Optional[float] = None
    pension_start_date: Optional[str] = None
    monthly_pension_amount: Optional[float] = None
    other_private_pension_annual: Optional[float] = None


# ── 라우터 ───────────────────────────────────────────────────────

@router.put("/plan")
def update_pension_plan(body: PensionPlanIn):
    """연금 계획 설정 저장 (user_config JSON의 pension_plan 키)."""
    config = get_config()
    plan = dict(config.get("pension_plan") or {})

    if body.severance_principal is not None:
        if body.severance_principal < 0:
            raise HTTPException(status_code=400, detail="severance_principal은 0 이상이어야 합니다")
        plan["severance_principal"] = body.severance_principal

    if body.pension_start_date is not None:
        try:
            date.fromisoformat(body.pension_start_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="pension_start_date 형식 오류 (YYYY-MM-DD)")
        plan["pension_start_date"] = body.pension_start_date

    if body.monthly_pension_amount is not None:
        if body.monthly_pension_amount < 0:
            raise HTTPException(status_code=400, detail="monthly_pension_amount는 0 이상이어야 합니다")
        plan["monthly_pension_amount"] = body.monthly_pension_amount

    if body.other_private_pension_annual is not None:
        if body.other_private_pension_annual < 0:
            raise HTTPException(status_code=400, detail="other_private_pension_annual은 0 이상이어야 합니다")
        plan["other_private_pension_annual"] = body.other_private_pension_annual

    config["pension_plan"] = plan
    supabase.table("user_config").update({
        "value":      config,
        "updated_at": datetime.now().isoformat(),
    }).eq("key", "config").execute()

    return {"ok": True, "pension_plan": plan}


@router.get("/summary")
def get_pension_tax_summary():
    """연금소득세 종합 계산 요약."""
    config = get_config()
    plan   = config.get("pension_plan") or {}

    severance_principal        = plan.get("severance_principal")
    pension_start_date_str     = plan.get("pension_start_date")
    monthly_pension_amount     = plan.get("monthly_pension_amount")
    other_private_pension_annual = float(plan.get("other_private_pension_annual") or 0)

    has_plan = bool(severance_principal and pension_start_date_str and monthly_pension_amount)
    pension_start_date = date.fromisoformat(pension_start_date_str) if pension_start_date_str else None

    # 인출 기록 전체 조회
    all_withdrawals = (
        supabase.table("withdrawals").select("*").order("withdrawal_date").execute().data or []
    )
    rp_records = [r for r in all_withdrawals if r["tax_account_type"] == "retirement_pension"]

    # (A) 퇴직금 원금 소진 예측
    depletion = None
    if has_plan:
        depletion = calc_depletion(
            float(severance_principal),
            pension_start_date,
            float(monthly_pension_amount),
            rp_records,
        )

    # (B) 당해 연도 한도 집계
    today = date.today()
    year  = today.year

    ps_ytd = sum(
        float(r["amount"])
        for r in all_withdrawals
        if r["tax_account_type"] == "pension_savings"
        and date.fromisoformat(r["withdrawal_date"]).year == year
    )
    rp_ytd = calc_retirement_pension_limit_ytd(
        year,
        all_withdrawals,
        pension_start_date,
        float(severance_principal) if severance_principal else None,
    )
    ytd_total = ps_ytd + rp_ytd
    pct = round(ytd_total / PRIVATE_PENSION_ANNUAL_LIMIT * 100, 1)

    # (C) 권장 월 수령액
    over_other   = other_private_pension_annual >= PRIVATE_PENSION_ANNUAL_LIMIT
    monthly_limit = max(0.0, (PRIVATE_PENSION_ANNUAL_LIMIT - other_private_pension_annual) / 12)

    # (D) 나이별 세율
    age = _get_age(config)

    # 당해 연도 한도 관련 인출 기록 (블록 3 리스트용)
    withdrawals_ytd = sorted(
        [
            r for r in all_withdrawals
            if date.fromisoformat(r["withdrawal_date"]).year == year
            and r["tax_account_type"] in ("pension_savings", "retirement_pension")
        ],
        key=lambda r: r["withdrawal_date"],
        reverse=True,
    )

    return {
        "has_plan": has_plan,
        "plan": {
            "severance_principal":         severance_principal,
            "pension_start_date":          pension_start_date_str,
            "monthly_pension_amount":      monthly_pension_amount,
            "other_private_pension_annual": other_private_pension_annual,
        },
        "depletion": depletion,
        "limit_ytd": {
            "year":                    year,
            "pension_savings_ytd":     ps_ytd,
            "retirement_pension_ytd":  rp_ytd,
            "ytd_amount":              ytd_total,
            "limit":                   PRIVATE_PENSION_ANNUAL_LIMIT,
            "remaining":               PRIVATE_PENSION_ANNUAL_LIMIT - ytd_total,
            "pct":                     pct,
            "status":                  _limit_status(pct),
            "is_over_limit":           ytd_total > PRIVATE_PENSION_ANNUAL_LIMIT,
        },
        "monthly_guide": {
            "other_annual":       other_private_pension_annual,
            "monthly_limit":      monthly_limit,
            "over_other_pension": over_other,
        },
        "tax_rate":       _get_tax_rate_info(age),
        "withdrawals_ytd": withdrawals_ytd,
    }
