#!/usr/bin/env python3
"""Hub 阶段 ① · 核验页 API 验收（上游 GTCID + 下游 supplier-conclusion/claim-verify）。"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:8000"
TS = int(time.time())
ORIGIN_EMAIL = f"verify-origin-{TS}@example.com"
BUYER_EMAIL = f"verify-buyer-{TS}@example.com"
PASSWORD = "TestPass1"
ORIGIN_CO = f"VerifyOrigin-{TS}"
BUYER_CO = f"VerifyBuyer-{TS}"
ORIGIN_CREDIT = f"93{TS % 10**16:016d}"[:18]
BUYER_CREDIT = f"94{(TS + 1) % 10**16:016d}"[:18]
SUPPLIER_NAME = f"下游核验供应商-{TS}"

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
    print("Hub 核验批次 · API 验收")
    print("=" * 60)

    try:
        code, _ = req("GET", "/api/health")
        record("backend health", code == 200)
    except Exception as exc:  # noqa: BLE001
        record("backend health", False, str(exc))
        return 1

    # ── 上游 · 原厂 GTCID ──
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
        "annualExportTons": 50000,
    }, token=origin_token)
    record("origin workspace-update", code == 200, ws.get("message", str(code)))

    code, att = req("POST", "/api/v1/hub/industry-factor-attest", {
        "carbonIntensity": 1.842,
        "yoyChangePct": -3.0,
        "industryCode": "steel",
        "productLabel": "钢铁综合",
    }, token=origin_token)
    verification_code = att.get("verificationCode") or att.get("verification_code") or ""
    record("origin attest + GTCID", code == 200 and verification_code.startswith("GTCID-"), verification_code)

    code, miss = req(
        "GET",
        "/api/v1/hub/verified-factor-pool/verify",
        token=origin_token,
        query={"code": "GTCID-INVALID-000000"},
    )
    record("无效 GTCID 未命中", code == 200 and miss.get("match") is False, miss.get("message", ""))

    if verification_code:
        code, hit = req(
            "GET",
            "/api/v1/hub/verified-factor-pool/verify",
            token=origin_token,
            query={"code": verification_code},
        )
        entry = hit.get("entry") or {}
        factor = entry.get("carbonIntensity") or entry.get("carbon_intensity")
        record(
            "有效 GTCID 命中",
            code == 200 and hit.get("match") is True and float(factor or 0) > 0,
            str(factor),
        )
    else:
        record("有效 GTCID 命中", False, "无 verificationCode")

    code, search = req(
        "GET",
        "/api/v1/hub/verified-factor-pool/search",
        token=origin_token,
        query={"q": ORIGIN_CO},
    )
    search_entry = search.get("entry") or {}
    record(
        "按企业名检索命中",
        code == 200 and search.get("match") is True,
        str(search_entry.get("holder") or search_entry.get("originName") or ""),
    )

    # ── 下游 · 链主邀请 → H5 提交 → 结论对账 ──
    _, buyer_reg = req("POST", "/api/v1/auth/register", {
        "email": BUYER_EMAIL,
        "password": PASSWORD,
        "company_name": BUYER_CO,
    })
    buyer_token = buyer_reg.get("access_token")
    record("register buyer", bool(buyer_token), BUYER_EMAIL)
    if not buyer_token:
        return 1

    code, bws = req("POST", "/api/v1/hub/workspace-update", {
        "name": BUYER_CO,
        "creditCode": BUYER_CREDIT,
        "industryCode": "steel",
        "mainProduct": "出口紧固件",
        "annualExportTons": 12000,
    }, token=buyer_token)
    record("buyer workspace-update", code == 200, bws.get("message", str(code)))

    code, inv = req("POST", "/api/v1/hub/supplier-invite", {
        "supplierName": SUPPLIER_NAME,
        "contactPersonName": "核验联系人",
        "contactPhone": "13800138000",
    }, token=buyer_token)
    node_id = inv.get("supplierNodeId") or inv.get("supplier_node_id")
    submit_token = inv.get("submissionToken") or inv.get("submission_token")
    record("supplier-invite", code == 200 and bool(node_id), str(node_id))

    code, sub = req("POST", "/api/v1/eco/supplier-submit", {
        "submissionToken": submit_token,
        "supplierName": SUPPLIER_NAME,
        "contactEmail": f"sup-{TS}@example.com",
        "tco2eReported": 2.05,
        "payloadJson": json.dumps({"isolation": "supplier_sovereign", "batchRef": f"VERIFY-{TS}"}),
    })
    submitted_id = sub.get("supplierNodeId") or sub.get("supplier_node_id") or node_id
    cl_ivc = sub.get("clIvcHash") or sub.get("cl_ivc_hash") or ""
    record(
        "supplier-submit",
        code == 200 and float(sub.get("tco2eReported") or sub.get("tco2e_reported") or 0) > 0,
        str(cl_ivc)[:24],
    )

    code, claim = req("POST", "/api/v1/eco/supplier-claim-confirm", {
        "supplierNodeId": submitted_id,
        "contactName": "核验认领人",
        "contactPhone": "13900139000",
        "verifyChannel": "phone",
    })
    claim_cert = claim.get("claimCertificateId") or claim.get("claim_certificate_id") or ""
    record("supplier-claim-confirm", code == 200 and claim_cert.startswith("CL-CLAIM-"), claim_cert)

    code, conclusion = req(
        "GET",
        f"/api/v1/hub/supplier-conclusion/{submitted_id}",
        token=buyer_token,
    )
    conc_factor = conclusion.get("carbonIntensity") or conclusion.get("carbon_intensity")
    record(
        "supplier-conclusion 甲方只读",
        code == 200 and float(conc_factor or 0) > 0 and conclusion.get("dataVisibility") == "buyer_readonly",
        str(conc_factor),
    )

    if claim_cert:
        code, cv = req("GET", f"/api/v1/eco/claim-verify/{claim_cert}")
        record(
            "claim-verify CL-CLAIM",
            code == 200 and cv.get("valid") is True,
            cv.get("message", ""),
        )
    else:
        record("claim-verify CL-CLAIM", False, "无 claim cert")

    code, blocked = req(
        "GET",
        f"/api/v1/hub/supplier-conclusion/{submitted_id}",
        token=origin_token,
    )
    record(
        "supplier-conclusion 跨企业 404/403",
        code in (403, 404),
        str(blocked.get("detail", code)),
    )

    html_path = "/static/" + urllib.parse.quote("HengAI_核验.html")
    st_code, html = fetch_static(html_path)
    record(
        "HengAI_核验.html embed 壳",
        st_code == 200
        and "hengai-load-appstate.js" in html
        and "hengai-verify-downstream.js" in html
        and 'src="AppState.js"' not in html,
        str(len(html)),
    )

    _, ds_js = fetch_static("/static/hengai-verify-downstream.js")
    record(
        "hengai-verify-downstream.js",
        "hengaiRenderDownstreamVerification" in ds_js,
        str(len(ds_js)),
    )

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = sum(1 for _, ok, _ in RESULTS if not ok)
    print("\n" + "=" * 60)
    print(f"合计: {passed} PASS / {failed} FAIL")
    if failed:
        for label, ok, detail in RESULTS:
            if not ok:
                print(f"  - {label}: {detail}")
        return 1
    print("核验批次 API 全部通过")
    print(f"  origin: {ORIGIN_EMAIL}")
    print(f"  buyer:  {BUYER_EMAIL}")
    print(f"  gtcid:  {verification_code}")
    print(f"  claim:  {claim_cert}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
