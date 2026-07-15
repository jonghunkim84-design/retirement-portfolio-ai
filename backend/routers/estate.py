"""상속·증여 계획 API.

증여세 (단순화 모델):
- 수증자별 10년 합산: 각 증여 시점 기준 직전 10년(당해 포함) 증여 합계에
  누진세율 적용 후, 이미 낸 세액을 차감하는 방식 (실제 합산신고 방식 근사).
- 관계별 증여재산공제 (배우자 6억 / 성인 자녀 5천만 / 미성년 2천만 / 손자녀 5천만 /
  기타 친족 1천만, 10년간).
- 손자녀(grandchild)는 세대생략 30% 할증.

상속세 개산 (단순화 모델):
- 상속재산 = 금융자산(assets) + 실물 순자산(real_assets, 시세−대출)
- 공제 = 일괄공제 5억 + 배우자 최소공제 5억(배우자 有) + 금융재산공제 min(금융×20%, 2억)
- 사전증여 비교: 증여 실행 시 [증여세 합 + 잔여 재산 상속세] vs 전액 상속.
  ⚠️ 사망 전 10년 내 증여분 상속재산 가산은 미반영 — 경고로 안내.

연금 계획 연동: GET /schedule 이 연도별 증여 유출과 상속 목표 금액을 반환,
PensionPlan.jsx 시뮬레이션이 잔액에서 차감하고 목표선을 표시한다.
"""
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator, model_validator

from database import supabase
from utils import get_config, get_active_assets
from tax_constants import (
    GIFT_DEDUCTION_10YR,
    MARRIAGE_GIFT_DEDUCTION,
    ESTATE_GIFT_TAX_BRACKETS,
    GENERATION_SKIP_SURCHARGE,
    INHERITANCE_LUMP_DEDUCTION,
    INHERITANCE_SPOUSE_MIN_DEDUCTION,
    INHERITANCE_FINANCIAL_RATE,
    INHERITANCE_FINANCIAL_CAP,
)
from routers.real_assets import summarize_real_assets

router = APIRouter()

RELATIONSHIP_LABELS = {
    "spouse":         "배우자",
    "adult_child":    "성인 자녀",
    "minor_child":    "미성년 자녀",
    "grandchild":     "손자녀",
    "other_relative": "기타 친족",
    "other":          "타인",
}


# ── 순수 계산 함수 (테스트에서 직접 import) ─────────────────────────

def calc_transfer_tax(taxable: float) -> float:
    """상속·증여세 공통 누진세율. 과세표준(원) → 산출세액(원)."""
    if taxable <= 0:
        return 0.0
    for limit, rate, deduction in ESTATE_GIFT_TAX_BRACKETS:
        if taxable <= limit:
            return taxable * rate - deduction
    return 0.0  # unreachable


def expand_gift_occurrences(plan: dict) -> list:
    """증여 계획 1건 → [(연도, 금액)] 목록으로 전개."""
    amount = float(plan.get("amount") or 0)
    start = int(plan["start_year"])
    if plan.get("gift_type") == "recurring":
        end = int(plan.get("end_year") or start)
        return [(y, amount) for y in range(start, max(start, end) + 1)]
    return [(start, amount)]


def calc_gift_taxes_for_recipient(
    occurrences: list, relationship: str, extra_deduction: float = 0.0
) -> list:
    """수증자 1명의 증여 목록 → 건별 증여세 (10년 합산 방식 근사).

    occurrences: [(year, amount)] — 정렬 불필요 (내부 정렬).
    extra_deduction: 혼인·출산 공제 등 추가 공제 (원, 수증자 평생 1회).
    반환: [{year, amount, window_sum, taxable, tax}] 연도 오름차순.
    """
    deduction = GIFT_DEDUCTION_10YR.get(relationship, 0) + max(0.0, extra_deduction)
    surcharge = GENERATION_SKIP_SURCHARGE if relationship == "grandchild" else 0.0

    occs = sorted(occurrences, key=lambda o: o[0])
    results = []
    for i, (year, amount) in enumerate(occs):
        window_sum = sum(a for (y, a) in occs[: i + 1] if year - 9 <= y <= year)
        prior_sum = window_sum - amount
        tax_total = calc_transfer_tax(max(0.0, window_sum - deduction))
        tax_prior = calc_transfer_tax(max(0.0, prior_sum - deduction))
        tax = max(0.0, tax_total - tax_prior) * (1 + surcharge)
        results.append({
            "year":       year,
            "amount":     round(amount),
            "window_sum": round(window_sum),
            "taxable":    round(max(0.0, window_sum - deduction)),
            "tax":        round(tax),
        })
    return results


def calc_inheritance_tax(estate_value: float, financial_assets: float, has_spouse: bool) -> dict:
    """상속세 개산 (일괄공제 + 배우자 최소공제 + 금융재산공제)."""
    financial_deduction = min(
        max(0.0, financial_assets) * INHERITANCE_FINANCIAL_RATE,
        INHERITANCE_FINANCIAL_CAP,
    )
    total_deduction = (
        INHERITANCE_LUMP_DEDUCTION
        + (INHERITANCE_SPOUSE_MIN_DEDUCTION if has_spouse else 0)
        + financial_deduction
    )
    taxable = max(0.0, estate_value - total_deduction)
    tax = calc_transfer_tax(taxable)
    return {
        "estate_value":        round(estate_value),
        "lump_deduction":      INHERITANCE_LUMP_DEDUCTION,
        "spouse_deduction":    INHERITANCE_SPOUSE_MIN_DEDUCTION if has_spouse else 0,
        "financial_deduction": round(financial_deduction),
        "total_deduction":     round(total_deduction),
        "taxable":             round(taxable),
        "tax":                 round(tax),
        "effective_rate_pct":  round(tax / estate_value * 100, 1) if estate_value > 0 else 0.0,
    }


def aggregate_gift_taxes(plans: list) -> dict:
    """활성 증여 계획 → 수증자(이름+관계)별 10년 합산 증여세 집계.

    혼인·출산 공제: 수증자의 계획 중 하나라도 marriage_deduction=True면
    해당 수증자 공제에 +1억 (평생 1회 — 여러 건에 중복 적용되지 않음).
    반환: recipients / tax_by_plan / total_gifts / total_gift_tax
    """
    groups: dict = {}
    for p in plans:
        if not p.get("is_active", True):
            continue
        key = (p["recipient_name"], p.get("relationship", "other"))
        g = groups.setdefault(key, {"occ3": [], "marriage": False})
        g["occ3"].extend([(y, a, p["id"]) for y, a in expand_gift_occurrences(p)])
        if p.get("marriage_deduction"):
            g["marriage"] = True

    recipients = []
    tax_by_plan: dict = {}
    total_gifts = 0.0
    total_gift_tax = 0.0

    for (name, rel), g in groups.items():
        extra = MARRIAGE_GIFT_DEDUCTION if g["marriage"] else 0.0
        occ3_sorted = sorted(g["occ3"], key=lambda o: o[0])
        occs = [(y, a) for y, a, _ in occ3_sorted]
        taxes = calc_gift_taxes_for_recipient(occs, rel, extra)

        # 건별 세금을 계획 id 별로 재귀속 (동일 정렬 사용)
        for (y, a, pid), t in zip(occ3_sorted, taxes):
            tax_by_plan[pid] = tax_by_plan.get(pid, 0) + t["tax"]

        amount = sum(a for _, a in occs)
        tax = sum(t["tax"] for t in taxes)
        total_gifts += amount
        total_gift_tax += tax
        recipients.append({
            "recipient_name":     name,
            "relationship":       rel,
            "relationship_label": RELATIONSHIP_LABELS.get(rel, rel),
            "deduction_10yr":     GIFT_DEDUCTION_10YR.get(rel, 0),
            "marriage_deduction": g["marriage"],
            "extra_deduction":    round(extra),
            "total_amount":       round(amount),
            "total_tax":          round(tax),
            "occurrences":        taxes,
        })

    return {
        "recipients":     recipients,
        "tax_by_plan":    tax_by_plan,
        "total_gifts":    round(total_gifts),
        "total_gift_tax": round(total_gift_tax),
    }


def build_gift_schedule(plans: list) -> dict:
    """활성 증여 계획 → {연도: 총 증여액} (연금 시뮬레이션 유출용)."""
    by_year: dict = {}
    for p in plans:
        if not p.get("is_active", True):
            continue
        for year, amount in expand_gift_occurrences(p):
            by_year[year] = by_year.get(year, 0) + amount
    return {int(y): round(v) for y, v in sorted(by_year.items())}


def compare_gift_vs_inheritance(
    estate_value: float,
    financial_assets: float,
    has_spouse: bool,
    plans: list,
) -> dict:
    """전액 상속 vs 계획 증여 실행 후 상속 — 총 이전 비용 비교."""
    # A: 증여 없이 전액 상속
    no_gift = calc_inheritance_tax(estate_value, financial_assets, has_spouse)

    # B: 계획 증여 실행 (증여분은 금융자산에서 우선 유출 가정)
    agg = aggregate_gift_taxes(plans)
    total_gifts = agg["total_gifts"]
    total_gift_tax = agg["total_gift_tax"]

    remaining_estate = max(0.0, estate_value - total_gifts)
    remaining_financial = max(0.0, financial_assets - total_gifts)
    with_gift = calc_inheritance_tax(remaining_estate, remaining_financial, has_spouse)

    total_cost_no_gift = no_gift["tax"]
    total_cost_with_gift = round(total_gift_tax) + with_gift["tax"]

    return {
        "no_gift": {
            "inheritance_tax": no_gift["tax"],
            "total_cost":      total_cost_no_gift,
        },
        "with_gift": {
            "total_gifts":     round(total_gifts),
            "gift_tax":        round(total_gift_tax),
            "inheritance_tax": with_gift["tax"],
            "total_cost":      total_cost_with_gift,
        },
        "savings": total_cost_no_gift - total_cost_with_gift,
    }


# ── Pydantic 모델 ────────────────────────────────────────────────

class GiftPlanIn(BaseModel):
    recipient_name: str
    relationship: str = "adult_child"
    gift_type: str = "one_time"
    amount: float = 0
    start_year: int
    end_year: Optional[int] = None
    marriage_deduction: bool = False   # 혼인·출산 공제 (+1억, 직계비속만)
    memo: Optional[str] = None
    is_active: bool = True

    @field_validator("relationship")
    @classmethod
    def relationship_valid(cls, v):
        if v not in RELATIONSHIP_LABELS:
            raise ValueError(f"관계 값이 유효하지 않습니다: {v}")
        return v

    @field_validator("gift_type")
    @classmethod
    def gift_type_valid(cls, v):
        if v not in ("one_time", "recurring"):
            raise ValueError(f"증여 유형이 유효하지 않습니다: {v}")
        return v

    @field_validator("amount")
    @classmethod
    def amount_positive(cls, v):
        if v <= 0:
            raise ValueError("증여 금액은 0보다 커야 합니다")
        return v

    @model_validator(mode="after")
    def check_years(self):
        if self.start_year < date.today().year:
            raise ValueError("시작 연도는 올해 이후여야 합니다")
        if self.gift_type == "recurring":
            if not self.end_year or self.end_year < self.start_year:
                raise ValueError("정기 증여는 종료 연도(시작 연도 이후)가 필요합니다")
        else:
            self.end_year = None
        if self.marriage_deduction and self.relationship not in (
            "adult_child", "minor_child", "grandchild"
        ):
            raise ValueError("혼인·출산 공제는 직계비속(자녀·손자녀) 증여에만 적용됩니다")
        return self


class EstateConfigIn(BaseModel):
    target_amount: float = 0    # 남길 상속 목표 금액 (원)
    has_spouse: bool = False

    @field_validator("target_amount")
    @classmethod
    def target_non_negative(cls, v):
        if v < 0:
            raise ValueError("목표 금액은 0 이상이어야 합니다")
        return v


# ── 내부 헬퍼 ───────────────────────────────────────────────────

def _load_plans() -> list:
    res = supabase.table("gift_plans").select("*").order("start_year").order("recipient_name").execute()
    return res.data or []


def _estate_config(config: dict) -> dict:
    ep = config.get("estate_plan") or {}
    return {
        "target_amount": float(ep.get("target_amount") or 0),
        "has_spouse":    bool(ep.get("has_spouse", False)),
    }


def _current_assets() -> dict:
    financial = sum(a["current_value"] for a in get_active_assets())
    try:
        res = supabase.table("real_assets").select("*").eq("is_active", True).execute()
        real = summarize_real_assets(res.data or [])["net_value"]
    except Exception:
        real = 0
    return {"financial": round(financial), "real_net": round(real), "total": round(financial + real)}


# ── 라우터 ───────────────────────────────────────────────────────

@router.get("/gifts")
def list_gift_plans():
    return _load_plans()


@router.post("/gifts")
def create_gift_plan(body: GiftPlanIn):
    data = body.model_dump()
    data["updated_at"] = datetime.now().isoformat()
    try:
        res = supabase.table("gift_plans").insert(data).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return res.data[0]


@router.put("/gifts/{plan_id}")
def update_gift_plan(plan_id: int, body: GiftPlanIn):
    data = body.model_dump()
    data["updated_at"] = datetime.now().isoformat()
    try:
        res = supabase.table("gift_plans").update(data).eq("id", plan_id).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not res.data:
        raise HTTPException(status_code=404, detail="증여 계획을 찾을 수 없습니다")
    return res.data[0]


@router.delete("/gifts/{plan_id}")
def delete_gift_plan(plan_id: int):
    res = supabase.table("gift_plans").delete().eq("id", plan_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="증여 계획을 찾을 수 없습니다")
    return {"ok": True}


@router.patch("/gifts/{plan_id}/toggle")
def toggle_gift_plan(plan_id: int):
    cur = supabase.table("gift_plans").select("is_active").eq("id", plan_id).execute()
    if not cur.data:
        raise HTTPException(status_code=404, detail="증여 계획을 찾을 수 없습니다")
    res = supabase.table("gift_plans").update({
        "is_active":  not cur.data[0]["is_active"],
        "updated_at": datetime.now().isoformat(),
    }).eq("id", plan_id).execute()
    return res.data[0]


@router.put("/config")
def update_estate_config(body: EstateConfigIn):
    """상속 목표 금액·배우자 유무 저장 (user_config JSON의 estate_plan 키)."""
    config = get_config()
    config["estate_plan"] = {
        "target_amount": body.target_amount,
        "has_spouse":    body.has_spouse,
    }
    supabase.table("user_config").update({
        "value":      config,
        "updated_at": datetime.now().isoformat(),
    }).eq("key", "config").execute()
    return {"ok": True, "estate_plan": config["estate_plan"]}


@router.get("/schedule")
def get_gift_schedule():
    """연금 계획 시뮬레이션용 — 연도별 증여 유출 + 상속 목표."""
    config = get_config()
    ep = _estate_config(config)
    try:
        plans = _load_plans()
    except Exception:
        plans = []  # 테이블 미생성 시에도 연금 계획 페이지가 동작하도록
    return {
        "gifts_by_year": build_gift_schedule(plans),
        "target_amount": ep["target_amount"],
        "has_active_gifts": any(p.get("is_active", True) for p in plans),
    }


@router.get("/summary")
def get_estate_summary():
    """상속·증여 종합: 계획별 증여세 + 상속세 개산 + 사전증여 비교."""
    config = get_config()
    ep = _estate_config(config)
    plans = _load_plans()
    assets = _current_assets()

    # 수증자(이름+관계)별로 묶어 10년 합산 증여세 계산 (혼인·출산 공제 포함)
    agg = aggregate_gift_taxes(plans)
    recipients = agg["recipients"]
    tax_by_plan = agg["tax_by_plan"]

    plans_out = []
    for p in plans:
        p2 = dict(p)
        p2["estimated_tax"] = round(tax_by_plan.get(p["id"], 0)) if p.get("is_active", True) else None
        plans_out.append(p2)

    comparison = compare_gift_vs_inheritance(
        assets["total"], assets["financial"], ep["has_spouse"], plans,
    )
    inheritance = calc_inheritance_tax(assets["total"], assets["financial"], ep["has_spouse"])

    total_gifts = comparison["with_gift"]["total_gifts"]

    warnings = [
        "사망 전 10년 이내 증여분은 상속재산에 가산되므로, 절세 효과는 증여 후 10년 이상 생존을 가정한 값입니다.",
        *([
            "혼인·출산 공제(+1억)는 혼인신고일 전후 2년(또는 출생·입양 후 2년) 이내 증여에만 적용되며, 혼인+출산 통합 평생 한도 1억원입니다."
        ] if any(p.get("marriage_deduction") and p.get("is_active", True) for p in plans) else []),
        "배우자 상속공제는 최소 5억원 기준 단순 계산입니다 (법정상속분 한도 최대 30억원 미반영).",
        "증여세는 수증자 부담이 원칙이라 연금 시뮬레이션 유출에는 증여 원금만 반영됩니다.",
    ]

    return {
        "config":       ep,
        "assets":       assets,
        "plans":        plans_out,
        "recipients":   recipients,
        "total_gifts":  total_gifts,
        "inheritance":  inheritance,
        "comparison":   comparison,
        "gifts_by_year": build_gift_schedule(plans),
        "relationship_labels": RELATIONSHIP_LABELS,
        "warnings":     warnings,
    }
