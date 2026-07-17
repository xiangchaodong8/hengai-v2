#!/usr/bin/env python3
"""Prepare browser E2E session JSON (register + Phase2 + attest)."""
import json
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"
TS = int(time.time())
EMAIL = f"browser-e2e-{TS}@example.com"
PASSWORD = "TestPass1"
COMPANY = f"BrowserE2E原厂-{TS}"
CREDIT = f"91{TS % 10**16:016d}"[:18]
OUT = __import__("pathlib").Path(__file__).resolve().parent / "browser_e2e_session.json"


def post(path, body, token=None):
    data = json.dumps(body).encode()
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def get(path, token):
    req = urllib.request.Request(
        BASE + path,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def main():
    reg = post("/api/v1/auth/register", {
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
        "annualExportTons": 50000,
    }, token)
    att = post("/api/v1/hub/industry-factor-attest", {
        "carbonIntensity": 2.1567,
        "yoyChangePct": -3.2,
        "industryCode": "steel",
        "productLabel": "钢铁综合",
    }, token)
    cert = att.get("cert_id") or att.get("certId")
    pool = get(f"/api/v1/hub/verified-factor-pool/search?q={CREDIT[:10]}", token)
    ov = get("/api/v1/hub/overview", token)
    payload = {
        "email": EMAIL,
        "password": PASSWORD,
        "company": COMPANY,
        "credit": CREDIT,
        "token": token,
        "cert": cert,
        "carbonIntensity": 2.1567,
        "poolMatch": pool.get("match"),
        "phase": (ov.get("flags") or {}).get("currentPhase"),
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
