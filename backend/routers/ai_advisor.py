from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from database import supabase
from datetime import date
import os
import openai

# 자산 유형별 장기 기대수익률 (실측 연환산이 없을 때 폴백)
_EXPECTED_RETURN = {
    "cash": 0.02, "bond": 0.04, "tdf": 0.05,
    "fund": 0.05, "equity": 0.08, "income": 0.05,
}

router = APIRouter()


class ChatRequest(BaseModel):
    user_id: str
    message: str
    history: list[dict] = []


@router.post("/chat")
def ai_chat(req: ChatRequest):
    # ── 1. Config ────────────────────────────────────────────────
    cfg_res = supabase.table("user_config").select("value").eq("key", "config").execute()
    config  = cfg_res.data[0]["value"] if cfg_res.data else {}

    user_cfg         = config.get("user", {})
    monthly_expenses = user_cfg.get("monthly_expense", 5000000)
    birth_year       = user_cfg.get("birth_year", 1965)
    age              = date.today().year - birth_year

    pension_start = config.get("income", {}).get("national_pension", {}).get("start_date", "")
    retire_age    = 65
    if pension_start:
        try:
            retire_age = int(pension_start.split("-")[0]) - birth_year
        except Exception:
            pass

    # ── 2. Assets ────────────────────────────────────────────────
    assets_res = supabase.table("assets") \
        .select("asset_type,current_value,investment_amount,purchase_date") \
        .eq("is_active", True) \
        .execute()
    assets = assets_res.data or []
    today  = date.today()

    type_totals: dict = {}
    for a in assets:
        t = a.get("asset_type", "")
        type_totals[t] = type_totals.get(t, 0) + float(a.get("current_value", 0))

    total_assets = sum(type_totals.values())
    cash_total   = type_totals.get("cash",   0)
    bond_total   = type_totals.get("bond",   0) + type_totals.get("fund", 0)
    tdf_total    = type_totals.get("tdf",    0)
    equity_total = type_totals.get("equity", 0)
    income_total = type_totals.get("income", 0)

    def pct(v: float) -> float:
        return round(v / total_assets * 100, 1) if total_assets else 0.0

    liquidity_months = round(cash_total / monthly_expenses, 1) if monthly_expenses else None
    withdrawal_rate  = round(monthly_expenses * 12 / total_assets * 100, 2) if total_assets else 0.0

    # ── 3. 포트폴리오 연환산 수익률 ──────────────────────────────
    # returns.py 의 _calc_asset_return 로직을 직접 재현
    # 보유 365일 이상 + investment_amount 있는 자산만 실측값 산출,
    # 나머지는 자산유형별 장기 기대수익률로 폴백
    weighted_sum = 0.0
    weight_total = 0.0
    annual_return_source = "estimated"

    for a in assets:
        cur = float(a.get("current_value", 0))
        inv = a.get("investment_amount")
        pd_str = a.get("purchase_date")

        annual = None
        if inv and float(inv) > 0 and cur > 0 and pd_str:
            try:
                holding = (today - date.fromisoformat(str(pd_str)[:10])).days
                if holding >= 365:
                    annual = ((cur / float(inv)) ** (365 / holding) - 1) * 100
            except Exception:
                pass

        if annual is None:
            annual = _EXPECTED_RETURN.get(a.get("asset_type", ""), 0.05) * 100

        weighted_sum  += annual * cur
        weight_total  += cur

    if weight_total > 0:
        annual_return_rate = round(weighted_sum / weight_total, 1)
        # 실측 연환산이 하나라도 있으면 source를 actual로 표시
        has_actual = any(
            a.get("investment_amount") and float(a.get("investment_amount", 0)) > 0
            and a.get("purchase_date")
            and (today - date.fromisoformat(str(a["purchase_date"])[:10])).days >= 365
            for a in assets
            if a.get("purchase_date")
        )
        annual_return_source = "actual+estimated" if has_actual else "estimated"
    else:
        annual_return_rate = 5.0

    # ── 4. Risk score ────────────────────────────────────────────
    risk_res   = supabase.table("risk_scores").select("total_score") \
        .order("date", desc=True).limit(1).execute()
    risk_score = risk_res.data[0]["total_score"] if risk_res.data else 0

    # ── 5. System prompt ─────────────────────────────────────────
    liq_str = f"{liquidity_months:.1f}" if liquidity_months is not None else "계산불가"
    system_prompt = f"""당신은 한국 은퇴자 전문 포트폴리오 어드바이저입니다.
아래는 사용자의 현재 포트폴리오 현황입니다.

[포트폴리오 현황]
- 총자산: {int(total_assets):,}원
- 버킷 구성: Cash {pct(cash_total)}% / Bond {pct(bond_total)}% / TDF {pct(tdf_total)}% / Equity {pct(equity_total)}% / Income {pct(income_total)}%
- 현재 인출률: {withdrawal_rate:.1f}% (안전 기준: 4% 이하)
- 위험 점수: {risk_score}/100
- 비상 유동성: {liq_str}개월 (권장: 6개월 이상)
- 현재 나이: {age}세 / 은퇴 나이: {retire_age}세
- 월 생활비: {int(monthly_expenses):,}원
- 포트폴리오 연 기대 수익률: {annual_return_rate:.1f}% ({annual_return_source})

답변 원칙:
1. 수치 근거를 명확히 제시할 것
2. 구체적인 행동 권고로 마무리할 것
3. 투자 손실 위험을 과소평가하지 말 것
4. 200자 이내로 간결하게 답변할 것
5. 자산 고갈 계산 시 반드시 연 기대 수익률 {annual_return_rate:.1f}%를 반영할 것
6. 단순 인출률로만 고갈 시점을 계산하지 말 것 (수익률·물가상승률을 함께 고려)"""

    # ── 6. OpenAI 호출 ───────────────────────────────────────────
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY 환경변수가 설정되지 않았습니다.")

    try:
        client = openai.OpenAI(api_key=api_key)
        messages = [{"role": "system", "content": system_prompt}]
        for h in req.history:
            messages.append({"role": h["role"], "content": h["content"]})
        messages.append({"role": "user", "content": req.message})

        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            max_tokens=600,
        )
        reply = completion.choices[0].message.content
    except openai.OpenAIError as e:
        raise HTTPException(status_code=502, detail=f"OpenAI 오류: {str(e)}")

    return {
        "reply": reply,
        "context_used": {
            "total_assets":        total_assets,
            "withdrawal_rate":     withdrawal_rate,
            "liquidity_months":    liquidity_months,
            "risk_score":          risk_score,
            "annual_return_rate":  annual_return_rate,
            "annual_return_source": annual_return_source,
        },
    }
