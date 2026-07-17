#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""精算芯签发 HENGAI1 → Hub evidence/redeem 跨仓冒烟。"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any, Optional, Tuple

HUB = os.environ.get("HENGAI_HUB_BASE", "http://127.0.0.1:8000").rstrip("/")
CORE = os.environ.get("HENGAI_CORE_BASE", "http://127.0.0.1:8001").rstrip("/")
TS = int(time.time())
EMAIL = f"redeem-e2e-{TS}@example.com"
PASSWORD = "TestPass1"
COMPANY = f"兑换联调原厂-{TS}"
CREDIT = f"91{TS % 10**16:016d}"[:18]


def req(base: str, method: str, path: str, body: Optional[dict] = None, token: Optional[str] = None) -> Tuple[int, Any]:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(base + path, data=data, headers=headers, method=method)
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


def main() -> None:
    print(f"== Core issue-redeem → Hub redeem @ {CORE} → {HUB} ==")
    code, health = req(HUB, "GET", "/api/health")
    assert code == 200, health
    print("  PASS  Hub health")

    sync = {
        "syncTier": "L1",
        "source": "hengai_universal_core",
        "industryId": "steel",
        "batchId": f"CORE-RDM-{TS}",
        "dataFingerprint": f"fp:rdm:{TS}",
        "encHash": f"enc:rdm:{TS}",
        "carbonIntensity": 1.87,
        "gmReward": 80,
        "holder": COMPANY,
        "productionEntity": CREDIT,
        "productionEntitySource": "enterprise_legal",
        "certificateId": f"CL-GTCID-2026-RDM-{TS}",
        "issuedAt": "2026-07-17T12:00:00+08:00",
        "qualityTag": {
            "calibration": "cited",
            "matBoxLocked": False,
            "credibilityScore": 70,
            "suspicionLevel": "LOW",
            "maturityTier": "L1_reference",
            "provenanceGrade": "cited",
            "riskFlags": [],
            "activeJurisdiction": "cbam",
        },
        "fundingMode": "self_paid",
    }

    # 故意带禁止字段，签发侧应剥离
    dirty = dict(sync)
    dirty["processes"] = [{"step": 1, "kwh": 999}]

    code, issued = req(CORE, "POST", "/api/v1/core/evidence/issue-redeem", {
        "sync": dirty,
        "expiresDays": 30,
        "seatStatus": "active",
        "demoAllow": True,
    })
    assert code == 200, issued
    redeem_code = issued.get("redeemCode") or ""
    assert redeem_code.startswith("HENGAI1."), issued
    assert issued.get("redeemId"), issued
    print("  PASS  Core issue-redeem", issued.get("redeemId"))

    code, reg = req(HUB, "POST", "/api/v1/auth/register", {
        "email": EMAIL,
        "password": PASSWORD,
        "company_name": COMPANY,
    })
    assert code in (200, 201) and reg.get("access_token"), reg
    token = reg["access_token"]
    code, _ = req(HUB, "POST", "/api/v1/hub/workspace-update", {
        "name": COMPANY,
        "creditCode": CREDIT,
        "industryCode": "steel",
    }, token)
    assert code == 200, _
    print("  PASS  Hub workspace", CREDIT)

    code, redeem = req(HUB, "POST", "/api/v1/hub/evidence/redeem", {
        "redeemCode": redeem_code,
    }, token)
    assert code == 200, redeem
    assert redeem.get("cityState") == "evidence_building", redeem
    assert redeem.get("pullEligible") is False, redeem
    print("  PASS  Hub redeem", redeem.get("cityState"))

    code, dup = req(HUB, "POST", "/api/v1/hub/evidence/redeem", {
        "redeemCode": redeem_code,
    }, token)
    assert code == 409, dup
    print("  PASS  duplicate → 409")

    ov = req(HUB, "GET", "/api/v1/hub/overview", token=token)[1]
    fa = (ov or {}).get("factorAuth") or {}
    assert fa.get("cityState") == "evidence_building", fa
    print(json.dumps({
        "ok": True,
        "redeemId": issued.get("redeemId"),
        "cityState": fa.get("cityState"),
        "certificateId": issued.get("certificateId"),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
