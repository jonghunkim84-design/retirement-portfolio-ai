import logging
import os

import anthropic
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from advisor_context import build_portfolio_context
from advisor_prompt import SYSTEM_PROMPT_TEMPLATE

logger = logging.getLogger(__name__)

router = APIRouter()

_DEFAULT_MODEL     = "claude-sonnet-4-6"
_MAX_TOKENS        = 1500
_MAX_HISTORY_TURNS = 5  # 직전 5턴(메시지 10개) 이력 유지


class ChatRequest(BaseModel):
    user_id: str
    message: str
    history: list[dict] = []


@router.post("/chat")
def ai_chat(req: ChatRequest):
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.",
        )

    model = os.getenv("ADVISOR_MODEL", _DEFAULT_MODEL)

    portfolio_context = build_portfolio_context(req.message)
    system_prompt     = SYSTEM_PROMPT_TEMPLATE.format(portfolio_context=portfolio_context)

    # 직전 5턴으로 이력 제한 (토큰 절감)
    history  = req.history[-(2 * _MAX_HISTORY_TURNS):]
    messages = [
        *[{"role": h["role"], "content": h["content"]} for h in history],
        {"role": "user", "content": req.message},
    ]

    try:
        client   = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=model,
            max_tokens=_MAX_TOKENS,
            system=system_prompt,
            messages=messages,
        )
        reply = response.content[0].text

        logger.info(
            "[AI 어드바이저] 모델=%s | 입력=%d | 출력=%d | 합계=%d 토큰",
            model,
            response.usage.input_tokens,
            response.usage.output_tokens,
            response.usage.input_tokens + response.usage.output_tokens,
        )

    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"Claude API 오류: {str(e)}")

    return {
        "reply": reply,
        "usage": {
            "input_tokens":  response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
        },
    }
