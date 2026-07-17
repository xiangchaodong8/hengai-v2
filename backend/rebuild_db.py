"""
Co2Lion·HengAI — 数据库核弹级重置脚本（校准版）
文件：rebuild_db.py  ← 平铺在项目根目录

严格对齐项目结构：
  - database.py 的 Base 在 models.py 中被重新定义（models.Base 覆盖 database.Base）
  - main.py 的 lifespan 使用 database.Base + database.engine
  - 本脚本直接从 database.py 读取 engine，从 models.py 读取 Base + 所有模型

执行效果：
  1. DROP SCHEMA public CASCADE  → 清除所有表、约束、枚举类型、序列
  2. CREATE SCHEMA public        → 重建空白 schema
  3. GRANT 权限恢复
  4. Base.metadata.create_all    → 按 models.py 重建全部 23+ 张表

⚠️  此脚本【永久删除】所有数据，不可恢复！
    --force 跳过确认（适合 docker exec 自动化场景）
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from typing import Optional
from urllib.parse import urlparse, urlunparse

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

# ── 关键：从 models.py 导入 Base + 全部 ORM 类，确保注册到 Base.metadata
#     （models.py V3.1 已重写，旧版 AccountTierEnum / SupplyChainNode 等已移除）
from models import (  # noqa: F401
    Base,
    WorkspaceStage,
    LedgerAction,
    CBAMStatus,
    SupplierStatus,
    UserTier,
    User,
    UserWorkspace,
    Workspace,
    GMLedger,
    CBAMReport,
    SupplierNode,
    EnergyRecord,
    UserBadge,
)

# ── 从 database.py 读取已配置好的异步引擎与连接串（用于失败时脱敏打印）
from database import DATABASE_URL, engine


def _redact_database_url(url: str) -> str:
    """脱敏：保留 scheme / host / port / dbname，密码替换为 ***。"""
    if not url:
        return "(空)"
    try:
        p = urlparse(url)
        user = p.username or ""
        if p.password:
            auth = f"{user}:***" if user else "***"
        else:
            auth = user or ""
        host = p.hostname or ""
        port = f":{p.port}" if p.port else ""
        netloc = f"{auth}@{host}{port}" if auth else f"{host}{port}"
        return urlunparse((p.scheme, netloc, p.path or "", p.params, p.query, p.fragment))
    except Exception:
        return "(无法解析 DATABASE_URL)"


def _hostname_from_database_url(url: str) -> Optional[str]:
    try:
        return urlparse(url).hostname
    except Exception:
        return None


def print_database_connection_diagnostics(last_exc: BaseException) -> None:
    """连接失败时打印可操作的排障信息（不写明文密码）。"""
    raw = os.environ.get("DATABASE_URL", "")
    effective = DATABASE_URL
    host = _hostname_from_database_url(effective)

    print("\n" + "─" * 62)
    print("  [DATABASE 连接失败 · 诊断]")
    print("─" * 62)
    print(f"  环境变量 DATABASE_URL 已设置: {'是' if raw else '否（使用 database.py 默认）'}")
    print(f"  实际使用的连接串（脱敏）:\n    {_redact_database_url(effective)}")
    print(f"  解析到的主机名: {host or '(无)'}")
    print(f"  异常类型: {type(last_exc).__name__}")
    print(f"  异常信息: {last_exc}")

    if host in ("hengai_db", "db"):
        print(
            "\n  提示: 主机名「hengai_db / db」仅在 Docker Compose 内部网络可解析。\n"
            "        若在 Windows 宿主直接运行本脚本，请任选其一：\n"
            "        A) 先执行: docker compose up -d db\n"
            "           再设置: DATABASE_URL=postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/postgres\n"
            "        B) 在容器内执行: docker compose exec backend python rebuild_db.py --force\n"
        )
    elif host and host not in ("127.0.0.1", "localhost"):
        print(
            "\n  提示: 请确认该主机可从本机解析（ping / nslookup），且安全组/防火墙放行 5432。\n"
        )
    else:
        print(
            "\n  提示: 若本机未起库，可: docker compose up -d db\n"
            "        默认端口映射见 docker-compose.yml（POSTGRES_HOST_PORT，默认 5432）。\n"
        )
    print("─" * 62 + "\n")

# ─────────────────────────────────────────────────────────────────────
# § 1  核弹 SQL 步骤
# ─────────────────────────────────────────────────────────────────────

NUKE_STEPS: list[tuple[str, str]] = [
    ("DROP SCHEMA public CASCADE",
     "DROP SCHEMA public CASCADE;"),
    ("CREATE SCHEMA public",
     "CREATE SCHEMA public;"),
    ("GRANT USAGE ON SCHEMA public TO PUBLIC",
     "GRANT USAGE ON SCHEMA public TO PUBLIC;"),
    ("GRANT CREATE ON SCHEMA public TO PUBLIC",
     "GRANT CREATE ON SCHEMA public TO PUBLIC;"),
]

# 关键列校验（表名, 列名）—— 与 models.py V3.1 对齐
CRITICAL_COLUMNS: list[tuple[str, str]] = [
    ("users",          "hashed_password"),
    ("users",          "email"),
    ("users",          "tier"),
    ("users",          "gm_balance_cache"),
    ("users",          "tokens_left"),
    ("workspaces",     "name"),
    ("workspaces",     "credit_code"),
    ("workspaces",     "is_complete"),
    ("workspaces",     "stage"),
    ("workspaces",     "main_product"),
    ("gm_ledger",      "user_id"),
    ("gm_ledger",      "action"),
    ("gm_ledger",      "amount"),
    ("cbam_reports",   "workspace_id"),
    ("cbam_reports",   "reporting_period"),
    ("cbam_reports",   "status"),
    ("supplier_nodes", "workspace_id"),
    ("supplier_nodes", "supplier_name"),
    ("supplier_nodes", "status"),
    ("energy_records", "workspace_id"),
    ("user_badges",    "user_id"),
    ("user_badges",    "badge_code"),
]


# ─────────────────────────────────────────────────────────────────────
# § 2  核心异步函数
# ─────────────────────────────────────────────────────────────────────

async def nuke_schema(engine: AsyncEngine, dry_run: bool) -> None:
    print("\n" + "═" * 62)
    print("  Phase 1/3 — 核弹清场（DROP SCHEMA CASCADE）")
    print("═" * 62)

    if dry_run:
        for label, sql in NUKE_STEPS:
            print(f"  [DRY-RUN] {label}")
        print()
        return

    async with engine.connect() as conn:
        await conn.execution_options(isolation_level="AUTOCOMMIT")
        for label, sql in NUKE_STEPS:
            print(f"  ▶ {label} ... ", end="", flush=True)
            t0 = time.monotonic()
            await conn.execute(text(sql))
            print(f"✓  ({(time.monotonic()-t0)*1000:.1f}ms)")

    print("\n  ✅ Schema 清除并重建完毕\n")


async def create_tables(engine: AsyncEngine, dry_run: bool) -> None:
    print("═" * 62)
    print("  Phase 2/3 — 按 models.py 重建全部表结构")
    print("═" * 62)

    tables = sorted(Base.metadata.tables.keys())
    print(f"  📋 检测到 {len(tables)} 张表：")
    for t in tables:
        print(f"       • {t}")
    print()

    if not tables:
        print("  ❌ Base.metadata 中无表！检查 models.py 导入是否完整")
        sys.exit(1)

    if dry_run:
        print("  [DRY-RUN] 跳过建表\n")
        return

    t0 = time.monotonic()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print(f"  ✅ {len(tables)} 张表创建完毕  ({(time.monotonic()-t0)*1000:.1f}ms)\n")


async def verify_columns(engine: AsyncEngine, dry_run: bool) -> None:
    print("═" * 62)
    print("  Phase 3/3 — 关键列完整性校验")
    print("═" * 62)

    if dry_run:
        print("  [DRY-RUN] 跳过校验\n")
        return

    all_pass = True
    async with engine.connect() as conn:
        for table, col in CRITICAL_COLUMNS:
            res = await conn.execute(text("""
                SELECT COUNT(*) FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name   = :t
                  AND column_name  = :c
            """), {"t": table, "c": col})
            ok = res.scalar_one() > 0
            if not ok:
                all_pass = False
            print(f"  {'✅' if ok else '❌'}  {table}.{col}")

    print()
    if all_pass:
        print("  ✅ 所有关键列校验通过！\n")
    else:
        print("  ❌ 存在缺失列，检查 models.py 后重试\n")
        sys.exit(2)


# ─────────────────────────────────────────────────────────────────────
# § 3  主流程
# ─────────────────────────────────────────────────────────────────────

async def main(force: bool, dry_run: bool) -> None:
    print("\n" + "█" * 62)
    print("  Co2Lion·HengAI  数据库核弹级重置脚本")
    print("█" * 62)
    print(f"\n  检测到 {len(Base.metadata.tables)} 张表已注册到 Base.metadata")
    print(f"  Dry-Run: {'是（仅预览）' if dry_run else '否（真实执行）'}\n")

    if not force and not dry_run:
        print("  ⚠️  此操作将【永久删除】数据库中所有数据，不可恢复！")
        ans = input("  输入 'YES I AM SURE' 确认：").strip()
        if ans != "YES I AM SURE":
            print("\n  ✋ 已取消\n")
            sys.exit(0)
        print()

    t_start = time.monotonic()
    try:
        await nuke_schema(engine, dry_run)
        await create_tables(engine, dry_run)
        await verify_columns(engine, dry_run)

        print("█" * 62)
        print(f"  🎉 数据库重置完成！耗时 {(time.monotonic()-t_start)*1000:.0f}ms")
        print("█" * 62 + "\n")
    finally:
        await engine.dispose()


# ─────────────────────────────────────────────────────────────────────
# § 4  CLI 入口
# ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="HengAI 数据库核弹重置")
    parser.add_argument("--force",   "-f", action="store_true",
                        help="跳过交互确认（docker exec / CI 场景）")
    parser.add_argument("--dry-run", "-n", action="store_true",
                        help="仅预览，不实际执行")
    args = parser.parse_args()
    try:
        asyncio.run(main(force=args.force, dry_run=args.dry_run))
    except Exception as exc:  # noqa: BLE001 — CLI 入口统一吞掉并给出脱敏诊断
        print_database_connection_diagnostics(exc)
        sys.exit(3)
