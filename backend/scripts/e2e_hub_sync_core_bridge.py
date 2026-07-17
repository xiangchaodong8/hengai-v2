#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
精算芯 → Hub 工程联调冒烟（SYNC_CONTRACT_v2）

覆盖两条路径：
  A. 工程直连  POST /api/v1/hub/overview/sync   （Bearer + Core payload 形状）
  B. 产品主路径 POST /api/v1/hub/evidence/redeem （HENGAI1 兑换码内嵌 sync）

不依赖 :8001 进程在线；payload 字段与 HengAI_Core_Test/app.js → buildHubSyncPayload 对齐。
用法：
  python backend/scripts/e2e_hub_sync_core_bridge.py
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Optional, Tuple

BASE = os.environ.get("HENGAI_HUB_BASE", "http://127.0.0.1:8000").rstrip("/")
TS = int(time.time())
EMAIL = f"core-bridge-{TS}@example.com"
PASSWORD = "TestPass1"
COMPANY = f"CoreBridge原厂-{TS}"
CREDIT = f"91{TS % 10**16:016d}"[:18]
REDEEM_PREFIX = "HENGAI1"
HMAC_SECRET = os.environ.get("HENGAI_REDEEM_HMAC", "dev-redeem-hmac-change-me")


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
            raw = resp.read().decode() or "{}"
            return resp.status, json.loads(raw)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode() or "{}"
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {"detail": raw}
        return exc.code, parsed


def build_core_sync_payload(*, batch_suffix: str, mat_locked: bool, maturity: str) -> Dict[str, Any]:
    """镜像 Core buildHubSyncPayload(L1) 字段集（无 processes）。"""
    return {
        "syncTier": "L1",
        "source": "hengai_universal_core",
        "industryId": "steel",
        "batchId": f"CORE-BATCH-{TS}-{batch_suffix}",
        "dataFingerprint": f"fp:core:{TS}:{batch_suffix}",
        "encHash": f"enc:core:{TS}:{batch_suffix}",
        "carbonIntensity": 1.87,
        "gmReward": 150,
        "holder": COMPANY,
        "productionEntity": CREDIT,
        "productionEntitySource": "enterprise_legal",
        "enterpriseRegistryId": f"REG-CORE-{TS}",
        "certificateId": f"CL-GTCID-2026-CORE-{TS}-{batch_suffix}",
        "issuedAt": "2026-07-15T10:00:00+08:00",
        "cnCode": "7208",
        "totalEmission": 18700,
        "productOutputT": 10000,
        "fundingMode": "self_paid",
        "qualityTag": {
            "calibration": "cited",
            "matBoxLocked": mat_locked,
            "credibilityScore": 72,
            "suspicionLevel": "LOW",
            "maturityTier": maturity,
            "provenanceGrade": "cited",
            "riskFlags": [],
            "activeJurisdiction": "cbam",
            "fundingMode": "self_paid",
        },
        "dataFitReport": {
            "fitDegreePct": 91.2,
            "credibilityScore": 72,
            "suspicionLevel": "LOW",
            "gmReward": 150,
            "euAuditRisk": "LOW",
        },
        "deviationSummary": {"count": 0, "hasCritical": False, "hasWarning": False},
    }


def build_redeem_code(sync_payload: dict, redeem_id: str) -> str:
    exp = "2027-07-15T00:00:00+00:00"
    pkg = {"redeemId": redeem_id, "expiresAt": exp, "sync": sync_payload}
    body = base64.urlsafe_b64encode(json.dumps(pkg, ensure_ascii=False).encode()).decode().rstrip("=")
    sig = hmac.new(HMAC_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
    return f"{REDEEM_PREFIX}.{body}.{sig}"


def assert_ok(name: str, cond: bool, detail: Any = None) -> None:
    if cond:
        print(f"  PASS  {name}")
        return
    print(f"  FAIL  {name} :: {detail}")
    raise SystemExit(1)


def main() -> None:
    print(f"== Core→Hub bridge smoke @ {BASE} ==")

    # health
    code, health = req("GET", "/api/health")
    assert_ok("hub health", code == 200, health)

    # register + workspace
    code, reg = req("POST", "/api/v1/auth/register", {
        "email": EMAIL,
        "password": PASSWORD,
        "company_name": COMPANY,
    })
    assert_ok("register", code in (200, 201) and "access_token" in (reg or {}), reg)
    token = reg["access_token"]

    code, _ = req("POST", "/api/v1/hub/workspace-update", {
        "name": COMPANY,
        "creditCode": CREDIT,
        "industryCode": "steel",
        "mainProduct": "热轧卷板",
    }, token)
    assert_ok("workspace-update", code == 200, _)

    # ---- Path A: engineering sync (no auth must 401) ----
    sync_l1 = build_core_sync_payload(batch_suffix="L1", mat_locked=False, maturity="L1_reference")
    code, noauth = req("POST", "/api/v1/hub/overview/sync", sync_l1, token=None)
    assert_ok("sync without Bearer → 401", code == 401, noauth)

    # forbidden detail field
    bad = dict(sync_l1)
    bad["processes"] = [{"step": 1, "kwh": 999}]
    code, forbidden = req("POST", "/api/v1/hub/overview/sync", bad, token)
    assert_ok(
        "forbid processes[] → 422/400",
        code in (400, 422),
        forbidden,
    )

    code, sync_resp = req("POST", "/api/v1/hub/overview/sync", sync_l1, token)
    assert_ok("Path A L1 sync 200", code == 200, sync_resp)
    assert_ok("cityState=evidence_building", sync_resp.get("cityState") == "evidence_building", sync_resp)
    assert_ok("pullEligible=false", sync_resp.get("pullEligible") is False, sync_resp)
    assert_ok("message mentions 不可 Pull", "不可 Pull" in (sync_resp.get("message") or ""), sync_resp.get("message"))
    assert_ok("gmRewardApplied=150", sync_resp.get("gmRewardApplied") == 150, sync_resp)

    code, ov = req("GET", "/api/v1/hub/overview", token=token)
    assert_ok("overview 200", code == 200, ov)
    fa = (ov or {}).get("factorAuth") or {}
    assert_ok("overview.factorAuth.cityState", fa.get("cityState") == "evidence_building", fa)
    board = ((ov or {}).get("resonance") or {}).get("industryBoard") or []
    assert_ok("industryBoard has entry", len(board) >= 1, board)

    # certified path → pull eligible, then reverse to evidence
    sync_cert = build_core_sync_payload(batch_suffix="CERT", mat_locked=True, maturity="L3_chain_ready")
    code, cert_resp = req("POST", "/api/v1/hub/overview/sync", sync_cert, token)
    assert_ok("Path A certified sync", code == 200 and cert_resp.get("cityState") == "certified", cert_resp)
    assert_ok("certified pullEligible", cert_resp.get("pullEligible") is True, cert_resp)

    # roll back to evidence (same as e2e_hub_sync)
    sync_back = build_core_sync_payload(batch_suffix="BACK", mat_locked=False, maturity="L1_reference")
    code, back = req("POST", "/api/v1/hub/overview/sync", sync_back, token)
    assert_ok("rollback evidence_building", code == 200 and back.get("cityState") == "evidence_building", back)

    code, pool = req("GET", f"/api/v1/hub/verified-factor-pool/search?q={COMPANY[:4]}", token=token)
    assert_ok("pool not match while evidence_building", code == 200 and pool.get("match") is False, pool)

    # ---- Path B: product redeem ----
    sync_redeem = build_core_sync_payload(batch_suffix="RDM", mat_locked=False, maturity="L1_reference")
    redeem_id = f"RDM-CORE-{TS}"
    redeem_code = build_redeem_code(sync_redeem, redeem_id)
    code, redeem = req("POST", "/api/v1/hub/evidence/redeem", {"redeemCode": redeem_code}, token)
    assert_ok("Path B redeem 200", code == 200, redeem)
    assert_ok("redeem cityState", redeem.get("cityState") == "evidence_building", redeem)
    assert_ok("redeem has appState", isinstance(redeem.get("appState"), dict), redeem)

    code, dup = req("POST", "/api/v1/hub/evidence/redeem", {"redeemCode": redeem_code}, token)
    assert_ok("redeem duplicate → 409", code == 409, dup)

    print(json.dumps({
        "ok": True,
        "email": EMAIL,
        "paths": ["overview/sync", "evidence/redeem"],
        "cityState": back.get("cityState"),
        "certificateId": sync_l1["certificateId"],
        "message": "Core-shaped payload accepted by Hub; Bearer required; redeem path OK",
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
