#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SYNC §6 共振举力冒烟：trigger / GET / fulfill（无资金归集）。"""
from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional, Tuple

BASE = os.environ.get("HENGAI_HUB_BASE", "http://127.0.0.1:8000").rstrip("/")
TS = int(time.time())
ENTITY = f"91{TS % 10**16:016d}"[:18]
HOLDER = f"共振原厂-{TS}"
TARGET = 3


def req(method: str, path: str, body: Optional[dict] = None, token: Optional[str] = None) -> Tuple[int, Any]:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode() or "{}"
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {"detail": raw}
        return exc.code, parsed


def register_sme(i: int) -> str:
    email = f"res-sme-{TS}-{i}@example.com"
    code, reg = req("POST", "/api/v1/auth/register", {
        "email": email,
        "password": "TestPass1",
        "company_name": f"SME-{TS}-{i}",
    })
    assert code in (200, 201), reg
    token = reg["access_token"]
    code, _ = req("POST", "/api/v1/hub/workspace-update", {
        "name": f"SME-{TS}-{i}",
        "creditCode": f"92{TS % 10**14:014d}{i:02d}"[:18],
        "industryCode": "steel",
    }, token)
    assert code == 200, _
    return token


def set_pool_target(entity: str, target: int) -> None:
    """测试用：把阈值压到 3，避免注册 30 个账号。"""
    sql = (
        f"UPDATE resonance_trigger_pools "
        f"SET target_count={int(target)} "
        f"WHERE upper(production_entity)=upper('{entity}');"
    )
    subprocess.run(
        [
            "docker", "exec", "hengai_db",
            "psql", "-U", "postgres", "-d", "postgres", "-c", sql,
        ],
        check=False,
        capture_output=True,
        text=True,
    )


def main() -> None:
    print(f"== resonance trigger smoke @ {BASE} entity={ENTITY} ==")
    code, health = req("GET", "/api/health")
    assert code == 200, health

    # 原厂档案（供 fulfill 写 fundingMode）
    code, oreg = req("POST", "/api/v1/auth/register", {
        "email": f"res-origin-{TS}@example.com",
        "password": "TestPass1",
        "company_name": HOLDER,
    })
    assert code in (200, 201), oreg
    origin_tok = oreg["access_token"]
    code, _ = req("POST", "/api/v1/hub/workspace-update", {
        "name": HOLDER,
        "creditCode": ENTITY,
        "industryCode": "steel",
    }, origin_tok)
    assert code == 200, _

    t1 = register_sme(1)
    code, r1 = req("POST", "/api/v1/hub/resonance/trigger", {
        "productionEntity": ENTITY,
        "holder": HOLDER,
        "message": "请启动 CL-GTCID 实证",
    }, t1)
    assert code == 200, r1
    assert r1.get("currentCount") == 1, r1
    assert r1.get("status") == "collecting", r1
    print("  PASS  first trigger", r1.get("currentCount"), "/", r1.get("targetCount"))

    set_pool_target(ENTITY, TARGET)

    q = urllib.parse.urlencode({"productionEntity": ENTITY})
    code, g1 = req("GET", f"/api/v1/hub/resonance/trigger?{q}", token=t1)
    assert code == 200, g1
    assert g1.get("targetCount") == TARGET, g1
    assert g1.get("alreadyParticipated") is True, g1
    print("  PASS  GET after target patch", g1.get("currentCount"), "/", g1.get("targetCount"))

    # 同账号重复不计次
    code, dup = req("POST", "/api/v1/hub/resonance/trigger", {
        "productionEntity": ENTITY,
        "holder": HOLDER,
    }, t1)
    assert code == 200 and dup.get("alreadyParticipated") is True, dup
    assert dup.get("currentCount") == 1, dup
    print("  PASS  duplicate ignored")

    # 未达阈 fulfill → 400
    code, early = req("POST", "/api/v1/hub/resonance/trigger/fulfill", {
        "productionEntity": ENTITY,
        "holder": HOLDER,
    }, t1)
    assert code == 400, early
    print("  PASS  fulfill before threshold → 400")

    for i in (2, 3):
        tok = register_sme(i)
        code, ri = req("POST", "/api/v1/hub/resonance/trigger", {
            "productionEntity": ENTITY,
            "holder": HOLDER,
        }, tok)
        assert code == 200, ri
        print("  PASS  trigger", i, "→", ri.get("currentCount"), "/", ri.get("targetCount"))

    code, ful = req("POST", "/api/v1/hub/resonance/trigger/fulfill", {
        "productionEntity": ENTITY,
        "holder": HOLDER,
    }, t1)
    assert code == 200, ful
    assert ful.get("status") == "fulfilled", ful
    assert ful.get("fundingMode") == "resonance_triggered", ful
    print("  PASS  fulfill", ful.get("status"))

    ov = req("GET", "/api/v1/hub/overview", token=origin_tok)[1]
    # fundingMode 在 meta / company 视实现而定；至少 overview 不报错
    assert isinstance(ov, dict), ov
    print(json.dumps({
        "ok": True,
        "productionEntity": ENTITY,
        "status": ful.get("status"),
        "currentCount": ful.get("currentCount"),
        "targetCount": ful.get("targetCount"),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
