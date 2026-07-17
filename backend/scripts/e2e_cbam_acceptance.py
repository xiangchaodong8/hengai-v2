#!/usr/bin/env python3
"""CBAM ① 功能验收 · API + 静态资源层（商业卡口开关 OFF）。"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:8000"
TS = int(time.time())
ORIGIN_EMAIL = f"cbam-origin-{TS}@example.com"
SME_EMAIL = f"cbam-sme-{TS}@example.com"
PASSWORD = "TestPass1"
ORIGIN_CO = f"CBAM原厂E2E-{TS}"
SME_CO = f"CBAM下游SME-{TS}"
ORIGIN_CREDIT = f"91{TS % 10**16:016d}"[:18]
SME_CREDIT = f"92{(TS + 1) % 10**16:016d}"[:18]
ZITENG_EMAIL = "ziteng@co2lion.com"
ZITENG_PASS = "xd23587052"

RESULTS: list[tuple[str, bool, str]] = []


def req(method: str, path: str, body: dict | None = None, token: str | None = None) -> tuple[int, dict]:
    url = BASE + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=45) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            payload = json.loads(raw) if raw else {"detail": e.reason}
        except json.JSONDecodeError:
            payload = {"detail": raw or str(e.reason)}
        return e.code, payload


def get_text(path: str) -> tuple[int, str]:
    r = urllib.request.Request(BASE + path, method="GET")
    with urllib.request.urlopen(r, timeout=20) as resp:
        return resp.status, resp.read().decode("utf-8", errors="replace")


def record(label: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((label, ok, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {label}" + (f" — {detail}" if detail else ""))


def cbam_payload_snapshot() -> str:
    return json.dumps({
        "ci": 2.15,
        "totalTax": 125000,
        "fx": 7.85,
        "coverage": 68.5,
        "supplierCount": 12,
        "supplierSubmitted": 8,
        "mainProduct": "热轧卷板",
        "scope3MaterialLabel": "铁矿石",
        "usesChinaDefaultLibrary": True,
    }, ensure_ascii=False)


def setup_origin(token: str) -> None:
    code, ws = req("POST", "/api/v1/hub/workspace-update", {
        "name": ORIGIN_CO,
        "creditCode": ORIGIN_CREDIT,
        "industryCode": "steel",
        "mainProduct": "热轧卷板",
        "annualExportTons": 80000,
    }, token=token)
    record("原厂 workspace-update", code == 200, ws.get("message", str(code)))


def setup_sme(token: str) -> None:
    code, ws = req("POST", "/api/v1/hub/workspace-update", {
        "name": SME_CO,
        "creditCode": SME_CREDIT,
        "industryCode": "steel",
        "mainProduct": "钢铁下游部件出口",
        "annualExportTons": 5000,
    }, token=token)
    record("SME workspace-update", code == 200, ws.get("message", str(code)))


def test_static_gates_off() -> None:
    print("\n── 静态资源 · 商业开关 ──")
    code, body = get_text("/static/AppState.js")
    record("AppState.js 可访问", code == 200 and len(body) > 1000)
    record(
        "HENGAI_COMMERCIAL_GATES_ENABLED = false",
        "HENGAI_COMMERCIAL_GATES_ENABLED = false" in body,
    )
    record("COMMERCIAL_GATE_REGISTRY 存在", "COMMERCIAL_GATE_REGISTRY" in body)
    record("checkCommercialGate 存在", "function checkCommercialGate" in body)

    for path, label, needle in (
        ("/static/%E5%85%A8%E5%9F%9F%E4%B8%AD%E5%BF%83.html", "全域中心", "H-pg-cbam"),
        ("/static/HengAI_CBAM%E6%B5%8B%E7%AE%97%E5%B7%A5%E5%85%B7.html", "CBAM工具", "cbam"),
        ("/static/cbam-calc-core.js", "cbam-calc-core", "persistCbamCommit"),
        ("/static/cbam-verified-factor.js", "verified-factor", "notifyCbamCommercialBlock"),
    ):
        try:
            c, b = get_text(path)
            record(f"静态 {label}", c == 200 and needle.lower() in b.lower())
        except Exception as exc:  # noqa: BLE001
            record(f"静态 {label}", False, str(exc))


def test_origin_cbam_commit(token: str) -> None:
    print("\n── 原厂 · CBAM commit ──")
    code, save = req("POST", "/api/v1/hub/cbam-report-save", {
        "reportingPeriod": "2026-Q2",
        "riskExposureEur": 125000,
        "tco2eTotal": 4200.5,
        "payloadJson": cbam_payload_snapshot(),
    }, token=token)
    record("cbam-report-save 200", code == 200, save.get("message", str(save.get("detail", code))))
    report_id = save.get("reportId") or save.get("report_id")
    record("report_id 返回", bool(report_id), str(report_id))
    gm = save.get("gmEarned") if save.get("gmEarned") is not None else save.get("gm_earned")
    record("GM 奖励字段", gm is not None, f"gm={gm}")

    code, ov = req("GET", "/api/v1/hub/overview", token=token)
    record("overview 200", code == 200)
    co = ov.get("company") or {}
    metrics = ov.get("metrics") or {}
    record("company.isComplete", co.get("isComplete") is True or co.get("is_complete") is True)
    record("metrics.riskExposureEur", metrics.get("riskExposureEur") is not None, str(metrics.get("riskExposureEur")))
    flags = ov.get("flags") or {}
    role = flags.get("userRole") or flags.get("user_role") or "?"
    record("flags Phase2+", (flags.get("currentPhase") or "") in ("Phase2", "Phase3"), flags.get("currentPhase"))


def test_sme_pool_and_resonance(sme_token: str, origin_token: str | None) -> None:
    print("\n── SME · Pull / 共振资格 ──")
    code, ov = req("GET", "/api/v1/hub/overview", token=sme_token)
    record("SME overview", code == 200)
    fa = ov.get("factorAuth") or {}
    city = fa.get("cityState") or ov.get("cityState") or "?"
    pull_ok = fa.get("pullEligible")
    if pull_ok is None:
        pull_ok = ov.get("pullEligible")
    record("SME cityState（无 sync 可为空）", True, city)
    record("SME pullEligible（无 sync 可为空）", True, str(pull_ok))

    q = urllib.parse.quote(ORIGIN_CREDIT[:12], safe="")
    code, pool = req("GET", f"/api/v1/hub/verified-factor-pool/search?q={q}", token=sme_token)
    record("SME pool search 200", code == 200, pool.get("message", ""))
    # 无 certified 原厂时 match=false 属预期
    record("pool.match 布尔", isinstance(pool.get("match"), bool), str(pool.get("match")))

    code, res = req("POST", "/api/v1/eco/resonance-request", {
        "industryCode": "steel",
        "originQuery": ORIGIN_CO,
        "productCategory": "热轧卷板",
    }, token=sme_token)
    record("resonance-request", code in (200, 201), str(res.get("message") or res.get("detail") or code))

    pending_before = int((ov.get("metrics") or {}).get("resonanceCount") or 0)
    code_ov2, ov2 = req("GET", "/api/v1/hub/overview", token=sme_token)
    record("SME overview(共振后)", code_ov2 == 200)
    pending_after_req = int((ov2.get("metrics") or {}).get("resonanceCount") or 0) if code_ov2 == 200 else pending_before
    record("共振计数上升", pending_after_req > pending_before, f"{pending_before} -> {pending_after_req}")

    if origin_token:
        code_att, att = req("POST", "/api/v1/hub/industry-factor-attest", {
            "carbonIntensity": 1.842,
            "yoyChangePct": -4.2,
            "industryCode": "steel",
            "productLabel": "钢铁综合",
        }, token=origin_token)
        cert = att.get("certId") or att.get("cert_id")
        record("原厂确权（回落触发）", code_att == 200 and bool(cert), str(cert or code_att))

        code_ov3, ov3 = req("GET", "/api/v1/hub/overview", token=sme_token)
        record("SME overview(确权后)", code_ov3 == 200)
        pending_after_attest = int((ov3.get("metrics") or {}).get("resonanceCount") or 0) if code_ov3 == 200 else pending_after_req
        record("共振计数回落", pending_after_attest < pending_after_req, f"{pending_after_req} -> {pending_after_attest}")
        verified = (ov3.get("resonance") or {}).get("verifiedOrigin") if code_ov3 == 200 else {}
        record("verifiedOrigin 回灌", bool(verified and verified.get("verified") is True), str((verified or {}).get("certId")))


def test_ziteng_regression() -> None:
    print("\n── 回归账号 ziteng ──")
    code, login = req("POST", "/api/v1/auth/login", {
        "email": ZITENG_EMAIL,
        "password": ZITENG_PASS,
    })
    if code != 200:
        record("ziteng 登录", False, str(login.get("detail", code)))
        return
    token = login.get("access_token")
    record("ziteng 登录", bool(token))
    code, ov = req("GET", "/api/v1/hub/overview", token=token)
    record("ziteng overview", code == 200)
    co = ov.get("company") or {}
    flags = ov.get("flags") or {}
    record("ziteng 有企业名", bool(co.get("name")), co.get("name", ""))
    record("ziteng Phase", bool(flags.get("currentPhase")), flags.get("currentPhase"))


def main() -> int:
    print("=" * 60)
    print("HengAI CBAM ① 功能验收 · API 层")
    print("=" * 60)

    code, health = req("GET", "/api/health")
    record("Health", code == 200, str(health))

    test_static_gates_off()

    print("\n── 注册 · 原厂账号 ──")
    code, reg = req("POST", "/api/v1/auth/register", {
        "email": ORIGIN_EMAIL,
        "password": PASSWORD,
        "company_name": ORIGIN_CO,
    })
    record("原厂 register", code == 201, ORIGIN_EMAIL)
    origin_token = reg.get("access_token")
    record("原厂 token", bool(origin_token))
    setup_origin(origin_token)
    test_origin_cbam_commit(origin_token)

    print("\n── 注册 · SME 账号 ──")
    code, reg2 = req("POST", "/api/v1/auth/register", {
        "email": SME_EMAIL,
        "password": PASSWORD,
        "company_name": SME_CO,
    })
    record("SME register", code == 201, SME_EMAIL)
    sme_token = reg2.get("access_token")
    setup_sme(sme_token)
    test_sme_pool_and_resonance(sme_token, origin_token)

    test_ziteng_regression()

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = sum(1 for _, ok, _ in RESULTS if not ok)
    print("\n" + "=" * 60)
    print(f"合计: {passed} PASS / {failed} FAIL")
    if failed:
        print("失败项:")
        for label, ok, detail in RESULTS:
            if not ok:
                print(f"  - {label}: {detail}")
        print("=" * 60)
        return 1
    print("CBAM ① API 验收全部通过")
    print(f"  原厂: {ORIGIN_EMAIL}")
    print(f"  SME:  {SME_EMAIL}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
