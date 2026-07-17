# database.py — 异步数据库会话工厂（V3 Docker 主路径）
# 容器内 Postgres 服务名 hengai_db，与 docker-compose 对齐
#
# 心脏起搏增强（V3.1）：
# 1) 通过 connect_args.command_timeout 限制单条 SQL 阻塞，避免数据库 starting up 时整个进程被卡死。
# 2) pool_pre_ping + pool_recycle，连接被 PG 重启踢掉后能透明重建。
# 3) wait_for_db()：后端启动时主动重试 ping，等待数据库就绪而不是直接崩溃。

from __future__ import annotations

import asyncio
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from models import Base  # noqa: F401 — 供 main.create_all 与类型引用

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@hengai_db:5432/postgres",
)

# asyncpg 的 connection-level 配置：command_timeout 单位为秒。
# 这里给到 60s，既能容忍 starting up 期间的慢查询，又不会让接口被无限期挂起。
_ASYNCPG_CONNECT_ARGS = {
    "command_timeout": 60,
    "server_settings": {
        # 让 PG 端日志能区分是 HengAI Backend 发出的连接，方便排障
        "application_name": "hengai_backend",
    },
}

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,        # 取连接前先 ping，避免拿到已被 PG 关闭的死连接
    pool_recycle=1800,         # 30 分钟回收一次，防止 PG 端 idle_in_transaction 超时
    pool_size=10,
    max_overflow=20,
    connect_args=_ASYNCPG_CONNECT_ARGS,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def wait_for_db(
    max_retries: int = 30,
    delay_seconds: float = 2.0,
) -> None:
    """
    启动时阻塞式等待数据库就绪。
    Docker 启动顺序下，hengai_db 还在 'database system is starting up' 时，
    后端不应直接崩溃，而应轮询重试，直到数据库可执行 `SELECT 1`。

    - max_retries: 最多重试次数（默认 30 次 × 2s = 最长 60 秒）
    - delay_seconds: 每次失败后的等待间隔
    """
    last_exc: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            print(f"[HengAI][DB] 数据库连接就绪（尝试 {attempt}/{max_retries}）")
            return
        except Exception as exc:  # noqa: BLE001 — 启动期任何异常都视作未就绪
            last_exc = exc
            print(
                f"[HengAI][DB] 数据库尚未就绪({type(exc).__name__}: {exc})，"
                f"{delay_seconds}s 后重试 ({attempt}/{max_retries})"
            )
            await asyncio.sleep(delay_seconds)
    # 到达这里说明真的连不上了，再向上抛，让 lifespan 给出明确错误
    raise RuntimeError(
        f"数据库在 {max_retries * delay_seconds:.0f}s 内仍不可用，最后异常: {last_exc!r}"
    )


async def get_db():
    """FastAPI Depends 注入：自动管理 Session 生命周期。"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
