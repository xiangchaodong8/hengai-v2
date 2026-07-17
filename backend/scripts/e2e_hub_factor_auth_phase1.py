#!/usr/bin/env python3
"""Hub 阶段 ① · 工业原厂精算 API 验收（attest + 收敛展示 + 页面壳）。"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:8000"
TS = int(time.time())
ORIGIN_EMAIL = f"factor-origin-{TS}@example.com"
SME_EMAIL = f"factor-sme-{TS}@example.com"
PASSWORD = "TestPass1"
ORIGIN_CO = f"FactorOrigin-{TS}"
SME_CO = f"FactorSME-{TS}"
ORIGIN_CREDIT = f"95{TS % 10**16:016d}"[:18]
SME_CREDIT = f"96{(TS + 1) % 10**16:016d}"[:18]

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
    print("Hub 工业原厂精算 · API 验收")
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

    code, ov1 = req("GET", "/api/v1/hub/overview", token=origin_token)
    phase1 = (ov1.get("flags") or {}).get("currentPhase")
    record("overview Phase1", code == 200 and phase1 == "Phase1", phase1 or "")

    code, deny = req("POST", "/api/v1/hub/industry-factor-attest", {
        "carbonIntensity": 1.55,
        "industryCode": "steel",
        "productLabel": "钢铁综合",
    }, token=origin_token)
    record("Phase1 attest 403", code == 403, str(deny.get("detail") or deny.get("message") or code))

    code, ws = req("POST", "/api/v1/hub/workspace-update", {
        "name": ORIGIN_CO,
        "creditCode": ORIGIN_CREDIT,
        "industryCode": "steel",
        "mainProduct": "热轧卷板",
        "annualExportTons": 80000,
    }, token=origin_token)
    record("origin workspace-update", code == 200, ws.get("message", str(code)))

    code, ov2 = req("GET", "/api/v1/hub/overview", token=origin_token)
    phase2 = (ov2.get("flags") or {}).get("currentPhase")
    record("Phase2 unlock", phase2 == "Phase2", phase2 or "")

    code, att = req("POST", "/api/v1/hub/industry-factor-attest", {
        "carbonIntensity": 1.756,
        "yoyChangePct": -2.1,
        "industryCode": "steel",
        "productLabel": "钢铁综合",
        "intensityUnit": "tCO2e/t",
    }, token=origin_token)
    cert_id = att.get("certId") or att.get("cert_id") or ""
    vcode = att.get("verificationCode") or att.get("verification_code") or ""
    record("attest + GTCID", code == 200 and vcode.startswith("GTCID-"), vcode or cert_id)

    code, wrong = req("POST", "/api/v1/hub/industry-factor-attest", {
        "carbonIntensity": 0.89,
        "industryCode": "cement",
        "productLabel": "水泥",
    }, token=origin_token)
    record("跨行业 attest 403", code == 403, str(wrong.get("detail") or wrong.get("message") or code))

    code, pool = req(
        "GET",
        "/api/v1/hub/verified-factor-pool/search",
        token=origin_token,
        query={"q": ORIGIN_CREDIT[:12]},
    )
    entry = pool.get("entry") or {}
    pool_ci = float(entry.get("carbonIntensity") or entry.get("carbon_intensity") or 0)
    record("pool search 命中", code == 200 and pool.get("match") is True, str(pool_ci))

    if vcode:
        code, verify = req(
            "GET",
            "/api/v1/hub/verified-factor-pool/verify",
            token=origin_token,
            query={"code": vcode},
        )
        record("GTCID verify 命中", code == 200 and verify.get("match") is True, verify.get("message", ""))

    code, ov3 = req("GET", "/api/v1/hub/overview", token=origin_token)
    ia = ov3.get("industryAudit") or {}
    co = ov3.get("company") or {}
    record("industryAudit.hasVerifiedFactor", ia.get("hasVerifiedFactor") is True)
    record("company.verifiedFactor", co.get("verifiedFactor") is not None, str(co.get("verifiedFactor")))

    code, ledger = req("GET", "/api/v1/hub/origin-factor-ledger", token=origin_token)
    record("origin-factor-ledger", code == 200, str((ledger.get("consumptionLedger") or ledger.get("consumption_ledger") or {}).get("total", "")))

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
    code, sme_att = req("POST", "/api/v1/hub/industry-factor-attest", {
        "carbonIntensity": 2.0,
        "industryCode": "machinery",
        "productLabel": "配套件",
    }, token=sme_token)
    record("SME attest 403", code == 403, str(sme_att.get("detail") or sme_att.get("message") or code))

    st_code, html = fetch_static("/static/HengAI_%E5%B7%A5%E4%B8%9A%E5%8E%9F%E5%8E%82%E7%B2%BE%E7%AE%97.html")
    record(
        "HengAI_工业原厂精算.html embed 壳",
        st_code == 200
        and "hengai-load-appstate.js" in html
        and "submitPool" in html
        and 'src="AppState.js"' not in html,
        str(len(html)),
    )
    record("GTCID UI 字段", "pool-gtcid-val" in html and "fr-gtcid-val" in html)
    record("行业收敛 applyIndustryScopeUI", "applyIndustryScopeUI" in html)

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = sum(1 for _, ok, _ in RESULTS if not ok)
    print("\n" + "=" * 60)
    print(f"合计: {passed} PASS / {failed} FAIL")
    if failed:
        print("工业原厂精算 API 未全部通过")
        return 1
    print("工业原厂精算 API 全部通过")
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
