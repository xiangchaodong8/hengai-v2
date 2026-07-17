# chat.py — HengAI V3.1 对话接口（终极重构版）
# 架构原则：对话即录入 / 专家合伙人语境 / AppState 实时注入
# 严禁机械列表回复！严禁引导用户去"全域中心查看"他们刚告诉你的数据！

from __future__ import annotations

import json
import logging
import os
from decimal import Decimal
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
import httpx
from openai import AsyncOpenAI
from pydantic import AliasChoices, BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

# V3.1 心脏移植：统一绝对导入；AppState 唯一数据源 = hub_engine.build_app_state。
from action_executor import ActionExecutor, ExecutionSummary
from auth import get_current_user
from database import get_db
from hub_engine import build_app_state, normalize_app_state_for_frontend
from intent_engine import IntentRecognizer
from models import User

router = APIRouter(tags=["chat"])
logger = logging.getLogger("hengai.chat")

# ---------------------------------------------------------------------------
# 请求/响应 Schema
# ---------------------------------------------------------------------------

class ChatMessage(BaseModel):
    role   : str   # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    messages   : List[ChatMessage]
    # 前端 index.html 用 app_state；chatClient.js 用 appState（camelCase）
    app_state  : Dict[str, Any]  = Field(
        default_factory=dict,
        validation_alias=AliasChoices("app_state", "appState"),
        description="前端 window.AppState 实时快照",
    )
    # 🚨 任务 2 · 前端 chatClient.buildAppStateSummary() 生成的紧凑可读摘要
    # 一旦 LLM 收到它，绝不可能与 AppState 现状冲突（注入到 system role 最末尾）
    app_state_summary: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("app_state_summary", "appStateSummary"),
        description="紧凑可读 AppState 摘要（GM/Phase/供应商/碳数据），由前端 chatClient 注入",
    )
    stream     : bool            = True


class ChatResponse(BaseModel):
    reply          : str
    actions_taken  : List[Dict[str, Any]]  = Field(default_factory=list)
    gm_delta       : Decimal               = Decimal("0")
    phase_changed  : Optional[str]         = None
    updated_state  : Optional[Dict]        = None   # 执行后的最新 AppState


# ---------------------------------------------------------------------------
# System Role 构建器 — 专家合伙人人格注入
# ---------------------------------------------------------------------------

_PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"
_CONSTITUTION_PATH = _PROMPTS_DIR / "system_prompt.md"

def _load_constitution() -> str:
    """加载《HengAI 创世宪法 v3.0》—— 失败则返回空串，由下方 PERSONA 兜底。"""
    try:
        if _CONSTITUTION_PATH.is_file():
            txt = _CONSTITUTION_PATH.read_text(encoding="utf-8").strip()
            if txt:
                print(f"[HengAI][chat] 已加载创世宪章: {_CONSTITUTION_PATH} ({len(txt)} chars)")
                return txt
        print(f"[HengAI][chat] 创世宪章文件缺失/为空: {_CONSTITUTION_PATH}")
    except Exception as exc:  # noqa: BLE001
        print(f"[HengAI][chat] 加载创世宪章异常: {exc!r}")
    return ""

HENGAI_CONSTITUTION = _load_constitution()

HENGAI_PERSONA = """你是 HengAI——一位拥有欧盟 CBAM 实战经验的数字合规官，也是企业创始人/合规总监的私人战略合伙人。

【人格守则——违反即报错】
1. 你已经读过了用户的实时数据。回复中必须主动引用这些数据，而不是要求用户去"全域中心查看"。
2. 回复语言必须是"专家合伙人"语境：精准、有判断、有立场，不做无谓的礼貌性铺垫。
3. 严禁输出 [策略本质/利益驱动/一键动作] 这类模版列表。用流畅的专家对话替代。
4. 当你检测到用户提供了新数据（用电量/供应商数/碳排放），立即确认已录入，并基于这个新数据给出下一步判断。
5. 数字要精确。不要说"您的碳排放较高"，要说"您现在是 1,240 tCO2e，对标欧盟 CBAM 铝制品关税阈值，风险敞口约 €68,000"。
6. 风险要量化。每次涉及 CBAM 时，必须给出欧元级别的风险数字（CBAM 碳价参考 €50/tCO2e）。
7. 你的建议是可执行的，且必须与用户当前所处的 Phase 匹配。"""


def _derive_evidence_mode_from_app_state(app_state: Dict[str, Any]) -> str:
    cbam = app_state.get("cbam") or {}
    ev = cbam.get("evidence") if isinstance(cbam.get("evidence"), dict) else {}
    mode = str((ev or {}).get("mode") or "").strip().upper()
    if mode in ("SIMULATED", "PENDING_VERIFICATION", "SOVEREIGN_VERIFIED"):
        return mode
    company = app_state.get("company") or {}
    city = str(company.get("cityState") or company.get("city_state") or "").lower()
    if city == "certified":
        return "SOVEREIGN_VERIFIED"
    if city in ("evidence_building", "mat_pending"):
        return "PENDING_VERIFICATION"
    return "SIMULATED"


def _build_evidence_voice_block(app_state: Dict[str, Any]) -> str:
    """双模状态机 · AI 语气切换（契约：全域中心纯玩法与精算芯升格交互规范 v1.1 §4）"""
    cbam = app_state.get("cbam") or {}
    ev = cbam.get("evidence") if isinstance(cbam.get("evidence"), dict) else {}
    mode = _derive_evidence_mode_from_app_state(app_state)
    value = ev.get("value")
    unit = ev.get("unit") or "tCO2e/t"
    dict_ver = ev.get("dictVersion") or "—"
    calc_ver = ev.get("calcVersion") or "—"
    stage = ev.get("stage") or "—"
    verified = ev.get("verified") if isinstance(ev.get("verified"), dict) else {}
    cert_id = verified.get("certId") or app_state.get("company", {}).get("verifiedFactorCertId") or "—"
    shadow = ev.get("shadow") if isinstance(ev.get("shadow"), dict) else {}
    drift = shadow.get("driftPct")

    if mode == "SOVEREIGN_VERIFIED":
        voice = (
            "【当前 AI 身份 · 首席合规官 / 交易经纪人】\n"
            "- 语气：确权已成、资产可执行；禁止「假如/如果/建议尝试」式推演口吻。\n"
            "- 必须说明：当前结果为已确权证据，可用于下游协同引用与外部合规材料。\n"
            "- 可执行动作：Pull 官方因子、供应链协同、报关资料准备。\n"
            "- 禁止：硬件推销口吻；必须描述为证据等级与协同路径。"
        )
    elif mode == "PENDING_VERIFICATION":
        voice = (
            "【当前 AI 身份 · 实证推进官】\n"
            "- 语气：汇报进度 + 明确下一步；禁止宣称「已可申报/已可 Pull」。\n"
            "- 必须说明：升格流程进行中，结果仅供内部决策，尚未 hardware 封签。\n"
            "- 下一步：引导用户在 CBAM 结果页继续模拟，或等待精算芯回灌（无需推销硬件）。\n"
            "- 禁止：混用已确权语气。"
        )
    else:
        voice = (
            "【当前 AI 身份 · 参谋长】\n"
            "- 语气：假如/如果/建议/尝试；经营推演可用。\n"
            "- 必须说明：当前为模拟态，不构成申报凭证，不可 Pull 官方因子。\n"
            "- 若用户问申报/融资：先给推演结论，再提示可在全域中心 CBAM 结果页「升格为可核验结果」。\n"
            "- 禁止：混用「已确权/可申报」语气。"
        )

    val_str = f"{float(value):.4f}" if value is not None else "—"
    drift_str = f"{float(drift):.1f}%" if drift is not None else "—"
    return f"""
【CBAM 证据态 · 必须与页面一致】
- EvidenceMode：{mode}
- 碳强度主值：{val_str} {unit}
- 实证阶段 stage：{stage}
- 行业字典 dictVersion：{dict_ver} · 核算内核 calcVersion：{calc_ver}
- 凭证 certId：{cert_id}
- 模拟漂移 driftPct：{drift_str}

{voice}"""


def build_system_role(
    app_state     : Dict[str, Any],
    exec_summary  : Optional[ExecutionSummary] = None,
) -> str:
    """
    构建注入 LLM 的 System 提示。
    包含：人格守则 + 实时 AppState 快照（hub_engine V3.1：`metrics` / `flags`）+ 本轮动作执行结果。
    """
    user    = app_state.get("user", {})
    company = app_state.get("company")
    metrics = app_state.get("metrics") or {}
    flags   = app_state.get("flags") or {}

    # 兼容旧版前端快照（impact / phaseMeta）
    if not metrics and app_state.get("impact"):
        legacy = app_state.get("impact") or {}
        metrics = {
            "tCO2eTotal": legacy.get("tCO2eTotal"),
            "globalRank": legacy.get("globalRank"),
            "scope3Coverage": legacy.get("scope3Coverage"),
            "riskExposureEur": legacy.get("riskExposureEur"),
        }
    if not flags.get("currentPhase") and app_state.get("phaseMeta"):
        pm = app_state.get("phaseMeta") or {}
        flags = {
            "currentPhase": pm.get("currentPhase", "Phase1"),
            "unlockedMenusList": pm.get("unlockFeatures", []),
            "nextAction": pm.get("nextAction"),
        }

    phase = flags.get("currentPhase", "Phase1")
    gm      = user.get("gmBalance", 0)

    # ── 用户状态快照 ─────────────────────────────────────────────────────
    user_block = f"""
【当前用户实时状态】
- 用户：{user.get("name", "未知")}（{user.get("email", "")}）
- GM 余额：{gm} GM
- 当前阶段：{phase}
- Token 剩余：{user.get("tokensLeft", 0)}"""

    # ── 企业状态快照 ─────────────────────────────────────────────────────
    if company:
        stage    = company.get("stage", "Incomplete")
        complete = "✅ 已完成" if company.get("isComplete") else "⚠️ 未完成"
        company_block = f"""
【企业空间状态】
- 企业名称：{company.get("name", "未命名")}
- 信用代码：{company.get("creditCode") or "未录入"}
- 行业：{company.get("industryCode") or "未录入"}
- 认证阶段：{stage}
- 信息完整度：{complete}"""
    else:
        company_block = "\n【企业空间状态】\n- 尚未创建企业空间（Phase1 个体模式）"

    # ── 碳数据快照（V3.1 来自 metrics）────────────────────────────────────
    tco2e   = metrics.get("tCO2eTotal")
    scope3  = metrics.get("scope3Coverage")
    risk_eur= metrics.get("riskExposureEur")
    rank    = metrics.get("globalRank")

    if tco2e is not None:
        # 实时计算风险敞口（如数据库没有，前端传来也算）
        risk_str = f"€{risk_eur:,.0f}" if risk_eur else f"≈ €{float(tco2e) * 50:,.0f}（估算，CBAM €50/tCO2e）"
        impact_block = f"""
【实时碳数据】
- 总排放量：{tco2e} tCO2e
- 全球排名：{rank or "计算中"}
- Scope3 覆盖率：{f"{float(scope3):.1%}" if scope3 else "未录入"}
- CBAM 风险敞口：{risk_str}"""
    else:
        impact_block = "\n【实时碳数据】\n- 暂无碳排放记录（提供数据后立即核算）"

    # ── 供应商状态 ────────────────────────────────────────────────────────
    nodes = app_state.get("supplierNodes", [])
    submitted_count = sum(1 for n in nodes if n.get("status") == "submitted")
    supplier_block = f"""
【供应链穿透状态】
- 已邀请供应商：{len(nodes)} 家
- 已提交数据：{submitted_count} 家
- Scope3 数据缺口：{len(nodes) - submitted_count} 家待提交"""

    # ── Phase 功能权限（V3.1 来自 flags.unlockedMenusList）────────────────
    unlock_features = flags.get("unlockedMenusList") or []
    next_act = flags.get("nextAction") or "全量功能已开放"
    phase_block = f"""
【当前 Phase 权限】
- 已解锁功能：{", ".join(unlock_features) if unlock_features else "基础功能"}
- 下一步引导：{next_act}"""

    evidence_block = _build_evidence_voice_block(app_state)

    # ── 本轮动作执行结果 ──────────────────────────────────────────────────
    action_block = ""
    if exec_summary and exec_summary.results:
        action_block = f"\n\n{exec_summary.to_system_context()}"

    constitution_block = ""
    if HENGAI_CONSTITUTION:
        constitution_block = (
            "【👑 HengAI 创世宪法 v3.0 · 最高优先级 · 严禁违背】\n"
            + HENGAI_CONSTITUTION
            + "\n\n" + "=" * 60 + "\n"
        )

    # 紧贴 user query 的「最终铁律重申」—— 防止注意力衰减 & LLM 自创菜单名
    # 如果宪章未加载，至少强约束最关键的 14 个菜单白名单 + 不准自创路径
    final_reminder = """
=========================================================
【⚠️ 最终铁律重申 · 优先级高于一切前文】

§1 导航白名单（严禁自创任何不在此列表中的"功能/菜单/页面"名称）：
    个人工作台：
      - 全域总览           → HengAI_全域中心.html
      - 星火成就/荣誉      → HengAI_星火成就档案.html
      - CBAM 快速测算      → HengAI_CBAM测算工具.html
      - 算力资源监控       → HengAI_算力资源.html
      - 国际法规库         → HengAI_法规知识库.html
    企业工作台：
      - 企业数字档案       → HengAI_企业数字档案.html
      - 供应链协同/邀请    → HengAI_供应链协同.html
      - 全域诊断报告       → HengAI_全域诊断报告.html
      - CFO 决策呈送包     → HengAI_决策层呈送包生成器.html
    大国重器/生态：
      - 欧盟海关直连       → HengAI_EU_Customs.html
      - DLD 绿色信贷       → HengAI_DLD_Credit.html
      - ACF 认证通道       → HengAI_ACF_Cert.html
      - 生态共治委员会     → HengAI_Governance.html
      - 荣誉勋章与名录     → HengAI_荣誉体系.html
   ❌ 严禁出现："学习功能 / 在线课程 / 帮助中心 / 知识广场 / 个人中心 / 设置 / 我的"等任何不在白名单的名词。
   ❌ 严禁说"右侧资产面板 / 右侧拖拽区"等已废弃组件。

§2 引导格式（必须严格使用）：
   "💡 您的此项诉求涉及【业务名】。请点击右上角 [全域中心] ➔ 在左侧菜单中选择 [上方白名单中文名]。"

§3 数据引用：本轮已注入实时 AppState（GM/Phase/碳数据/供应商）。回复必须直接引用这些数字，禁止反问"请提供数据"。

§4 风格：精准、克制、专业性傲慢。禁止套话与机械列表。涉及 CBAM 必须给欧元数字（参考 €50/tCO2e）。
=========================================================
"""

    return (
        constitution_block
        + HENGAI_PERSONA
        + "\n\n" + "=" * 60
        + user_block
        + company_block
        + impact_block
        + evidence_block
        + supplier_block
        + phase_block
        + action_block
        + "\n" + final_reminder
    )


# CBAM 因子字典（欧盟 v3.0，宪章§2-4；供本地工具或后续 function-calling 复用）
CBAM_FACTORS: Dict[str, Decimal] = {
    "aluminium"   : Decimal("11.2"),
    "steel"       : Decimal("2.2"),
    "cement"      : Decimal("0.85"),
    "fertilizers" : Decimal("1.6"),
    "electricity" : Decimal("0.4"),
}


def execute_tool_call(tool_name: str, tool_input: Dict) -> str:
    """在后端执行 CBAM 辅助计算（预留；当前 DeepSeek 路径为纯文本流）。"""
    if tool_name == "calculate_cbam_risk":
        price = Decimal(str(tool_input.get("cbam_carbon_price_eur", 50)))
        lines = []
        total_eur = Decimal("0")
        for item in tool_input.get("goods", []):
            ptype   = item["product_type"]
            weight  = Decimal(str(item["weight_tons"]))
            factor  = CBAM_FACTORS.get(ptype, Decimal("2.0"))
            tco2e   = weight * factor
            eur     = tco2e * price
            total_eur += eur
            lines.append(
                f"{ptype}: {weight}吨 × {factor} tCO2e/t = {tco2e:.1f} tCO2e → €{eur:,.0f}"
            )
        lines.append(f"合计 CBAM 风险敞口: €{total_eur:,.0f}")
        return "\n".join(lines)

    if tool_name == "get_phase_recommendation":
        phase = tool_input.get("current_phase", "Phase1")
        missing = tool_input.get("missing_data_types", [])
        recs = {
            "Phase1": "优先完成企业信息录入（名称+信用代码+行业），解锁碳风险全景图",
            "Phase2": "立即生成 ROI 对冲报告，同时批量邀请供应商完成 Scope3 穿透",
            "Phase3": "激活海关直连，申请 DLD 绿色信贷额度",
        }
        base = recs.get(phase, "完善数据")
        if missing:
            base += f"。当前数据缺口：{', '.join(missing)}"
        return base

    return "工具执行结果不可用"


# ---------------------------------------------------------------------------
# 主对话接口
# ---------------------------------------------------------------------------

DEEPSEEK_API_KEY  = os.environ.get("DEEPSEEK_API_KEY", "").strip()
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip()
DEEPSEEK_MODEL    = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat").strip()
# DeepSeek 首字节可能较慢：读超时 5 分钟，避免默认 httpx 超时导致 SSE event:error
DEEPSEEK_HTTP_TIMEOUT = httpx.Timeout(connect=30.0, read=300.0, write=60.0, pool=30.0)

if not DEEPSEEK_API_KEY:
    logger.error(
        "[HengAI][chat] DEEPSEEK_API_KEY 未配置 —— /api/v1/chat 将返回 503。"
        "请在 backend/.env 或 docker-compose env_file 中设置 DEEPSEEK_API_KEY。"
    )
else:
    logger.info("[HengAI][chat] DEEPSEEK_API_KEY 已加载（长度=%d）", len(DEEPSEEK_API_KEY))


@router.post("/chat", summary="HengAI 专家对话接口（V3.1 · DeepSeek 流式）")
async def chat(
    request       : ChatRequest,
    current_user  : User = Depends(get_current_user),
    db            : AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """
    完整流程：
      1. 意图识别 → 生成 ActionInstruction 列表
      2. ActionExecutor 写库 → ExecutionSummary
      3. 用 ExecutionSummary 更新 AppState 快照
      4. 构建含实时数据的 System Role
      5. 调用 DeepSeek API（OpenAI 兼容协议）
      6. SSE 流式返回 + 附带动作摘要元数据
    """

    # ── Step 0: API Key 校验（缺则 503，否则 NameError 会绕过 CORS）────────
    if not DEEPSEEK_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="后端未配置 DEEPSEEK_API_KEY，对话引擎不可用。请在 docker-compose.yml 的 backend.environment 中注入。",
        )

    # ── Step 1: 意图识别 ──────────────────────────────────────────────────
    user_text = ""
    for msg in reversed(request.messages):
        if msg.role == "user":
            user_text = msg.content
            break

    recognizer = IntentRecognizer()
    parse_result = recognizer.parse(user_text, request.app_state)

    # ── Step 2: 执行动作指令，写入数据库 ──────────────────────────────────
    executor = ActionExecutor(db=db, current_user=current_user)
    exec_summary = await executor.execute_all(parse_result.actions)

    # ── Step 3: 重新拉取最新 AppState（执行后数据已更新）─────────────────
    try:
        updated_state = await build_app_state(current_user, db)
    except Exception as exc:  # noqa: BLE001
        # 降级：使用前端传入的快照，并把异常写到日志而非吞掉
        print(f"[HengAI][chat] build_app_state 失败，回退前端快照: {exc!r}")
        updated_state = normalize_app_state_for_frontend(request.app_state or {})

    # ── Step 4: 构建 System Role ──────────────────────────────────────────
    system_role = build_system_role(updated_state, exec_summary)

    # 🚨 任务 2 · 前端注入的紧凑摘要追加到 system role 末尾（紧贴 user query）
    if request.app_state_summary:
        print(f"[HengAI][chat] 收到 appStateSummary（{len(request.app_state_summary)} chars），注入 system role 末尾")
        system_role = (
            system_role
            + "\n\n=========================================================\n"
            + "【🔴 实时 AppState 摘要（前端 buildAppStateSummary 注入）·  绝对不可与之冲突】\n"
            + request.app_state_summary
            + "\n========================================================="
        )

    # ── Step 5: 构建发送给 LLM 的消息列表 ─────────────────────────────────
    api_messages = [
        {"role": msg.role, "content": msg.content}
        for msg in request.messages
    ]

    # ── Step 6: 流式调用 DeepSeek API（OpenAI 兼容协议）──────────────────
    # 关键：函数名 = _stream_deepseek_response（不是 _stream_claude_response），
    # 否则会抛 NameError 并绕过 CORS 中间件。
    return StreamingResponse(
        _stream_deepseek_response(
            system_role   = system_role,
            messages      = api_messages,
            exec_summary  = exec_summary,
            updated_state = updated_state,
            api_key       = DEEPSEEK_API_KEY,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control"     : "no-cache",
            "X-Accel-Buffering" : "no",
        },
    )


async def _stream_deepseek_response(
    system_role  : str,
    messages     : List[Dict],
    exec_summary : ExecutionSummary,
    updated_state: Dict,
    api_key      : str,
) -> AsyncGenerator[str, None]:
    """
    SSE 流式生成器（DeepSeek = OpenAI 兼容协议）。
    先发送元数据帧（动作摘要），再流式传输模型回复文本。
    前端监听 event: actions_taken 更新 AppState，监听 event: token 更新对话框。
    """

    actions_payload = {
        "actionsTaken" : [
            {
                "type"     : r.action_type.value,
                "success"  : r.success,
                "changes"  : r.changes,
                "gmAwarded": str(r.gm_awarded),
            }
            for r in exec_summary.results if r.success
        ],
        "gmDelta"     : str(exec_summary.total_gm_awarded),
        "phaseChanged": exec_summary.phase_changed,
        "updatedState": normalize_app_state_for_frontend(updated_state),
    }
    yield f"event: actions_taken\ndata: {json.dumps(actions_payload, ensure_ascii=False, default=str)}\n\n"

    yield (
        "event: token\n"
        f"data: {json.dumps({'text': '正在连接 Co2Lion 专家引擎…'}, ensure_ascii=False)}\n\n"
    )

    client = AsyncOpenAI(
        api_key=api_key,
        base_url=DEEPSEEK_BASE_URL,
        timeout=DEEPSEEK_HTTP_TIMEOUT,
    )
    try:
        stream = await client.chat.completions.create(
            model=DEEPSEEK_MODEL,
            messages=[{"role": "system", "content": system_role}] + messages,
            stream=True,
            max_tokens=2048,
        )
    except Exception as exc:  # noqa: BLE001
        yield f"event: error\ndata: {json.dumps({'message': str(exc)}, ensure_ascii=False)}\n\n"
        yield "event: done\ndata: {}\n\n"
        return

    try:
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta and getattr(delta, "content", None):
                chunk_text = delta.content
                yield f"event: token\ndata: {json.dumps({'text': chunk_text}, ensure_ascii=False)}\n\n"
    except Exception as exc:  # noqa: BLE001
        yield f"event: error\ndata: {json.dumps({'message': str(exc)}, ensure_ascii=False)}\n\n"

    yield "event: done\ndata: {}\n\n"
