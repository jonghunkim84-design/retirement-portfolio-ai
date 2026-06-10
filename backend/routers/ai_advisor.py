from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from database import supabase
from datetime import date
import os
import openai

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
        .select("asset_type,current_value") \
        .eq("is_active", True) \
        .execute()
    assets = assets_res.data or []

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

    # ── 3. Risk score ────────────────────────────────────────────
    risk_res   = supabase.table("risk_scores").select("total_score") \
        .order("date", desc=True).limit(1).execute()
    risk_score = risk_res.data[0]["total_score"] if risk_res.data else 0

    # ── 4. System prompt ─────────────────────────────────────────
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

답변 원칙:
1. 수치 근거를 명확히 제시할 것
2. 구체적인 행동 권고로 마무리할 것
3. 투자 손실 위험을 과소평가하지 말 것
4. 200자 이내로 간결하게 답변할 것"""

    # ── 5. OpenAI 호출 ───────────────────────────────────────────
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
            "total_assets":    total_assets,
            "withdrawal_rate": withdrawal_rate,
            "liquidity_months": liquidity_months,
            "risk_score":      risk_score,
        },
    }
