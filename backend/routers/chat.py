"""
HengAI 对话路由 — V3 心脏起搏版

铁律：
1) 路径直接定义在装饰器 `/api/v1/chat`，main.py 挂载时不再叠加任何 prefix，确保最终路由精确等于 `/api/v1/chat`。
2) System Prompt 必须使用基于 __file__ 的绝对路径解析，确保 Docker 与本地开发一致。
3) 即使 prompts/system_prompt.md 缺失或读取异常，也必须返回 DEFAULT_SYSTEM_PROMPT 兜底，绝不抛出导致 import / 启动失败。
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# 常量与路径解析（基于 __file__ 的绝对路径，Docker / 本地行为一致）
# ---------------------------------------------------------------------------

DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-chat"

# backend/routers/chat.py → backend/ → backend/prompts/system_prompt.md
SYSTEM_PROMPT_PATH: Path = (
    Path(__file__).resolve().parent.parent / "prompts" / "system_prompt.md"
)

# 兜底 System Prompt：当 prompts/system_prompt.md 缺失或不可读时启用，
# 内容已对齐宪法第四部分的 [全域中心] 引导铁律，确保无论文件是否存在，HengAI 的人格不漂移。
DEFAULT_SYSTEM_PROMPT = (
    "你是 HengAI，Co2Lion 旗下的首席能碳战略官（Chief Energy & Carbon Strategist）。"
    "请用专业、克制、结构化的中文回答企业关于 CBAM、SBTi、碳税与出海合规的问题，单次回复控制在 300 字以内，核心数字加粗。"
    "\n【称呼铁律】严禁臆造姓氏（如“王总/李总”），统一使用“您好”“贵司”。"
    "\n【商业铁律】严禁承诺免费试用、折扣、补贴金额或具体收费数字；任何价格类问题统一引导：“请进入【全域中心】完成实名认证，系统将匹配最优商业升级路径”。"
    "\n【UI 引导铁律】当前为“前店后厂”MPA 架构，所有复杂操作必须引导至右上角【全域中心】对应模块，"
    "严禁提及“右侧资产面板/侧边抽屉/绿色浮窗”等不存在的组件。"
    "\n【引导话术参考】上传电费单 → [全域中心] → [企业数字档案]；"
    "CBAM 精测 → [全域中心] → [CBAM 测算工具]；"
    "供应链穿透 → [全域中心] → [供应链协同]。"
    "\n【未登录 / 访客阶梯引导】若用户尚未注册或登录，禁止直接抛出复杂 CBAM 术语墙。"
    "请用温和两步：① 先说明「注册/登录后可为您建立专属数字档案」；② 登录后引导点击右上角【全域中心】→【企业数字档案】上传电费单，"
    "系统将据此核算真实排碳与碳税敞口。语气专业但亲切，单次回复仍≤300字。"
)


@lru_cache(maxsize=1)
def _load_system_prompt() -> str:
    """
    加载 System Prompt 的兜底铁律：
    - 使用 SYSTEM_PROMPT_PATH（绝对路径），避免容器/本地 cwd 差异导致 FileNotFoundError；
    - 无论文件不存在、权限不足、编码错误，统一返回 DEFAULT_SYSTEM_PROMPT；
    - 绝对不抛异常，绝不让 chat 路由因 prompt 文件缺失而拖垮整个后端启动。
    """
    try:
        if SYSTEM_PROMPT_PATH.is_file():
            content = SYSTEM_PROMPT_PATH.read_text(encoding="utf-8").strip()
            if content:
                return content
            print(f"[HengAI][chat] system_prompt.md 为空，启用 DEFAULT_SYSTEM_PROMPT 兜底（path={SYSTEM_PROMPT_PATH}）")
        else:
            print(f"[HengAI][chat] system_prompt.md 缺失，启用 DEFAULT_SYSTEM_PROMPT 兜底（path={SYSTEM_PROMPT_PATH}）")
    except Exception as exc:  # noqa: BLE001 — 任何异常都必须吞掉，保证启动
        print(f"[HengAI][chat] 加载 system_prompt.md 失败({exc!r})，启用 DEFAULT_SYSTEM_PROMPT 兜底")
    return DEFAULT_SYSTEM_PROMPT


SYSTEM_CONSTITUTION: str = _load_system_prompt()


# ---------------------------------------------------------------------------
# 路由与 Schema
# ---------------------------------------------------------------------------

# 注意：APIRouter 不带 prefix；最终路径完全由下方装饰器 "/api/v1/chat" 决定，
# 配合 main.py 中 `app.include_router(chat_router)`（无 prefix），杜绝 v1/v1 叠加。
router = APIRouter(tags=["chat"])


class ChatMessageItem(BaseModel):
    role: str = Field(..., description="user | assistant | system")
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessageItem]


def _messages_for_model(body: ChatRequest) -> list[dict[str, str]]:
    return [{"role": "system", "content": SYSTEM_CONSTITUTION}] + [
        {"role": m.role, "content": m.content} for m in body.messages
    ]


async def _sse_token_stream(
    messages: list[dict[str, str]], api_key: str
) -> AsyncIterator[str]:
    client = AsyncOpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL)
    try:
        stream = await client.chat.completions.create(
            model=DEEPSEEK_MODEL,
            messages=messages,
            stream=True,
        )
    except Exception as e:  # noqa: BLE001
        yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"
        return

    try:
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta and delta.content:
                yield f"data: {json.dumps({'content': delta.content}, ensure_ascii=False)}\n\n"
    except Exception as e:  # noqa: BLE001
        yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
    yield "data: [DONE]\n\n"


@router.post("/api/v1/chat")
async def chat(body: ChatRequest) -> StreamingResponse:
    api_key = (os.getenv("DEEPSEEK_API_KEY") or "").strip()
    if not api_key or api_key == "your_key_here":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="未配置有效的 DEEPSEEK_API_KEY",
        )
    if not body.messages:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="messages 不能为空",
        )

    messages = _messages_for_model(body)
    return StreamingResponse(
        _sse_token_stream(messages, api_key),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
