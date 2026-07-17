#!/usr/bin/env python3
"""验证 hub overview / regulation-read 无 500（在 backend 容器 /app 下运行）"""
import asyncio
import os
import sys

# 容器内 working_dir=/app
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from sqlalchemy import select

from database import AsyncSessionLocal
from hub_engine import build_app_state, regulation_read
from models import User
from schemas import RegulationReadRequest


async def main() -> int:
    async with AsyncSessionLocal() as db:
        r = await db.execute(select(User).limit(1))
        user = r.scalar_one_or_none()
        if not user:
            print("SKIP: 无用户，跳过 API 聚合测试")
            return 0

        dna = await build_app_state(user, db)
        gen = (dna.get("user") or {}).get("generationalGm", dna.get("user", {}).get("gm_generational"))
        if gen is None:
            print("FAIL: overview DNA 缺少 generationalGm")
            return 1
        if not isinstance(gen, (int, float)):
            print(f"FAIL: generationalGm 类型非法: {type(gen)}")
            return 1
        print(f"OK build_app_state generationalGm={gen}")

        req = RegulationReadRequest(regulation_id="audit-reg-001", title="审计法规", progress_pct=100)
        resp = await regulation_read(req, user, db)
        gm = float(resp.gm_earned or 0)
        print(f"OK regulation_read gm_earned={gm} already_read={resp.already_read}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
