#!/usr/bin/env python3
"""Hub 阶段 ① · 原厂资产确权 API 验收（overview 驱动 + 页面壳 + 角色边界）。"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:8000"
TS = int(time.time())
ORIGIN_EMAIL = f"audit-origin-{TS}@example.com"
SME_EMAIL = f"audit-sme-{TS}@example.com"
PASSWORD = "TestPass1"
ORIGIN_CO = f"AuditOrigin-{TS}"
SME_CO = f"AuditSME-{TS}"
ORIGIN_CREDIT = f"97{TS % 10**16:016d}"[:18]
SME_CREDIT = f"98{(TS + 1) % 10**16:016d}"[:18]

RESULTS: list[tuple[str, bool, str]] = []


def req(
    method: str,
    path: str,
    body: dict | None = None,
    token: str | None = None,
    query: dict | None = None,
) -> tuple[int, dict]:
    url = BASE + path
    if query:
        url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            payload = json.loads(raw) if raw else {"detail": e.reason}
        except json.JSONDecodeError:
            payload = {"detail": raw or str(e.reason)}
        return e.code, payload


def fetch_static(path: str) -> tuple[int, str]:
    url = BASE + path
    r = urllib.request.Request(url, headers={"Accept": "*/*"}, method="GET")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, ""


def record(label: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((label, ok, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {label}" + (f" — {detail}" if detail else ""))


def main() -> int:
    print("=" * 60)
    print("Hub 原厂资产确权 · API 验收")
    print("=" * 60)

    try:
        code, _ = req("GET", "/api/health")
        record("backend health", code == 200)
    except Exception as exc:  # noqa: BLE001
        record("backend health", False, str(exc))
        return 1

    _, reg = req("POST", "/api/v1/auth/register", {
        "email": ORIGIN_EMAIL,
        "password": PASSWORD,
        "company_name": ORIGIN_CO,
    })
    origin_token = reg.get("access_token")
    record("register origin", bool(origin_token), ORIGIN_EMAIL)
    if not origin_token:
        return 1

    code, ws = req("POST", "/api/v1/hub/workspace-update", {
        "name": ORIGIN_CO,
        "creditCode": ORIGIN_CREDIT,
        "industryCode": "steel",
        "mainProduct": "热轧卷板",
        "annualExportTons": 90000,
    }, token=origin_token)
    record("origin workspace-update", code == 200, ws.get("message", str(code)))

    code, ov = req("GET", "/api/v1/hub/overview", token=origin_token)
    flags = ov.get("flags") or {}
    metrics = ov.get("metrics") or {}
    res = ov.get("resonance") or {}
    ia = ov.get("industryAudit") or {}
    record("overview Phase2", (flags.get("currentPhase") == "Phase2"), flags.get("currentPhase", ""))
    record("overview industryAudit 块", isinstance(ia, dict) and "hasVerifiedFactor" in ia)
    record("overview metrics 共振", "crusadeCount" in metrics or "resonanceCount" in metrics)
    record("overview resonance 块", isinstance(res, dict))
    record("overview industryBoard", isinstance(res.get("industryBoard"), list))

    code, att = req("POST", "/api/v1/hub/industry-factor-attest", {
        "carbonIntensity": 1.688,
        "industryCode": "steel",
        "productLabel": "钢铁综合",
    }, token=origin_token)
    vcode = att.get("verificationCode") or att.get("verification_code") or ""
    record("attest 驱动 overview", code == 200 and vcode.startswith("GTCID-"), vcode)

    code, ov2 = req("GET", "/api/v1/hub/overview", token=origin_token)
    co2 = ov2.get("company") or {}
    ia2 = ov2.get("industryAudit") or {}
    record("overview verifiedFactor", co2.get("verifiedFactor") is not None, str(co2.get("verifiedFactor")))
    record("overview hasVerifiedFactor", ia2.get("hasVerifiedFactor") is True)
    board = (ov2.get("resonance") or {}).get("industryBoard") or []
    record("industryBoard 非空", len(board) >= 1, str(len(board)))

    _, sme_reg = req("POST", "/api/v1/auth/register", {
        "email": SME_EMAIL,
        "password": PASSWORD,
        "company_name": SME_CO,
    })
    sme_token = sme_reg.get("access_token")
    req("POST", "/api/v1/hub/workspace-update", {
        "name": SME_CO,
        "creditCode": SME_CREDIT,
        "industryCode": "machinery",
        "mainProduct": "出口配件",
        "annualExportTons": 3000,
    }, token=sme_token)
    code, sme_ov = req("GET", "/api/v1/hub/overview", token=sme_token)
    sme_flags = sme_ov.get("flags") or {}
    record("SME overview", code == 200)
    record("SME 非 ORIGIN 权限", sme_flags.get("hasOriginFactoryPerm") is not True, str(sme_flags.get("userRole")))

    st_code, html = fetch_static("/static/HengAI_HeavyIndustry_Suite.html")
    record(
        "HeavyIndustry Suite embed 壳",
        st_code == 200
        and "hengai-load-appstate.js" in html
        and 'src="AppState.js"' not in html,
        str(len(html)),
    )
    record("overview 战情室说明", "hi-overview-notice" in html)
    record("guardOriginFactoryPage 引用", "guardOriginFactoryPage" in html)
    record("SME blocker 元素", "hi-sme-blocker" in html or "guardOriginFactoryPage" in html)
    record("CTA 路由 factor-auth", "routeFactorExecution" in html and "factor-auth" in html)
    record("CTA 路由 batch-verify", "routeAttestExecution" in html and "batch-verify" in html)
    record("industryBoard 消费", "industryBoard" in html)
    record("embed 隐藏第二算力", "html[data-embed=\"1\"] .hi-center" in html)
    code, tpl = fetch_static("/api/v1/hub/sovereignty-claim/template?format=html")
    record("sovereignty template 非空", code == 200 and "产业链数据主权授权书" in tpl, str(len(tpl)))
    record("buildSovereigntyLetterHtmlClient", "buildSovereigntyLetterHtmlClient" in html)

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = sum(1 for _, ok, _ in RESULTS if not ok)
    print("\n" + "=" * 60)
    print(f"合计: {passed} PASS / {failed} FAIL")
    if failed:
        print("原厂资产确权 API 未全部通过")
        return 1
    print("原厂资产确权 API 全部通过")
    print(f"  origin: {ORIGIN_EMAIL}")
    print(f"  gtcid:  {vcode}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"\nE2E ERROR: {exc}")
        sys.exit(2)
