import logging
import os

import openai
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from advisor_context import build_portfolio_context
from advisor_prompt import SYSTEM_PROMPT_TEMPLATE

logger = logging.getLogger(__name__)

router = APIRouter()

_DEFAULT_MODEL     = "gpt-4o"
_MAX_TOKENS        = 1500
_MAX_HISTORY_TURNS = 5  # 직전 5턴(메시지 10개) 이력 유지


class ChatRequest(BaseModel):
    user_id: str
    message: str
    history: list[dict] = []


@router.post("/chat")
def ai_chat(req: ChatRequest):
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY 환경변수가 설정되지 않았습니다.",
        )

    model = os.getenv("ADVISOR_MODEL", _DEFAULT_MODEL)

    portfolio_context = build_portfolio_context(req.message)
    system_prompt     = SYSTEM_PROMPT_TEMPLATE.format(portfolio_context=portfolio_context)

    # 직전 5턴으로 이력 제한 (토큰 절감)
    history = req.history[-(2 * _MAX_HISTORY_TURNS):]
    messages = [{"role": "system", "content": system_prompt}]
    for h in history:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": req.message})

    try:
        client     = openai.OpenAI(api_key=api_key)
        completion = client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=_MAX_TOKENS,
        )
        reply = completion.choices[0].message.content

        usage = completion.usage
        logger.info(
            "[AI 어드바이저] 모델=%s | 입력=%d | 출력=%d | 합계=%d 토큰",
            model,
            usage.prompt_tokens,
            usage.completion_tokens,
            usage.total_tokens,
        )

    except openai.OpenAIError as e:
        raise HTTPException(status_code=502, detail=f"OpenAI 오류: {str(e)}")

    return {
        "reply": reply,
        "usage": {
            "input_tokens":  completion.usage.prompt_tokens,
            "output_tokens": completion.usage.completion_tokens,
        },
    }
