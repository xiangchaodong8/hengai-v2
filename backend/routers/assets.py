import asyncio
import base64
import json
import os

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from openai import AsyncOpenAI

from core.security import get_current_user
from models import User
from schemas import BillParserResponse

router = APIRouter(tags=["assets"])

MAX_FILE_SIZE = 8 * 1024 * 1024  # 8MB
SUPPORTED_TYPES = {"image/jpeg", "image/png", "image/webp"}
VISION_MODEL = os.getenv("VISION_MODEL", "gpt-4o")
VISION_PROMPT = (
    "你是一个专业的工业碳盘查审计员。请识别用户上传的电费单/发票图像。"
    "提取当期总用电量(kWh)、账单月份(YYYY-MM)以及所属电网区域。"
    "无论图片多模糊，请尽力提取，并严格以 JSON 格式返回。"
    "如果无法识别，请将 confidence 设为低于 0.5。"
)


def _guess_image_format(content_type: str) -> str:
    if content_type == "image/jpeg":
        return "jpeg"
    if content_type == "image/png":
        return "png"
    if content_type == "image/webp":
        return "webp"
    return "jpeg"


async def _call_vision_llm(image_bytes: bytes, content_type: str) -> BillParserResponse:
    api_key = (os.getenv("VISION_API_KEY") or os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="未配置 VISION_API_KEY（或 OPENAI_API_KEY）",
        )

    b64 = base64.b64encode(image_bytes).decode("utf-8")
    image_fmt = _guess_image_format(content_type)
    data_url = f"data:image/{image_fmt};base64,{b64}"

    client = AsyncOpenAI(api_key=api_key)
    completion_coro = client.chat.completions.create(
        model=VISION_MODEL,
        response_format={"type": "json_object"},
        temperature=0,
        messages=[
            {"role": "system", "content": VISION_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "请提取并仅返回 JSON。"},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            },
        ],
    )

    try:
        completion = await asyncio.wait_for(completion_coro, timeout=45)
    except TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="视觉模型调用超时，请稍后重试",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"视觉模型调用失败: {exc}",
        )

    message_content = (completion.choices[0].message.content or "").strip()
    if not message_content:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="视觉模型未返回可解析内容",
        )

    try:
        payload = json.loads(message_content)
        # 兼容多种字段名：electricity_kwh / kwh
        raw_kwh = payload.get("electricity_kwh", payload.get("kwh", 0))
        return BillParserResponse(
            electricity_kwh=float(raw_kwh),
            month=str(payload.get("month", "")),
            confidence=float(payload.get("confidence", 0.0)),
        )
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"视觉结果解析失败: {exc}",
        )


@router.post("/parse-bill", response_model=BillParserResponse)
async def parse_bill(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
) -> BillParserResponse:
    if file.content_type not in SUPPORTED_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="仅支持 jpg/png/webp 图片格式",
        )

    try:
        file_bytes = await file.read()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"文件读取失败: {exc}",
        )
    finally:
        await file.close()

    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="上传文件为空")
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"文件过大，最大支持 {MAX_FILE_SIZE // (1024 * 1024)}MB",
        )

    result = await _call_vision_llm(file_bytes, file.content_type)

    # TODO: 更新 companies 表中该 workspace_id 的 annual_electricity_kwh 字段
    _ = current_user.id

    return result