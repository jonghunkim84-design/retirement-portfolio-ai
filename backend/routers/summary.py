import os
from datetime import date
from fastapi import APIRouter
from openai import OpenAI
from dotenv import load_dotenv
from database import supabase
from utils import get_config, get_active_assets, calculate_buckets, calculate_risk, get_pension_info

load_dotenv()
router  = APIRouter()
_client = None


def _openai():
    global _client
    if _client is None:
        key = os.getenv("OPENAI_API_KEY", "")
        _client = OpenAI(api_key=key) if key else None
    return _client


def _rule_based(config, buckets, risk, pension, monthly, display_wd, guardrail):
    months   = buckets["months_covered"]
    total    = buckets["total"]
    b1       = buckets["b1"]
    level_ko = {"green": "안전", "yellow": "주의", "red": "위험"}.get(risk["level"], "확인")

    line1 = (f"총 자산 {total/1e8:.2f}억원, 위험 등급 {level_ko}({risk['total_score']:.0f}점)으로 "
             f"{'포트폴리오는 안정적입니다.' if risk['level'] == 'green' else '점검이 필요합니다.'}")

    if months >= 12:
        line2 = f"현금성 자산은 {months:.0f}개월치({b1/1e8:.2f}억원)로 충분히 확보되어 있습니다."
    elif months >= 6:
        line2 = f"현금성 자산이 {months:.0f}개월치({b1/1e8:.2f}억원)로 12개월치 확보를 권장합니다."
    else:
        line2 = f"현금성 자산이 {months:.0f}개월치({b1/1e8:.2f}억원)로 부족합니다. 즉시 보충을 권장합니다."

    guard_txt = " (가드레일 하향 적용)" if guardrail else ""
    if pension["income"] > 0:
        line3 = (f"이번 달 인출액은 {display_wd:,.0f}원{guard_txt}이며, "
                 f"국민연금 {pension['income']:,.0f}원과 합산 시 생활비가 충당됩니다.")
    elif pension["months_to_start"] > 0:
        line3 = (f"이번 달 인출액은 {display_wd:,.0f}원{guard_txt}이며, "
                 f"{pension['months_to_start']}개월 후 국민연금({pension['base_amount']:,.0f}원) 개시 시 인출 부담이 줄어듭니다.")
    else:
        line3 = f"이번 달 인출액은 {display_wd:,.0f}원{guard_txt}입니다."

    return f"{line1}\n{line2}\n{line3}"


@router.post("/generate")
def generate_summary():
    config  = get_config()
    assets  = get_active_assets()
    buckets = calculate_buckets(assets, config)
    risk    = calculate_risk(buckets, config)
    pension = get_pension_info(config)
    monthly = config.get("user", {}).get("monthly_expense", 5000000)
    user_name = config.get("user", {}).get("name", "고객")

    # 최신 인출 데이터 — withdrawals 최근 월 합계 (withdrawal_log 폐지)
    from utils import get_monthly_withdrawal_totals
    _totals = get_monthly_withdrawal_totals()
    _recent = sorted(_totals.items(), reverse=True)
    display_wd = _recent[0][1] if _recent else monthly
    guardrail  = False  # withdrawal_log 폐지로 가드레일 플래그 제거

    client = _openai()
    source = "fallback"
    summary = ""

    if client:
        try:
            prompt = f"""당신은 은퇴자 {user_name}님의 포트폴리오를 관리하는 AI 자문가입니다.
아래 데이터를 바탕으로 이번 달 포트폴리오 현황을 친근하고 명확한 한국어로 정확히 3줄로 요약해 주세요.

**포트폴리오 현황 ({date.today().strftime('%Y년 %m월')})**
- 총 자산: {buckets['total']/1e8:.2f}억원
- 버킷1(현금성): {buckets['b1']/1e8:.2f}억원 ({buckets['months_covered']:.1f}개월치)
- 버킷2(채권/TDF): {buckets['b2']/1e8:.2f}억원 / 버킷3(성장): {buckets['b3']/1e8:.2f}억원
- 자산 비중: 현금 {buckets['cash_ratio']*100:.1f}% / 채권 {buckets['bond_ratio']*100:.1f}% / 주식 {buckets['equity_ratio']*100:.1f}% / 인컴 {buckets['income_ratio']*100:.1f}%

**위험 점수**: {risk['total_score']:.1f}점/100점 (현금:{risk['cash_score']}점 순서:{risk['seq_score']}점 집중:{risk['conc_score']}점)
**등급**: {'녹색(안전)' if risk['level']=='green' else '황색(주의)' if risk['level']=='yellow' else '적색(위험)'}
**월 생활비**: {monthly:,.0f}원 / **이번달 인출액**: {display_wd:,.0f}원
**국민연금**: {'수령 중 '+str(pension['income'])+'원/월' if pension['income']>0 else str(pension['months_to_start'])+'개월 후 개시 예정('+str(pension['base_amount'])+'원)'}

규칙: 정확히 3줄, 완결된 문장, 숫자는 억원 단위, 위험 황색/적색이면 구체적 행동 권고 포함"""

            resp    = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "당신은 은퇴 자산관리 전문 AI입니다. 항상 한국어로 답변합니다."},
                    {"role": "user",   "content": prompt},
                ],
                max_tokens=300, temperature=0.4,
            )
            summary = resp.choices[0].message.content.strip()
            source  = "gpt-4o-mini"
        except Exception as e:
            summary = _rule_based(config, buckets, risk, pension, monthly, display_wd, guardrail)
    else:
        summary = _rule_based(config, buckets, risk, pension, monthly, display_wd, guardrail)

    # DB 저장
    today = str(date.today())
    exists = supabase.table("recommendations").select("id") \
        .eq("date", today).eq("rule_id", "ai_summary").execute()
    if exists.data:
        supabase.table("recommendations").update(
            {"message": summary, "status": "completed"}
        ).eq("date", today).eq("rule_id", "ai_summary").execute()
    else:
        supabase.table("recommendations").insert({
            "date": today, "rule_id": "ai_summary",
            "message": summary, "status": "completed",
        }).execute()

    return {"summary": summary, "source": source, "date": today}


@router.get("/history")
def get_history(limit: int = 6):
    res = supabase.table("recommendations") \
        .select("date,message,status") \
        .eq("rule_id", "ai_summary") \
        .order("date", desc=True) \
        .limit(limit).execute()
    return res.data or []
