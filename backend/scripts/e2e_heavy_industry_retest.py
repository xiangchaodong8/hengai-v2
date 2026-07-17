#!/usr/bin/env python3
"""工业原厂 · 因子精算战情室 — API + 页面逻辑复测（配合浏览器 CDP 手测）"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"
PASSWORD = "TestPass1"
TS = int(time.time())
EMAIL = f"hi-retest-{TS}@example.com"
COMPANY = f"HI复测原厂-{TS}"
CREDIT = f"91{TS % 10**16:016d}"[:18]

STEEL_OUTPUTS = [52000, 48000, 61000, 55000, 50000, 47000, 12000, 8000, 15000]


def post(path: str, body: dict, token: str | None = None) -> dict:
    data = json.dumps(body).encode()
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def get(path: str, token: str) -> dict:
    req = urllib.request.Request(
        BASE + path,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def ok(label: str, cond: bool, detail: str = "") -> bool:
    mark = "PASS" if cond else "FAIL"
    extra = f" — {detail}" if detail else ""
    print(f"  [{mark}] {label}{extra}")
    return cond


def main() -> int:
    print("=== HengAI Heavy Industry Suite Retest ===")
    fails = 0

    try:
        urllib.request.urlopen(f"{BASE}/api/health", timeout=5)
    except urllib.error.URLError as e:
        print(f"Backend offline: {e}")
        return 1

    reg = post("/api/v1/auth/register", {
        "email": EMAIL,
        "password": PASSWORD,
        "company_name": COMPANY,
    })
    token = reg["access_token"]
    fails += 0 if ok("Register", bool(token), EMAIL) else 1

    post("/api/v1/hub/workspace-update", {
        "name": COMPANY,
        "creditCode": CREDIT,
        "industryCode": "steel",
        "mainProduct": "热轧卷板",
        "annualExportTons": 50000,
    }, token)
    ov = get("/api/v1/hub/overview", token)
    fails += 0 if ok("Phase2 unlock", ov.get("flags", {}).get("currentPhase") == "Phase2", COMPANY) else 1

    suite_url = f"{BASE}/static/HengAI_HeavyIndustry_Suite.html"
    with urllib.request.urlopen(suite_url, timeout=15) as resp:
        html = resp.read().decode("utf-8", "replace")
    fails += 0 if ok("Suite page served", "hi-btn-budget-report" in html) else 1
    fails += 0 if ok("No hard lock overlay", "hi-sovereign-lock" not in html) else 1
    fails += 0 if ok("Draft status block", "hi-draft-status" in html) else 1
    fails += 0 if ok("Policy card", "hi-policy-card" in html) else 1
    fails += 0 if ok("Convert modal (soft gate)", "hi-modal-convert" in html) else 1
    fails += 0 if ok("PDF seal builder", "buildClIvcSealSvg" in html) else 1
    fails += 0 if ok("CISA always sealed", "官方钢印版" in html and "isOfficialCertified()" in html) else 1

    att = post("/api/v1/hub/industry-factor-attest", {
        "carbonIntensity": 1.842,
        "yoyChangePct": -4.5,
        "industryCode": "steel",
        "productLabel": "钢铁综合",
    }, token)
    cert = att.get("certId") or att.get("cert_id")
    fails += 0 if ok("Attest API", bool(cert), str(cert)) else 1

    ov2 = get("/api/v1/hub/overview", token)
    c2 = ov2.get("company") or {}
    fails += 0 if ok("Cert in overview", c2.get("verifiedFactorCertId") == cert) else 1

    print("\n--- Test credentials (browser) ---")
    print(json.dumps({
        "email": EMAIL,
        "password": PASSWORD,
        "company": COMPANY,
        "credit": CREDIT,
        "token": token,
        "cert": cert,
        "suite_url": suite_url,
        "steel_outputs": STEEL_OUTPUTS,
    }, ensure_ascii=False, indent=2))

    print(f"\nResult: {('ALL PASS' if fails == 0 else f'{fails} FAIL')}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
