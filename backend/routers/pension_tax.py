"""연금소득세 계산 API (v2 — 듀얼 트랙 모델).

세법 모델:
- 퇴직연금(IRP, retirement_pension): 이연퇴직소득(퇴직금 원금) 먼저 인출 — 한도 무관.
  원금 소진 후 운용수익 — 연 1,500만원 한도 대상. 과세 전환 = 원금 소진 시점.
- 개인연금(연금저축, pension_savings): 세액공제 받지 않은 납입 원금 먼저 — 비과세, 한도 무관.
  그 다음 세액공제 받은 원금 + 운용수익(한 묶음) — 한도 대상.
  과세 전환 = 세액공제 받지 않은 원금의 소진 시점.
  ⚠️ pp_deducted_principal(세액공제 받은 원금)은 운용수익과 같은 과세 단계 —
     과세 전환 시점 계산에 사용하지 않는다 (참고값).
- 1,500만원 한도: 계좌별 과세 전환 시점 이후 인출분만 연도별 합산.
  전환 경계에 걸친 인출 건은 금액 비례 분할.
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

MONTHLY_CAP = PRIVATE_PENSION_ANNUAL_LIMIT / 12  # 1,250,000


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
    principal: float,
    start_date: date,
    monthly_amount: float,
    records: list,
) -> dict:
    """
    비과세 풀(퇴직금 원금 / 세액공제 받지 않은 납입 원금) 소진 예측.

    records: 해당 계좌 유형의 인출 기록 dict 목록
      (각 dict에 'withdrawal_date': 'YYYY-MM-DD', 'amount': float 포함)

    인출 기록이 있으면 실적 우선, 없으면 계획값으로 추정.
    반환: remaining_principal, withdrawn_principal, depletion_date,
          is_estimate, assumption, is_depleted, months_remaining
    """
    today = date.today()

    post_start = sorted(
        [r for r in records if date.fromisoformat(r["withdrawal_date"]) >= start_date],
        key=lambda r: r["withdrawal_date"],
    )

    if post_start:
        cumulative = 0.0
        depletion_date = None
        for rec in post_start:
            cumulative += float(rec["amount"])
            if depletion_date is None and cumulative >= principal:
                depletion_date = date.fromisoformat(rec["withdrawal_date"])
                break

        withdrawn = min(cumulative, principal)
        remaining = max(0.0, principal - cumulative)
        is_depleted = cumulative >= principal

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

        if monthly_amount > 0:
            months_rem = int(remaining / monthly_amount)
            return {
                "remaining_principal": remaining,
                "withdrawn_principal": withdrawn,
                "depletion_date": _add_months(today, months_rem).isoformat(),
                "is_estimate": True,
                "assumption": (
                    f"실적 기준 잔여 원금 {remaining:,.0f}원, "
                    f"월 {monthly_amount:,.0f}원 수령 기준 추정"
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
    if monthly_amount <= 0:
        return {
            "remaining_principal": principal,
            "withdrawn_principal": 0.0,
            "depletion_date": None,
            "is_estimate": True,
            "assumption": "월 수령액 미설정 — 소진 시점 추정 불가",
            "is_depleted": False,
            "months_remaining": None,
        }

    months_elapsed = max(
        0,
        (today.year - start_date.year) * 12 + (today.month - start_date.month),
    )
    est_withdrawn = min(months_elapsed * monthly_amount, principal)
    remaining = max(0.0, principal - est_withdrawn)

    if remaining <= 0:
        total_months = int(principal / monthly_amount)
        dep_date = _add_months(start_date, total_months - 1)
        return {
            "remaining_principal": 0.0,
            "withdrawn_principal": principal,
            "depletion_date": dep_date.isoformat(),
            "is_estimate": True,
            "assumption": f"월 {monthly_amount:,.0f}원 수령 기준 추정 (인출 기록 없음)",
            "is_depleted": True,
            "months_remaining": 0,
        }

    months_rem = int(remaining / monthly_amount)
    return {
        "remaining_principal": remaining,
        "withdrawn_principal": est_withdrawn,
        "depletion_date": _add_months(today, months_rem).isoformat(),
        "is_estimate": True,
        "assumption": f"월 {monthly_amount:,.0f}원 수령 기준 추정 (인출 기록 없음)",
        "is_depleted": False,
        "months_remaining": months_rem,
    }


def calc_track_limit_ytd(
    year: int,
    records: list,
    start_date: Optional[date],
    principal: Optional[float],
) -> float:
    """
    한 계좌 트랙의 당해 연도 연간 한도 대상 금액.

    records: 해당 계좌 유형으로 이미 필터링된 인출 기록 목록.
    비과세 풀(principal) 구간 인출은 한도 제외, 소진 이후는 한도 대상.
    소진 경계 인출 건은 비례 분할 (비과세 부분 제외 + 과세 부분만 포함).

    - principal이 0이면 개시일부터 즉시 과세 (개시일 이후 전액 한도 대상)
    - start_date 또는 principal 미입력(None)이면 보수적으로 전액 한도 대상 처리
    """
    if start_date is None or principal is None:
        return sum(
            float(r["amount"])
            for r in records
            if date.fromisoformat(r["withdrawal_date"]).year == year
        )

    year_start = date(year, 1, 1)
    year_end   = date(year, 12, 31)

    # 개시일 이후 기록 전체 (날짜 오름차순)
    post_start = sorted(
        [r for r in records if date.fromisoformat(r["withdrawal_date"]) >= start_date],
        key=lambda r: r["withdrawal_date"],
    )

    # 연도 시작 이전 누적
    cum_before = sum(
        float(r["amount"])
        for r in post_start
        if date.fromisoformat(r["withdrawal_date"]) < year_start
    )

    limit_ytd  = 0.0
    cumulative = cum_before

    for rec in post_start:
        rec_date = date.fromisoformat(rec["withdrawal_date"])
        if not (year_start <= rec_date <= year_end):
            continue

        amount = float(rec["amount"])

        if cumulative >= principal:
            # 이미 소진 → 전액 한도 대상
            limit_ytd += amount
        else:
            remaining_principal = principal - cumulative
            if amount > remaining_principal:
                # 경계 비례 분할: 과세 부분만 한도 포함
                limit_ytd += amount - remaining_principal

        cumulative += amount

    return limit_ytd


def build_track(track_type: str, plan: dict, records: list) -> dict:
    """
    계좌 트랙(retirement_pension | pension_savings)의 상태 계산.

    plan(user_config의 pension_plan)에서 트랙별 값을 읽는다:
    - retirement_pension: severance_principal / pension_start_date / monthly_pension_amount
    - pension_savings:    pp_non_deducted_principal / pp_start_date / pp_monthly_amount
      (pp_deducted_principal은 참고값 — 과세 전환 시점 계산에 사용하지 않음)

    반환 dict: active, plan, depletion, tax_start_date, tax_started, principal
    """
    today = date.today()

    if track_type == "retirement_pension":
        principal_raw = plan.get("severance_principal")
        start_str     = plan.get("pension_start_date")
        monthly       = plan.get("monthly_pension_amount")
        track_plan = {
            "principal":      principal_raw,
            "start_date":     start_str,
            "monthly_amount": monthly,
        }
        # 퇴직연금: 원금·개시일·월 수령액 모두 필요
        active = bool(principal_raw and start_str and monthly)
    else:  # pension_savings
        principal_raw = plan.get("pp_non_deducted_principal")
        start_str     = plan.get("pp_start_date")
        monthly       = plan.get("pp_monthly_amount")
        track_plan = {
            "non_deducted_principal": principal_raw,
            "deducted_principal":     plan.get("pp_deducted_principal"),
            "start_date":             start_str,
            "monthly_amount":         monthly,
        }
        # 개인연금: 개시일·월 수령액 필요. 비과세 원금 0/미입력은 즉시 과세로 동작
        active = bool(start_str and monthly)

    if not active:
        return {
            "type": track_type, "active": False, "plan": track_plan,
            "depletion": None, "tax_start_date": None, "tax_started": False,
            "principal": None,
        }

    start_date = date.fromisoformat(start_str)
    principal  = float(principal_raw or 0)

    if principal <= 0:
        # 비과세 풀 없음 → 개시일부터 즉시 과세
        return {
            "type": track_type, "active": True, "plan": track_plan,
            "depletion": {
                "remaining_principal": 0.0,
                "withdrawn_principal": 0.0,
                "depletion_date": start_date.isoformat(),
                "is_estimate": False,
                "assumption": "비과세 원금 없음 — 개시일부터 즉시 과세 단계",
                "is_depleted": True,
                "months_remaining": 0,
            },
            "tax_start_date": start_date.isoformat(),
            "tax_started": start_date <= today,
            "principal": 0.0,
        }

    depletion = calc_depletion(principal, start_date, float(monthly), records)
    tax_start = depletion.get("depletion_date")
    return {
        "type": track_type, "active": True, "plan": track_plan,
        "depletion": depletion,
        "tax_start_date": tax_start,
        "tax_started": bool(tax_start and date.fromisoformat(tax_start) <= today),
        "principal": principal,
    }


def calc_phases(rp_track: dict, pp_track: dict) -> list:
    """
    시간 축 3구간 (비과세 / 단독 과세 / 동시 과세) 계산.

    구간은 별도 분기문이 아니라 각 트랙의 과세 전환 시점에서 자연히 도출:
    - 비과세: 모든 활성 트랙이 과세 전환 전
    - 단독 과세: 한 트랙만 과세 전환 후 (해당 트랙 월 합계 ≤ 125만 권장)
    - 동시 과세: 두 트랙 모두 과세 전환 후 (두 트랙 월 합계 ≤ 125만 권장)

    과세 전환 시점을 알 수 없는 트랙(월 수령액 미설정 등)이 있으면 빈 목록 반환.
    """
    active = [t for t in (rp_track, pp_track) if t["active"]]
    if not active:
        return []
    if any(t["tax_start_date"] is None for t in active):
        return []  # 전환 시점 미상 — 구간 계산 불가

    starts = [date.fromisoformat(t["plan"]["start_date"]) for t in active]
    earliest_start = min(starts)
    tax_starts = sorted(
        (date.fromisoformat(t["tax_start_date"]), t["type"]) for t in active
    )

    phases = []
    first_tax, first_type = tax_starts[0]

    if first_tax > earliest_start:
        phases.append({
            "phase": "tax_free",
            "from": earliest_start.isoformat(),
            "to": first_tax.isoformat(),
            "taxable_accounts": [],
            "monthly_cap": None,
        })

    if len(tax_starts) == 1:
        phases.append({
            "phase": "single",
            "from": first_tax.isoformat(),
            "to": None,
            "taxable_accounts": [first_type],
            "monthly_cap": MONTHLY_CAP,
        })
        return phases

    second_tax, second_type = tax_starts[1]
    if second_tax > first_tax:
        phases.append({
            "phase": "single",
            "from": first_tax.isoformat(),
            "to": second_tax.isoformat(),
            "taxable_accounts": [first_type],
            "monthly_cap": MONTHLY_CAP,
        })
    phases.append({
        "phase": "dual",
        "from": second_tax.isoformat(),
        "to": None,
        "taxable_accounts": [first_type, second_type] if second_tax > first_tax
                            else sorted([first_type, second_type]),
        "monthly_cap": MONTHLY_CAP,
    })
    return phases


def calc_over_warning(rp_track: dict, pp_track: dict) -> dict:
    """
    계획 월 수령액 기준 연 1,500만원 초과 예상 여부 + 최초 초과 연도.

    연도별 프로젝션: 각 트랙의 과세 전환 연·월 이후 개월 수 × 월 수령액 합산.
    """
    tracks = []
    for t in (rp_track, pp_track):
        if t["active"] and t["tax_start_date"] and t["plan"].get("monthly_amount"):
            tracks.append((date.fromisoformat(t["tax_start_date"]), float(t["plan"]["monthly_amount"])))

    planned_monthly_total = sum(m for _, m in tracks)

    if not tracks:
        return {"will_exceed": False, "first_over_year": None,
                "planned_monthly_total": planned_monthly_total}

    this_year = date.today().year
    horizon = max(ts.year for ts, _ in tracks) + 5
    for year in range(this_year, horizon + 1):
        taxable = 0.0
        for ts, monthly in tracks:
            if year < ts.year:
                continue
            months = 12 if year > ts.year else (12 - ts.month + 1)
            taxable += months * monthly
        if taxable > PRIVATE_PENSION_ANNUAL_LIMIT:
            return {"will_exceed": True, "first_over_year": year,
                    "planned_monthly_total": planned_monthly_total}

    return {"will_exceed": False, "first_over_year": None,
            "planned_monthly_total": planned_monthly_total}


def calc_limit_breakdown(year: int, all_withdrawals: list, plan: dict) -> dict:
    """
    당해 연도 1,500만원 한도 대상 금액 — 계좌별 + 합계.
    summary API와 notifier가 공용으로 사용.
    """
    rp_records = [r for r in all_withdrawals if r["tax_account_type"] == "retirement_pension"]
    ps_records = [r for r in all_withdrawals if r["tax_account_type"] == "pension_savings"]

    rp_start = plan.get("pension_start_date")
    rp_principal = plan.get("severance_principal")
    rp_ytd = calc_track_limit_ytd(
        year, rp_records,
        date.fromisoformat(rp_start) if rp_start else None,
        float(rp_principal) if rp_principal is not None else None,
    )

    pp_start = plan.get("pp_start_date")
    pp_principal = plan.get("pp_non_deducted_principal")
    ps_ytd = calc_track_limit_ytd(
        year, ps_records,
        date.fromisoformat(pp_start) if pp_start else None,
        float(pp_principal) if pp_principal is not None
        # 개시일이 있는데 비과세 원금 미입력 → 0 (즉시 과세)와 동일 처리
        else (0.0 if pp_start else None),
    )

    return {
        "pension_savings_ytd":    ps_ytd,
        "retirement_pension_ytd": rp_ytd,
        "ytd_total":              ps_ytd + rp_ytd,
    }


# ── Pydantic 모델 ────────────────────────────────────────────────

class PensionPlanIn(BaseModel):
    # 퇴직연금(IRP)
    severance_principal: Optional[float] = None
    pension_start_date: Optional[str] = None
    monthly_pension_amount: Optional[float] = None
    # 개인연금(연금저축)
    pp_non_deducted_principal: Optional[float] = None
    pp_deducted_principal: Optional[float] = None   # 참고값 — 과세 전환 계산에 사용 안 함
    pp_start_date: Optional[str] = None
    pp_monthly_amount: Optional[float] = None


_AMOUNT_FIELDS = (
    "severance_principal", "monthly_pension_amount",
    "pp_non_deducted_principal", "pp_deducted_principal", "pp_monthly_amount",
)
_DATE_FIELDS = ("pension_start_date", "pp_start_date")


# ── 라우터 ───────────────────────────────────────────────────────

@router.put("/plan")
def update_pension_plan(body: PensionPlanIn):
    """연금 계획 설정 저장 (user_config JSON의 pension_plan 키)."""
    config = get_config()
    plan = dict(config.get("pension_plan") or {})

    data = body.model_dump()
    for field in _AMOUNT_FIELDS:
        if data[field] is not None:
            if data[field] < 0:
                raise HTTPException(status_code=400, detail=f"{field}은(는) 0 이상이어야 합니다")
            plan[field] = data[field]
    for field in _DATE_FIELDS:
        if data[field] is not None:
            try:
                date.fromisoformat(data[field])
            except ValueError:
                raise HTTPException(status_code=400, detail=f"{field} 형식 오류 (YYYY-MM-DD)")
            plan[field] = data[field]

    # v1의 연간 단일 입력값은 구조화 입력(pp_*)으로 대체됨 — 저장 시 제거
    plan.pop("other_private_pension_annual", None)

    config["pension_plan"] = plan
    supabase.table("user_config").update({
        "value":      config,
        "updated_at": datetime.now().isoformat(),
    }).eq("key", "config").execute()

    return {"ok": True, "pension_plan": plan}


@router.get("/summary")
def get_pension_tax_summary():
    """연금소득세 종합 계산 요약 (듀얼 트랙)."""
    config = get_config()
    plan   = config.get("pension_plan") or {}

    # 인출 기록 전체 조회
    all_withdrawals = (
        supabase.table("withdrawals").select("*").order("withdrawal_date").execute().data or []
    )
    rp_records = [r for r in all_withdrawals if r["tax_account_type"] == "retirement_pension"]
    ps_records = [r for r in all_withdrawals if r["tax_account_type"] == "pension_savings"]

    # (A) 트랙별 과세 전환 시점
    rp_track = build_track("retirement_pension", plan, rp_records)
    pp_track = build_track("pension_savings", plan, ps_records)

    # (B) 당해 연도 한도 집계
    today = date.today()
    year  = today.year
    breakdown = calc_limit_breakdown(year, all_withdrawals, plan)
    ytd_total = breakdown["ytd_total"]
    pct = round(ytd_total / PRIVATE_PENSION_ANNUAL_LIMIT * 100, 1)

    # (C) 구간별 권장 월 수령액 + 초과 예상 경고
    phases = calc_phases(rp_track, pp_track)
    over_warning = calc_over_warning(rp_track, pp_track)

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
        "tracks": {
            "retirement_pension": rp_track,
            "pension_savings":    pp_track,
        },
        "has_any_plan": rp_track["active"] or pp_track["active"],
        "limit_ytd": {
            "year":                    year,
            "pension_savings_ytd":     breakdown["pension_savings_ytd"],
            "retirement_pension_ytd":  breakdown["retirement_pension_ytd"],
            "ytd_amount":              ytd_total,
            "limit":                   PRIVATE_PENSION_ANNUAL_LIMIT,
            "remaining":               PRIVATE_PENSION_ANNUAL_LIMIT - ytd_total,
            "pct":                     pct,
            "status":                  _limit_status(pct),
            "is_over_limit":           ytd_total > PRIVATE_PENSION_ANNUAL_LIMIT,
        },
        "phases":        phases,
        "over_warning":  over_warning,
        "monthly_cap":   MONTHLY_CAP,
        "tax_rate":      _get_tax_rate_info(age),
        "withdrawals_ytd": withdrawals_ytd,
    }
