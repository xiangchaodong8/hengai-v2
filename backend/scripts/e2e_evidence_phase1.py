#!/usr/bin/env python3
"""Phase 1 · 双模状态机 API 验收（evidence.mode + sync 并网，不含 redeem）。"""
import json
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"
TS = int(time.time())
EMAIL = f"evidence-p1-{TS}@example.com"
PASSWORD = "TestPass1"
COMPANY = f"EvidenceP1-{TS}"
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


def assert_eq(label, got, expected):
    ok = got == expected
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {label}: {got!r}" + ("" if ok else f" expected {expected!r}"))
    if not ok:
        raise AssertionError(f"{label}: {got!r} != {expected!r}")


def main():
    print("=" * 60)
    print("Phase 1 · evidence API acceptance")
    print("=" * 60)

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

    sync_l1 = {
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
        "certificateId": f"CL-GTCID-P1-{TS}",
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
    code, r1 = post("/api/v1/hub/overview/sync", sync_l1, token)
    assert_eq("L1 sync HTTP", code, 200)
    assert_eq("L1 cityState", r1.get("cityState"), "evidence_building")

    ov1 = get("/api/v1/hub/overview", token)
    ev1 = ((ov1.get("cbam") or {}).get("evidence")) or {}
    assert_eq("L1 evidence.mode", ev1.get("mode"), "PENDING_VERIFICATION")
    assert_eq("L1 evidence.stage", ev1.get("stage"), "software_evidenced")
    v1 = float(ev1.get("value") or 0)
    assert abs(v1 - 1.87) < 1e-6, f"L1 evidence.value: {v1}"

    sync_cert = dict(sync_l1)
    sync_cert["batchId"] = f"BATCH-{TS}-CERT"
    sync_cert["dataFingerprint"] = f"fp:{TS}-CERT"
    sync_cert["carbonIntensity"] = 1.72
    sync_cert["qualityTag"] = dict(sync_l1["qualityTag"])
    sync_cert["qualityTag"]["matBoxLocked"] = True
    sync_cert["qualityTag"]["maturityTier"] = "L3_chain_ready"
    code2, r2 = post("/api/v1/hub/overview/sync", sync_cert, token)
    assert_eq("L3 sync HTTP", code2, 200)
    assert_eq("L3 cityState", r2.get("cityState"), "certified")
    assert_eq("L3 pullEligible", r2.get("pullEligible"), True)

    ov2 = get("/api/v1/hub/overview", token)
    ev2 = ((ov2.get("cbam") or {}).get("evidence")) or {}
    assert_eq("L3 evidence.mode", ev2.get("mode"), "SOVEREIGN_VERIFIED")
    v2 = float(ev2.get("value") or 0)
    assert abs(v2 - 1.72) < 1e-6, f"L3 evidence.value: {v2}"
    verified = ev2.get("verified") or {}
    assert verified.get("certId"), "verified.certId missing"

    co = ov2.get("company") or {}
    assert_eq("company.cityState", co.get("cityState"), "certified")

    print("\n  [PASS] Phase 1 evidence API chain complete")
    print(f"  account: {EMAIL}")
    print("=" * 60)


if __name__ == "__main__":
    main()
