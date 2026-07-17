from contextlib import asynccontextmanager
import asyncio
import os
import sys

from dotenv import load_dotenv

load_dotenv()

# Windows 控制台默认 GBK 编码无法承载日志里的 emoji（⚠️ ✅ 🌐 等），
# 一旦 print 抛 UnicodeEncodeError，会把 uvicorn 子进程整体拖死。
# 这里在最早期就把 stdout/stderr 切到 UTF-8（带 errors='replace' 兜底），
# 不影响 Linux/Mac，也不需要用户额外设 PYTHONIOENCODING。
for _stream_name in ("stdout", "stderr"):
    _stream = getattr(sys, _stream_name, None)
    if _stream is not None and hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001 — 不能让日志层把启动拖崩
            pass

import models  # noqa: F401 — 注册 ORM 模型到 Base.metadata
import json
from pathlib import Path

from database import Base, engine, wait_for_db
from sqlalchemy import text
from fastapi import FastAPI, APIRouter
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware


async def _initialize_database() -> None:
    """
    后台初始化数据库。
    Postgres 启动慢时不能阻塞整个 FastAPI 监听，否则前端会看到 ERR_EMPTY_RESPONSE。
    """
    try:
        await wait_for_db()

        # V3 物理重建：设 HENGAI_DB_RESET_ON_START=1 时先 drop_all 再 create_all（首次迁库用；常态请保持 0）
        _reset = os.environ.get("HENGAI_DB_RESET_ON_START", "0").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        async with engine.begin() as conn:
            if _reset:
                await conn.run_sync(Base.metadata.drop_all)
                print("♻️ 已执行 Base.metadata.drop_all（HENGAI_DB_RESET_ON_START 启用）")
            await conn.run_sync(Base.metadata.create_all)
            for stmt in (
                "ALTER TABLE workspaces ALTER COLUMN verified_factor_cert_id TYPE VARCHAR(96)",
                "ALTER TABLE supplier_nodes ADD COLUMN IF NOT EXISTS invited_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL",
                "ALTER TABLE supplier_nodes ADD COLUMN IF NOT EXISTS is_insured BOOLEAN NOT NULL DEFAULT FALSE",
                "ALTER TABLE supplier_nodes ADD COLUMN IF NOT EXISTS is_white_listed BOOLEAN NOT NULL DEFAULT FALSE",
                "CREATE INDEX IF NOT EXISTS ix_supplier_nodes_invited_by ON supplier_nodes (invited_by_user_id)",
                "ALTER TABLE supplier_nodes ADD COLUMN IF NOT EXISTS invite_code VARCHAR(16)",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_nodes_invite_code ON supplier_nodes (invite_code) WHERE invite_code IS NOT NULL",
                "ALTER TABLE supplier_nodes ADD COLUMN IF NOT EXISTS claim_contact_name VARCHAR(128)",
                "ALTER TABLE supplier_nodes ADD COLUMN IF NOT EXISTS claim_phone VARCHAR(32)",
                "ALTER TABLE supplier_nodes ADD COLUMN IF NOT EXISTS claim_certificate_id VARCHAR(64)",
                "ALTER TABLE supplier_nodes ADD COLUMN IF NOT EXISTS claim_confirmed_at TIMESTAMPTZ",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_nodes_claim_cert ON supplier_nodes (claim_certificate_id) WHERE claim_certificate_id IS NOT NULL",
                "ALTER TABLE supplier_nodes ADD COLUMN IF NOT EXISTS cl_ivc_hash VARCHAR(64)",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_nodes_cl_ivc_hash ON supplier_nodes (cl_ivc_hash) WHERE cl_ivc_hash IS NOT NULL",
                "ALTER TABLE supplier_nodes ADD COLUMN IF NOT EXISTS sovereign_payload_json TEXT",
                "ALTER TABLE supplier_nodes ADD COLUMN IF NOT EXISTS submission_count INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE supplier_nodes ADD COLUMN IF NOT EXISTS consecutive_submissions INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE supplier_nodes ADD COLUMN IF NOT EXISTS report_timeliness NUMERIC(8, 4)",
                "CREATE TABLE IF NOT EXISTS supplier_submission_logs ("
                "id UUID PRIMARY KEY, "
                "supplier_node_id UUID NOT NULL REFERENCES supplier_nodes(id) ON DELETE CASCADE, "
                "submitted_at TIMESTAMPTZ NOT NULL, "
                "tco2e_reported NUMERIC(20, 4), "
                "timeliness_score NUMERIC(8, 4), "
                "cl_ivc_hash VARCHAR(64), "
                "period_key VARCHAR(16)"
                ")",
                "CREATE INDEX IF NOT EXISTS ix_supplier_submission_logs_node ON supplier_submission_logs (supplier_node_id)",
                "CREATE INDEX IF NOT EXISTS ix_supplier_submission_logs_period ON supplier_submission_logs (period_key)",
                "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS verified_factor NUMERIC(20, 4)",
                "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS verified_factor_yoy_pct NUMERIC(8, 4)",
                "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS verified_factor_cert_id VARCHAR(32)",
                "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS verified_factor_meta_json TEXT",
                "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS verification_code VARCHAR(64)",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_verified_factor_cert ON workspaces (verified_factor_cert_id) WHERE verified_factor_cert_id IS NOT NULL",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_verification_code ON workspaces (verification_code) WHERE verification_code IS NOT NULL",
                "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS sovereignty_claim_status VARCHAR(16) NOT NULL DEFAULT 'none'",
                "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS sovereignty_claim_submitted_at TIMESTAMPTZ",
                "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS sovereignty_auth_letter_path VARCHAR(512)",
                "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS sovereignty_auth_letter_filename VARCHAR(256)",
                "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS sovereignty_auth_letter_mime VARCHAR(128)",
                "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS sovereignty_claim_reviewer_note TEXT",
                "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS sovereignty_claim_reviewed_at TIMESTAMPTZ",
                "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS sovereignty_ai_prescreen_json TEXT",
                "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS resonance_requests INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS region_tag VARCHAR(32)",
                "CREATE TABLE IF NOT EXISTS resonance_requests ("
                "id UUID PRIMARY KEY, "
                "requester_workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, "
                "requester_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
                "industry_code VARCHAR(32) NOT NULL, "
                "origin_query VARCHAR(256), "
                "product_category VARCHAR(128), "
                "status VARCHAR(16) NOT NULL DEFAULT 'pending', "
                "target_workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL, "
                "fulfilled_cert_id VARCHAR(32), "
                "created_at TIMESTAMPTZ DEFAULT NOW(), "
                "updated_at TIMESTAMPTZ DEFAULT NOW()"
                ")",
                "CREATE INDEX IF NOT EXISTS ix_resonance_requests_industry ON resonance_requests (industry_code, status)",
                "ALTER TABLE resonance_requests ADD COLUMN IF NOT EXISTS fulfill_source VARCHAR(16)",
                "CREATE TABLE IF NOT EXISTS supply_chain_bindings ("
                "id UUID PRIMARY KEY, "
                "downstream_workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, "
                "origin_workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE, "
                "origin_query VARCHAR(256) NOT NULL, "
                "material_type VARCHAR(128), "
                "status VARCHAR(16) NOT NULL DEFAULT 'pending', "
                "declared_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL, "
                "reviewer_note TEXT, "
                "reviewed_at TIMESTAMPTZ, "
                "created_at TIMESTAMPTZ DEFAULT NOW(), "
                "updated_at TIMESTAMPTZ DEFAULT NOW(), "
                "CONSTRAINT uq_binding_pair UNIQUE (downstream_workspace_id, origin_workspace_id)"
                ")",
                "CREATE INDEX IF NOT EXISTS ix_supply_chain_bindings_origin ON supply_chain_bindings (origin_workspace_id, status)",
                "CREATE TABLE IF NOT EXISTS factor_consumptions ("
                "id UUID PRIMARY KEY, "
                "origin_workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, "
                "consumer_workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, "
                "consumer_user_id UUID REFERENCES users(id) ON DELETE SET NULL, "
                "binding_id UUID REFERENCES supply_chain_bindings(id) ON DELETE SET NULL, "
                "cert_id VARCHAR(32), "
                "industry_code VARCHAR(32) NOT NULL, "
                "batch_id VARCHAR(64) NOT NULL, "
                "qty_tons NUMERIC(20, 4), "
                "factor_value NUMERIC(20, 4), "
                "carbon_tonnage NUMERIC(20, 4), "
                "tax_saved_eur NUMERIC(20, 4), "
                "claim_mode VARCHAR(16) NOT NULL DEFAULT 'anonymous', "
                "region_tag VARCHAR(64), "
                "created_at TIMESTAMPTZ DEFAULT NOW(), "
                "CONSTRAINT uq_consumer_batch UNIQUE (consumer_workspace_id, batch_id)"
                ")",
                "CREATE INDEX IF NOT EXISTS ix_factor_consumptions_origin ON factor_consumptions (origin_workspace_id, created_at)",
            ):
                await conn.execute(text(stmt))
        print("✅ 数据库实体模型(异步)映射完毕")
        print(
            "[HengAI][DB] 金额/碳排字段已按 Numeric(20,4) 建模（最大约 10^16 量级）。"
            "若旧库仍报 numeric overflow，请设 HENGAI_DB_RESET_ON_START=1 重建一次表结构。"
        )
    except Exception as exc:  # noqa: BLE001 — 启动期数据库异常不能拖垮 HTTP 服务
        print(f"[HengAI][DB] 后台初始化失败，HTTP 服务继续运行: {exc!r}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 心脏起搏 V3.2：数据库初始化转后台，避免 Postgres 慢启动导致 HTTP 空响应。
    db_init_task = asyncio.create_task(_initialize_database())
    try:
        yield
    finally:
        if not db_init_task.done():
            db_init_task.cancel()
            try:
                await db_init_task
            except asyncio.CancelledError:
                pass

app = FastAPI(title="HengAI V2.0 Backend", lifespan=lifespan)

# ---------- CORS 配置（本地 HTML / 多端口联调）----------
# 注意：CORS 规范禁止 `allow_origins=["*"]` 与 `allow_credentials=True` 同时启用，
# 部分浏览器会忽略响应头导致前端拿到「No Access-Control-Allow-Origin」。
# 因此这里改为：
#   - allow_origin_regex：放行所有 localhost / 127.0.0.1 / 0.0.0.0 的任意端口
#   - allow_credentials=True：保留 cookie / Authorization 透传能力
#   - expose_headers="*"：让前端可以读到 SSE 流相关的自定义头
_DEV_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://localhost:80",
        "http://localhost:8000",
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1",
        "http://127.0.0.1:80",
        "http://127.0.0.1:8000",
    ],
    allow_origin_regex=_DEV_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=86400,
)

# ---------- 核心业务路由（V3.1 心脏移植）----------
# 路由前缀策略（与 chat / hub_engine 保持单一真相）：
# - 所有业务 router 内部 NOT 自带 prefix
# - main.py 在 include_router 时统一注入 /api/v1 / /api/v1/hub / /api/v1/auth
# 这样可以彻底杜绝 /api/v1/api/v1/... 这类双前缀 404。
from hub_engine import router as hub_router, eco_router
from auth import router as auth_router

app.include_router(auth_router, prefix="/api/v1/auth")
app.include_router(hub_router, prefix="/api/v1/hub")
app.include_router(eco_router)

# ---------- 静态资源：单点真理 = frontend（Docker: /app/frontend；本地: <项目根>/frontend）----------
_HERE = Path(__file__).resolve().parent
_PROJECT_ROOT = _HERE.parent
_frontend_dir = Path("/app/frontend")
if not (_frontend_dir / "index.html").is_file():
    _frontend_dir = (_PROJECT_ROOT / "frontend").resolve()
if not (_frontend_dir / "index.html").is_file():
    _frontend_dir = (_HERE / "frontend").resolve()
if not (_frontend_dir / "index.html").is_file():
    print(
        "[HengAI][WARN] frontend 缺少 index.html —— "
        f"已检查 /app/frontend 与 {_PROJECT_ROOT / 'frontend'}"
    )
_static_dir = _frontend_dir

print(
    "[HengAI] JWT/密码栈依赖：请确认已安装 "
    "python-jose[cryptography]、passlib[bcrypt]、bcrypt（已写入 requirements.txt）。"
)

# ---------- V3.1 对话路由（IntentRecognizer + ActionExecutor + AppState 注入）----------
# 根目录 chat.py 内部 NOT 自带 prefix，由 main.py 注入 /api/v1，最终路径精确等于 /api/v1/chat。
# 任何 ImportError 都不能拖垮整个后端进程，而是降级到一条最小可用 fallback（同样挂在 /api/v1）。
try:
    from chat import router as chat_router

    app.include_router(chat_router, prefix="/api/v1")
    _ds_key = (os.environ.get("DEEPSEEK_API_KEY") or "").strip()
    if _ds_key:
        print(
            f"[HengAI] ✅ 已挂载 V3.1 chat → /api/v1/chat | DEEPSEEK_API_KEY 长度={len(_ds_key)}"
        )
    else:
        print(
            "[HengAI] ✅ 已挂载 V3.1 chat → /api/v1/chat | "
            "⚠️ DEEPSEEK_API_KEY 未设置，对话接口将返回 503"
        )
except Exception as e:  # noqa: BLE001 — 这里必须吞掉，避免 chat 链路崩溃整个后端
    print(f"[HengAI] ⚠️ V3.1 chat.py 加载失败，启用 fallback: {e!r}")
    fallback_chat_router = APIRouter(tags=["chat-fallback"])

    class FallbackChatRequest(BaseModel):
        message: str = Field(default="")

    @fallback_chat_router.post("/chat")
    async def fallback_chat_endpoint(req: FallbackChatRequest):
        user_msg = (req.message or "").strip()
        if ("怎么算" in user_msg) or ("测算" in user_msg):
            reply = "我已经为您调取了 CBAM 核算模型。请点击右上角的【全域中心】，在左侧【CBAM 测算工具】中进行精准测算。"
        else:
            reply = f"收到您的指令：{user_msg or '请继续描述您的问题'}。HengAI 底座已激活，正在为您处理跨国合规数据。"
        return {"reply": reply}

    app.include_router(fallback_chat_router, prefix="/api/v1")

try:
    from routers.assets import router as assets_router

    # assets 路由内部 endpoint 是 /parse-bill，统一注入 /api/v1/assets 前缀，
    # 避免与根静态混淆（按董事长禁令：所有 API 必须以 /api 开头）。
    app.include_router(assets_router, prefix="/api/v1/assets")
except ImportError as e:
    print(f"Assets Router 导入失败: {e}")


# ---------- 健康检查路由 ----------
@app.get("/api/health")
async def health_check():
    return {"status": "ok", "message": "HengAI Engine Online"}


class ChatPayload(BaseModel):
    message: str = Field(default="")
    history: list[dict] = Field(default_factory=list)
    messages: list[dict] = Field(default_factory=list)


@app.post("/api/chat")
async def chat_fallback(payload: ChatPayload):
    """
    过渡期聊天接口：
    - 保证前端 /api/chat 不再 404
    - 回显用户问题，维持可交互状态
    """
    msg = (payload.message or "").strip()
    messages = payload.messages or payload.history or []
    if not msg and messages:
        last_user = next(
            (
                m for m in reversed(messages)
                if str(m.get("role", "")).lower() in {"user", "human"}
            ),
            {},
        )
        msg = str(last_user.get("content", "")).strip()
    if not msg:
        msg = "请继续为我分析当前碳合规风险"

    reply = (
        "我是 HengAI，我已经收到您的指令。"
        f"您的企业专属碳管家正在为您处理：{msg}"
    )
    chunk = f"event: token\ndata: {json.dumps({'text': reply}, ensure_ascii=False)}\n\n"
    done = "event: done\ndata: {}\n\n"
    return StreamingResponse(
        iter([chunk, done]),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


# ---------- 静态资源挂载（必须放在所有 API 路由之后，且严禁挂到根 "/"）----------
# 教训：app.mount("/", StaticFiles(html=True)) 会接管所有未命中路由的请求，
# 把按钮点击产生的 fetch（如打错前缀的 /api/docs / /chat 之类）静默吞成 200 + index.html，
# 让前端误以为接口存在，业务全线哑火。
#
# V3.2 纪律：
#   * 业务接口：一律 /api/...
#   * 静态资源：仅挂 /static
#   * Swagger 文档：保持 FastAPI 默认 /docs（不要加 /api 前缀）
#   * 根路径 "/"：用一个轻量重定向把人送到 /static/index.html，绝不挂 StaticFiles
class NoCacheStaticFiles(StaticFiles):
    """静态资源强制 no-cache，避免前端脚本/HTML 缓存幽灵。"""

    async def get_response(self, path: str, scope):
        response: Response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response


app.mount(
    "/static",
    NoCacheStaticFiles(directory=str(_static_dir), html=True),
    name="static",
)
print(f"[HengAI] 已挂载 /static → {_static_dir}")
print("[HengAI] 文档入口：/docs（Swagger）/redoc（ReDoc）/openapi.json")


@app.get("/", include_in_schema=False)
async def _root_redirect():
    """根路径仅做一次性跳转，不再被静态文件夺权。"""
    from fastapi.responses import RedirectResponse

    return RedirectResponse(url="/static/index.html", status_code=307)


# Docker 自检：docker exec hengai_backend test -f /app/frontend/index.html && echo STATIC_OK
