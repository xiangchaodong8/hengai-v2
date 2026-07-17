#!/usr/bin/env python3
"""Hub 阶段 ① · 供应链协同批次（invite + binding + redeem + revoke + 函件）。"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

BASE = "http://127.0.0.1:8000"
TS = int(time.time())
ORIGIN_EMAIL = f"sup-origin-{TS}@example.com"
SME_EMAIL = f"sup-sme-{TS}@example.com"
PASSWORD = "TestPass1"
ORIGIN_CO = f"SupplyOrigin-{TS}"
SME_CO = f"SupplySME-{TS}"
ORIGIN_CREDIT = f"91{TS % 10**16:016d}"[:18]
SME_CREDIT = f"92{(TS + 1) % 10**16:016d}"[:18]

RESULTS: list[tuple[str, bool, str]] = []


def _redeem_hmac_secret() -> str:
    return (
        os.getenv("HENGAI_REDEEM_HMAC_SECRET")
        or os.getenv("JWT_SECRET_KEY")
        or "dev-redeem-hmac-change-me"
    )


def build_redeem_code(sync_payload: dict, redeem_id: str) -> str:
    """与 hub_engine.build_redeem_code 同构，避免 e2e 脚本硬依赖 SQLAlchemy。"""
    exp = datetime.now(timezone.utc).replace(
        year=datetime.now(timezone.utc).year + 1
    ).isoformat()
    pkg = {"redeemId": redeem_id, "expiresAt": exp, "sync": sync_payload}
    body = base64.urlsafe_b64encode(
        json.dumps(pkg, ensure_ascii=False).encode()
    ).decode().rstrip("=")
    sig = hmac.new(
        _redeem_hmac_secret().encode(),
        body.encode(),
        hashlib.sha256,
    ).hexdigest()
    return f"HENGAI1.{body}.{sig}"


def req(method: str, path: str, body: dict | None = None, token: str | None = None) -> tuple[int, dict]:
    url = BASE + path
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


def record(label: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((label, ok, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {label}" + (f" — {detail}" if detail else ""))


def setup_workspace(token: str, name: str, credit: str, industry: str) -> None:
    code, ws = req("POST", "/api/v1/hub/workspace-update", {
        "name": name,
        "creditCode": credit,
        "industryCode": industry,
        "mainProduct": "热轧卷板",
        "annualExportTons": 50000,
    }, token=token)
    record(f"workspace-update {name}", code == 200, ws.get("message", str(code)))


def main() -> int:
    print("=" * 60)
    print("Hub 供应链协同批次 · API 验收")
    print("=" * 60)

    try:
        code, _ = req("GET", "/api/health")
        record("backend health", code == 200)
    except Exception as exc:  # noqa: BLE001
        record("backend health", False, str(exc))
        return 1

    _, reg_o = req("POST", "/api/v1/auth/register", {
        "email": ORIGIN_EMAIL, "password": PASSWORD, "company_name": ORIGIN_CO,
    })
    _, reg_s = req("POST", "/api/v1/auth/register", {
        "email": SME_EMAIL, "password": PASSWORD, "company_name": SME_CO,
    })
    origin_token = reg_o.get("access_token")
    sme_token = reg_s.get("access_token")
    record("register origin", bool(origin_token), ORIGIN_EMAIL)
    record("register sme", bool(sme_token), SME_EMAIL)
    if not origin_token or not sme_token:
        return 1

    setup_workspace(origin_token, ORIGIN_CO, ORIGIN_CREDIT, "steel")
    setup_workspace(sme_token, SME_CO, SME_CREDIT, "machinery")

    code, att = req("POST", "/api/v1/hub/industry-factor-attest", {
        "carbonIntensity": 1.842,
        "yoyChangePct": -3.0,
        "industryCode": "steel",
        "productLabel": "钢铁综合",
    }, token=origin_token)
    record("origin attest", code == 200, str(att.get("certId") or code))

    code, inv = req("POST", "/api/v1/hub/supplier-invite", {
        "supplierName": "供应链节点 1",
        "contactEmail": f"sup1-{TS}@example.com",
    }, token=sme_token)
    record("supplier-invite", code == 200, inv.get("message", str(code)))
    nodes = ((inv.get("appState") or inv.get("app_state") or {}).get("supplierNodes") or [])
    record("supplierNodes 回写", len(nodes) >= 1, str(len(nodes)))

    code, decl = req("POST", "/api/v1/hub/supply-binding/declare", {
        "originQuery": ORIGIN_CO,
        "materialType": "热轧卷板",
    }, token=sme_token)
    binding_id = (decl.get("binding") or {}).get("bindingId")
    record("binding declare", code == 200 and bool(binding_id), str(binding_id))

    code, mine = req("GET", "/api/v1/hub/supply-binding/mine", token=sme_token)
    bindings = mine.get("bindings") or []
    record("binding mine", code == 200 and len(bindings) >= 1, str(len(bindings)))

    code, conf = req("POST", "/api/v1/hub/supply-binding/confirm", {
        "bindingId": binding_id,
        "approve": True,
    }, token=origin_token)
    record("binding confirm", code == 200, conf.get("message", str(code)))

    code, consume = req("POST", "/api/v1/hub/factor-consume", {
        "batchId": f"SUP-{TS}",
        "qtyTons": 80,
        "claimMode": "claimed",
    }, token=sme_token)
    record("factor-consume", code == 200 and consume.get("success"), str(consume.get("taxSavedEur")))

    sync_body = {
        "syncTier": "L1",
        "source": "hengai_universal_core",
        "industryId": "steel",
        "batchId": f"REDEEM-{TS}",
        "dataFingerprint": f"fp-redeem-{TS}",
        "encHash": f"enc-redeem-{TS}",
        "carbonIntensity": 1.77,
        "gmReward": 0,
        "holder": ORIGIN_CO,
        "productionEntity": ORIGIN_CREDIT,
        "productionEntitySource": "enterprise_legal",
        "certificateId": f"CL-GTCID-REDEEM-{TS}",
        "issuedAt": "2026-06-23T08:00:00+08:00",
        "qualityTag": {
            "calibration": "cited",
            "matBoxLocked": False,
            "credibilityScore": 70,
            "suspicionLevel": "LOW",
            "maturityTier": "L1_reference",
            "provenanceGrade": "cited",
            "riskFlags": [],
            "activeJurisdiction": "cbam",
        },
    }
    redeem_code = build_redeem_code(sync_body, redeem_id=f"RDM-{TS}")
    code, redeem = req("POST", "/api/v1/hub/evidence/redeem", {
        "redeemCode": redeem_code,
    }, token=origin_token)
    ev = (((redeem.get("appState") or redeem.get("app_state") or {}).get("cbam") or {}).get("evidence") or {})
    record("evidence/redeem", code == 200 and redeem.get("cityState") == "evidence_building", redeem.get("message", ""))
    record("redeem evidence.mode", ev.get("mode") == "PENDING_VERIFICATION", str(ev.get("mode")))

    code, consume_after_redeem = req("POST", "/api/v1/hub/factor-consume", {
        "batchId": f"SUP-{TS}-POST-REDEEM",
        "qtyTons": 5,
        "claimMode": "claimed",
    }, token=sme_token)
    record(
        "redeem 后 factor-consume 仍可用",
        code == 200 and consume_after_redeem.get("success"),
        str(consume_after_redeem.get("taxSavedEur")),
    )

    code, dup = req("POST", "/api/v1/hub/evidence/redeem", {
        "redeemCode": redeem_code,
    }, token=origin_token)
    detail = dup.get("detail")
    dup_code = detail.get("code") if isinstance(detail, dict) else None
    record("redeem 幂等拒绝", code == 409 and dup_code == "ALREADY_REDEEMED", str(dup_code))

    code, revoke = req("POST", "/api/v1/hub/supply/factor-auth/revoke", {
        "bindingId": binding_id,
        "note": "e2e revoke",
    }, token=origin_token)
    record("factor-auth revoke", code == 200, revoke.get("message", str(code)))

    code, blocked = req("POST", "/api/v1/hub/factor-consume", {
        "batchId": f"SUP-{TS}-BLOCK",
        "qtyTons": 10,
        "claimMode": "claimed",
    }, token=sme_token)
    blocked_detail = blocked.get("detail")
    blocked_msg = blocked_detail if isinstance(blocked_detail, str) else str(blocked_detail)
    record(
        "revoke 后 consume 403",
        code == 403 and "撤回" in blocked_msg,
        blocked_msg,
    )

    code, mine_revoked = req("GET", "/api/v1/hub/supply-binding/mine", token=sme_token)
    bindings_after = mine_revoked.get("bindings") or []
    revoked_binding = next(
        (b for b in bindings_after if b.get("bindingId") == binding_id),
        {},
    )
    record(
        "下游 binding.factorAuthRequired",
        revoked_binding.get("factorAuthRequired") is True,
        str(revoked_binding.get("factorAuthNotice", ""))[:80],
    )

    code, apply = req("POST", "/api/v1/hub/supply/factor-auth/apply", {
        "bindingId": binding_id,
        "note": "e2e apply unlock",
    }, token=sme_token)
    record("factor-auth apply", code == 200, apply.get("message", str(code)))

    code, mine_pending = req("GET", "/api/v1/hub/supply-binding/mine", token=sme_token)
    pending_binding = next(
        (b for b in (mine_pending.get("bindings") or []) if b.get("bindingId") == binding_id),
        {},
    )
    record(
        "apply 后 status=pending",
        pending_binding.get("factorAuthApplicationStatus") == "pending",
        str(pending_binding.get("factorAuthApplicationStatus")),
    )

    code, still_blocked = req("POST", "/api/v1/hub/factor-consume", {
        "batchId": f"SUP-{TS}-PENDING",
        "qtyTons": 5,
        "claimMode": "claimed",
    }, token=sme_token)
    record("pending 时 consume 仍 403", still_blocked.get("detail") and code == 403, str(code))

    code, approve = req("POST", "/api/v1/hub/supply/factor-auth/approve", {
        "bindingId": binding_id,
        "approve": True,
    }, token=origin_token)
    record("factor-auth approve", code == 200 and approve.get("approved") is True, approve.get("message", ""))

    code, restored = req("POST", "/api/v1/hub/factor-consume", {
        "batchId": f"SUP-{TS}-RESTORED",
        "qtyTons": 12,
        "claimMode": "claimed",
    }, token=sme_token)
    record(
        "approve 后 consume 恢复",
        code == 200 and restored.get("success"),
        str(restored.get("taxSavedEur")),
    )

    code, letters = req("POST", "/api/v1/hub/supply/factor-rule-letters/batch", {
        "bindingIds": [binding_id],
    }, token=origin_token)
    record("rule letters batch", code == 200 and letters.get("sentCount", 0) >= 1, str(letters.get("sentCount")))

    code, hist = req("GET", "/api/v1/hub/supply/factor-rule-letters/history", token=origin_token)
    record("rule letters history", code == 200 and len(hist.get("letters") or []) >= 1, str(len(hist.get("letters") or [])))

    static_req = urllib.request.Request(
        BASE + "/static/hengai-supply-phase2.js",
        headers={"Accept": "*/*"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(static_req, timeout=30) as static_resp:
            static_body = static_resp.read().decode("utf-8", errors="replace")
            record(
                "hengai-supply-phase2.js",
                static_resp.status == 200 and "hengaiSubmitEvidenceRedeem" in static_body,
                str(len(static_body)),
            )
    except urllib.error.HTTPError as exc:
        record("hengai-supply-phase2.js", False, str(exc.code))

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = sum(1 for _, ok, _ in RESULTS if not ok)
    print("\n" + "=" * 60)
    print(f"合计: {passed} PASS / {failed} FAIL")
    if failed:
        for label, ok, detail in RESULTS:
            if not ok:
                print(f"  - {label}: {detail}")
        return 1
    print("供应链协同批次 API 全部通过")
    print(f"  origin: {ORIGIN_EMAIL}")
    print(f"  sme:    {SME_EMAIL}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
