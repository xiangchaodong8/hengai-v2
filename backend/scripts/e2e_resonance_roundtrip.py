#!/usr/bin/env python3
"""Resonance round-trip health check.

Validates the core narrative pipeline:
1) SME sends /eco/resonance-request -> pending counter goes up
2) Origin performs /hub/industry-factor-attest -> pending counter goes down
3) SME overview receives verified origin signal after fulfillment
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"
PASSWORD = "TestPass1"
TS = int(time.time())

ORIGIN_EMAIL = f"res-origin-{TS}@example.com"
SME_EMAIL = f"res-sme-{TS}@example.com"
ORIGIN_COMPANY = f"共振原厂-{TS}"
SME_COMPANY = f"共振下游-{TS}"
ORIGIN_CREDIT = f"91{TS % 10**16:016d}"[:18]
SME_CREDIT = f"92{(TS + 1) % 10**16:016d}"[:18]
INDUSTRY = "steel"

RESULTS: list[tuple[str, bool, str]] = []


def req(method: str, path: str, body: dict | None = None, token: str | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=45) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            payload = json.loads(raw) if raw else {"detail": e.reason}
        except json.JSONDecodeError:
            payload = {"detail": raw or str(e.reason)}
        return e.code, payload


def record(label: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((label, ok, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {label}" + (f" — {detail}" if detail else ""))


def register(email: str, company: str) -> str:
    code, payload = req("POST", "/api/v1/auth/register", {
        "email": email,
        "password": PASSWORD,
        "company_name": company,
    })
    token = payload.get("access_token")
    record(f"注册 {email}", code == 201 and bool(token), str(code))
    return token or ""


def setup_workspace(token: str, name: str, credit: str, industry: str) -> None:
    code, payload = req("POST", "/api/v1/hub/workspace-update", {
        "name": name,
        "creditCode": credit,
        "industryCode": industry,
        "mainProduct": "热轧卷板",
        "annualExportTons": 50000,
    }, token=token)
    record(f"workspace-update {name}", code == 200, payload.get("message", str(code)))


def get_pending_count(overview: dict) -> int:
    metrics = overview.get("metrics") or {}
    resonance = overview.get("resonance") or {}
    return int(
        metrics.get("resonanceCount")
        if metrics.get("resonanceCount") is not None
        else resonance.get("pendingRequestsForIndustry") or 0
    )


def main() -> int:
    print("=" * 64)
    print("Resonance Round-trip Health Check")
    print("=" * 64)

    code, health = req("GET", "/api/health")
    record("Health", code == 200, str(health.get("status", code)))
    if code != 200:
        return 1

    origin_token = register(ORIGIN_EMAIL, ORIGIN_COMPANY)
    sme_token = register(SME_EMAIL, SME_COMPANY)
    if not origin_token or not sme_token:
        return 1

    setup_workspace(origin_token, ORIGIN_COMPANY, ORIGIN_CREDIT, INDUSTRY)
    setup_workspace(sme_token, SME_COMPANY, SME_CREDIT, INDUSTRY)

    code, ov_before = req("GET", "/api/v1/hub/overview", token=sme_token)
    record("SME overview(before)", code == 200)
    pending_before = get_pending_count(ov_before if code == 200 else {})
    record("pending before captured", True, str(pending_before))

    code, res_req = req("POST", "/api/v1/eco/resonance-request", {
        "industryCode": INDUSTRY,
        "originQuery": ORIGIN_COMPANY,
        "productCategory": "scope3_upstream_material",
        "materialFactor": 2.1,
        "materialUnit": "t",
    }, token=sme_token)
    record("SME resonance-request", code in (200, 201), res_req.get("message", str(code)))

    code, ov_after_req = req("GET", "/api/v1/hub/overview", token=sme_token)
    record("SME overview(after request)", code == 200)
    pending_after_req = get_pending_count(ov_after_req if code == 200 else {})
    record(
        "pending increased",
        pending_after_req > pending_before,
        f"{pending_before} -> {pending_after_req}",
    )

    code, attest = req("POST", "/api/v1/hub/industry-factor-attest", {
        "carbonIntensity": 1.842,
        "yoyChangePct": -4.2,
        "industryCode": INDUSTRY,
        "productLabel": "钢铁综合",
    }, token=origin_token)
    cert_id = attest.get("certId") or attest.get("cert_id")
    record("Origin industry-factor-attest", code == 200 and bool(cert_id), str(cert_id or code))

    code, ov_after_attest = req("GET", "/api/v1/hub/overview", token=sme_token)
    record("SME overview(after attest)", code == 200)
    pending_after_attest = get_pending_count(ov_after_attest if code == 200 else {})
    record(
        "pending decreased",
        pending_after_attest < pending_after_req,
        f"{pending_after_req} -> {pending_after_attest}",
    )

    resonance = (ov_after_attest if code == 200 else {}).get("resonance") or {}
    verified = resonance.get("verifiedOrigin") or {}
    record("verifiedOrigin present", bool(verified and verified.get("verified") is True), str(verified.get("certId")))

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = sum(1 for _, ok, _ in RESULTS if not ok)
    print("\n" + "=" * 64)
    print(f"TOTAL: {passed} PASS / {failed} FAIL")
    if failed:
        print("FAILED ITEMS:")
        for label, ok, detail in RESULTS:
            if not ok:
                print(f"  - {label}: {detail}")
        print("=" * 64)
        return 1

    print("Resonance round-trip check passed")
    print(f"  origin: {ORIGIN_EMAIL}")
    print(f"  sme:    {SME_EMAIL}")
    print("=" * 64)
    return 0


if __name__ == "__main__":
    sys.exit(main())
