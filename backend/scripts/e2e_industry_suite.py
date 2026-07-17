#!/usr/bin/env python3
"""工业原厂 · 因子精算 全链路 E2E（API 层）"""
from __future__ import annotations

import json
import sys
import time
import uuid

try:
    import urllib.error
    import urllib.request
except ImportError:
    sys.exit("Python urllib required")

BASE = "http://127.0.0.1:8000"
TS = int(time.time())
EMAIL = f"e2e-industry-{TS}@example.com"
PASSWORD = "TestPass1"
COMPANY = f"E2E钢铁原厂-{TS}"
CREDIT = f"91{TS % 10**16:016d}"[:18]


def req(method: str, path: str, body: dict | None = None, token: str | None = None) -> tuple[int, dict]:
    url = BASE + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            payload = json.loads(raw) if raw else {"detail": e.reason}
        except json.JSONDecodeError:
            payload = {"detail": raw or str(e.reason)}
        return e.code, payload


def ok(label: str, cond: bool, detail: str = "") -> None:
    mark = "PASS" if cond else "FAIL"
    print(f"  [{mark}] {label}" + (f" — {detail}" if detail else ""))
    if not cond:
        raise AssertionError(f"{label}: {detail}")


def main() -> int:
    print("=" * 60)
    print("HengAI 工业原厂 · 因子精算 E2E")
    print("=" * 60)

    code, health = req("GET", "/api/health")
    ok("Health", code == 200, str(health))

    code, reg = req("POST", "/api/v1/auth/register", {
        "email": EMAIL,
        "password": PASSWORD,
        "company_name": COMPANY,
    })
    ok("Register", code == 201, f"user={reg.get('user_id')}")
    token = reg.get("access_token")
    ok("Token", bool(token))

    code, ov1 = req("GET", "/api/v1/hub/overview", token=token)
    ok("Overview Phase1", code == 200)
    phase1 = (ov1.get("flags") or {}).get("currentPhase")
    ok("Phase1 lock", phase1 == "Phase1", phase1)

    code, ws = req("POST", "/api/v1/hub/workspace-update", {
        "name": COMPANY,
        "creditCode": CREDIT,
        "industryCode": "steel",
        "mainProduct": "热轧卷板",
        "annualExportTons": 120000,
    }, token=token)
    ok("Workspace update", code == 200, ws.get("message", ""))
    ok("Workspace is_complete", ws.get("isComplete") or ws.get("is_complete"), str(ws.get("stage")))

    code, ov2 = req("GET", "/api/v1/hub/overview", token=token)
    phase2 = (ov2.get("flags") or {}).get("currentPhase")
    ok("Phase2 unlock", phase2 == "Phase2", phase2)
    co = ov2.get("company") or {}
    ok("Company name", co.get("name") == COMPANY, co.get("name"))

    # Phase1 attest should 403
    code, deny = req("POST", "/api/v1/hub/industry-factor-attest", {
        "carbonIntensity": 1.2345,
        "yoyChangePct": -2.5,
        "industryCode": "steel",
        "productLabel": "钢铁综合",
    }, token=token)
    # After workspace update we're Phase2 — attest should succeed, not 403
    ok("Attest not blocked after Phase2", code == 200, str(deny.get("detail") or deny.get("message") or code))

    cert_id = deny.get("certId") or deny.get("cert_id")
    ci = deny.get("carbonIntensity") or deny.get("carbon_intensity")
    badge = deny.get("badgeAwarded") or deny.get("badge_awarded")
    ok("Cert ID issued", bool(cert_id), cert_id or "")
    ok("Carbon intensity stored", float(ci or 0) > 0, str(ci))
    ok("Badge awarded (first attest)", badge is True, str(badge))

    code, pool = req("GET", f"/api/v1/hub/verified-factor-pool/search?q={CREDIT[:12]}", token=token)
    ok("Pool search", code == 200)
    ok("Pool match", pool.get("match") is True, pool.get("message", ""))
    entry = pool.get("entry") or {}
    ok("Pool cert", entry.get("certId") == cert_id or entry.get("cert_id") == cert_id, entry.get("certId"))
    ok("Pool CI", abs(float(entry.get("carbonIntensity") or entry.get("carbon_intensity") or 0) - float(ci)) < 0.0001)

    code, ov3 = req("GET", "/api/v1/hub/overview", token=token)
    m = ov3.get("metrics") or {}
    ia = ov3.get("industryAudit") or {}
    ok("metrics.crusadeCount present", "crusadeCount" in m, str(m.get("crusadeCount")))
    ok("metrics.totalTaxPenalty present", "totalTaxPenalty" in m, str(m.get("totalTaxPenalty")))
    ok("company.verifiedFactor", (ov3.get("company") or {}).get("verifiedFactor") is not None)
    ok("industryAudit.hasVerifiedFactor", ia.get("hasVerifiedFactor") is True)

    for page_path, label in (
        ("/static/HengAI_HeavyIndustry_Suite.html", "HeavyIndustry_Suite.html"),
        ("/static/HengAI_CBAM%E6%B5%8B%E7%AE%97%E5%B7%A5%E5%85%B7.html", "CBAM_tool.html"),
        ("/static/index.html", "index.html"),
        ("/static/%E5%85%A8%E5%9F%9F%E4%B8%AD%E5%BF%83.html", "hub_center.html"),
    ):
        r = urllib.request.Request(BASE + page_path, method="GET")
        with urllib.request.urlopen(r, timeout=15) as resp:
            body = resp.read(4096).decode("utf-8", errors="replace")
            ok(f"Static {label}", resp.status == 200 and len(body) > 200)

    r = urllib.request.Request(BASE + "/static/index.html", method="GET")
    with urllib.request.urlopen(r, timeout=15) as resp:
        idx = resp.read().decode("utf-8", errors="replace")
    ok("index.html n-industry-audit", "n-industry-audit" in idx)
    ok("index.html menu label", "\u5de5\u4e1a\u539f\u5382" in idx)

    r = urllib.request.Request(BASE + "/static/HengAI_CBAM%E6%B5%8B%E7%AE%97%E5%B7%A5%E5%85%B7.html", method="GET")
    with urllib.request.urlopen(r, timeout=15) as resp:
        cbam = resp.read().decode("utf-8", errors="replace")
    ok("CBAM origin search UI", "f-origin-search" in cbam and "verified-factor-pool" in cbam)

    r = urllib.request.Request(BASE + "/static/HengAI_HeavyIndustry_Suite.html", method="GET")
    with urllib.request.urlopen(r, timeout=15) as resp:
        hi = resp.read().decode("utf-8", errors="replace")
    ok("HeavyIndustry LOCAL_VAULT", "LOCAL_VAULT" in hi)
    ok("HeavyIndustry pledge", "\u91cd\u5de5\u4e1a\u6838\u5fc3\u6570\u636e\u4fdd\u5bc6\u627f\u8bfa\u4e66" in hi)

    print("=" * 60)
    print("ALL E2E CHECKS PASSED")
    print(f"  Test user: {EMAIL}")
    print(f"  Cert ID:   {cert_id}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as e:
        print(f"\nE2E FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\nE2E ERROR: {e}")
        sys.exit(2)
