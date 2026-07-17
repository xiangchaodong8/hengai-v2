#!/usr/bin/env python3
"""Hub 阶段 ① 队列验收 · 首页 T0 静态 + 企业数字档案 workspace-update（API）。"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"
TS = int(time.time())
EMAIL = f"hub-p1q-{TS}@example.com"
PASSWORD = "TestPass1"
COMPANY = f"HubP1Q档案-{TS}"
CREDIT = f"93{TS % 10**16:016d}"[:18]
UPDATED = f"HubP1Q已更新-{TS}"

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


def test_index_static() -> None:
    print("\n── 首页 T0 · 静态资源 ──")
    try:
        code, body = get_text("/static/index.html")
    except Exception as exc:  # noqa: BLE001
        record("index.html 可访问", False, str(exc))
        return
    record("index.html 可访问", code == 200 and len(body) > 5000)
    record("WidgetEngine.renderCbamForm", "renderCbamForm(container)" in body)
    record("T0 粗测按钮文案", "一键测算关税敞口" in body)
    record("无 cbam-evidence-ui 污染", "cbam-evidence-ui.js" not in body)
    record("无「可申报」暗示", "可申报" not in body)
    record("TRIGGER_ALERT_MOCK 敞口链", "TRIGGER_ALERT_MOCK" in body)


def test_enterprise_api(token: str) -> None:
    print("\n── 企业数字档案 · workspace-update ──")
    payload = {
        "name": UPDATED,
        "creditCode": CREDIT,
        "industryCode": "steel",
        "mainProduct": "热轧卷板",
        "annualExportTons": 12000,
        "annualPowerKwh": 4500000,
        "contactEmail": f"ops-{TS}@example.com",
        "regionTag": "华东",
    }
    code, ws = req("POST", "/api/v1/hub/workspace-update", payload, token=token)
    record("workspace-update HTTP 200", code == 200, ws.get("message", str(code)))

    app_state = ws.get("appState") or ws.get("app_state") or {}
    company = app_state.get("company") or {}
    record("响应 company.name", company.get("name") == UPDATED, company.get("name", ""))
    record("响应 mainProduct", company.get("mainProduct") == "热轧卷板", company.get("mainProduct", ""))

    code2, ov = req("GET", "/api/v1/hub/overview", token=token)
    record("overview HTTP 200", code2 == 200)
    co2 = (ov.get("company") or {}) if isinstance(ov, dict) else {}
    record("overview company.name 持久", co2.get("name") == UPDATED, co2.get("name", ""))
    record("overview industryCode", co2.get("industryCode") == "steel", co2.get("industryCode", ""))
    export = co2.get("annualExportTons") or co2.get("annual_export_tons")
    record("overview annualExportTons", export == 12000, str(export))


def test_enterprise_static() -> None:
    print("\n── 企业数字档案 · 静态 ──")
    path = "/static/HengAI_%E4%BC%81%E4%B8%9A%E6%95%B0%E5%AD%97%E6%A1%A3%E6%A1%88.html"
    try:
        code, body = get_text(path)
    except Exception as exc:  # noqa: BLE001
        record("企业数字档案.html 可访问", False, str(exc))
        return
    record("企业数字档案.html 可访问", code == 200)
    record("saveEnterpriseProfile", "saveEnterpriseProfile" in body)
    record("AppState.commit enterprise", "AS.commit('enterprise'" in body or 'commit(\'enterprise\'' in body)
    record("ent-company-name 绑定", 'id="ent-company-name"' in body)


def main() -> int:
    print("=" * 60)
    print("Hub 阶段 ① 队列 · API 验收（首页 T0 + 企业数字档案）")
    print("=" * 60)

    try:
        code, _ = req("GET", "/api/health")
        record("backend /api/health", code == 200, str(code))
    except Exception as exc:  # noqa: BLE001
        record("backend /api/health", False, str(exc))
        print("\n后端不可用，请先 docker compose up / uvicorn")
        return 1

    test_index_static()
    test_enterprise_static()

    print("\n── 注册 · 测试账号 ──")
    code, reg = req("POST", "/api/v1/auth/register", {
        "email": EMAIL,
        "password": PASSWORD,
        "company_name": COMPANY,
    })
    record("register", code in (200, 201), EMAIL)
    token = reg.get("access_token") if code in (200, 201) else None
    if not token:
        failed = sum(1 for _, ok, _ in RESULTS if not ok)
        print(f"\n合计 FAIL（无 token）: {failed}")
        return 1

    test_enterprise_api(token)

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = sum(1 for _, ok, _ in RESULTS if not ok)
    print("\n" + "=" * 60)
    print(f"合计: {passed} PASS / {failed} FAIL")
    if failed:
        for label, ok, detail in RESULTS:
            if not ok:
                print(f"  - {label}: {detail}")
        print("=" * 60)
        return 1
    print("阶段 ① 队列（T0 + 企业档案 API）全部通过")
    print(f"  account: {EMAIL}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
