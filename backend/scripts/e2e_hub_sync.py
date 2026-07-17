#!/usr/bin/env python3
"""Smoke test POST /api/v1/hub/overview/sync (SYNC_CONTRACT_v2)."""
import json
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"
TS = int(time.time())
EMAIL = f"sync-e2e-{TS}@example.com"
PASSWORD = "TestPass1"
COMPANY = f"SyncE2E原厂-{TS}"
CREDIT = f"91{TS % 10**16:016d}"[:18]


def post(path, body, token=None):
    data = json.dumps(body).encode()
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status, json.loads(resp.read())


def get(path, token):
    req = urllib.request.Request(
        BASE + path,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def main():
    _, reg = post("/api/v1/auth/register", {
        "email": EMAIL,
        "password": PASSWORD,
        "company_name": COMPANY,
    })
    token = reg["access_token"]
    post("/api/v1/hub/workspace-update", {
        "name": COMPANY,
        "creditCode": CREDIT,
        "industryCode": "steel",
        "mainProduct": "热轧卷板",
    }, token)

    sync_body = {
        "syncTier": "L1",
        "source": "hengai_universal_core",
        "industryId": "steel",
        "batchId": f"BATCH-{TS}",
        "dataFingerprint": f"fp:{TS}",
        "encHash": f"enc:{TS}",
        "carbonIntensity": 1.87,
        "gmReward": 50,
        "holder": COMPANY,
        "productionEntity": CREDIT,
        "productionEntitySource": "enterprise_legal",
        "certificateId": f"CL-GTCID-2026-SYNC-{TS}",
        "issuedAt": "2026-06-21T08:00:00+08:00",
        "qualityTag": {
            "calibration": "cited",
            "matBoxLocked": False,
            "credibilityScore": 72,
            "suspicionLevel": "LOW",
            "maturityTier": "L1_reference",
            "provenanceGrade": "cited",
            "riskFlags": [],
            "activeJurisdiction": "cbam",
        },
    }
    code, sync_resp = post("/api/v1/hub/overview/sync", sync_body, token)
    assert code == 200, sync_resp
    assert sync_resp.get("cityState") == "evidence_building", sync_resp
    assert sync_resp.get("pullEligible") is False, sync_resp

    ov0 = get("/api/v1/hub/overview", token)
    ev0 = (((ov0.get("cbam") or {}).get("evidence")) or {})
    assert ev0.get("mode") == "PENDING_VERIFICATION", ev0
    assert ev0.get("stage") == "software_evidenced", ev0
    assert ev0.get("trustCommitmentLevel") == "COMMITTED", ev0
    assert ev0.get("honorEligibilityTier") == "PIONEER", ev0

    sync_cert = dict(sync_body)
    sync_cert["batchId"] = f"BATCH-{TS}-CERT"
    sync_cert["dataFingerprint"] = f"fp:{TS}-CERT"
    sync_cert["qualityTag"] = dict(sync_cert["qualityTag"])
    sync_cert["qualityTag"]["matBoxLocked"] = True
    sync_cert["qualityTag"]["maturityTier"] = "L3_chain_ready"
    code2, sync_resp2 = post("/api/v1/hub/overview/sync", sync_cert, token)
    assert code2 == 200, sync_resp2
    assert sync_resp2.get("cityState") == "certified", sync_resp2
    assert sync_resp2.get("pullEligible") is True, sync_resp2

    sync_back = dict(sync_body)
    sync_back["batchId"] = f"BATCH-{TS}-BACK"
    sync_back["dataFingerprint"] = f"fp:{TS}-BACK"
    code3, sync_resp3 = post("/api/v1/hub/overview/sync", sync_back, token)
    assert code3 == 200, sync_resp3
    assert sync_resp3.get("cityState") == "evidence_building", sync_resp3
    assert sync_resp3.get("pullEligible") is False, sync_resp3

    pool = get(f"/api/v1/hub/verified-factor-pool/search?q={COMPANY[:4]}", token)
    assert pool.get("match") is False, pool

    ov = get("/api/v1/hub/overview", token)
    fa = ov.get("factorAuth") or {}
    res = ov.get("resonance") or {}
    ev = (((ov.get("cbam") or {}).get("evidence")) or {})
    co = ov.get("company") or {}
    assert fa.get("cityState") == "evidence_building", fa
    assert len(res.get("industryBoard") or []) >= 1, res
    assert ev.get("trustCommitmentLevel") == "VERIFIED", ev
    assert ev.get("honorEligibilityTier") == "CERTIFIED_BUILDER", ev
    assert co.get("trustCommitmentLevel") == "VERIFIED", co
    assert co.get("honorEligibilityTier") == "CERTIFIED_BUILDER", co
    assert isinstance(ev.get("history"), list) and len(ev.get("history")) >= 3, ev

    print(json.dumps({
        "ok": True,
        "cityState": sync_resp3.get("cityState"),
        "pullEligible": sync_resp3.get("pullEligible"),
        "poolMatch": pool.get("match"),
        "trustCommitmentLevel": ev.get("trustCommitmentLevel"),
        "honorEligibilityTier": ev.get("honorEligibilityTier"),
        "evidenceHistoryLen": len(ev.get("history") or []),
        "industryBoardLen": len(res.get("industryBoard") or []),
        "message": sync_resp3.get("message"),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
