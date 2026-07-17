# hub_engine.py — HengAI V3.1 唯一数据聚合引擎
# 职责：跨表实时聚合，吐出前端 window.AppState 的完整 DNA JSON
# 调用方：chat.py（每轮对话后）、GET /api/v1/hub/overview（首屏加载）
# 零 Mock · 零硬编码 · 数据库无数据时返回合法的 Phase1 空壳

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, HTMLResponse, Response
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

# V3.1 心脏移植：backend/ 不是 Python 包（无 __init__.py），统一使用绝对导入。
from security import get_current_user, get_optional_current_user
from database import get_db
from models import (
    CBAMReport, CBAMStatus, EnergyRecord, FactorConsumption, GMLedger, LedgerAction,
    ResonanceRequest, ResonanceTriggerPool, SupplyChainBinding,
    SupplierNode, SupplierStatus, SupplierSubmissionLog, User, UserBadge, UserWorkspace, Workspace, WorkspaceStage, UserTier,
)
from schemas import (
    CBAMReportSaveRequest,
    CBAMReportSaveResponse,
    DecisionPackageRequest,
    DecisionPackageResponse,
    DLDApplyRequest,
    DLDApplyResponse,
    RegulationReadRequest,
    RegulationReadResponse,
    SupplierInviteRequest,
    SupplierInviteResponse,
    SupplierMergeDuplicatesRequest,
    SupplierMergeDuplicatesResponse,
    SupplierReconcileResponse,
    SupplierClaimConfirmRequest,
    SupplierClaimConfirmResponse,
    SupplierClaimVerifyResponse,
    SupplierConclusionResponse,
    SupplierSovereignResponse,
    SupplierSubmitRequest,
    SupplierSubmitResponse,
    WorkspaceStageSchema,
    WorkspaceUpdateRequest,
    WorkspaceUpdateResponse,
    IndustryFactorAttestRequest,
    IndustryFactorAttestResponse,
    HubSyncRequest,
    HubSyncResponse,
    HubSyncResonanceInfo,
    VerifiedFactorPoolEntry,
    VerifiedFactorPoolSearchResponse,
    ResonanceRequestSubmit,
    ResonanceRequestResponse,
    ResonanceTriggerSubmit,
    ResonanceTriggerStatus,
    ResonanceTriggerFulfillRequest,
    SovereigntyClaimSubmitResponse,
    SovereigntyClaimReviewRequest,
    SovereigntyClaimReviewResponse,
    SovereigntyClaimPendingItem,
    SovereigntyClaimPendingListResponse,
    SupplyBindingDeclareRequest,
    SupplyBindingConfirmRequest,
    FactorConsumeRequest,
    EvidenceRedeemRequest,
    EvidenceRedeemResponse,
    FactorAuthRevokeRequest,
    FactorAuthApplyRequest,
    FactorAuthApproveRequest,
    FactorRuleLetterBatchRequest,
)

from sovereignty_template import build_sovereignty_letter_html

router = APIRouter(tags=["hub"])
eco_router = APIRouter(prefix="/api/v1/eco", tags=["Ecosystem"])
logger = logging.getLogger(__name__)

# CBAM 默认因子字典（欧盟 v3.0，宪章§2-4）
CBAM_FACTORS: Dict[str, Decimal] = {
    "aluminium"  : Decimal("11.2"),
    "steel"      : Decimal("2.2"),
    "cement"     : Decimal("0.85"),
    "fertilizers": Decimal("1.6"),
    "electricity": Decimal("0.4"),
}
CBAM_CARBON_PRICE_EUR = Decimal("50")  # €50/tCO2e 基准碳价
GENERATIONAL_GM_RATE = Decimal("0.20")  # 一级供应商 GM 贡献 → 链主代际收益比例
SUPPLIER_SUBMIT_SOURCE_PREFIX = "supplier_submit/"
SUPPLIER_SUBMIT_GM_REWARD = Decimal("50")  # 与 hub.py / 供应链 H5 提交奖励对齐
GENERATIONAL_GM_SOURCE_PREFIX = "generational_gm/"


def supplier_submit_source_ref(node_id: uuid.UUID) -> str:
    """GMLedger.source_ref：一级供应商提交产生的下游 GM（可聚合代际收益）。"""
    return f"{SUPPLIER_SUBMIT_SOURCE_PREFIX}{node_id}"


def _period_key_for(dt: datetime) -> str:
    return f"{dt.year}-Q{(dt.month - 1) // 3 + 1}"


def _prev_period_key(pk: str) -> str:
    y_str, q_str = pk.split("-Q", 1)
    y, q = int(y_str), int(q_str)
    if q <= 1:
        return f"{y - 1}-Q4"
    return f"{y}-Q{q - 1}"


def _compute_cl_ivc_hash(name: str, submitted_at: datetime, tco2e: Any, node_id: uuid.UUID) -> str:
    raw = f"{name}|{submitted_at.isoformat()}|{tco2e or 0}|{node_id}"
    return "CL-IVC-" + hashlib.sha256(raw.encode()).hexdigest()[:12].upper()


def _timeliness_score(created_at: Optional[datetime], submitted_at: datetime) -> float:
    if not created_at:
        return 0.82
    try:
        delta_days = max(0, (submitted_at - created_at).days)
        return max(0.35, min(1.0, 1.0 - delta_days / 45.0))
    except Exception:
        return 0.75


async def _compute_consecutive_submissions(db: AsyncSession, node_id: uuid.UUID) -> int:
    r = await db.execute(
        select(SupplierSubmissionLog.period_key)
        .where(SupplierSubmissionLog.supplier_node_id == node_id)
        .order_by(SupplierSubmissionLog.submitted_at.desc())
    )
    periods = sorted({row[0] for row in r.all() if row[0]}, reverse=True)
    if not periods:
        return 0
    count = 1
    cur = periods[0]
    seen = set(periods)
    for _ in range(12):
        prev = _prev_period_key(cur)
        if prev in seen:
            count += 1
            cur = prev
        else:
            break
    return count


async def _record_supplier_submission(
    db: AsyncSession,
    node: SupplierNode,
    *,
    tco2e: Decimal,
    sovereign_payload: Optional[Dict[str, Any]] = None,
) -> Tuple[str, float]:
    now = datetime.now(timezone.utc)
    timeliness = _timeliness_score(node.created_at, now)
    cl_hash = _compute_cl_ivc_hash(node.supplier_name, now, tco2e, node.id)
    period = _period_key_for(now)
    db.add(
        SupplierSubmissionLog(
            supplier_node_id=node.id,
            submitted_at=now,
            tco2e_reported=tco2e,
            timeliness_score=Decimal(str(round(timeliness, 4))),
            cl_ivc_hash=cl_hash,
            period_key=period,
        )
    )
    await db.flush()
    consecutive = await _compute_consecutive_submissions(db, node.id)
    node.submission_count = int(node.submission_count or 0) + 1
    node.consecutive_submissions = consecutive
    node.report_timeliness = Decimal(str(round(timeliness, 4)))
    node.cl_ivc_hash = cl_hash
    node.submitted_at = now
    if sovereign_payload is not None:
        node.sovereign_payload_json = json.dumps(sovereign_payload, ensure_ascii=False)
    return cl_hash, timeliness


def _parse_sovereign_payload(raw: Optional[str]) -> Optional[Dict[str, Any]]:
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {"raw": parsed}
    except Exception:
        return {"raw": raw}


def _serialize_supplier_buyer_view(s: SupplierNode) -> Dict[str, Any]:
    """甲方只读序列化：不含 sovereign_payload_json 等原始数据。"""
    return _serialize_supplier(s)


def generational_gm_source_ref(node_id: uuid.UUID) -> str:
    """GMLedger.source_ref：代际收益分润落账（可选审计）。"""
    return f"{GENERATIONAL_GM_SOURCE_PREFIX}{node_id}"


_INVITE_CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _new_invite_code() -> str:
    suffix = "".join(secrets.choice(_INVITE_CODE_ALPHABET) for _ in range(5))
    return "WL" + suffix


async def _unique_invite_code(db: AsyncSession) -> str:
    for _ in range(16):
        code = _new_invite_code()
        exists = await db.execute(
            select(SupplierNode.id).where(SupplierNode.invite_code == code).limit(1)
        )
        if exists.scalar_one_or_none() is None:
            return code
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="邀请短码生成失败，请重试")


_SUPPLIER_SLOT_RE = re.compile(r"供应链节点\s*(\d+)", re.IGNORECASE)


def _canonical_supplier_slot_name(slot: int) -> str:
    return f"供应链节点 {int(slot)}"


def _parse_supplier_slot(supplier_name: Optional[str]) -> Optional[int]:
    if not supplier_name:
        return None
    m = _SUPPLIER_SLOT_RE.search(str(supplier_name).strip())
    if not m:
        return None
    try:
        n = int(m.group(1))
        return n if n > 0 else None
    except (TypeError, ValueError):
        return None


def _merge_supplier_node_fields(keep: SupplierNode, remove: SupplierNode) -> None:
    """将重复节点上的有效数据并入保留节点。"""
    if remove.invite_code and not (keep.invite_code or "").strip():
        keep.invite_code = remove.invite_code
    if remove.submission_token and not (keep.submission_token or "").strip():
        keep.submission_token = remove.submission_token
    if remove.contact_email and not keep.contact_email:
        keep.contact_email = remove.contact_email
    if remove.supplier_credit_code and not keep.supplier_credit_code:
        keep.supplier_credit_code = remove.supplier_credit_code
    remove_done = remove.status in (SupplierStatus.submitted, SupplierStatus.confirmed)
    keep_done = keep.status in (SupplierStatus.submitted, SupplierStatus.confirmed)
    if remove_done and not keep_done:
        keep.status = remove.status
        keep.submitted_at = remove.submitted_at
        keep.tco2e_reported = remove.tco2e_reported
        keep.data_quality_score = remove.data_quality_score
    elif (
        remove.tco2e_reported is not None
        and float(remove.tco2e_reported or 0) > 0
        and (keep.tco2e_reported is None or float(keep.tco2e_reported or 0) <= 0)
    ):
        keep.tco2e_reported = remove.tco2e_reported
        keep.submitted_at = remove.submitted_at or keep.submitted_at
        keep.data_quality_score = remove.data_quality_score or keep.data_quality_score
        keep.status = remove.status


def _fix_zombie_submitted_placeholder(node: SupplierNode) -> None:
    """CBAM 历史假确权：submitted 但无真实碳强度（质量分=0）→ 恢复为待邀请占位。"""
    if node.status not in (SupplierStatus.submitted, SupplierStatus.confirmed):
        return
    tco = float(node.tco2e_reported or 0)
    if tco > 0:
        return
    dq = float(node.data_quality_score or 0)
    if dq > 0:
        return
    node.status = SupplierStatus.invited
    node.submitted_at = None
    node.tco2e_reported = None
    node.submission_token = None
    node.invite_code = None


async def _reconcile_supplier_nodes(ws_id: uuid.UUID, db: AsyncSession) -> int:
    """
    按槽位 1..N 合并重复「供应链节点 X」，统一规范名称，修复假确权。
    返回删除的重复行数。
    """
    r = await db.execute(
        select(SupplierNode)
        .where(SupplierNode.workspace_id == ws_id)
        .order_by(SupplierNode.created_at.asc())
    )
    nodes: List[SupplierNode] = list(r.scalars().all())
    by_slot: Dict[int, List[SupplierNode]] = {}
    for n in nodes:
        slot = _parse_supplier_slot(n.supplier_name)
        if slot is None:
            continue
        by_slot.setdefault(slot, []).append(n)

    removed = 0
    for slot, group in by_slot.items():
        canonical = _canonical_supplier_slot_name(slot)
        group.sort(key=lambda x: x.created_at)
        keep = group[0]
        keep.supplier_name = canonical
        for dup in group[1:]:
            _merge_supplier_node_fields(keep, dup)
            await db.delete(dup)
            removed += 1
        _fix_zombie_submitted_placeholder(keep)
        _apply_civilization_flags(keep)
        db.add(keep)

    for n in nodes:
        if _parse_supplier_slot(n.supplier_name) is not None:
            continue
        _fix_zombie_submitted_placeholder(n)
        db.add(n)

    if removed:
        await db.flush()
    return removed


async def _find_supplier_node_by_slot(
    ws_id: uuid.UUID,
    slot: int,
    db: AsyncSession,
) -> Optional[SupplierNode]:
    r = await db.execute(
        select(SupplierNode)
        .where(SupplierNode.workspace_id == ws_id)
        .order_by(SupplierNode.created_at.asc())
    )
    for n in r.scalars().all():
        if _parse_supplier_slot(n.supplier_name) == slot:
            return n
    return None


def _sort_supplier_nodes_for_display(nodes: List[SupplierNode]) -> List[SupplierNode]:
    def key_fn(n: SupplierNode) -> tuple:
        slot = _parse_supplier_slot(n.supplier_name)
        return (slot if slot is not None else 99999, n.created_at)

    return sorted(nodes, key=key_fn)


async def _find_invited_supplier_node(
    db: AsyncSession,
    *,
    submission_token: Optional[str],
    invite_code: Optional[str],
) -> Optional[SupplierNode]:
    tok = (submission_token or "").strip()
    inv = (invite_code or "").strip().upper()
    if tok:
        r = await db.execute(
            select(SupplierNode).where(
                SupplierNode.submission_token == tok,
                SupplierNode.status == SupplierStatus.invited,
            )
        )
        return r.scalar_one_or_none()
    if inv:
        r = await db.execute(
            select(SupplierNode).where(
                func.upper(SupplierNode.invite_code) == inv,
                SupplierNode.status == SupplierStatus.invited,
            )
        )
        return r.scalar_one_or_none()
    return None


# 菜单解锁白名单（Phase → slug 列表）
MENU_UNLOCK_MAP: Dict[str, List[str]] = {
    "Phase1": [
        "dashboard", "learning_center", "gm_wallet",
        "earth_citizen", "badges",
    ],
    "Phase2": [
        "dashboard", "learning_center", "gm_wallet",
        "earth_citizen", "badges",
        "cbam_risk_mirror", "roi_report", "supplier_invite",
        "scope3_tracker", "energy_input", "compliance_check",
        "industry_factor_audit",
        "sovereignty_resonance",
    ],
    "Phase3": [
        "dashboard", "learning_center", "gm_wallet",
        "earth_citizen", "badges",
        "cbam_risk_mirror", "roi_report", "supplier_invite",
        "scope3_tracker", "energy_input", "compliance_check",
        "customs_connect", "dld_credit", "governance_board",
        "supply_chain_map",
    ],
}

PHASE_LABELS: Dict[str, str] = {
    "Phase1": "个体启蒙 · The Enlightenment",
    "Phase2": "业务映射 · The Reality Projection",
    "Phase3": "全域共治 · The Governance",
}

_RESONANCE_INDUSTRY_ALIASES: Dict[str, str] = {
    "steel": "steel",
    "钢铁": "steel",
    "aluminum": "aluminum",
    "aluminium": "aluminum",
    "al": "aluminum",
    "铝": "aluminum",
    "cement": "cement",
    "水泥": "cement",
    "petro": "petro",
    "petrochem": "petro",
    "petrochemical": "petro",
    "petrochemicals": "petro",
    "石化": "petro",
    "化工": "petro",
    "paper": "paper",
    "造纸": "paper",
    "ceramic": "ceramic",
    "ceramics": "ceramic",
    "陶瓷": "ceramic",
    "port": "port",
    "港口": "port",
    "交通": "port",
    "idc": "idc",
    "datacenter": "idc",
    "data_center": "idc",
    "数据中心": "idc",
}

CANONICAL_ORIGIN_INDUSTRIES = frozenset({
    "steel", "aluminum", "aluminium", "cement",
    "petro", "paper", "ceramic", "port", "idc",
})

RESONANCE_PENALTY_MULTIPLIER = Decimal("1.35")


def _norm_resonance_industry(raw: Optional[str]) -> str:
    s = (raw or "steel").strip().lower()
    if s in _RESONANCE_INDUSTRY_ALIASES:
        return _RESONANCE_INDUSTRY_ALIASES[s]
    if s in CANONICAL_ORIGIN_INDUSTRIES:
        return "aluminum" if s == "aluminium" else s
    return "steel"


async def _count_pending_resonance(db: AsyncSession, industry_code: Optional[str]) -> int:
    ind = _norm_resonance_industry(industry_code)
    r = await db.execute(
        select(func.count())
        .select_from(ResonanceRequest)
        .where(
            ResonanceRequest.status == "pending",
            ResonanceRequest.industry_code == ind,
        )
    )
    return int(r.scalar_one() or 0)


def _resonance_trigger_target() -> int:
    raw = (os.environ.get("HENGAI_RESONANCE_TARGET") or "30").strip()
    try:
        n = int(raw)
    except ValueError:
        n = 30
    return max(1, min(n, 10_000))


def _parse_trigger_participants(raw: Optional[str]) -> List[Dict[str, Any]]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _trigger_status_payload(
    pool: ResonanceTriggerPool,
    *,
    already: bool = False,
    message: str = "",
) -> ResonanceTriggerStatus:
    parts = _parse_trigger_participants(pool.participants_json)
    return ResonanceTriggerStatus(
        production_entity=pool.production_entity,
        holder=pool.holder or "",
        target_count=int(pool.target_count or 30),
        current_count=int(pool.current_count or 0),
        participant_count=len(parts),
        status=pool.status or "collecting",
        funding_mode="resonance_triggered",
        message=message,
        already_participated=already,
    )


async def _get_or_create_trigger_pool(
    db: AsyncSession,
    production_entity: str,
    holder: str,
) -> ResonanceTriggerPool:
    entity = (production_entity or "").strip().upper()
    r = await db.execute(
        select(ResonanceTriggerPool).where(ResonanceTriggerPool.production_entity == entity).limit(1)
    )
    pool = r.scalar_one_or_none()
    if pool is not None:
        if holder and holder.strip() and not (pool.holder or "").strip():
            pool.holder = holder.strip()
        return pool
    pool = ResonanceTriggerPool(
        production_entity=entity,
        holder=(holder or "").strip(),
        target_count=_resonance_trigger_target(),
        current_count=0,
        status="collecting",
        participants_json="[]",
    )
    db.add(pool)
    await db.flush()
    return pool


async def _sync_upstream_resonance_counters(db: AsyncSession, industry_code: Optional[str]) -> None:
    ind = _norm_resonance_industry(industry_code)
    count = await _count_pending_resonance(db, ind)
    r = await db.execute(
        select(Workspace).where(
            func.lower(func.coalesce(Workspace.industry_code, "")) == ind
        )
    )
    for ws in r.scalars().all():
        ws.resonance_requests = count
        db.add(ws)


FORBIDDEN_SYNC_TOP_KEYS = frozenset({
    "processes", "cems", "rawenergy", "gasvolume", "cokeratio", "vault",
    "raw_energy", "gas_volume", "coke_ratio",
})


def _parse_workspace_meta(ws: Optional[Workspace]) -> Dict[str, Any]:
    if ws is None or not ws.verified_factor_meta_json:
        return {}
    try:
        meta = json.loads(ws.verified_factor_meta_json)
        return meta if isinstance(meta, dict) else {}
    except Exception:
        return {}


def _save_workspace_meta(ws: Workspace, meta: Dict[str, Any]) -> None:
    ws.verified_factor_meta_json = json.dumps(meta, ensure_ascii=False)


REDEEM_CODE_PREFIX = "HENGAI1"


def _redeem_hmac_secret() -> str:
    return (
        os.getenv("HENGAI_REDEEM_HMAC_SECRET")
        or os.getenv("JWT_SECRET_KEY")
        or "dev-redeem-hmac-change-me"
    )


def _redeem_sign(body_b64: str) -> str:
    return hmac.new(
        _redeem_hmac_secret().encode(),
        body_b64.encode(),
        hashlib.sha256,
    ).hexdigest()


def build_redeem_code(
    sync_payload: Dict[str, Any],
    redeem_id: Optional[str] = None,
    expires_at: Optional[str] = None,
) -> str:
    """签发 HENGAI1 兑换码（精算芯侧 e2e / staging；生产由 Core issue-redeem 对接）。"""
    rid = redeem_id or f"RDM-{secrets.token_hex(8).upper()}"
    exp = expires_at or (
        datetime.now(timezone.utc).replace(year=datetime.now(timezone.utc).year + 1).isoformat()
    )
    pkg = {"redeemId": rid, "expiresAt": exp, "sync": sync_payload}
    body = base64.urlsafe_b64encode(
        json.dumps(pkg, ensure_ascii=False).encode()
    ).decode().rstrip("=")
    return f"{REDEEM_CODE_PREFIX}.{body}.{_redeem_sign(body)}"


def _parse_redeem_package(code: str) -> Dict[str, Any]:
    raw = (code or "").strip()
    if not raw.startswith(f"{REDEEM_CODE_PREFIX}."):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_SIGNATURE", "message": "兑换码格式无效"},
        )
    parts = raw.split(".", 2)
    if len(parts) != 3:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_SIGNATURE", "message": "兑换码结构无效"},
        )
    _, body, sig = parts
    if not hmac.compare_digest(_redeem_sign(body), sig):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_SIGNATURE", "message": "兑换码验签失败"},
        )
    pad = "=" * (-len(body) % 4)
    try:
        pkg = json.loads(base64.urlsafe_b64decode(body + pad).decode("utf-8"))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_SIGNATURE", "message": f"兑换包解析失败: {exc}"},
        ) from exc
    if not isinstance(pkg, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_SIGNATURE", "message": "兑换包无效"},
        )
    return pkg


def _factor_auth_revocations(meta: Dict[str, Any]) -> List[Dict[str, Any]]:
    rev = meta.get("factorAuthRevocations")
    return rev if isinstance(rev, list) else []


def _is_downstream_factor_revoked(meta: Dict[str, Any], downstream_ws_id: uuid.UUID) -> bool:
    ds = str(downstream_ws_id)
    for r in _factor_auth_revocations(meta):
        if str(r.get("downstreamWorkspaceId") or r.get("downstream_workspace_id") or "") == ds:
            return True
    return False


def _factor_rule_letters(meta: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows = meta.get("factorRuleLetters")
    return rows if isinstance(rows, list) else []


def _factor_auth_applications(meta: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows = meta.get("factorAuthApplications")
    return rows if isinstance(rows, list) else []


def _factor_auth_application_for_downstream(
    meta: Dict[str, Any],
    downstream_ws_id: uuid.UUID,
) -> Optional[Dict[str, Any]]:
    ds = str(downstream_ws_id)
    apps = [
        a for a in _factor_auth_applications(meta)
        if str(a.get("downstreamWorkspaceId") or a.get("downstream_workspace_id") or "") == ds
    ]
    if not apps:
        return None
    pending = [a for a in apps if str(a.get("status") or "").lower() == "pending"]
    if pending:
        return pending[-1]
    return apps[-1]


TRUST_COMMITMENT_RANK: Dict[str, int] = {
    "NOT_STARTED": 0,
    "COMMITTED": 1,
    "VERIFIED": 2,
}

HONOR_TIER_BY_TRUST: Dict[str, str] = {
    "NOT_STARTED": "INELIGIBLE",
    "COMMITTED": "PIONEER",
    "VERIFIED": "CERTIFIED_BUILDER",
}


def _normalize_trust_commitment_level(raw: Optional[str]) -> str:
    key = str(raw or "").strip().upper()
    return key if key in TRUST_COMMITMENT_RANK else "NOT_STARTED"


def _resolve_honor_eligibility_tier(trust_level: Optional[str]) -> str:
    return HONOR_TIER_BY_TRUST.get(_normalize_trust_commitment_level(trust_level), "INELIGIBLE")


def _normalize_honor_eligibility_tier(raw: Optional[str]) -> Optional[str]:
    tier = str(raw or "").strip().upper()
    if tier in ("INELIGIBLE", "PIONEER", "CERTIFIED_BUILDER"):
        return tier
    return None


def _derive_evidence_mode_from_city_state(city_state: Optional[str]) -> str:
    cs = str(city_state or "").strip().lower()
    if cs == "certified":
        return "SOVEREIGN_VERIFIED"
    if cs in ("evidence_building", "mat_pending"):
        return "PENDING_VERIFICATION"
    return "SIMULATED"


def _derive_evidence_stage_from_city_state(city_state: Optional[str]) -> Optional[str]:
    cs = str(city_state or "").strip().lower()
    if cs == "evidence_building":
        return "software_evidenced"
    if cs == "mat_pending":
        return "hardware_pending"
    return None


def _parse_iso_datetime(raw: Optional[str]) -> Optional[datetime]:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except Exception:
        return None


def _next_evidence_event_id(history: List[Dict[str, Any]]) -> str:
    max_n = 0
    for it in history:
        if not isinstance(it, dict):
            continue
        m = re.match(r"^evt-(\d+)$", str(it.get("eventId") or "").strip(), flags=re.I)
        if not m:
            continue
        try:
            max_n = max(max_n, int(m.group(1)))
        except Exception:
            continue
    return f"evt-{max_n + 1:03d}"


def _build_evidence_contract_meta(
    prev_meta: Dict[str, Any],
    *,
    city_state: str,
    carbon_intensity: float,
    industry_id: str,
    synced_at: str,
    cert_id: str,
    funding_mode: Optional[str],
    source: str,
    sync_tier: str,
    resonance_count: Optional[int] = None,
) -> Dict[str, Any]:
    prev_evidence = prev_meta.get("evidence")
    prev_evidence = dict(prev_evidence) if isinstance(prev_evidence, dict) else {}
    history_raw = prev_evidence.get("history")
    history: List[Dict[str, Any]] = []
    if isinstance(history_raw, list):
        for item in history_raw:
            if isinstance(item, dict):
                history.append(dict(item))

    mode = _derive_evidence_mode_from_city_state(city_state)
    stage = _derive_evidence_stage_from_city_state(city_state)
    prev_trust = _normalize_trust_commitment_level(
        prev_evidence.get("trustCommitmentLevel") or prev_meta.get("trustCommitmentLevel")
    )
    target_trust = "NOT_STARTED"
    if mode == "PENDING_VERIFICATION":
        target_trust = "COMMITTED"
    elif mode == "SOVEREIGN_VERIFIED":
        target_trust = "VERIFIED"
    trust = target_trust if TRUST_COMMITMENT_RANK[target_trust] > TRUST_COMMITMENT_RANK[prev_trust] else prev_trust
    honor = _resolve_honor_eligibility_tier(trust)

    trigger = "simulated_sync"
    if mode == "PENDING_VERIFICATION":
        trigger = "resonance_triggered" if str(funding_mode or "").strip() == "resonance_triggered" else "self_paid"
    elif mode == "SOVEREIGN_VERIFIED":
        trigger = "verified_sync"

    last = history[-1] if history else {}
    last_mode = str(last.get("mode") or "")
    last_trigger = str(last.get("trigger") or "")
    last_cert = str(last.get("certId") or "")
    try:
        last_value = float(last.get("value")) if last.get("value") is not None else None
    except (TypeError, ValueError):
        last_value = None
    same_value = last_value is not None and abs(last_value - float(carbon_intensity)) < 1e-12
    same_cert = mode != "SOVEREIGN_VERIFIED" or (bool(cert_id) and last_cert == cert_id)
    should_append = not (history and last_mode == mode and last_trigger == trigger and same_cert and same_value)
    if should_append:
        evt: Dict[str, Any] = {
            "eventId": _next_evidence_event_id(history),
            "mode": mode,
            "enteredAt": synced_at,
            "value": float(carbon_intensity),
            "trigger": trigger,
        }
        if mode == "PENDING_VERIFICATION":
            evt["fundingMode"] = str(funding_mode or "self_paid")
            if str(funding_mode or "").strip() == "resonance_triggered":
                if resonance_count is not None and int(resonance_count) > 0:
                    evt["resonanceCountAtTrigger"] = int(resonance_count)
                pending_participants = prev_meta.get("resonanceParticipantCount")
                if pending_participants is not None and int(pending_participants) > 0:
                    evt["participantCount"] = int(pending_participants)
        if mode == "SOVEREIGN_VERIFIED":
            if cert_id:
                evt["certId"] = cert_id
            first_sim_ts: Optional[str] = None
            for row in history:
                if str((row or {}).get("mode") or "").upper() == "SIMULATED":
                    first_sim_ts = row.get("enteredAt")
                    break
            if not first_sim_ts and history:
                first_sim_ts = history[0].get("enteredAt")
            ts0 = _parse_iso_datetime(first_sim_ts) if first_sim_ts else None
            ts1 = _parse_iso_datetime(synced_at)
            if ts0 and ts1:
                evt["daysFromFirstSimToVerified"] = max(0, (ts1 - ts0).days)
        history.append(evt)

    verified = prev_evidence.get("verified")
    verified_block: Dict[str, Any] = dict(verified) if isinstance(verified, dict) else {}
    if mode == "SOVEREIGN_VERIFIED":
        if cert_id:
            verified_block["certId"] = cert_id
        verified_block["verifiedAt"] = synced_at
        verified_block["source"] = source
        verified_block["syncTier"] = sync_tier

    shadow = prev_evidence.get("shadow")
    shadow_block: Dict[str, Any] = dict(shadow) if isinstance(shadow, dict) else {}

    evidence: Dict[str, Any] = {
        "mode": mode,
        "value": float(carbon_intensity),
        "unit": prev_evidence.get("unit") or "tCO2e/t",
        "industryCode": industry_id,
        "dictVersion": prev_evidence.get("dictVersion") or "IND_DICT_2026.06",
        "calcVersion": prev_evidence.get("calcVersion") or "CORE_V1",
        "updatedAt": synced_at,
        "verified": verified_block,
        "shadow": shadow_block,
        "trustCommitmentLevel": trust,
        "honorEligibilityTier": honor,
        "history": history,
    }
    if stage:
        evidence["stage"] = stage
    return evidence


def derive_city_state_and_pull(quality_tag: Dict[str, Any]) -> Tuple[str, bool]:
    """SYNC_CONTRACT_v2 §3：由 qualityTag 派生 cityState / pullEligible。"""
    mat = bool(quality_tag.get("matBoxLocked") or quality_tag.get("mat_box_locked"))
    tier = str(quality_tag.get("maturityTier") or quality_tag.get("maturity_tier") or "L0_present")
    if tier == "L3_chain_ready":
        return "certified", True
    if tier == "L2_mat_attested":
        return ("mat_pending", False) if mat else ("evidence_building", False)
    if mat:
        return "mat_pending", False
    return "evidence_building", False


def _workspace_pull_eligible(ws: Workspace) -> bool:
    meta = _parse_workspace_meta(ws)
    if meta.get("cityState"):
        return meta.get("cityState") == "certified" and bool(meta.get("pullEligible"))
    return bool(
        ws.verified_factor is not None
        and ws.verified_factor > 0
        and (ws.verified_factor_cert_id or "").strip()
    )


def _sync_response_message(city_state: str, pull_eligible: bool) -> str:
    if city_state == "certified" and pull_eligible:
        return "正式碳城池已确权；下游可 Pull 核验。"
    if city_state == "mat_pending":
        return "MAT 已接驳，城池建设中；暂不可 Pull。"
    return "软件实证已进城池展示；未 hardware 封签，不可 Pull。下游可见：实名实证中。"


async def _build_industry_board(db: AsyncSession, limit: int = 48) -> List[Dict[str, Any]]:
    """共振大盘实名列表 · evidence_building / mat_pending / certified。"""
    r = await db.execute(
        select(Workspace)
        .where(Workspace.verified_factor_meta_json.isnot(None))
        .order_by(Workspace.updated_at.desc())
        .limit(200)
    )
    board: List[Dict[str, Any]] = []
    for ws in r.scalars().all():
        meta = _parse_workspace_meta(ws)
        if not meta.get("cityState") and not meta.get("lastSyncAt"):
            continue
        intensity_raw = meta.get("displayCarbonIntensity") or meta.get("carbonIntensity")
        try:
            intensity_f = float(intensity_raw) if intensity_raw is not None else 0.0
        except (TypeError, ValueError):
            intensity_f = 0.0
        board.append({
            "holder": meta.get("holder") or ws.name,
            "productionEntity": ws.credit_code,
            "industryId": meta.get("industryId") or ws.industry_code,
            "cityState": meta.get("cityState") or "evidence_building",
            "pullEligible": bool(meta.get("pullEligible")),
            "carbonIntensity": intensity_f,
            "certificateId": meta.get("certificateId") or ws.verified_factor_cert_id,
            "syncedAt": meta.get("lastSyncAt"),
            "fundingMode": meta.get("fundingMode"),
            "trustCommitmentLevel": (
                ((meta.get("evidence") or {}).get("trustCommitmentLevel"))
                if isinstance(meta.get("evidence"), dict)
                else meta.get("trustCommitmentLevel")
            ),
            "honorEligibilityTier": (
                ((meta.get("evidence") or {}).get("honorEligibilityTier"))
                if isinstance(meta.get("evidence"), dict)
                else meta.get("honorEligibilityTier")
            ),
        })
        if len(board) >= limit:
            break
    return board


async def _find_workspace_for_sync(
    db: AsyncSession,
    user: User,
    production_entity: str,
    holder: str,
) -> Workspace:
    entity = (production_entity or "").strip().upper()
    if not entity:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_ENTITY", "message": "productionEntity 不能为空"},
        )
    r = await db.execute(
        select(Workspace)
        .join(Workspace.members)
        .where(User.id == user.id, Workspace.credit_code == entity)
        .limit(1)
    )
    ws = r.scalar_one_or_none()
    if ws is not None:
        return ws
    ws = await _get_primary_workspace(user, db)
    if ws is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请先建立企业数字档案",
        )
    credit = (ws.credit_code or "").strip().upper()
    if credit and credit != entity:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "ENTITY_MISMATCH", "message": "认证主体与 productionEntity 不一致"},
        )
    if not credit:
        ws.credit_code = entity
    holder_norm = (holder or "").strip()
    if holder_norm and not (ws.name or "").strip():
        ws.name = holder_norm
    return ws


async def _latest_verified_origin_for_industry(
    db: AsyncSession,
    industry_code: Optional[str],
) -> Optional[Dict[str, Any]]:
    ind = _norm_resonance_industry(industry_code)
    r = await db.execute(
        select(Workspace)
        .where(
            Workspace.verified_factor.isnot(None),
            Workspace.verified_factor > 0,
            Workspace.verified_factor_cert_id.isnot(None),
            func.lower(func.coalesce(Workspace.industry_code, "")) == ind,
        )
        .order_by(Workspace.updated_at.desc())
        .limit(1)
    )
    ws = r.scalar_one_or_none()
    if ws is None:
        return None
    if not _workspace_pull_eligible(ws):
        return None
    entry = _workspace_to_pool_entry(ws)
    return {
        "verified": True,
        "certId": entry.cert_id,
        "carbonIntensity": _dec(entry.carbon_intensity),
        "originName": entry.origin_name,
        "industryCode": ind,
    }


async def _fulfill_resonance_requests_for_industry(
    db: AsyncSession,
    industry_code: Optional[str],
    target_ws: Workspace,
    cert_id: str,
) -> int:
    ind = _norm_resonance_industry(industry_code or target_ws.industry_code)
    r = await db.execute(
        select(ResonanceRequest).where(
            ResonanceRequest.status == "pending",
            ResonanceRequest.industry_code == ind,
        )
    )
    fulfilled = 0
    target_name = (target_ws.name or "").strip().lower()
    for req in r.scalars().all():
        req.status = "fulfilled"
        req.target_workspace_id = target_ws.id
        req.fulfilled_cert_id = cert_id
        # 来源分层（#7）：下游点名了本原厂 → bound（可计费）；否则行业池广播（合规公共品）
        q = (req.origin_query or "").strip().lower()
        req.fulfill_source = (
            "bound" if q and target_name and (q in target_name or target_name in q) else "industry-pool"
        )
        db.add(req)
        fulfilled += 1
    await _sync_upstream_resonance_counters(db, ind)
    return fulfilled


TIER_LEVEL_MAP: Dict[str, int] = {
    "Seed": 1, "Sprout": 2, "Guardian": 3, "Pioneer": 4, "Sovereign": 5
}

# 地球公民轨 (DB UserTier) → 前端商业档位 ACCOUNT_TIER（与 AppState.normalizeTierCode 对齐）
DB_TIER_TO_ACCOUNT_CODE: Dict[str, str] = {
    "Seed": "FREE_USER",
    "Sprout": "FREE_USER",
    "Guardian": "PRO_PERSONAL",
    "Pioneer": "PRO_PERSONAL",
    "Sovereign": "ENT_VERIFIED",
}

ACCOUNT_TIER_LABEL_ZH: Dict[str, str] = {
    "GUEST": "访客",
    "FREE_USER": "免费体验版",
    "PRO_PERSONAL": "个人专业版",
    "ENT_VERIFIED": "企业共治版",
}


def _account_tier_code_from_user(user_block: Dict[str, Any]) -> str:
    """将 user.tier / user.tier_code 规范为前端 ACCOUNT_TIER 枚举。"""
    explicit = user_block.get("tier_code")
    if explicit and str(explicit).upper() in ACCOUNT_TIER_LABEL_ZH:
        return str(explicit).upper()
    tier_raw = str(user_block.get("tier") or "").strip()
    if tier_raw.upper() in ACCOUNT_TIER_LABEL_ZH:
        return tier_raw.upper()
    if tier_raw in DB_TIER_TO_ACCOUNT_CODE:
        return DB_TIER_TO_ACCOUNT_CODE[tier_raw]
    return "FREE_USER" if tier_raw else "GUEST"


def _reg_label_from_iso(reg_date: Optional[str]) -> Optional[str]:
    if not reg_date:
        return None
    try:
        day = str(reg_date)[:10]
        if len(day) >= 10 and day[4] == "-":
            return f"注册于 {day}"
    except Exception:
        pass
    return None


def normalize_app_state_for_frontend(dna: Dict[str, Any]) -> Dict[str, Any]:
    """
    丰富 hub DNA，使 /hub/overview 与 SSE actions_taken.updatedState
    与前端 formatHubUserIdentity / buildHubPipelinePayload 契约一致。
    """
    if not dna or not isinstance(dna, dict):
        return dna or {}

    out = dict(dna)
    user = dict(out.get("user") or {})
    tier_code = _account_tier_code_from_user(user)
    user["tier_code"] = tier_code
    user["tierLabel"] = ACCOUNT_TIER_LABEL_ZH.get(tier_code, tier_code)
    reg_label = _reg_label_from_iso(user.get("regDate"))
    if reg_label:
        user["regLabel"] = reg_label
    gen_raw = (
        user.get("generationalGm")
        if user.get("generationalGm") is not None
        else user.get("generational_gm")
    )
    try:
        gen_val = float(gen_raw) if gen_raw is not None else 0.0
    except (TypeError, ValueError):
        gen_val = 0.0
    if gen_val < 0:
        gen_val = 0.0
    user["generationalGm"] = gen_val
    user["generational_gm"] = gen_val
    user["gmGenerational"] = gen_val
    user["gm_generational"] = gen_val
    out["user"] = user

    company = out.get("company")
    metrics = out.get("metrics") or {}
    cbam = out.get("cbam") or {}
    if company and isinstance(company, dict):
        co = dict(company)
        risk_raw = metrics.get("riskExposureEur") or metrics.get("cbamTaxEstimate") or co.get("riskExposureEur")
        try:
            risk_f = float(risk_raw) if risk_raw is not None else 0.0
        except (TypeError, ValueError):
            risk_f = 0.0
        has_calc = bool(cbam.get("calcResult")) or co.get("isComplete") or co.get("is_complete")
        if not co.get("stageLabel"):
            if has_calc or risk_f > 0:
                co["stageLabel"] = "CBAM 已测算"
            elif str(co.get("stage") or "").lower() == "certified":
                co["stageLabel"] = "企业官方金库"
            elif str(co.get("stage") or "").lower() == "sandbox":
                co["stageLabel"] = "沙盒运行中"
            elif co.get("name"):
                co["stageLabel"] = "数字孪生体建立中"
        if risk_f > 0 and (not co.get("cbamRisk") or co.get("cbamRisk") == "待测算"):
            co["cbamRisk"] = f"€{int(risk_f):,}"
        if co.get("scope3Rate") is None:
            cov = metrics.get("supplyChainCoverage")
            if cov is None:
                cov = metrics.get("scope3Coverage")
            if cov is not None:
                try:
                    cx = float(cov)
                    if 0 <= cx <= 1:
                        co["scope3Rate"] = round(cx * 100, 2)
                    elif cx > 0:
                        co["scope3Rate"] = cx
                except (TypeError, ValueError):
                    pass
        out["company"] = co

    return out


# ─── 阶段判定（宪章§3 三阶段状态机）────────────────────────────────────────

def _fx_from_cbam_payload(payload_json: Optional[str], default: Decimal = Decimal("7.85")) -> Decimal:
    if not payload_json:
        return default
    try:
        meta = json.loads(payload_json)
        if isinstance(meta, dict) and meta.get("fx") is not None:
            return Decimal(str(meta["fx"]))
    except Exception:
        pass
    return default


def _roi_tax_from_risk_eur(
    risk_eur: Optional[Decimal],
    fx_eur_cny: Decimal,
    invest_cny: Decimal = Decimal("58000"),
) -> tuple[Optional[Decimal], Optional[Decimal]]:
    """节税（万人民币）与 ROI 倍数（净收益/投入）；无正收益时返回 (None, None)。"""
    if not risk_eur or risk_eur <= 0:
        return None, None
    tax_cny = risk_eur * fx_eur_cny
    net = tax_cny - invest_cny
    if net <= 0:
        return None, None
    tax_wan = (net / Decimal("10000")).quantize(Decimal("0.01"))
    roi_m = (net / invest_cny).quantize(Decimal("0.01"))
    return tax_wan, roi_m


def resolve_phase(workspace: Optional[Workspace]) -> str:
    if workspace is None:
        return "Phase1"
    if workspace.stage == WorkspaceStage.certified:
        return "Phase3"
    if workspace.is_complete and workspace.stage == WorkspaceStage.sandbox:
        return "Phase2"
    return "Phase1"


# ─── 原子聚合函数 ─────────────────────────────────────────────────────────────

async def _sum_gm(user_id: uuid.UUID, db: AsyncSession) -> Decimal:
    """实时 SUM GMLedger.amount。永远不读缓存字段。"""
    r = await db.execute(
        select(func.coalesce(func.sum(GMLedger.amount), Decimal("0")))
        .where(GMLedger.user_id == user_id)
    )
    return r.scalar_one() or Decimal("0")


async def _fetch_gm_ledger_recent(
    user_id: uuid.UUID, db: AsyncSession, limit: int = 20
) -> List[GMLedger]:
    r = await db.execute(
        select(GMLedger)
        .where(GMLedger.user_id == user_id)
        .order_by(GMLedger.created_at.desc())
        .limit(limit)
    )
    return list(r.scalars().all())


def _ledger_title(entry: GMLedger) -> str:
    if entry.memo and str(entry.memo).strip():
        return str(entry.memo).strip()
    if entry.source_ref and str(entry.source_ref).strip():
        return str(entry.source_ref).strip()
    return entry.action.value


def _serialize_gm_ledger(entry: GMLedger) -> Dict[str, Any]:
    return {
        "id": str(entry.id),
        "action": entry.action.value,
        "amount": _dec(entry.amount),
        "memo": entry.memo,
        "sourceRef": entry.source_ref,
        "title": _ledger_title(entry),
        "createdAt": _dt(entry.created_at),
    }


REGULATION_READ_PREFIX = "regulation_read/"


def _regulation_title_from_entry(entry: GMLedger, regulation_id: str) -> str:
    memo = (entry.memo or "").strip()
    if memo.startswith("阅读法规："):
        return memo[len("阅读法规："):].strip() or regulation_id
    return memo or regulation_id


def _build_regulation_reads(ledger_rows: List[GMLedger]) -> Dict[str, Any]:
    """从 GM 流水聚合法规阅读记录（source_ref=regulation_read/{id}）。"""
    reads: List[Dict[str, Any]] = []
    seen: set = set()
    for entry in sorted(
        ledger_rows,
        key=lambda x: x.created_at or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    ):
        ref = entry.source_ref or ""
        if not ref.startswith(REGULATION_READ_PREFIX):
            continue
        rid = ref[len(REGULATION_READ_PREFIX):].strip()
        if not rid or rid in seen:
            continue
        seen.add(rid)
        reads.append({
            "regulationId": rid,
            "title": _regulation_title_from_entry(entry, rid),
            "readAt": _dt(entry.created_at),
            "progressPct": 100,
            "gmEarned": _dec(entry.amount) if entry.action == LedgerAction.earn else "0",
        })
    last_at = reads[0]["readAt"] if reads else None
    return {
        "reads": reads,
        "readCount": len(reads),
        "lastReadAt": last_at,
    }


def _pick_earliest_iso(*candidates: Optional[str]) -> Optional[str]:
    best: Optional[str] = None
    for c in candidates:
        if not c:
            continue
        if best is None or str(c) < str(best):
            best = c
    return best


def _build_milestones(
    user: User,
    ws: Optional[Workspace],
    report: Optional[CBAMReport],
    reports_raw: List[CBAMReport],
    supplier_nodes: List[SupplierNode],
    ledger_rows: List[GMLedger],
    badges: List[UserBadge],
) -> Dict[str, Optional[str]]:
    """全域总览时间轴 · 注册/会员/CBAM/档案/供应链/激活"""
    reg = _dt(user.reg_date)
    pro_at: Optional[str] = None
    cbam_at: Optional[str] = None
    ent_at: Optional[str] = None
    sup_at: Optional[str] = None

    tier_code = _account_tier_code_from_user({"tier": user.tier.value})
    if tier_code in ("PRO_PERSONAL", "ENT_VERIFIED"):
        pro_at = reg

    for entry in sorted(
        ledger_rows,
        key=lambda x: x.created_at or datetime.min.replace(tzinfo=timezone.utc),
    ):
        blob = f"{entry.memo or ''} {entry.source_ref or ''}".lower()
        at = _dt(entry.created_at)
        if not pro_at and any(k in blob for k in ("会员", "pro", "月度", "tier")):
            pro_at = at
        if not cbam_at and any(k in blob for k in ("cbam", "测算", "report")):
            cbam_at = at

    if report:
        cbam_at = _pick_earliest_iso(
            cbam_at,
            _dt(report.submitted_at),
            _dt(report.created_at),
        )
    for r in reports_raw:
        cbam_at = _pick_earliest_iso(cbam_at, _dt(r.submitted_at), _dt(r.created_at))

    if ws and ws.is_complete:
        ent_at = _dt(ws.updated_at) or _dt(ws.created_at)
    for entry in ledger_rows:
        blob = f"{entry.memo or ''} {entry.source_ref or ''}"
        if not ent_at and any(k in blob for k in ("档案", "workspace", "企业")):
            ent_at = _dt(entry.created_at)

    for sn in supplier_nodes:
        if sn.status in (SupplierStatus.submitted, SupplierStatus.confirmed):
            sup_at = _pick_earliest_iso(sup_at, _dt(sn.submitted_at), _dt(sn.created_at))

    activation_at: Optional[str] = None
    if ws and ws.stage == WorkspaceStage.certified:
        activation_at = _dt(ws.updated_at) or ent_at

    return {
        "register": reg,
        "proMember": pro_at,
        "cbamCalc": cbam_at,
        "enterprise": ent_at,
        "supply": sup_at,
        "activation": activation_at,
    }


def _build_activity_timeline(
    gm_ledger: List[Dict[str, Any]],
    recent_reports: List[Dict[str, Any]],
    user: User,
) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for g in gm_ledger:
        items.append({
            "type": "gm",
            "title": g.get("title") or "GM 流水",
            "at": g.get("createdAt"),
            "amount": g.get("amount"),
            "gm": g.get("amount"),
        })
    for r in recent_reports:
        items.append({
            "type": "cbam",
            "title": "CBAM · " + str(r.get("reportingPeriod") or "报告"),
            "at": r.get("submittedAt") or r.get("createdAt"),
        })
    if user.last_login_at:
        items.append({
            "type": "auth",
            "title": "最近登录",
            "at": _dt(user.last_login_at),
        })
    items = [x for x in items if x.get("at")]
    items.sort(key=lambda x: str(x.get("at") or ""), reverse=True)
    return items[:30]


async def compute_generational_gm(user_id: uuid.UUID, db: AsyncSession) -> Decimal:
    """
    代际收益真实聚合：
    1. 查询链主邀请的一级 SupplierNode（invited_by_user_id）
    2. 汇总这些节点在 GMLedger 中产生的下游 GM（source_ref = supplier_submit/{node_id}）
    3. 按 20% 计入链主代际收益
    无数据时返回 Decimal('0')，禁止 null。
    """
    zero = Decimal("0")
    try:
        nodes_result = await db.execute(
            select(SupplierNode.id).where(SupplierNode.invited_by_user_id == user_id)
        )
        node_ids = list(nodes_result.scalars().all())
        if not node_ids:
            return zero

        refs = [supplier_submit_source_ref(nid) for nid in node_ids]
        sum_result = await db.execute(
            select(func.coalesce(func.sum(GMLedger.amount), zero)).where(
                GMLedger.user_id == user_id,
                GMLedger.action == LedgerAction.earn,
                GMLedger.amount > 0,
                GMLedger.source_ref.in_(refs),
            )
        )
        downstream_total = sum_result.scalar_one() or zero
        if downstream_total <= zero:
            return zero
        return (downstream_total * GENERATIONAL_GM_RATE).quantize(Decimal("0.0001"))
    except Exception as exc:
        logger.warning("compute_generational_gm 降级为 0: user_id=%s err=%s", user_id, exc)
        return zero


FORTRESS_LEVELS = ["地基", "初建", "成型", "强化", "要塞"]

# 工业原厂 Workspace（武钢/中铝/海螺等） vs 下游 SME（比亚迪等）
ORIGIN_FACTORY_INDUSTRIES = CANONICAL_ORIGIN_INDUSTRIES
BATCH_VERIFY_SUCCESS_MSG = "[🟢 批次对账成功：该物料已由原厂确权]"


def _resolve_workspace_role(ws: Optional["Workspace"]) -> str:
    """ROLE_ORIGIN · 签发/确权；ROLE_SME · 认领/请求因子。"""
    if ws is None:
        return "ROLE_GUEST"
    ind = (ws.industry_code or "").strip().lower()
    if ind in ORIGIN_FACTORY_INDUSTRIES:
        return "ROLE_ORIGIN"
    return "ROLE_SME"


async def _build_verified_origin_pool(db: AsyncSession, limit: int = 48) -> List[Dict[str, Any]]:
    """已确权原厂列表 · 供 CBAM 智能检测 / 进料单模糊匹配。"""
    r = await db.execute(
        select(Workspace)
        .where(
            Workspace.verified_factor.isnot(None),
            Workspace.verified_factor > 0,
            Workspace.verified_factor_cert_id.isnot(None),
        )
        .order_by(Workspace.updated_at.desc())
        .limit(limit)
    )
    out: List[Dict[str, Any]] = []
    for ws in r.scalars().all():
        if not _workspace_pull_eligible(ws):
            continue
        entry = _workspace_to_pool_entry(ws)
        out.append(
            {
                "workspaceId": str(entry.workspace_id),
                "originName": entry.origin_name,
                "origin_name": entry.origin_name,
                "creditCode": entry.credit_code,
                "credit_code": entry.credit_code,
                "industryCode": entry.industry_code,
                "carbonIntensity": float(entry.carbon_intensity),
                "carbon_intensity": float(entry.carbon_intensity),
                "certId": entry.cert_id,
                "cert_id": entry.cert_id,
                "verificationCode": entry.verification_code,
                "verification_code": entry.verification_code,
                "batchId": entry.verification_code,
                "batch_id": entry.verification_code,
                "productLabel": entry.product_label,
                "attestedAt": entry.attested_at,
            }
        )
    return out


def _collaboration_score_for_supplier(s: SupplierNode) -> int:
    """协作质量 = 填报及时性 × 数据置信度 × 连续填报次数（归一化 0–100）。"""
    dq_raw = float(s.data_quality_score) if s.data_quality_score is not None else 0.0
    confidence = max(0.0, min(1.0, dq_raw / 100.0 if dq_raw > 1 else dq_raw))
    if confidence <= 0 and s.status in (SupplierStatus.submitted, SupplierStatus.confirmed):
        confidence = 0.72
    timeliness = float(s.report_timeliness) if s.report_timeliness is not None else 0.0
    if timeliness <= 0:
        if s.submitted_at and s.created_at:
            timeliness = _timeliness_score(s.created_at, s.submitted_at)
        elif s.status in (SupplierStatus.submitted, SupplierStatus.confirmed):
            timeliness = 0.82
        else:
            timeliness = 0.35
    consecutive = int(s.consecutive_submissions or 0)
    if consecutive <= 0:
        consecutive = int(s.submission_count or 0)
    if consecutive <= 0 and s.status in (SupplierStatus.submitted, SupplierStatus.confirmed):
        consecutive = 1
    score = timeliness * max(confidence, 0.25) * max(consecutive, 0) * 100.0
    return int(max(0, min(100, round(score))))


def _confidence_level_label(score: Optional[Decimal]) -> str:
    v = float(score) if score is not None else 0.0
    if v > 1:
        v = v / 100.0
    if v >= 0.9:
        return "A · 高置信"
    if v >= 0.75:
        return "B · 良好"
    if v >= 0.55:
        return "C · 可用"
    return "D · 待提升"


def _build_fortress(
    *,
    supply_chain_cov: Optional[Decimal],
    submitted_count: int,
    generational_nodes: int,
    gm_balance: Optional[Decimal],
    tier_level: int,
    current_level: int,
    is_complete: bool,
    avg_data_quality: float = 0.0,
    data_years: float = 0.0,
    reduction_pct: float = 0.0,
) -> Dict[str, Any]:
    """
    供应链碳城池四维（时间跨度 / 置信度 / 完整性 / 减排趋势），每维 0–100。
    levelLabel：地基 → 初建 → 成型 → 强化 → 要塞（共 5 级）。
    """
    try:
        cov = float(supply_chain_cov) if supply_chain_cov is not None else 0.0
    except (TypeError, ValueError):
        cov = 0.0
    if cov > 1:
        cov = cov / 100.0
    cov = max(0.0, min(1.0, cov))

    dim_time = int(max(0, min(100, round(min(data_years, 4.0) / 4.0 * 100))))
    dim_confidence = int(max(0, min(100, round(max(0.0, min(1.0, avg_data_quality)) * 100))))
    dim_completeness = int(max(0, min(100, round(cov * 100))))
    dim_reduction = int(max(0, min(100, round(max(0.0, min(100.0, reduction_pct))))))

    dims = [dim_time, dim_confidence, dim_completeness, dim_reduction]
    avg = int(round(sum(dims) / 4.0))

    if not is_complete:
        level = "地基"
    elif avg >= 82 or cov >= 0.85:
        level = "要塞"
    elif avg >= 62 or cov >= 0.6:
        level = "强化"
    elif avg >= 40 or cov >= 0.35:
        level = "成型"
    elif avg >= 18 or submitted_count >= 1:
        level = "初建"
    else:
        level = "地基"

    return {
        "source": "server",
        "levelLabel": level,
        "avgScore": avg,
        "avgScoreNum": avg,
        "dims": dims,
        "dimTimeSpan": f"{dim_time}%",
        "dimConfidence": f"{dim_confidence}%",
        "dimCompleteness": f"{dim_completeness}%",
        "dimReduction": f"{dim_reduction}%",
        "dimCoverage": f"{dim_completeness}%",
        "dimSovereignty": f"{dim_confidence}%",
        "dimNetwork": f"{dim_time}%",
        "dimTrust": f"{dim_reduction}%",
    }


async def _record_supplier_submit_gm_if_needed(
    db: AsyncSession,
    owner_user_id: uuid.UUID,
    node: SupplierNode,
    amount: Decimal = SUPPLIER_SUBMIT_GM_REWARD,
) -> Decimal:
    """供应商节点首次提交时写入 GMLedger（source_ref 追踪，幂等）。"""
    if amount <= 0:
        return Decimal("0")
    ref = supplier_submit_source_ref(node.id)
    exists = await db.execute(
        select(func.count())
        .select_from(GMLedger)
        .where(GMLedger.user_id == owner_user_id, GMLedger.source_ref == ref)
    )
    if (exists.scalar_one() or 0) > 0:
        return Decimal("0")
    bal_before = await _sum_gm(owner_user_id, db)
    db.add(
        GMLedger(
            user_id=owner_user_id,
            action=LedgerAction.earn,
            amount=amount,
            balance_snap=bal_before + amount,
            source_ref=ref,
            memo=f"一级供应商「{node.supplier_name}」完成碳数据提交",
        )
    )
    return amount


def _supplier_completeness_score(node: SupplierNode) -> int:
    """填报完整度 0–100，驱动商业文明策略锚点（投保/白名单）。"""
    score = 0
    if (node.supplier_credit_code or "").strip():
        score += 20
    if (node.contact_email or "").strip():
        score += 15
    if node.tco2e_reported is not None and node.tco2e_reported > 0:
        score += 25
    if node.data_quality_score is not None:
        try:
            dq = float(node.data_quality_score)
            if dq > 1:
                dq = dq / 100.0
            score += int(min(25, max(0, dq * 25)))
        except (TypeError, ValueError):
            pass
    if node.status == SupplierStatus.submitted:
        score += 20
    elif node.status == SupplierStatus.confirmed:
        score += 35
    return min(100, score)


def _civilization_flags_for_supplier(node: SupplierNode) -> Tuple[bool, bool, str]:
    """
    根据填报完整度 + 节点 ID 确定性扰动，模拟「建议投保 / 已承保 / 白名单」商业氛围。
    """
    score = _supplier_completeness_score(node)
    seed = int(hashlib.md5(str(node.id).encode()).hexdigest()[:8], 16)
    is_white_listed = score >= 72 or node.status == SupplierStatus.confirmed
    is_insured = (score >= 88 and seed % 4 != 0) or (score >= 65 and seed % 7 == 0)
    if is_insured:
        suggestion = "已承保"
    elif score >= 45 and seed % 3 == 0:
        suggestion = "建议投保"
    else:
        suggestion = "待评估"
    return is_insured, is_white_listed, suggestion


def _apply_civilization_flags(node: SupplierNode) -> None:
    insured, whitelisted, _ = _civilization_flags_for_supplier(node)
    node.is_insured = insured
    node.is_white_listed = whitelisted


def _suppliers_from_payload(payload_json: Optional[str]) -> List[Dict[str, Any]]:
    """从 CBAM payload 解析供应商明细列表（可选）。"""
    if not payload_json:
        return []
    try:
        meta = json.loads(payload_json)
        if not isinstance(meta, dict):
            return []
        raw = meta.get("suppliers") or meta.get("supplierList") or meta.get("supplier_nodes")
        if not isinstance(raw, list):
            return []
        out: List[Dict[str, Any]] = []
        for item in raw:
            if isinstance(item, str) and item.strip():
                out.append({"name": item.strip()})
            elif isinstance(item, dict):
                name = (
                    item.get("name")
                    or item.get("supplierName")
                    or item.get("supplier_name")
                )
                if name and str(name).strip():
                    out.append(item)
        return out
    except Exception:
        return []


def _supplier_count_from_payload(payload_json: Optional[str]) -> Optional[int]:
    if not payload_json:
        return None
    try:
        meta = json.loads(payload_json)
        if not isinstance(meta, dict):
            return None
        raw = meta.get("supplier_count", meta.get("supplierCount", meta.get("supTotal")))
        if raw is None:
            return None
        n = int(raw)
        return n if n >= 0 else None
    except Exception:
        return None


def _supplier_submitted_from_payload(payload_json: Optional[str]) -> Optional[int]:
    if not payload_json:
        return None
    try:
        meta = json.loads(payload_json)
        if not isinstance(meta, dict):
            return None
        raw = meta.get(
            "supplier_submitted",
            meta.get("supplierSubmitted", meta.get("supDone")),
        )
        if raw is None:
            return None
        n = int(raw)
        return n if n >= 0 else None
    except Exception:
        return None


async def _ensure_supplier_nodes_from_cbam(
    ws: Workspace,
    payload_json: Optional[str],
    db: AsyncSession,
    inviter_user_id: Optional[uuid.UUID] = None,
) -> None:
    """CBAM 测算落库：按固定槽位 1..N 补齐节点（禁止按数组下标重复创建「节点 9」）。"""
    declared = _supplier_count_from_payload(payload_json)
    supplier_specs = _suppliers_from_payload(payload_json)
    if declared is None or declared <= 0:
        if supplier_specs:
            declared = len(supplier_specs)
        else:
            return

    await _reconcile_supplier_nodes(ws.id, db)

    for slot in range(1, declared + 1):
        spec = supplier_specs[slot - 1] if slot - 1 < len(supplier_specs) else {}
        canonical = _canonical_supplier_slot_name(slot)
        custom_name = (
            spec.get("name")
            or spec.get("supplierName")
            or spec.get("supplier_name")
        )
        display_name = str(custom_name).strip()[:256] if custom_name else canonical

        existing = await _find_supplier_node_by_slot(ws.id, slot, db)
        if existing is not None:
            if custom_name and existing.supplier_name != display_name:
                existing.supplier_name = display_name
            credit = (
                spec.get("creditCode")
                or spec.get("supplierCreditCode")
                or spec.get("supplier_credit_code")
            )
            if credit:
                existing.supplier_credit_code = str(credit).strip()[:64] or None
            submitted_flag = spec.get("submitted") or spec.get("status") == "submitted"
            if submitted_flag and existing.status not in (
                SupplierStatus.submitted,
                SupplierStatus.confirmed,
            ):
                existing.status = SupplierStatus.submitted
                existing.submitted_at = datetime.now(timezone.utc)
                if existing.tco2e_reported is None:
                    existing.tco2e_reported = Decimal("0")
                if existing.data_quality_score is None:
                    existing.data_quality_score = Decimal("0")
            _apply_civilization_flags(existing)
            db.add(existing)
            continue

        credit = (
            spec.get("creditCode")
            or spec.get("supplierCreditCode")
            or spec.get("supplier_credit_code")
        )
        submitted_flag = spec.get("submitted") or spec.get("status") == "submitted"
        st = SupplierStatus.submitted if submitted_flag else SupplierStatus.invited
        node = SupplierNode(
            workspace_id=ws.id,
            invited_by_user_id=inviter_user_id,
            supplier_name=display_name if custom_name else canonical,
            supplier_credit_code=(str(credit).strip()[:64] if credit else None),
            status=st,
            submission_token=secrets.token_urlsafe(24) if submitted_flag else None,
            invite_code=None,
        )
        if st == SupplierStatus.submitted:
            node.submitted_at = datetime.now(timezone.utc)
            node.tco2e_reported = Decimal("0")
            node.data_quality_score = Decimal("0")
        _apply_civilization_flags(node)
        db.add(node)

    await db.flush()
    await _reconcile_supplier_nodes(ws.id, db)


async def _sync_workspace_after_cbam_save(
    ws: Workspace,
    report: CBAMReport,
    payload_json: Optional[str],
    db: AsyncSession,
    inviter_user_id: Optional[uuid.UUID] = None,
) -> Decimal:
    """测算落库后：同步 declared_supplier_count、补齐 SupplierNode、重算 scope3，并回写 Workspace 缓存。"""
    tax_eur = report.cbam_tax_estimate or report.risk_exposure_eur or Decimal("0")
    ws.risk_exposure_eur_cache = tax_eur
    ws.is_complete = True
    if ws.stage == WorkspaceStage.incomplete:
        ws.stage = WorkspaceStage.sandbox

    sc = _supplier_count_from_payload(payload_json)
    if sc is not None:
        ws.declared_supplier_count = sc
    await _ensure_supplier_nodes_from_cbam(ws, payload_json, db, inviter_user_id)
    scope3 = await _scope3_coverage(ws.id, db)
    cov_from_payload: Optional[Decimal] = None
    if payload_json:
        try:
            meta = json.loads(payload_json)
            if isinstance(meta, dict) and meta.get("coverage") is not None:
                cov_from_payload = Decimal(str(meta["coverage"]))
                if cov_from_payload > 1:
                    cov_from_payload = (cov_from_payload / Decimal("100")).quantize(Decimal("0.0001"))
        except Exception:
            pass
    report.scope3_coverage = scope3
    report.supply_chain_coverage = cov_from_payload if cov_from_payload is not None else scope3
    db.add(ws)
    db.add(report)
    return scope3


async def _latest_report(workspace_id: uuid.UUID, db: AsyncSession) -> Optional[CBAMReport]:
    r = await db.execute(
        select(CBAMReport)
        .where(CBAMReport.workspace_id == workspace_id)
        .order_by(CBAMReport.updated_at.desc())
        .limit(1)
    )
    return r.scalar_one_or_none()


async def _scope3_coverage(workspace_id: uuid.UUID, db: AsyncSession) -> Decimal:
    total_r = await db.execute(
        select(func.count(SupplierNode.id)).where(SupplierNode.workspace_id == workspace_id)
    )
    sub_r = await db.execute(
        select(func.count(SupplierNode.id)).where(
            SupplierNode.workspace_id == workspace_id,
            SupplierNode.status.in_([SupplierStatus.submitted, SupplierStatus.confirmed]),
        )
    )
    total = total_r.scalar_one() or 0
    submitted = sub_r.scalar_one() or 0
    if total == 0:
        return Decimal("0")
    return (Decimal(submitted) / Decimal(total)).quantize(Decimal("0.0001"))


async def _sync_scope3_and_risk_exposure(
    workspace: Workspace,
    report: Optional[CBAMReport],
    new_scope3: Decimal,
    db: AsyncSession,
) -> Decimal:
    """
    供应商提交后同步穿透率并重算碳税敞口（缺省惩罚溢价随 Scope3 覆盖率下降）。
    写入 Workspace 缓存 + 最新 CBAMReport，供全域中心刷新后立即体现。
    """
    gap = max(Decimal("0"), Decimal("1") - min(new_scope3, Decimal("1")))
    base_risk = Decimal("0")
    if report and report.risk_exposure_eur and report.risk_exposure_eur > 0:
        base_risk = report.risk_exposure_eur
    elif workspace.risk_exposure_eur_cache and workspace.risk_exposure_eur_cache > 0:
        base_risk = workspace.risk_exposure_eur_cache
    elif report and report.tco2e_total and report.tco2e_total > 0:
        base_risk = (report.tco2e_total * CBAM_CARBON_PRICE_EUR).quantize(Decimal("0.01"))
    else:
        base_risk = Decimal("145000")

    relief = Decimal("1") - gap * Decimal("0.35")
    new_risk = (base_risk * relief).quantize(Decimal("0.01"))

    workspace.risk_exposure_eur_cache = new_risk
    db.add(workspace)
    if report:
        report.scope3_coverage = new_scope3
        report.supply_chain_coverage = new_scope3
        report.risk_exposure_eur = new_risk
        db.add(report)
    return new_risk


async def _energy_tco2e_sum(workspace_id: uuid.UUID, db: AsyncSession) -> Decimal:
    r = await db.execute(
        select(func.coalesce(func.sum(EnergyRecord.tco2e_calc), Decimal("0")))
        .where(EnergyRecord.workspace_id == workspace_id)
    )
    return r.scalar_one()


# ─── 核心聚合入口 ─────────────────────────────────────────────────────────────

async def build_app_state(user: User, db: AsyncSession) -> Dict[str, Any]:
    """
    唯一数据源。返回完整的 AppState DNA 字典。
    所有前端展示数字必须来自这里——包括对话触发的每次更新。
    """

    # ── 1. 实时 GM / 代际收益 ─────────────────────────────────────────────
    gm_balance = await _sum_gm(user.id, db)
    generational_gm = await compute_generational_gm(user.id, db)
    generational_f = _gm_scalar(generational_gm)

    # ── 2. 主 Workspace ──────────────────────────────────────────────────
    ws_r = await db.execute(
        select(Workspace)
        .join(Workspace.members)
        .where(User.id == user.id)
        .order_by(Workspace.created_at.asc())
        .limit(1)
    )
    ws: Optional[Workspace] = ws_r.scalar_one_or_none()

    # ── 3. 阶段判定 ──────────────────────────────────────────────────────
    phase = resolve_phase(ws)

    # ── 4. 最新 CBAM 报告 ────────────────────────────────────────────────
    report: Optional[CBAMReport] = None
    scope3 = Decimal("0")
    energy_tco2e = Decimal("0")
    supplier_nodes_raw: List[SupplierNode] = []

    if ws:
        report       = await _latest_report(ws.id, db)
        scope3       = await _scope3_coverage(ws.id, db)
        energy_tco2e = await _energy_tco2e_sum(ws.id, db)

        removed_dup = await _reconcile_supplier_nodes(ws.id, db)
        if removed_dup > 0:
            await db.commit()
        sn_r = await db.execute(
            select(SupplierNode).where(SupplierNode.workspace_id == ws.id)
        )
        supplier_nodes_raw = _sort_supplier_nodes_for_display(list(sn_r.scalars().all()))

    # ── 5. 碳数据汇算 ────────────────────────────────────────────────────
    tco2e_total = Decimal("0")
    if report and report.tco2e_total:
        tco2e_total = report.tco2e_total
    elif energy_tco2e > 0:
        tco2e_total = energy_tco2e

    # 风险敞口：Workspace 缓存 → 最新报告 → tco2e 估算
    risk_eur = Decimal("0")
    if ws and ws.risk_exposure_eur_cache and ws.risk_exposure_eur_cache > 0:
        risk_eur = ws.risk_exposure_eur_cache
    elif report and report.risk_exposure_eur:
        risk_eur = report.risk_exposure_eur
    elif tco2e_total > 0:
        risk_eur = (tco2e_total * CBAM_CARBON_PRICE_EUR).quantize(Decimal("0.01"))

    roi_ratio = report.roi_ratio if report else None
    supply_chain_cov = report.supply_chain_coverage if report else scope3
    global_rank      = report.global_rank if report else None
    cbam_tax         = report.cbam_tax_estimate if report else None

    fx_for_roi = _fx_from_cbam_payload(report.payload_json if report else None)
    tax_savings_wan: Optional[Decimal] = None
    roi_multiple: Optional[Decimal] = None
    if risk_eur and risk_eur > 0:
        tax_savings_wan, roi_multiple = _roi_tax_from_risk_eur(risk_eur, fx_for_roi)
        if roi_multiple is None and roi_ratio is not None:
            roi_multiple = roi_ratio

    s1_metric: Optional[Decimal] = None
    s2_metric: Optional[Decimal] = None
    s3_metric: Optional[Decimal] = None
    carbon_intensity: Optional[Decimal] = None
    if report and report.payload_json:
        try:
            calc = json.loads(report.payload_json)
            if isinstance(calc, dict):
                if calc.get("s1") is not None:
                    s1_metric = Decimal(str(calc["s1"]))
                if calc.get("s2") is not None:
                    s2_metric = Decimal(str(calc["s2"]))
                if calc.get("s3") is not None:
                    s3_metric = Decimal(str(calc["s3"]))
                if calc.get("ci") is not None:
                    carbon_intensity = Decimal(str(calc["ci"]))
        except Exception:
            pass
    reduction_target  = report.reduction_target if report else None
    reduction_achieved= report.reduction_achieved if report else None

    # ── 6. 勋章 ─────────────────────────────────────────────────────────
    badge_r = await db.execute(
        select(UserBadge).where(UserBadge.user_id == user.id)
        .order_by(UserBadge.awarded_at.desc()).limit(10)
    )
    badges = list(badge_r.scalars().all())

    # ── 7. 最近 CBAM 报告列表 + GM 流水（时间轴唯一数据源）────────────────
    recent_reports: List[Dict] = []
    reports_raw_list: List[CBAMReport] = []
    if ws:
        rr = await db.execute(
            select(CBAMReport).where(CBAMReport.workspace_id == ws.id)
            .order_by(CBAMReport.created_at.desc()).limit(5)
        )
        reports_raw_list = list(rr.scalars().all())
        for r in reports_raw_list:
            recent_reports.append({
                "id"             : str(r.id),
                "reportingPeriod": r.reporting_period,
                "status"         : r.status.value,
                "tCO2eTotal"     : _dec(r.tco2e_total),
                "riskExposureEur": _dec(r.risk_exposure_eur),
                "submittedAt"    : _dt(r.submitted_at),
                "createdAt"      : _dt(r.created_at),
            })

    ledger_rows = await _fetch_gm_ledger_recent(user.id, db, 50)
    gm_ledger_ser = [_serialize_gm_ledger(g) for g in ledger_rows]
    regulation_reads = _build_regulation_reads(ledger_rows)
    milestones = _build_milestones(
        user, ws, report, reports_raw_list, supplier_nodes_raw, ledger_rows, badges
    )
    activity_timeline = _build_activity_timeline(gm_ledger_ser, recent_reports, user)

    # ── 8. 组装完整 AppState ─────────────────────────────────────────────
    display_name = user.name or user.email.split("@")[0]

    net_save_str: Optional[str] = None
    roi_ratio_str: Optional[str] = None
    if ws and risk_eur > 0 and roi_multiple and roi_multiple > 0:
        net_c = risk_eur * fx_for_roi - Decimal("58000")
        if net_c > 0:
            net_save_str = "¥" + str(int(net_c.quantize(Decimal("1"))))
            roi_ratio_str = f"1 : {float(roi_multiple):.1f}"

    # ── 碳信用城池四维（穿透/主权/代际/信任）────────────────────────────
    submitted_count = sum(
        1 for s in supplier_nodes_raw
        if s.status in (SupplierStatus.submitted, SupplierStatus.confirmed)
    )
    dq_vals = [
        float(s.data_quality_score)
        for s in supplier_nodes_raw
        if s.data_quality_score is not None and s.status in (SupplierStatus.submitted, SupplierStatus.confirmed)
    ]
    avg_dq = (sum(dq_vals) / len(dq_vals) / 100.0) if dq_vals else (0.65 if submitted_count else 0.0)
    data_years = 0.0
    if user.reg_date:
        try:
            data_years = max(0.0, (datetime.now(timezone.utc) - user.reg_date).days / 365.25)
        except Exception:
            data_years = 0.0
    reduction_pct = 0.0
    if report and report.reduction_achieved is not None and report.reduction_target:
        try:
            rt = float(report.reduction_target)
            ra = float(report.reduction_achieved)
            if rt > 0:
                reduction_pct = min(100.0, max(0.0, ra / rt * 100.0))
        except Exception:
            reduction_pct = 0.0
    generational_nodes = sum(
        1 for s in supplier_nodes_raw if s.invited_by_user_id == user.id
    )
    fortress_block = _build_fortress(
        supply_chain_cov=supply_chain_cov,
        submitted_count=submitted_count,
        generational_nodes=generational_nodes,
        gm_balance=gm_balance,
        tier_level=TIER_LEVEL_MAP.get(user.tier.value, 1),
        current_level=user.current_level or 1,
        is_complete=bool(ws and ws.is_complete),
        avg_data_quality=avg_dq,
        data_years=data_years,
        reduction_pct=reduction_pct,
    )

    workspace_role = _resolve_workspace_role(ws)
    cbam_template = "origin_attest" if workspace_role == "ROLE_ORIGIN" else "sme_claim"
    cbam_block: Dict[str, Any] = {
        "step": 4 if report else 1,
        "template": cbam_template,
        "templateLabel": "工业原厂 · 签发/确权模板" if workspace_role == "ROLE_ORIGIN" else "下游 SME · 认领测算模板",
        "identityMode": workspace_role,
    }
    if report and report.payload_json:
        try:
            pr = json.loads(report.payload_json)
            if isinstance(pr, dict):
                cbam_block["calcResult"] = pr
        except Exception:
            pass

    crusade_count = 0
    total_tax_penalty = Decimal("0")
    resonance_pending = 0
    resonance_block: Dict[str, Any] = {
        "penaltyMultiplier": float(RESONANCE_PENALTY_MULTIPLIER),
        "usingDefaultFactor": True,
        "verifiedOrigin": None,
        "pendingRequestsForIndustry": 0,
    }
    if ws:
        ind_code = _norm_resonance_industry(ws.industry_code)
        resonance_pending = await _count_pending_resonance(db, ind_code)
        pending_r = await db.execute(
            select(SupplierNode).where(
                SupplierNode.workspace_id == ws.id,
                SupplierNode.status == SupplierStatus.invited,
            )
        )
        pending_nodes = list(pending_r.scalars().all())
        crusade_count = resonance_pending + len(pending_nodes)
        verified_origin = await _latest_verified_origin_for_industry(db, ind_code)
        resonance_block = {
            "penaltyMultiplier": float(RESONANCE_PENALTY_MULTIPLIER),
            "usingDefaultFactor": verified_origin is None,
            "verifiedOrigin": verified_origin,
            "pendingRequestsForIndustry": resonance_pending,
            "industryCode": ind_code,
            "resonanceRequestsOnWorkspace": int(ws.resonance_requests or 0),
            "industryBoard": await _build_industry_board(db),
        }
        for node in pending_nodes:
            if node.tco2e_reported and node.tco2e_reported > 0:
                total_tax_penalty += node.tco2e_reported * CBAM_CARBON_PRICE_EUR
            else:
                total_tax_penalty += Decimal("12000")
        if total_tax_penalty > 0:
            total_tax_penalty = total_tax_penalty.quantize(Decimal("0.01"))

    company_out: Optional[Dict[str, Any]] = None
    sync_meta: Dict[str, Any] = _parse_workspace_meta(ws) if ws else {}
    sync_evidence: Dict[str, Any] = (
        dict(sync_meta.get("evidence")) if isinstance(sync_meta.get("evidence"), dict) else {}
    )
    evidence_mode = (
        str(sync_evidence.get("mode") or "").strip().upper()
        or _derive_evidence_mode_from_city_state(sync_meta.get("cityState"))
    )
    evidence_stage = sync_evidence.get("stage")
    if not evidence_stage:
        evidence_stage = _derive_evidence_stage_from_city_state(sync_meta.get("cityState"))
    trust_level = _normalize_trust_commitment_level(
        sync_evidence.get("trustCommitmentLevel") or sync_meta.get("trustCommitmentLevel")
    )
    honor_tier = _normalize_honor_eligibility_tier(
        sync_evidence.get("honorEligibilityTier") or sync_meta.get("honorEligibilityTier")
    ) or _resolve_honor_eligibility_tier(trust_level)
    evidence_history = sync_evidence.get("history") if isinstance(sync_evidence.get("history"), list) else []
    factor_auth_block: Dict[str, Any] = {}
    if ws:
        company_out = {
            "id"              : str(ws.id),
            "name"            : ws.name,
            "creditCode"      : ws.credit_code,
            "stage"           : ws.stage.value,
            "isComplete"      : ws.is_complete,
            "industryCode"    : ws.industry_code,
            "industryLabel"   : ws.industry_label,
            "industry"        : ws.industry_label or ws.industry_code,
            "type"            : "ORIGIN" if workspace_role == "ROLE_ORIGIN" else "SME",
            "countryCode"     : ws.country_code,
            "contactEmail"    : ws.contact_email,
            "annualRevenue"   : _dec(ws.annual_revenue),
            "employeeCount"   : ws.employee_count,
            "complianceLevel" : ws.compliance_level,
            "mainProduct"        : ws.main_product,
            "hsCode"             : ws.hs_code,
            "annualCapacityTons" : _dec(ws.annual_capacity_tons),
            "annualExportTons"   : _dec(ws.annual_export_tons),
            "exportCountries"    : ws.export_countries,
            "annualPowerKwh"     : _dec(ws.annual_power_kwh),
            "powerGrid"          : ws.power_grid,
            "regionTag"          : ws.region_tag,
            "region_tag"         : ws.region_tag,
            "riskExposureEur" : _dec(risk_eur),
            "declaredSupplierCount": ws.declared_supplier_count,
            "resonanceRequests": int(ws.resonance_requests or 0),
        }
        if ws.verified_factor is not None and ws.verified_factor > 0:
            company_out["verifiedFactor"] = _dec(ws.verified_factor)
            company_out["verified_factor"] = _dec(ws.verified_factor)
        if ws.verified_factor_cert_id:
            company_out["verifiedFactorCertId"] = ws.verified_factor_cert_id
            company_out["verified_factor_cert_id"] = ws.verified_factor_cert_id
        if ws.verification_code:
            company_out["verificationCode"] = ws.verification_code
            company_out["verification_code"] = ws.verification_code
        if ws.verified_factor_yoy_pct is not None:
            company_out["verifiedFactorYoyPct"] = _dec(ws.verified_factor_yoy_pct)
        claim_st = (ws.sovereignty_claim_status or "none").lower()
        company_out["sovereigntyClaimStatus"] = claim_st
        company_out["sovereignty_claim_status"] = claim_st
        if ws.sovereignty_claim_submitted_at:
            company_out["sovereigntyClaimSubmittedAt"] = _dt(ws.sovereignty_claim_submitted_at)
        if ws.sovereignty_auth_letter_filename:
            company_out["sovereigntyAuthLetterFilename"] = ws.sovereignty_auth_letter_filename
        if ws.sovereignty_claim_reviewer_note:
            company_out["sovereigntyClaimReviewerNote"] = ws.sovereignty_claim_reviewer_note
        if ws.sovereignty_claim_reviewed_at:
            company_out["sovereigntyClaimReviewedAt"] = _dt(ws.sovereignty_claim_reviewed_at)
        if ws.sovereignty_ai_prescreen_json:
            try:
                company_out["sovereigntyAiPrescreen"] = json.loads(ws.sovereignty_ai_prescreen_json)
            except Exception:
                pass
        if net_save_str:
            company_out["netSavings"] = net_save_str
        if roi_ratio_str:
            company_out["roiRatio"] = roi_ratio_str
        if ws.is_complete and risk_eur > 0:
            company_out["stageLabel"] = "CBAM 已测算"
            company_out["cbamRisk"] = f"€{int(risk_eur):,}"
        elif ws.is_complete:
            company_out["stageLabel"] = "档案已建档"
        elif ws.stage == WorkspaceStage.sandbox:
            company_out["stageLabel"] = "沙盒运行中"
        elif ws.stage == WorkspaceStage.certified:
            company_out["stageLabel"] = "企业官方金库"
        if sync_meta.get("cityState"):
            company_out["cityState"] = sync_meta.get("cityState")
            company_out["pullEligible"] = bool(sync_meta.get("pullEligible"))
        if sync_meta.get("displayCarbonIntensity") is not None:
            company_out["displayCarbonIntensity"] = sync_meta.get("displayCarbonIntensity")
        if sync_meta.get("lastSyncAt"):
            company_out["lastHubSyncAt"] = sync_meta.get("lastSyncAt")
        company_out["trustCommitmentLevel"] = trust_level
        company_out["honorEligibilityTier"] = honor_tier
        company_out["evidenceMode"] = evidence_mode
        if evidence_stage:
            company_out["evidenceStage"] = evidence_stage

    cbam_block["evidence"] = {
        "mode": evidence_mode,
        "stage": evidence_stage,
        "value": sync_evidence.get("value"),
        "unit": sync_evidence.get("unit") or "tCO2e/t",
        "industryCode": sync_evidence.get("industryCode") or sync_meta.get("industryId") or (ws.industry_code if ws else None),
        "dictVersion": sync_evidence.get("dictVersion"),
        "calcVersion": sync_evidence.get("calcVersion"),
        "updatedAt": sync_evidence.get("updatedAt") or sync_meta.get("lastSyncAt"),
        "verified": sync_evidence.get("verified") if isinstance(sync_evidence.get("verified"), dict) else {},
        "shadow": sync_evidence.get("shadow") if isinstance(sync_evidence.get("shadow"), dict) else {},
        "trustCommitmentLevel": trust_level,
        "honorEligibilityTier": honor_tier,
        "history": evidence_history,
    }

    if ws and (sync_meta.get("cityState") or sync_meta.get("lastSyncAt")):
        qt = sync_meta.get("qualityTag") or {}
        factor_auth_block = {
            "confirmedFactor": sync_meta.get("displayCarbonIntensity") or (
                float(ws.verified_factor) if ws.verified_factor is not None else None
            ),
            "confirmedIndustry": sync_meta.get("industryId") or ws.industry_code,
            "cityState": sync_meta.get("cityState"),
            "pullEligible": bool(sync_meta.get("pullEligible")),
            "certificateId": sync_meta.get("certificateId") or ws.verified_factor_cert_id,
            "hardwareSealed": bool(qt.get("matBoxLocked")),
            "lastSyncAt": sync_meta.get("lastSyncAt"),
            "fundingMode": sync_meta.get("fundingMode"),
            "trustCommitmentLevel": trust_level,
            "honorEligibilityTier": honor_tier,
        }

    dna = {
        # ── user 对象（地球公民轨）
        "user": {
            "id"             : str(user.id),
            "email"          : user.email,
            "name"           : display_name,
            "avatarUrl"      : user.avatar_url,
            "gmBalance"      : _gm_scalar(gm_balance),
            "generationalGm" : generational_f,
            "generational_gm": generational_f,
            "gmGenerational" : generational_f,
            "gm_generational": generational_f,
            "tier"           : user.tier.value,
            "tierLevel"      : TIER_LEVEL_MAP.get(user.tier.value, 1),
            "currentLevel"   : user.current_level,
            "tokensLeft"     : user.tokens_left,
            "tokensUsed"     : user.tokens_used,
            "totalCo2eSaved" : _dec(user.total_co2e_saved),
            "badgeCount"     : user.badge_count,
            "complianceScore": user.compliance_score,
            "regDate"        : _dt(user.reg_date) or _dt(user.created_at),
            "createdAt"      : _dt(user.created_at) or _dt(user.reg_date),
            "lastLoginAt"    : _dt(user.last_login_at),
            "isLoggedIn"     : True,
            "workspaceRole"  : workspace_role,
        },

        # ── company 对象（企业文明轨）
        "company": company_out,

        # ── metrics 对象（核心量化指标，驱动所有数字面板）
        "metrics": {
            "tCO2eTotal"          : _dec(tco2e_total),
            "globalRank"          : global_rank,
            "roiRatio"            : _dec(roi_ratio)
                if roi_ratio is not None and roi_ratio <= Decimal("1")
                else 0.0,
            "roiMultiple"         : _dec(roi_multiple) if roi_multiple is not None else 0.0,
            "taxSavingsWan"       : _dec(tax_savings_wan) if tax_savings_wan is not None else 0.0,
            "supplyChainCoverage" : _dec(supply_chain_cov) if supply_chain_cov is not None else 0.0,
            "scope3Coverage"      : _dec(scope3) if scope3 is not None else 0.0,
            "riskExposureEur"     : _dec(risk_eur) if risk_eur is not None else 0.0,
            "cbamTaxEstimate"     : _dec(cbam_tax) if cbam_tax is not None else 0.0,
            "scope1"              : _dec(s1_metric) if s1_metric is not None else 0.0,
            "scope2"              : _dec(s2_metric) if s2_metric is not None else 0.0,
            "scope3"              : _dec(s3_metric) if s3_metric is not None else 0.0,
            "reductionTarget"     : _dec(reduction_target),
            "reductionAchieved"   : _dec(reduction_achieved),
            "reductionProgress"   : _dec(
                (reduction_achieved / reduction_target).quantize(Decimal("0.0001"))
                if reduction_target and reduction_achieved and reduction_target > 0
                else None
            ),
            "energyTco2eSum"      : _dec(energy_tco2e) or 0.0,
            "supplierCount"       : len(supplier_nodes_raw),
            "supplierSubmitted"   : sum(
                1 for s in supplier_nodes_raw
                if s.status in (SupplierStatus.submitted, SupplierStatus.confirmed)
            ),
            "supplierSubmittedCount": sum(
                1 for s in supplier_nodes_raw
                if s.status in (SupplierStatus.submitted, SupplierStatus.confirmed)
            ),
            "supplierPendingCount": sum(
                1
                for s in supplier_nodes_raw
                if s.status == SupplierStatus.invited and (s.invite_code or "").strip()
            ),
            "supplierUninvitedCount": sum(
                1
                for s in supplier_nodes_raw
                if s.status == SupplierStatus.invited and not (s.invite_code or "").strip()
            ),
            "carbonIntensity"     : _dec(carbon_intensity) if carbon_intensity is not None else 0.0,
            "generationalGm"      : generational_f,
            "generational_gm"     : generational_f,
            "gm_generational"     : generational_f,
            "generationalNodesCount" : generational_nodes,
            "generational_nodes_count": generational_nodes,
            "crusadeCount": crusade_count,
            "crusade_count": crusade_count,
            "resonanceCount": resonance_pending if ws else 0,
            "resonance_count": resonance_pending if ws else 0,
            "totalTaxPenalty": _dec(total_tax_penalty) if total_tax_penalty > 0 else 0.0,
            "total_tax_penalty": _dec(total_tax_penalty) if total_tax_penalty > 0 else 0.0,
        },

        # ── 工业原厂战情室（脱敏指标 · 驱动 HeavyIndustry Suite）
        "industryAudit": {
            "crusadeCount": crusade_count,
            "totalTaxPenaltyEur": _dec(total_tax_penalty) if total_tax_penalty > 0 else 0.0,
            "hasVerifiedFactor": bool(ws and _workspace_pull_eligible(ws)),
            "verifiedFactor": _dec(ws.verified_factor)
            if ws and ws.verified_factor is not None
            else None,
            "verifiedFactorCertId": ws.verified_factor_cert_id if ws else None,
            "verificationCode": ws.verification_code if ws else None,
            "verifiedFactorYoyPct": _dec(ws.verified_factor_yoy_pct)
            if ws and ws.verified_factor_yoy_pct is not None
            else None,
        },

        # ── impact（CBAM 测算驱动 · 与 metrics 同步）
        "impact": {
            "riskExposureEur" : _dec(risk_eur),
            "carbonIntensity" : _dec(carbon_intensity),
            "scope1"          : _dec(s1_metric),
            "scope2"          : _dec(s2_metric),
            "scope3"          : _dec(s3_metric),
        },

        # ── flags 对象（阶段状态机 + 菜单权限白名单）
        "flags": {
            "currentPhase"     : phase,
            "phaseLabel"       : PHASE_LABELS[phase],
            "unlockedMenusList": MENU_UNLOCK_MAP[phase],
            "nextAction"       : _next_action(phase, ws, tco2e_total, len(supplier_nodes_raw)),
            "isPhase1"         : phase == "Phase1",
            "isPhase2"         : phase == "Phase2",
            "isPhase3"         : phase == "Phase3",
            "originAuditUnlocked": phase in ("Phase2", "Phase3") and workspace_role == "ROLE_ORIGIN",
            "hasOriginFactoryPerm": workspace_role == "ROLE_ORIGIN",
            "userRole": workspace_role,
            "lastSyncAt": sync_meta.get("lastSyncAt"),
        },

        # ── 碳信用城池（四维雷达 · 前端物理驱动）
        "fortress": fortress_block,

        # ── 列表数据
        "recentReports"  : recent_reports,
        "supplierNodes"  : [_serialize_supplier(s) for s in supplier_nodes_raw],
        "suppliers"      : [_serialize_supplier(s) for s in supplier_nodes_raw],
        "badges"         : [_serialize_badge(b) for b in badges],
        "gmLedger"       : gm_ledger_ser,
        "regulation"     : regulation_reads,
        "milestones"     : milestones,
        "activityTimeline": activity_timeline,
        "compute": {
            "tokensLeft" : user.tokens_left,
            "tokensUsed" : user.tokens_used,
            "lastSyncAt" : datetime.now(timezone.utc).isoformat(),
        },

        # ── 元信息
        "serverTime": datetime.now(timezone.utc).isoformat(),
        "schemaVersion": "3.1",
        "cbam": cbam_block,
        "gm_generational": generational_f,
        "resonance": resonance_block,
        "verified_origin_pool": await _build_verified_origin_pool(db),
    }
    if factor_auth_block:
        dna["factorAuth"] = factor_auth_block
    return normalize_app_state_for_frontend(dna)


def build_guest_app_state() -> Dict[str, Any]:
    """访客首屏合法 DNA（与前端 MOCK_STATE 对齐，避免无 Token 时 401）。"""
    phase = "Phase1"
    dna = {
        "user": {
            "name": "",
            "email": "",
            "tier": "Seed",
            "tier_code": "GUEST",
            "tierLevel": 0,
            "currentLevel": 1,
            "complianceScore": 0,
            "gmBalance": 0,
            "generationalGm": 0,
            "generational_gm": 0,
            "gmGenerational": 0,
            "gm_generational": 0,
            "tokensLeft": 0,
            "tokensUsed": 0,
            "totalCo2eSaved": "0",
            "badgeCount": 0,
            "regDate": None,
            "lastLoginAt": None,
            "isLoggedIn": False,
            "workspaceRole": "ROLE_GUEST",
        },
        "company": {
            "name": "",
            "stage": "Incomplete",
            "stageLabel": "待激活",
            "cbamRisk": "待测算",
        },
        "metrics": {
            "tCO2eTotal": None,
            "supplyChainCoverage": "0",
            "scope3Coverage": "0",
            "riskExposureEur": None,
            "supplierCount": 0,
            "supplierSubmitted": 0,
        },
        "flags": {
            "currentPhase": phase,
            "phaseLabel": PHASE_LABELS[phase],
            "unlockedMenusList": MENU_UNLOCK_MAP[phase],
            "isPhase1": True,
            "isPhase2": False,
            "isPhase3": False,
            "originAuditUnlocked": False,
            "hasOriginFactoryPerm": False,
            "userRole": "ROLE_GUEST",
            "hubOverviewReady": True,
        },
        "verified_origin_pool": [],
        "cbam": {
            "step": 1,
            "template": "sme_claim",
            "templateLabel": "下游 SME · 认领测算模板",
            "identityMode": "ROLE_GUEST",
        },
        "macro": {
            "cbam_current_price": 75.36,
            "eur_cny_rate": 7.85,
            "last_updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        },
        "auth": {"user": None, "token": None},
        "fortress": {
            "source": "server",
            "levelLabel": "地基",
            "avgScore": 0,
            "avgScoreNum": 0,
            "dims": [0, 0, 0, 0],
            "dimCoverage": "0%",
            "dimSovereignty": "0%",
            "dimNetwork": "0%",
            "dimTrust": "0%",
        },
        "recentReports": [],
        "supplierNodes": [],
        "badges": [],
        "gmLedger": [],
        "milestones": {
            "register": None,
            "proMember": None,
            "cbamCalc": None,
            "enterprise": None,
            "supply": None,
            "activation": None,
        },
        "activityTimeline": [],
        "compute": {"tokensLeft": 0, "tokensUsed": 0, "lastSyncAt": None},
        "serverTime": datetime.now(timezone.utc).isoformat(),
        "schemaVersion": "3.1",
        "_mode": "guest",
    }
    return normalize_app_state_for_frontend(dna)


# ─── FastAPI 路由 ─────────────────────────────────────────────────────────────

@router.get("/overview", summary="全域概览·唯一数据源 (AppState DNA)")
async def hub_overview(
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_current_user),
) -> Dict[str, Any]:
    if current_user is None:
        return build_guest_app_state()
    return await build_app_state(current_user, db)


async def _apply_hub_overview_sync(
    payload: HubSyncRequest,
    current_user: User,
    db: AsyncSession,
) -> HubSyncResponse:
    if payload.sync_tier not in ("L0", "L1"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_SYNC_TIER", "message": "syncTier 仅支持 L0 或 L1"},
        )

    ws = await _find_workspace_for_sync(
        db, current_user, payload.production_entity, payload.holder,
    )
    prev_meta = _parse_workspace_meta(ws)
    if (
        prev_meta.get("lastBatchId") == payload.batch_id
        and prev_meta.get("lastDataFingerprint") != payload.data_fingerprint
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "DUPLICATE_BATCH", "message": "同 batchId 数据指纹冲突"},
        )

    qt_dump = payload.quality_tag.model_dump(by_alias=True)
    city_state, pull_eligible = derive_city_state_and_pull(qt_dump)
    synced_at = datetime.now(timezone.utc).isoformat()
    cert_id = (payload.certificate_id or "").strip() or prev_meta.get("certificateId")
    funding_mode = payload.funding_mode or payload.quality_tag.funding_mode or prev_meta.get("fundingMode")
    ind_norm = _norm_resonance_industry(payload.industry_id)
    resonance_pending = await _count_pending_resonance(db, ind_norm) if ws else 0
    evidence_meta = _build_evidence_contract_meta(
        prev_meta,
        city_state=city_state,
        carbon_intensity=float(payload.carbon_intensity),
        industry_id=ind_norm,
        synced_at=synced_at,
        cert_id=cert_id,
        funding_mode=funding_mode,
        source=payload.source,
        sync_tier=payload.sync_tier,
        resonance_count=resonance_pending,
    )

    meta: Dict[str, Any] = {
        **prev_meta,
        "cityState": city_state,
        "pullEligible": pull_eligible,
        "holder": payload.holder.strip(),
        "industryId": ind_norm,
        "industryCode": ind_norm,
        "displayCarbonIntensity": float(payload.carbon_intensity),
        "carbonIntensity": float(payload.carbon_intensity),
        "certificateId": cert_id,
        "lastSyncAt": synced_at,
        "lastBatchId": payload.batch_id,
        "lastDataFingerprint": payload.data_fingerprint,
        "lastEncHash": payload.enc_hash,
        "syncTier": payload.sync_tier,
        "source": payload.source,
        "qualityTag": qt_dump,
        "fundingMode": funding_mode,
        "productionEntitySource": payload.production_entity_source,
        "enterpriseRegistryId": payload.enterprise_registry_id,
        "evidence": evidence_meta,
        "trustCommitmentLevel": evidence_meta.get("trustCommitmentLevel"),
        "honorEligibilityTier": evidence_meta.get("honorEligibilityTier"),
    }
    if payload.sync_tier == "L1":
        meta.update({
            "cnCode": payload.cn_code,
            "totalEmission": float(payload.total_emission) if payload.total_emission is not None else None,
            "productOutputT": float(payload.product_output_t) if payload.product_output_t is not None else None,
            "issuedAt": payload.issued_at,
            "dataFitReport": payload.data_fit_report.model_dump(by_alias=True) if payload.data_fit_report else None,
            "deviationSummary": payload.deviation_summary.model_dump(by_alias=True) if payload.deviation_summary else None,
        })

    if not (ws.industry_code or "").strip():
        ws.industry_code = ind_norm
    holder_norm = payload.holder.strip()
    if holder_norm:
        ws.name = holder_norm

    ws.verified_factor_meta_json = json.dumps(meta, ensure_ascii=False)
    if pull_eligible:
        ws.verified_factor = payload.carbon_intensity
        if cert_id:
            ws.verified_factor_cert_id = cert_id[:96]
            # verification_code 是批次核验短码（GTCID-YYYYMM-XX-L01），勿把长 CL-GTCID 整段写入
            if not (ws.verification_code or "").strip():
                ws.verification_code = await _new_verification_code(
                    db, ind_norm, meta.get("productionLine"),
                )
    elif cert_id and not (ws.verified_factor_cert_id or "").strip():
        # L0/L1 非 Pull 并网仅更新城池 meta；保留 industry-factor-attest 供应链因子
        ws.verified_factor_cert_id = cert_id[:96]

    gm_reward = Decimal(str(int(payload.gm_reward or 0)))
    gm_applied = Decimal("0")
    if gm_reward > 0:
        bal = await _sum_gm(current_user.id, db)
        gm_applied = gm_reward
        db.add(
            GMLedger(
                user_id=current_user.id,
                action=LedgerAction.earn,
                amount=gm_reward,
                balance_snap=bal + gm_reward,
                source_ref=f"hub_sync/{payload.batch_id}",
                memo="精算芯并网 GM",
            )
        )

    await db.commit()
    await db.refresh(ws)

    gm_balance = await _sum_gm(current_user.id, db)
    app_state = await build_app_state(current_user, db)
    message = _sync_response_message(city_state, pull_eligible)

    return HubSyncResponse(
        sync_tier=payload.sync_tier,
        city_state=city_state,
        pull_eligible=pull_eligible,
        gm_balance=gm_balance,
        gm_reward_applied=int(gm_applied),
        certificate_id=cert_id,
        holder=payload.holder.strip(),
        synced_at=synced_at,
        message=message,
        resonance=HubSyncResonanceInfo(
            industry_id=ind_norm,
            visible_to_bound_chain=True,
            visible_to_industry_board=True,
        ),
        app_state=app_state,
    )


@router.post(
    "/overview/sync",
    response_model=HubSyncResponse,
    summary="精算芯 L0/L1 并网 · 城池态派生（SYNC_CONTRACT_v2 · 工程/e2e）",
)
async def hub_overview_sync(
    payload: HubSyncRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> HubSyncResponse:
    return await _apply_hub_overview_sync(payload, current_user, db)


@router.post(
    "/evidence/redeem",
    response_model=EvidenceRedeemResponse,
    summary="精算芯兑换包入库（钥匙码/QR · 产品主路径）",
)
async def hub_evidence_redeem(
    payload: EvidenceRedeemRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EvidenceRedeemResponse:
    code = (payload.redeem_code or payload.qr_token or "").strip()
    if not code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_SIGNATURE", "message": "请提供 redeemCode 或 qrToken"},
        )

    ws = await _get_primary_workspace(current_user, db)
    if ws is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请先建立企业数字档案")

    pkg = _parse_redeem_package(code)
    redeem_id = str(pkg.get("redeemId") or pkg.get("redeem_id") or "").strip()
    expires_at = str(pkg.get("expiresAt") or pkg.get("expires_at") or "").strip()
    if expires_at:
        try:
            exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=timezone.utc)
            if exp_dt < datetime.now(timezone.utc):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"code": "EXPIRED_REDEEM", "message": "兑换码已过期"},
                )
        except HTTPException:
            raise
        except Exception:
            pass

    meta = _parse_workspace_meta(ws)
    used = meta.get("usedRedeemIds") if isinstance(meta.get("usedRedeemIds"), list) else []
    if redeem_id and redeem_id in used:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "ALREADY_REDEEMED", "message": "该兑换码已使用"},
        )

    sync_raw = pkg.get("sync")
    if not isinstance(sync_raw, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_SIGNATURE", "message": "兑换包缺少 sync 载荷"},
        )

    entity = str(
        sync_raw.get("productionEntity")
        or sync_raw.get("production_entity")
        or ""
    ).strip()
    credit = (ws.credit_code or "").strip()
    if entity and credit and entity != credit:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "ENTITY_MISMATCH", "message": "兑换包主体与当前企业不匹配"},
        )

    try:
        sync_req = HubSyncRequest.model_validate(sync_raw)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_SIGNATURE", "message": f"sync 载荷无效: {exc}"},
        ) from exc

    sync_resp = await _apply_hub_overview_sync(sync_req, current_user, db)

    meta = _parse_workspace_meta(ws)
    used = meta.get("usedRedeemIds") if isinstance(meta.get("usedRedeemIds"), list) else []
    if redeem_id:
        used = list(dict.fromkeys(used + [redeem_id]))
    meta["usedRedeemIds"] = used
    meta["lastRedeemAt"] = datetime.now(timezone.utc).isoformat()
    meta["lastRedeemId"] = redeem_id or None
    _save_workspace_meta(ws, meta)
    bal = await _sum_gm(current_user.id, db)
    db.add(
        GMLedger(
            user_id=current_user.id,
            action=LedgerAction.earn,
            amount=Decimal("0"),
            balance_snap=bal,
            source_ref=f"evidence_redeem/{redeem_id or 'unknown'}",
            memo="CORE_EVIDENCE_REDEEMED",
        )
    )
    await db.commit()

    app_state = await build_app_state(current_user, db)
    return EvidenceRedeemResponse(
        success=True,
        city_state=sync_resp.city_state,
        pull_eligible=sync_resp.pull_eligible,
        certificate_id=sync_resp.certificate_id,
        message="精算芯实证包已兑换入库 · " + sync_resp.message,
        app_state=jsonable_encoder(app_state),
    )


@router.get(
    "/evidence/redeem/history",
    summary="本 Workspace 兑换记录（管理员可读）",
)
async def hub_evidence_redeem_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    ws = await _get_primary_workspace(current_user, db)
    if ws is None:
        return {"history": []}
    meta = _parse_workspace_meta(ws)
    used = meta.get("usedRedeemIds") if isinstance(meta.get("usedRedeemIds"), list) else []
    return {
        "history": [
            {
                "redeemId": rid,
                "redeemedAt": meta.get("lastRedeemAt") if rid == meta.get("lastRedeemId") else None,
            }
            for rid in used
        ],
        "lastRedeemAt": meta.get("lastRedeemAt"),
        "lastRedeemId": meta.get("lastRedeemId"),
    }


@router.post(
    "/resonance/trigger",
    response_model=ResonanceTriggerStatus,
    summary="实名举力 +1（SYNC §6 · 无资金归集）",
)
async def hub_resonance_trigger(
    payload: ResonanceTriggerSubmit,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ResonanceTriggerStatus:
    ws = await _get_primary_workspace(current_user, db)
    if ws is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请先建立企业数字档案后再参与共振",
        )
    entity = (payload.production_entity or "").strip().upper()
    if not entity:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_ENTITY", "message": "productionEntity 不能为空"},
        )
    pool = await _get_or_create_trigger_pool(db, entity, payload.holder)
    if pool.status in ("fulfilled", "rejected", "expired"):
        return _trigger_status_payload(
            pool,
            message=f"该原厂共振池状态为 {pool.status}，不再接受新的举力",
        )

    parts = _parse_trigger_participants(pool.participants_json)
    uid = str(current_user.id)
    wid = str(ws.id)
    already = any(
        str(p.get("userId") or p.get("user_id") or "") == uid
        or str(p.get("workspaceId") or p.get("workspace_id") or "") == wid
        for p in parts
    )
    if already:
        return _trigger_status_payload(
            pool,
            already=True,
            message="您已参与该原厂共振，不重复计次",
        )

    parts.append({
        "userId": uid,
        "workspaceId": wid,
        "holder": (ws.name or "").strip() or None,
        "message": (payload.message or "").strip() or None,
        "at": datetime.now(timezone.utc).isoformat(),
    })
    pool.participants_json = json.dumps(parts, ensure_ascii=False)
    pool.current_count = len(parts)
    if payload.holder and payload.holder.strip():
        pool.holder = payload.holder.strip()
    if pool.current_count >= int(pool.target_count or 30):
        msg = (
            f"举力已达阈值 {pool.current_count}/{pool.target_count}。"
            "可调用 fulfill 开启原厂实证入口（无资金归集）。"
        )
    else:
        msg = (
            f"举力已记录 {pool.current_count}/{pool.target_count}。"
            "请勿急，产业链正在推动该原厂进入实证。"
        )
    await db.commit()
    await db.refresh(pool)
    return _trigger_status_payload(pool, message=msg)


@router.get(
    "/resonance/trigger",
    response_model=ResonanceTriggerStatus,
    summary="查询实名举力阈值进度（SYNC §6）",
)
async def hub_resonance_trigger_get(
    productionEntity: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ResonanceTriggerStatus:
    entity = (productionEntity or "").strip().upper()
    if not entity:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_ENTITY", "message": "productionEntity 不能为空"},
        )
    r = await db.execute(
        select(ResonanceTriggerPool).where(ResonanceTriggerPool.production_entity == entity).limit(1)
    )
    pool = r.scalar_one_or_none()
    if pool is None:
        return ResonanceTriggerStatus(
            production_entity=entity,
            holder="",
            target_count=_resonance_trigger_target(),
            current_count=0,
            participant_count=0,
            status="collecting",
            funding_mode="resonance_triggered",
            message="尚未有举力记录",
        )
    ws = await _get_primary_workspace(current_user, db)
    already = False
    if ws is not None:
        parts = _parse_trigger_participants(pool.participants_json)
        uid, wid = str(current_user.id), str(ws.id)
        already = any(
            str(p.get("userId") or "") == uid or str(p.get("workspaceId") or "") == wid
            for p in parts
        )
    return _trigger_status_payload(pool, already=already, message="ok")


@router.post(
    "/resonance/trigger/fulfill",
    response_model=ResonanceTriggerStatus,
    summary="达阈后开启原厂实证入口（SYNC §6 · 非资金归集）",
)
async def hub_resonance_trigger_fulfill(
    payload: ResonanceTriggerFulfillRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ResonanceTriggerStatus:
    entity = (payload.production_entity or "").strip().upper()
    pool = await _get_or_create_trigger_pool(db, entity, payload.holder or "")
    if pool.status == "fulfilled":
        return _trigger_status_payload(pool, message="已履行：原厂实证入口此前已开启")
    if int(pool.current_count or 0) < int(pool.target_count or 30):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "THRESHOLD_NOT_MET",
                "message": f"未达阈值 {pool.current_count}/{pool.target_count}",
            },
        )
    pool.status = "fulfilled"
    pool.fulfilled_at = datetime.now(timezone.utc)
    if payload.holder and payload.holder.strip():
        pool.holder = payload.holder.strip()

    r = await db.execute(
        select(Workspace).where(func.upper(Workspace.credit_code) == entity).limit(1)
    )
    origin_ws = r.scalar_one_or_none()
    if origin_ws is not None:
        meta = _parse_workspace_meta(origin_ws)
        meta["fundingMode"] = "resonance_triggered"
        meta["resonanceTriggerFulfilledAt"] = pool.fulfilled_at.isoformat()
        meta["resonanceTriggerCount"] = int(pool.current_count or 0)
        meta["resonanceTriggerTarget"] = int(pool.target_count or 30)
        _save_workspace_meta(origin_ws, meta)

    await db.commit()
    await db.refresh(pool)
    return _trigger_status_payload(
        pool,
        message=(
            "阈值已履行：原厂实证入口已开启（fundingMode=resonance_triggered）。"
            "无资金归集；后续由原厂自购精算或供应商选购 CL-MAT 终端推进。"
        ),
    )


WORKSPACE_PROFILE_GM_REWARD: Decimal = Decimal("50")
INDUSTRY_FACTOR_ATTEST_GM: Decimal = Decimal("120")
INDUSTRY_ORIGIN_BADGE_CODE = "CL-ORIGIN-PIONEER"
INDUSTRY_ORIGIN_BADGE_NAME = "CL-Origin 绿色出海先行者"
WORKSPACE_AMEND_GM: Decimal = Decimal("3")
CBAM_REPORT_SAVE_GM: Decimal = Decimal("28")
SUPPLIER_INVITE_GM: Decimal = Decimal("20")
DECISION_PACKAGE_GM: Decimal = Decimal("15")
DLD_APPLY_GM: Decimal = Decimal("5")
REGULATION_READ_GM: Decimal = Decimal("15")


async def _get_primary_workspace(user: User, db: AsyncSession) -> Optional[Workspace]:
    ws_result = await db.execute(
        select(Workspace)
        .join(Workspace.members)
        .where(User.id == user.id)
        .order_by(Workspace.created_at.asc())
        .limit(1)
    )
    return ws_result.scalar_one_or_none()


@router.post(
    "/workspace-update",
    response_model=WorkspaceUpdateResponse,
    summary="企业数字档案落库（首次完成 +50 GM）",
)
async def workspace_update(
    payload: WorkspaceUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceUpdateResponse:
    """
    接收并保存『企业数字档案』。
    - 首次填写完整信用代码时：自动从 incomplete → sandbox 跃迁，并奖励 +50 GM。
    - 未关联任何 Workspace 的用户会被即时创建一份归属空间。
    """
    ws_result = await db.execute(
        select(Workspace)
        .join(Workspace.members)
        .where(User.id == current_user.id)
        .order_by(Workspace.created_at.asc())
        .limit(1)
    )
    workspace: Optional[Workspace] = ws_result.scalar_one_or_none()

    new_name = str(payload.name or "").strip()
    new_code = str(payload.credit_code or "").strip().upper()
    new_industry = str(payload.industry_code or "").strip().lower() or None
    if not new_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="企业名称不能为空",
        )

    if new_code:
        dup_q = select(Workspace.id).where(Workspace.credit_code == new_code)
        if workspace is not None:
            dup_q = dup_q.where(Workspace.id != workspace.id)
        dup_result = await db.execute(dup_q)
        if dup_result.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="该统一社会信用代码已被其他企业占用",
            )

    if workspace is None:
        workspace = Workspace(
            name=new_name,
            credit_code=new_code or None,
            industry_code=new_industry,
            stage=WorkspaceStage.incomplete,
            is_complete=False,
        )
        workspace.members.append(current_user)
        db.add(workspace)
        await db.flush()

    prev_snapshot: Optional[Dict[str, Any]] = None
    if workspace is not None:
        prev_snapshot = {
            "name": workspace.name,
            "credit_code": (workspace.credit_code or "").strip(),
            "industry_code": workspace.industry_code,
            "main_product": workspace.main_product,
            "hs_code": workspace.hs_code,
            "annual_capacity_tons": workspace.annual_capacity_tons,
            "annual_export_tons": workspace.annual_export_tons,
            "export_countries": workspace.export_countries,
            "annual_power_kwh": workspace.annual_power_kwh,
            "power_grid": workspace.power_grid,
            "contact_email": workspace.contact_email,
            "region_tag": workspace.region_tag,
        }

    _cc = (workspace.credit_code or "").strip()
    was_empty_credit = not bool(_cc) or _cc.upper().startswith("TEMP-")
    workspace.name = new_name
    workspace.industry_code = new_industry
    workspace.credit_code = new_code or None

    # —— V3.2 企业档案完整字段落库（None 即跳过，不覆盖已有值） ——
    def _str_or_none(v):
        if v is None:
            return None
        s = str(v).strip()
        return s if s else None

    if payload.main_product is not None:
        workspace.main_product = _str_or_none(payload.main_product)
    if payload.hs_code is not None:
        workspace.hs_code = _str_or_none(payload.hs_code)
    if payload.annual_capacity_tons is not None:
        workspace.annual_capacity_tons = payload.annual_capacity_tons
    if payload.annual_export_tons is not None:
        workspace.annual_export_tons = payload.annual_export_tons
    if payload.export_countries is not None:
        workspace.export_countries = _str_or_none(payload.export_countries)
    if payload.annual_power_kwh is not None:
        workspace.annual_power_kwh = payload.annual_power_kwh
    if payload.power_grid is not None:
        workspace.power_grid = _str_or_none(payload.power_grid)
    if payload.contact_email is not None:
        workspace.contact_email = _str_or_none(payload.contact_email)
    if payload.region_tag is not None:
        workspace.region_tag = _str_or_none(payload.region_tag)

    gm_earned = Decimal("0")
    if was_empty_credit and new_code:
        workspace.is_complete = True
        if workspace.stage == WorkspaceStage.incomplete:
            workspace.stage = WorkspaceStage.sandbox
        current_balance = await _sum_gm(current_user.id, db)
        gm_earned = WORKSPACE_PROFILE_GM_REWARD
        db.add(
            GMLedger(
                user_id=current_user.id,
                action=LedgerAction.earn,
                amount=gm_earned,
                balance_snap=current_balance + gm_earned,
                source_ref=f"workspace_update/{workspace.id}",
                memo="完成企业数字档案录入，+50 GM",
            )
        )

    if gm_earned == Decimal("0") and prev_snapshot is not None:
        post_snap = {
            "name": workspace.name,
            "credit_code": (workspace.credit_code or "").strip(),
            "industry_code": workspace.industry_code,
            "main_product": workspace.main_product,
            "hs_code": workspace.hs_code,
            "annual_capacity_tons": workspace.annual_capacity_tons,
            "annual_export_tons": workspace.annual_export_tons,
            "export_countries": workspace.export_countries,
            "annual_power_kwh": workspace.annual_power_kwh,
            "power_grid": workspace.power_grid,
            "contact_email": workspace.contact_email,
            "region_tag": workspace.region_tag,
        }

        def _norm_val(v: Any) -> Any:
            if isinstance(v, Decimal):
                return str(v.quantize(Decimal("0.0001")))
            if v is None:
                return None
            return v

        def _freeze(d: Dict[str, Any]) -> Dict[str, Any]:
            return {k: _norm_val(d.get(k)) for k in prev_snapshot.keys()}

        if _freeze(post_snap) != _freeze(prev_snapshot):
            bal0 = await _sum_gm(current_user.id, db)
            amend = WORKSPACE_AMEND_GM
            db.add(
                GMLedger(
                    user_id=current_user.id,
                    action=LedgerAction.earn,
                    amount=amend,
                    balance_snap=bal0 + amend,
                    source_ref=f"workspace_amend/{workspace.id}",
                    memo="企业数字档案更新 · GM 奖励",
                )
            )
            gm_earned = amend

    db.add(workspace)
    await db.commit()
    await db.refresh(workspace)

    usr_row = await db.execute(select(User).where(User.id == current_user.id))
    fresh_user = usr_row.scalar_one()
    dna = await build_app_state(fresh_user, db)

    return WorkspaceUpdateResponse(
        workspace_id=workspace.id,
        is_complete=workspace.is_complete,
        stage=WorkspaceStageSchema(workspace.stage.value),
        gm_earned=gm_earned,
        message="企业数字档案已存入底座",
        app_state=jsonable_encoder(dna),
    )


# ─── 主权认领 · 授权书上传与人工审核 ─────────────────────────────────────────

SOVEREIGNTY_UPLOAD_DIR = Path(__file__).resolve().parent / "data" / "sovereignty"
SOVEREIGNTY_MAX_BYTES = 10 * 1024 * 1024
SOVEREIGNTY_ALLOWED_MIME = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/jpg",
}


def _sovereignty_reviewer_emails() -> set[str]:
    raw = os.environ.get("HENGAI_SOVEREIGNTY_REVIEW_EMAILS", "").strip()
    if not raw:
        return set()
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def _is_sovereignty_reviewer(user: User) -> bool:
    allowed = _sovereignty_reviewer_emails()
    if allowed and (user.email or "").lower() in allowed:
        return True
    return user.tier == UserTier.sovereign


def _parse_ai_prescreen(raw: Optional[str]) -> Optional[Dict[str, Any]]:
    if not raw:
        return None
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else None
    except Exception:
        return None


async def _run_sovereignty_ai_prescreen(
    file_bytes: bytes,
    content_type: str,
    company_name: str = "",
    credit_code: str = "",
) -> Optional[Dict[str, Any]]:
    """可选 AI 预审：比对表单企业信息与扫描件要素，绝不自动通过。"""
    base_flags: List[str] = []
    if not (os.environ.get("VISION_API_KEY") or os.environ.get("OPENAI_API_KEY") or "").strip():
        base_flags.append("未配置视觉 API")
    if not content_type.startswith("image/"):
        base_flags.append("PDF 需人工审阅原件")
    if base_flags and not content_type.startswith("image/"):
        return {
            "available": False,
            "isLikelyAuthLetter": None,
            "nameMatch": None,
            "creditMatch": None,
            "hasSeal": None,
            "confidence": 0.0,
            "flags": base_flags,
            "note": "PDF/非图片格式须 HEGC 人工审核原件",
            "reviewRequired": True,
        }

    api_key = (os.environ.get("VISION_API_KEY") or os.environ.get("OPENAI_API_KEY") or "").strip()
    if not api_key:
        return {
            "available": False,
            "isLikelyAuthLetter": None,
            "nameMatch": None,
            "creditMatch": None,
            "hasSeal": None,
            "confidence": 0.0,
            "flags": ["未启用视觉预审"],
            "note": "需人工审核",
            "reviewRequired": True,
        }
    try:
        import asyncio
        import base64
        from openai import AsyncOpenAI

        fmt = "jpeg" if "jpeg" in content_type or "jpg" in content_type else "png"
        b64 = base64.b64encode(file_bytes).decode("utf-8")
        data_url = f"data:image/{fmt};base64,{b64}"
        client = AsyncOpenAI(api_key=api_key)
        prompt = (
            "你是 HengAI 企业合规文件预审助手。用户提交了主权授权书扫描件。"
            f"表单登记企业名称：{company_name or '（未提供）'}；"
            f"统一社会信用代码：{credit_code or '（未提供）'}。"
            "请识别图像并严格返回 JSON（字段缺一不可）："
            '{"isLikelyAuthLetter":bool,"nameMatch":bool,"creditMatch":bool,'
            '"hasSeal":bool,"confidence":0-1,"flags":["..."],"note":"..."}'
            "规则："
            "1) isLikelyAuthLetter：是否像正式授权书/委托书扫描件；"
            "2) nameMatch：可见企业名称是否与表单一致或高度相似；"
            "3) creditMatch：是否可见与表单一致的18位信用代码；"
            "4) hasSeal：是否有公章或清晰签章；"
            "5) 任意关键项为 false 时 flags 须说明原因；"
            "6) 仅辅助人工审核，不得给出通过结论。"
        )
        completion = await asyncio.wait_for(
            client.chat.completions.create(
                model=os.getenv("VISION_MODEL", "gpt-4o"),
                response_format={"type": "json_object"},
                temperature=0,
                messages=[
                    {"role": "system", "content": prompt},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "请预审该授权书扫描件并与表单信息比对。"},
                            {"type": "image_url", "image_url": {"url": data_url}},
                        ],
                    },
                ],
            ),
            timeout=35,
        )
        payload = json.loads((completion.choices[0].message.content or "{}").strip() or "{}")
        payload["available"] = True
        payload["submittedCompanyName"] = company_name
        payload["submittedCreditCode"] = credit_code
        payload["reviewRequired"] = True
        if not payload.get("nameMatch") or not payload.get("creditMatch") or not payload.get("hasSeal"):
            flags = list(payload.get("flags") or [])
            if not payload.get("nameMatch"):
                flags.append("企业名称与表单不一致或不可辨认")
            if not payload.get("creditMatch"):
                flags.append("信用代码与表单不一致或不可辨认")
            if not payload.get("hasSeal"):
                flags.append("未见清晰公章/签章")
            payload["flags"] = flags
            payload["note"] = "存在要素不一致或缺失 · 须人工复核 · " + str(
                payload.get("note") or ""
            )
        else:
            payload["note"] = "要素初步匹配 · 仍须 HEGC 人工审核盖章原件 · " + str(
                payload.get("note") or ""
            )
        return payload
    except Exception as exc:
        logger.warning("sovereignty AI prescreen failed: %r", exc)
        return {
            "available": False,
            "isLikelyAuthLetter": None,
            "nameMatch": None,
            "creditMatch": None,
            "hasSeal": None,
            "confidence": 0.0,
            "flags": ["AI 预审暂不可用"],
            "note": "需人工审核",
            "reviewRequired": True,
        }


@router.get(
    "/sovereignty-claim/template",
    summary="下载《主权授权书》正式范本（Word/HTML）",
)
async def sovereignty_claim_template(
    name: Optional[str] = None,
    credit_code: Optional[str] = None,
    format: str = "doc",
) -> Response:
    """format=doc → Word 可打开的 .doc（HTML）；format=html → 浏览器预览。"""
    body = build_sovereignty_letter_html(name or "", credit_code or "")
    fmt = (format or "doc").strip().lower()
    if fmt == "html":
        return HTMLResponse(content=body, media_type="text/html; charset=utf-8")
    filename = "CL-COP-sovereignty-auth-letter.doc"
    return Response(
        content=body.encode("utf-8"),
        media_type="application/msword; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@router.post(
    "/sovereignty-claim-submit",
    response_model=SovereigntyClaimSubmitResponse,
    summary="提交主权认领（含授权书真实上传）",
)
async def sovereignty_claim_submit(
    name: str = Form(...),
    credit_code: str = Form(...),
    industry_code: Optional[str] = Form(None),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SovereigntyClaimSubmitResponse:
    new_name = str(name or "").strip()
    new_code = str(credit_code or "").strip().upper()
    if not new_name:
        raise HTTPException(status_code=400, detail="企业名称不能为空")
    if len(new_code) < 15:
        raise HTTPException(status_code=400, detail="请输入有效的 18 位统一社会信用代码")

    ctype = (file.content_type or "").lower()
    if ctype not in SOVEREIGNTY_ALLOWED_MIME:
        raise HTTPException(status_code=400, detail="仅支持 PDF、JPG、PNG 格式")

    try:
        file_bytes = await file.read()
    finally:
        await file.close()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="上传文件为空")
    if len(file_bytes) > SOVEREIGNTY_MAX_BYTES:
        raise HTTPException(status_code=400, detail="文件过大，最大 10MB")

    workspace = await _get_primary_workspace(current_user, db)
    if workspace is None:
        workspace = Workspace(
            name=new_name,
            credit_code=new_code,
            industry_code=(industry_code or "steel").strip().lower() or None,
            stage=WorkspaceStage.incomplete,
            is_complete=False,
            sovereignty_claim_status="none",
        )
        workspace.members.append(current_user)
        db.add(workspace)
        await db.flush()
    else:
        st = (workspace.sovereignty_claim_status or "none").lower()
        if st == "pending":
            raise HTTPException(status_code=409, detail="已有认领申请审核中，请等待人工审核结果")
        dup_q = select(Workspace.id).where(
            Workspace.credit_code == new_code,
            Workspace.id != workspace.id,
        )
        if (await db.execute(dup_q)).scalar_one_or_none() is not None:
            raise HTTPException(status_code=409, detail="该统一社会信用代码已被其他企业占用")

    ext = ".pdf" if "pdf" in ctype else (".jpg" if "jpeg" in ctype or "jpg" in ctype else ".png")
    SOVEREIGNTY_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    ws_dir = SOVEREIGNTY_UPLOAD_DIR / str(workspace.id)
    ws_dir.mkdir(parents=True, exist_ok=True)
    fname = f"{uuid.uuid4().hex}{ext}"
    fpath = ws_dir / fname
    fpath.write_bytes(file_bytes)

    ai_prescreen = await _run_sovereignty_ai_prescreen(file_bytes, ctype, new_name, new_code)
    now = datetime.now(timezone.utc)

    workspace.name = new_name
    workspace.credit_code = new_code
    if industry_code:
        workspace.industry_code = industry_code.strip().lower()
    workspace.is_complete = True
    if workspace.stage == WorkspaceStage.incomplete:
        workspace.stage = WorkspaceStage.sandbox
    workspace.sovereignty_claim_status = "pending"
    workspace.sovereignty_claim_submitted_at = now
    workspace.sovereignty_auth_letter_path = str(fpath.relative_to(SOVEREIGNTY_UPLOAD_DIR.parent.parent))
    workspace.sovereignty_auth_letter_filename = (file.filename or fname)[:256]
    workspace.sovereignty_auth_letter_mime = ctype
    workspace.sovereignty_claim_reviewer_note = None
    workspace.sovereignty_claim_reviewed_at = None
    if ai_prescreen:
        workspace.sovereignty_ai_prescreen_json = json.dumps(ai_prescreen, ensure_ascii=False)

    db.add(workspace)
    await db.commit()
    await db.refresh(workspace)

    usr_row = await db.execute(select(User).where(User.id == current_user.id))
    fresh_user = usr_row.scalar_one()
    dna = await build_app_state(fresh_user, db)

    return SovereigntyClaimSubmitResponse(
        workspace_id=workspace.id,
        sovereignty_claim_status="pending",
        message="主权认领已提交，授权书已存证。请等待 HEGC 合规专员人工审核（通常 1–3 个工作日）。",
        app_state=jsonable_encoder(dna),
    )


@router.get(
    "/sovereignty-claim/document",
    summary="下载已上传的主权授权书（仅本企业成员）",
)
async def sovereignty_claim_document(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    workspace = await _get_primary_workspace(current_user, db)
    if workspace is None or not workspace.sovereignty_auth_letter_path:
        raise HTTPException(status_code=404, detail="尚未上传授权书")
    base = Path(__file__).resolve().parent
    fpath = base / workspace.sovereignty_auth_letter_path
    if not fpath.is_file():
        raise HTTPException(status_code=404, detail="授权书文件不存在")
    return FileResponse(
        path=str(fpath),
        media_type=workspace.sovereignty_auth_letter_mime or "application/octet-stream",
        filename=workspace.sovereignty_auth_letter_filename or "sovereignty-auth-letter",
    )


@router.get(
    "/sovereignty-claims/pending",
    response_model=SovereigntyClaimPendingListResponse,
    summary="待审核主权认领列表（审核员）",
)
async def sovereignty_claims_pending(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SovereigntyClaimPendingListResponse:
    if not _is_sovereignty_reviewer(current_user):
        raise HTTPException(status_code=403, detail="无权访问审核队列")
    rows = await db.execute(
        select(Workspace)
        .where(Workspace.sovereignty_claim_status == "pending")
        .order_by(Workspace.sovereignty_claim_submitted_at.asc())
    )
    items: List[SovereigntyClaimPendingItem] = []
    for ws in rows.scalars().all():
        items.append(
            SovereigntyClaimPendingItem(
                workspace_id=ws.id,
                company_name=ws.name,
                credit_code=ws.credit_code,
                submitted_at=_dt(ws.sovereignty_claim_submitted_at),
                auth_letter_filename=ws.sovereignty_auth_letter_filename,
                ai_prescreen=_parse_ai_prescreen(ws.sovereignty_ai_prescreen_json),
            )
        )
    return SovereigntyClaimPendingListResponse(items=items, total=len(items))


@router.post(
    "/sovereignty-claims/{workspace_id}/review",
    response_model=SovereigntyClaimReviewResponse,
    summary="人工审核主权认领（通过/驳回）",
)
async def sovereignty_claim_review(
    workspace_id: uuid.UUID,
    payload: SovereigntyClaimReviewRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SovereigntyClaimReviewResponse:
    if not _is_sovereignty_reviewer(current_user):
        raise HTTPException(status_code=403, detail="无权执行审核")
    action = (payload.action or "").strip().lower()
    if action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="action 须为 approve 或 reject")

    ws_result = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    workspace = ws_result.scalar_one_or_none()
    if workspace is None:
        raise HTTPException(status_code=404, detail="企业空间不存在")
    if (workspace.sovereignty_claim_status or "").lower() != "pending":
        raise HTTPException(status_code=409, detail="该认领不在待审核状态")

    now = datetime.now(timezone.utc)
    note = (payload.note or "").strip()[:2000] or None
    if action == "approve":
        workspace.sovereignty_claim_status = "approved"
        workspace.sovereignty_claim_reviewer_note = note or "人工审核通过"
        if workspace.stage == WorkspaceStage.sandbox:
            workspace.stage = WorkspaceStage.certified
    else:
        workspace.sovereignty_claim_status = "rejected"
        workspace.sovereignty_claim_reviewer_note = note or "授权书不符合要求，请重新上传盖章扫描件"
    workspace.sovereignty_claim_reviewed_at = now

    db.add(workspace)
    await db.commit()
    await db.refresh(workspace)

    msg = "主权认领已通过审核" if action == "approve" else "主权认领已驳回，请通知企业重新提交"
    return SovereigntyClaimReviewResponse(
        workspace_id=workspace.id,
        sovereignty_claim_status=workspace.sovereignty_claim_status,
        message=msg,
        app_state=None,
    )


async def _new_verified_factor_cert_id(db: AsyncSession) -> str:
    for _ in range(24):
        suffix = "".join(secrets.choice(_INVITE_CODE_ALPHABET) for _ in range(4))
        cert = f"CL-COP-{suffix}"
        exists = await db.execute(
            select(Workspace.id).where(Workspace.verified_factor_cert_id == cert).limit(1)
        )
        if exists.scalar_one_or_none() is None:
            return cert
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="确权编号生成失败，请重试",
    )


def _industry_gtci_tag(industry_code: Optional[str]) -> str:
    ind = _norm_resonance_industry(industry_code)
    return {
        "steel": "ST",
        "aluminum": "AL",
        "cement": "CE",
        "petro": "PE",
        "paper": "PA",
        "ceramic": "CR",
        "port": "PO",
        "idc": "DC",
    }.get(ind, "GN")


def _normalize_production_line(raw: Optional[str]) -> str:
    s = (raw or "L01").strip().upper().replace(" ", "")
    if not s:
        s = "L01"
    if s.startswith("L"):
        tail = s[1:].replace("-", "")
        if tail.isdigit():
            return "L" + tail.zfill(2)
        return s
    if s.isdigit():
        return "L" + s.zfill(2)
    return "L" + s[:4]


async def _new_verification_code(
    db: AsyncSession,
    industry_code: Optional[str],
    production_line: Optional[str],
) -> str:
    ym = datetime.now(timezone.utc).strftime("%Y%m")
    tag = _industry_gtci_tag(industry_code)
    line = _normalize_production_line(production_line)
    base_prefix = f"GTCID-{ym}-{tag}-"
    line_num = 1
    if line.startswith("L") and line[1:].replace("-", "").isdigit():
        line_num = max(1, int(line[1:].replace("-", "")))
    for attempt in range(99):
        candidate = f"{base_prefix}L{line_num + attempt:02d}"
        exists = await db.execute(
            select(Workspace.id).where(Workspace.verification_code == candidate).limit(1)
        )
        if exists.scalar_one_or_none() is None:
            return candidate
    import secrets
    for _ in range(48):
        candidate = f"{base_prefix}{line}{secrets.token_hex(2).upper()}"
        exists = await db.execute(
            select(Workspace.id).where(Workspace.verification_code == candidate).limit(1)
        )
        if exists.scalar_one_or_none() is None:
            return candidate
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="核验码生成失败，请重试",
    )


def _workspace_to_pool_entry(ws: Workspace) -> VerifiedFactorPoolEntry:
    meta = _parse_workspace_meta(ws)
    return VerifiedFactorPoolEntry(
        workspace_id=ws.id,
        origin_name=ws.name,
        credit_code=ws.credit_code,
        industry_code=ws.industry_code or meta.get("industryCode"),
        carbon_intensity=ws.verified_factor or Decimal("0"),
        intensity_unit=str(meta.get("intensityUnit") or meta.get("intensity_unit") or "tCO2e/t"),
        cert_id=ws.verified_factor_cert_id or "",
        verification_code=ws.verification_code or meta.get("verificationCode"),
        product_label=meta.get("productLabel"),
        attested_at=meta.get("attestedAt"),
        production_line=meta.get("productionLine"),
    )


@router.get(
    "/verified-factor-pool/search",
    response_model=VerifiedFactorPoolSearchResponse,
    summary="核验池 Pull：按原厂名称或信用代码检索已确权碳因子",
)
async def verified_factor_pool_search(
    q: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> VerifiedFactorPoolSearchResponse:
    query = (q or "").strip()
    if len(query) < 2:
        return VerifiedFactorPoolSearchResponse(
            match=False,
            message="请输入至少 2 个字符进行检索",
        )
    code_q = query.upper()
    if code_q.startswith("GTCID-"):
        r_code = await db.execute(
            select(Workspace)
            .where(
                Workspace.verified_factor.isnot(None),
                Workspace.verified_factor > 0,
                Workspace.verification_code.isnot(None),
                Workspace.verification_code.ilike(code_q),
            )
            .limit(1)
        )
        ws_code = r_code.scalar_one_or_none()
        if ws_code is not None and _workspace_pull_eligible(ws_code):
            return VerifiedFactorPoolSearchResponse(
                match=True,
                entry=_workspace_to_pool_entry(ws_code),
                message=BATCH_VERIFY_SUCCESS_MSG,
            )
    pattern = f"%{query}%"
    r = await db.execute(
        select(Workspace)
        .where(
            Workspace.verified_factor.isnot(None),
            Workspace.verified_factor > 0,
            Workspace.verified_factor_cert_id.isnot(None),
            (Workspace.name.ilike(pattern))
            | (Workspace.credit_code.ilike(pattern))
            | (Workspace.verification_code.ilike(pattern)),
        )
        .order_by(Workspace.updated_at.desc())
        .limit(1)
    )
    ws = r.scalar_one_or_none()
    if ws is None or not _workspace_pull_eligible(ws):
        return VerifiedFactorPoolSearchResponse(
            match=False,
            message="核验池中未找到匹配的原厂确权记录，将使用欧盟默认因子",
        )
    return VerifiedFactorPoolSearchResponse(
        match=True,
        entry=_workspace_to_pool_entry(ws),
        message="已由原厂官方确权",
    )


@router.get(
    "/verified-factor-pool/verify",
    response_model=VerifiedFactorPoolSearchResponse,
    summary="批次对账 · 按 GTCID 核验码精确认领原厂因子",
)
async def verified_factor_pool_verify(
    code: Optional[str] = None,
    batch_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> VerifiedFactorPoolSearchResponse:
    """批次对账 · verification_code / batch_id 精确认领（VerifiedPool.filter_by batch）。"""
    raw = (batch_id or code or "").strip().upper()
    if len(raw) < 8:
        return VerifiedFactorPoolSearchResponse(
            match=False,
            message="请输入完整的原厂核验码（GTCID-YYYYMM-…）",
        )
    r = await db.execute(
        select(Workspace)
        .where(
            Workspace.verified_factor.isnot(None),
            Workspace.verified_factor > 0,
            Workspace.verification_code.isnot(None),
            Workspace.verification_code.ilike(raw),
        )
        .limit(1)
    )
    ws = r.scalar_one_or_none()
    if ws is None or not _workspace_pull_eligible(ws):
        return VerifiedFactorPoolSearchResponse(
            match=False,
            message="核验码无效或尚未确权，将使用欧盟默认因子",
        )
    return VerifiedFactorPoolSearchResponse(
        match=True,
        entry=_workspace_to_pool_entry(ws),
        message=BATCH_VERIFY_SUCCESS_MSG,
    )


@router.post(
    "/industry-factor-attest",
    response_model=IndustryFactorAttestResponse,
    summary="工业原厂因子确权（仅脱敏碳强度与同比落库）",
)
async def industry_factor_attest(
    payload: IndustryFactorAttestRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> IndustryFactorAttestResponse:
    ws = await _get_primary_workspace(current_user, db)
    if ws is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请先建立企业数字档案",
        )
    phase = resolve_phase(ws)
    if phase == "Phase1":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="完成企业档案建立后开启工业原厂因子精算",
        )
    workspace_role = _resolve_workspace_role(ws)
    if workspace_role != "ROLE_ORIGIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="因子确权仅面向工业原厂企业；下游配套商请使用认领测算流程",
        )
    ws_ind = _norm_resonance_industry(ws.industry_code)
    if not (ws.industry_code or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请先在企业数字档案中选定所属行业",
        )
    attest_ind = _norm_resonance_industry(
        payload.industry_code or ws.industry_code
    )
    if attest_ind != ws_ind:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="因子确权行业与贵司企业档案不一致，仅可向本行业提交",
        )

    first_attest = not bool((ws.verified_factor_cert_id or "").strip())
    cert_id = ws.verified_factor_cert_id or await _new_verified_factor_cert_id(db)
    prod_line = _normalize_production_line(payload.production_line)
    verification_code = ws.verification_code or await _new_verification_code(
        db, payload.industry_code or ws.industry_code, prod_line
    )
    attested_at = datetime.now(timezone.utc).isoformat()
    meta = {
        "industryCode": ws_ind,
        "productLabel": (payload.product_label or "").strip() or None,
        "intensityUnit": (payload.intensity_unit or "tCO2e/t").strip(),
        "attestedAt": attested_at,
        "productionLine": prod_line,
        "verificationCode": verification_code,
    }
    ws.verified_factor = payload.carbon_intensity
    ws.verified_factor_yoy_pct = payload.yoy_change_pct
    ws.verified_factor_cert_id = cert_id
    ws.verification_code = verification_code
    ws.verified_factor_meta_json = json.dumps(meta, ensure_ascii=False)

    gm_earned = Decimal("0")
    badge_awarded = False
    if first_attest:
        bal = await _sum_gm(current_user.id, db)
        gm_earned = INDUSTRY_FACTOR_ATTEST_GM
        db.add(
            GMLedger(
                user_id=current_user.id,
                action=LedgerAction.earn,
                amount=gm_earned,
                balance_snap=bal + gm_earned,
                source_ref=f"industry_factor_attest/{ws.id}",
                memo="工业原厂因子首次确权",
            )
        )
        badge_exists = await db.execute(
            select(UserBadge.id).where(
                UserBadge.user_id == current_user.id,
                UserBadge.badge_code == INDUSTRY_ORIGIN_BADGE_CODE,
            ).limit(1)
        )
        if badge_exists.scalar_one_or_none() is None:
            db.add(
                UserBadge(
                    user_id=current_user.id,
                    badge_code=INDUSTRY_ORIGIN_BADGE_CODE,
                    badge_name=INDUSTRY_ORIGIN_BADGE_NAME,
                    source_ref=f"industry_factor_attest/{cert_id}",
                )
            )
            current_user.badge_count = (current_user.badge_count or 0) + 1
            badge_awarded = True

    await _fulfill_resonance_requests_for_industry(
        db,
        payload.industry_code or ws.industry_code,
        ws,
        cert_id,
    )
    db.add(ws)
    await db.commit()
    await db.refresh(ws)
    usr_row = await db.execute(select(User).where(User.id == current_user.id))
    fresh_user = usr_row.scalar_one()
    dna = await build_app_state(fresh_user, db)
    return IndustryFactorAttestResponse(
        cert_id=cert_id,
        verification_code=verification_code,
        carbon_intensity=payload.carbon_intensity,
        yoy_change_pct=payload.yoy_change_pct,
        gm_earned=gm_earned,
        badge_awarded=badge_awarded,
        message="工业原厂因子已确权存入核验池 · 核验码已生成",
        app_state=jsonable_encoder(dna),
    )


# ═══════════════════════════════════════════════════════════════════════════
# 供应链绑定（双向握手） + 因子消费台账（原厂权威账本）
# ═══════════════════════════════════════════════════════════════════════════

FACTOR_SERVICE_FEE_PCT = Decimal("0.03")   # 因子服务费率（计费基数以指令文档为准，可配置）
FACTOR_NURSING_FUND_PCT = Decimal("0.01")  # 其中注入供应链护航基金的比例
FACTOR_CONSUME_CARBON_PRICE = Decimal("75.36")  # €/tCO2e · CBAM 现价口径
ANON_K_THRESHOLD = 3  # k-匿名阈值：同行业匿名消费者少于 3 家时地区降级脱敏

_INDUSTRY_LABELS_ZH: Dict[str, str] = {
    "steel": "钢铁", "aluminum": "铝业", "cement": "水泥", "chemical": "化工",
    "petrochem": "石化", "glass": "玻璃", "ceramics": "陶瓷", "paper": "造纸",
    "datacenter": "数据中心", "port": "港口物流",
}


async def _find_origin_workspace_by_query(
    db: AsyncSession, origin_query: str
) -> Optional[Workspace]:
    """按下游申报的原厂名匹配工作区：优先精确名，再做包含匹配；仅限已确权原厂。"""
    q = (origin_query or "").strip()
    if not q:
        return None
    base = select(Workspace).where(
        Workspace.verified_factor.isnot(None),
        Workspace.verified_factor > 0,
    )
    r = await db.execute(base.where(func.lower(Workspace.name) == q.lower()).limit(1))
    ws = r.scalar_one_or_none()
    if ws is not None:
        return ws
    # 包含匹配：申报「武汉钢铁 · 一号高炉厂」也能命中「武汉钢铁」
    r = await db.execute(base.order_by(Workspace.updated_at.desc()))
    for cand in r.scalars().all():
        name = (cand.name or "").strip().lower()
        if name and (name in q.lower() or q.lower() in name):
            return cand
    return None


def _binding_to_dict(b: SupplyChainBinding, origin_name: Optional[str] = None,
                     downstream_name: Optional[str] = None,
                     origin_ws: Optional[Workspace] = None,
                     downstream_ws_id: Optional[uuid.UUID] = None) -> Dict[str, Any]:
    upstream_meta = _parse_workspace_meta(origin_ws) if origin_ws else {}
    ds_id = downstream_ws_id or b.downstream_workspace_id
    factor_auth_required = bool(
        origin_ws and ds_id and _is_downstream_factor_revoked(upstream_meta, ds_id)
    )
    app_row = (
        _factor_auth_application_for_downstream(upstream_meta, ds_id)
        if origin_ws and ds_id else None
    )
    app_status = str((app_row or {}).get("status") or "").lower() or None
    return {
        "bindingId": str(b.id),
        "originQuery": b.origin_query,
        "materialType": b.material_type,
        "status": b.status,
        "originWorkspaceId": str(b.origin_workspace_id) if b.origin_workspace_id else None,
        "originName": origin_name,
        "downstreamName": downstream_name,
        "downstreamWorkspaceId": str(ds_id) if ds_id else None,
        "declaredAt": b.created_at.isoformat() if b.created_at else None,
        "reviewedAt": b.reviewed_at.isoformat() if b.reviewed_at else None,
        "factorAuthRequired": factor_auth_required,
        "factorAuthApplicationStatus": app_status,
        "factorAuthApplicationId": (app_row or {}).get("applicationId"),
        "factorAuthNotice": (
            f"因未及时提交自身数据，原厂因子已不可用；填报前需向「{origin_name}」提交申请，审批后解锁。"
            if factor_auth_required and origin_name else None
        ),
        "upstreamCityState": upstream_meta.get("cityState"),
        "upstreamPullEligible": bool(upstream_meta.get("pullEligible")),
        "upstreamCertificateId": upstream_meta.get("certificateId"),
        "upstreamTrustCommitmentLevel": (
            ((upstream_meta.get("evidence") or {}).get("trustCommitmentLevel"))
            if isinstance(upstream_meta.get("evidence"), dict)
            else upstream_meta.get("trustCommitmentLevel")
        ),
        "upstreamHonorEligibilityTier": (
            ((upstream_meta.get("evidence") or {}).get("honorEligibilityTier"))
            if isinstance(upstream_meta.get("evidence"), dict)
            else upstream_meta.get("honorEligibilityTier")
        ),
    }


@router.post("/supply-binding/declare", summary="下游申报上游原厂供应链关系（待原厂确认）")
async def supply_binding_declare(
    payload: SupplyBindingDeclareRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    ws = await _get_primary_workspace(current_user, db)
    if ws is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请先建立企业数字档案")
    origin_ws = await _find_origin_workspace_by_query(db, payload.origin_query)
    if origin_ws is not None and origin_ws.id == ws.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不可将本企业申报为自己的上游")
    # 幂等：同一下游对同一原厂（或同一未匹配申报名）只保留一条
    cond = [SupplyChainBinding.downstream_workspace_id == ws.id]
    if origin_ws is not None:
        cond.append(SupplyChainBinding.origin_workspace_id == origin_ws.id)
    else:
        cond.append(func.lower(SupplyChainBinding.origin_query) == payload.origin_query.strip().lower())
    r = await db.execute(select(SupplyChainBinding).where(*cond).limit(1))
    binding = r.scalar_one_or_none()
    if binding is None:
        binding = SupplyChainBinding(
            downstream_workspace_id=ws.id,
            origin_workspace_id=origin_ws.id if origin_ws else None,
            origin_query=payload.origin_query.strip(),
            material_type=(payload.material_type or "").strip() or None,
            status="pending",
            declared_by_user_id=current_user.id,
        )
        db.add(binding)
        await db.commit()
        await db.refresh(binding)
    return {
        "success": True,
        "matched": origin_ws is not None,
        "binding": _binding_to_dict(
            binding, origin_name=origin_ws.name if origin_ws else None, origin_ws=origin_ws,
        ),
        "message": (
            "已匹配到原厂「%s」，等待对方确认供应链绑定" % origin_ws.name
            if origin_ws else "已记录申报；该原厂尚未入驻或未入池，匹配到后将自动通知"
        ),
    }


@router.get("/supply-binding/mine", summary="下游查询本企业的供应链绑定申报")
async def supply_binding_mine(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    ws = await _get_primary_workspace(current_user, db)
    if ws is None:
        return {"bindings": []}
    r = await db.execute(
        select(SupplyChainBinding, Workspace)
        .outerjoin(Workspace, SupplyChainBinding.origin_workspace_id == Workspace.id)
        .where(SupplyChainBinding.downstream_workspace_id == ws.id)
        .order_by(SupplyChainBinding.created_at.desc())
    )
    return {
        "bindings": [
            _binding_to_dict(
                b,
                origin_name=ows.name if ows else None,
                origin_ws=ows,
                downstream_ws_id=ws.id,
            )
            for b, ows in r.all()
        ]
    }


@router.get("/supply-binding/pending", summary="原厂查询待确认的下游绑定申报")
async def supply_binding_pending(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    ws = await _get_primary_workspace(current_user, db)
    if ws is None or _resolve_workspace_role(ws) != "ROLE_ORIGIN":
        return {"pendingBindings": []}
    r = await db.execute(
        select(SupplyChainBinding, Workspace)
        .join(Workspace, SupplyChainBinding.downstream_workspace_id == Workspace.id)
        .where(
            SupplyChainBinding.origin_workspace_id == ws.id,
            SupplyChainBinding.status == "pending",
        )
        .order_by(SupplyChainBinding.created_at.desc())
    )
    return {
        "pendingBindings": [
            dict(
                _binding_to_dict(b, origin_name=ws.name, downstream_name=dws.name, origin_ws=ws),
                downstreamIndustry=dws.industry_code,
            )
            for b, dws in r.all()
        ]
    }


@router.post("/supply-binding/confirm", summary="原厂确认/拒绝下游绑定申报")
async def supply_binding_confirm(
    payload: SupplyBindingConfirmRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    ws = await _get_primary_workspace(current_user, db)
    if ws is None or _resolve_workspace_role(ws) != "ROLE_ORIGIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅工业原厂可确认供应链绑定")
    r = await db.execute(
        select(SupplyChainBinding).where(SupplyChainBinding.id == payload.binding_id).limit(1)
    )
    binding = r.scalar_one_or_none()
    if binding is None or binding.origin_workspace_id != ws.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到指向贵司的该条绑定申报")
    binding.status = "confirmed" if payload.approve else "rejected"
    binding.reviewer_note = (payload.note or "").strip() or None
    binding.reviewed_at = datetime.now(timezone.utc)
    db.add(binding)
    await db.commit()
    return {
        "success": True,
        "binding": _binding_to_dict(binding, origin_name=ws.name, origin_ws=ws),
        "message": "已确认供应链绑定，下游可引用贵司确权因子" if payload.approve else "已拒绝该绑定申报",
    }


@router.post("/supply/factor-auth/revoke", summary="原厂撤回下游因子授权")
async def supply_factor_auth_revoke(
    payload: FactorAuthRevokeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    ws = await _get_primary_workspace(current_user, db)
    if ws is None or _resolve_workspace_role(ws) != "ROLE_ORIGIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅工业原厂可撤回因子授权")
    r = await db.execute(
        select(SupplyChainBinding, Workspace)
        .join(Workspace, SupplyChainBinding.downstream_workspace_id == Workspace.id)
        .where(SupplyChainBinding.id == payload.binding_id)
        .limit(1)
    )
    row = r.first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到绑定记录")
    binding, dws = row
    if binding.origin_workspace_id != ws.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权操作该绑定")
    if binding.status != "confirmed":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅已确认绑定可撤回因子授权")

    meta = _parse_workspace_meta(ws)
    revocations = _factor_auth_revocations(meta)
    ds_id = str(binding.downstream_workspace_id)
    if not any(str(r.get("downstreamWorkspaceId") or "") == ds_id for r in revocations):
        revocations.append({
            "downstreamWorkspaceId": ds_id,
            "bindingId": str(binding.id),
            "downstreamName": dws.name,
            "revokedAt": datetime.now(timezone.utc).isoformat(),
            "note": (payload.note or "").strip() or None,
            "factorAuthRequired": True,
        })
    meta["factorAuthRevocations"] = revocations
    _save_workspace_meta(ws, meta)
    bal = await _sum_gm(current_user.id, db)
    db.add(
        GMLedger(
            user_id=current_user.id,
            action=LedgerAction.earn,
            amount=Decimal("0"),
            balance_snap=bal,
            source_ref=f"revoke_factor_auth/{binding.id}",
            memo="REVOKE_FACTOR_AUTH",
        )
    )
    await db.commit()
    usr_row = await db.execute(select(User).where(User.id == current_user.id))
    fresh_user = usr_row.scalar_one()
    dna = await build_app_state(fresh_user, db)
    return {
        "success": True,
        "message": f"已撤回对「{dws.name}」的因子授权；下游需主动申请后重新解锁",
        "bindingId": str(binding.id),
        "downstreamName": dws.name,
        "appState": jsonable_encoder(dna),
    }


@router.post("/supply/factor-auth/apply", summary="下游申请重新解锁因子授权")
async def supply_factor_auth_apply(
    payload: FactorAuthApplyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    ws = await _get_primary_workspace(current_user, db)
    if ws is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请先建立企业数字档案")
    r = await db.execute(
        select(SupplyChainBinding, Workspace)
        .join(Workspace, SupplyChainBinding.origin_workspace_id == Workspace.id)
        .where(SupplyChainBinding.id == payload.binding_id)
        .limit(1)
    )
    row = r.first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到绑定记录")
    binding, origin_ws = row
    if binding.downstream_workspace_id != ws.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权对该绑定发起申请")
    if binding.status != "confirmed":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅已确认绑定可申请解锁")

    origin_meta = _parse_workspace_meta(origin_ws)
    if not _is_downstream_factor_revoked(origin_meta, ws.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="当前未被撤回因子授权，无需申请",
        )

    apps = _factor_auth_applications(origin_meta)
    ds_id = str(ws.id)
    for app in apps:
        if (
            str(app.get("downstreamWorkspaceId") or "") == ds_id
            and str(app.get("status") or "").lower() == "pending"
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "APPLICATION_PENDING", "message": "解锁申请审核中，请等待原厂处理"},
            )

    app_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    apps.append({
        "applicationId": app_id,
        "bindingId": str(binding.id),
        "downstreamWorkspaceId": ds_id,
        "downstreamName": ws.name,
        "status": "pending",
        "appliedAt": now_iso,
        "note": (payload.note or "").strip() or None,
    })
    origin_meta["factorAuthApplications"] = apps
    _save_workspace_meta(origin_ws, origin_meta)

    bal = await _sum_gm(current_user.id, db)
    db.add(
        GMLedger(
            user_id=current_user.id,
            action=LedgerAction.earn,
            amount=Decimal("0"),
            balance_snap=bal,
            source_ref=f"request_factor_auth/{binding.id}",
            memo="REQUEST_FACTOR_AUTH",
        )
    )
    await db.commit()
    usr_row = await db.execute(select(User).where(User.id == current_user.id))
    fresh_user = usr_row.scalar_one()
    dna = await build_app_state(fresh_user, db)
    return {
        "success": True,
        "applicationId": app_id,
        "message": f"已向「{origin_ws.name}」提交因子解锁申请，请等待审批",
        "appState": jsonable_encoder(dna),
    }


@router.post("/supply/factor-auth/approve", summary="原厂审批下游因子解锁申请")
async def supply_factor_auth_approve(
    payload: FactorAuthApproveRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    ws = await _get_primary_workspace(current_user, db)
    if ws is None or _resolve_workspace_role(ws) != "ROLE_ORIGIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅工业原厂可审批因子解锁申请")

    meta = _parse_workspace_meta(ws)
    apps = _factor_auth_applications(meta)
    app_row: Optional[Dict[str, Any]] = None
    if payload.application_id:
        aid = str(payload.application_id)
        app_row = next(
            (a for a in apps if str(a.get("applicationId") or "") == aid),
            None,
        )
    elif payload.binding_id:
        bid = str(payload.binding_id)
        pending = [
            a for a in apps
            if str(a.get("bindingId") or "") == bid
            and str(a.get("status") or "").lower() == "pending"
        ]
        app_row = pending[-1] if pending else None
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请提供 applicationId 或 bindingId")

    if app_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到待审批的解锁申请")
    if str(app_row.get("status") or "").lower() != "pending":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="该申请已处理")

    binding_id = app_row.get("bindingId")
    r = await db.execute(
        select(SupplyChainBinding, Workspace)
        .join(Workspace, SupplyChainBinding.downstream_workspace_id == Workspace.id)
        .where(SupplyChainBinding.id == binding_id)
        .limit(1)
    )
    row = r.first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="绑定记录不存在")
    binding, dws = row
    if binding.origin_workspace_id != ws.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权审批该申请")

    now_iso = datetime.now(timezone.utc).isoformat()
    ds_id = str(binding.downstream_workspace_id)
    if payload.approve:
        revocations = [
            r for r in _factor_auth_revocations(meta)
            if str(r.get("downstreamWorkspaceId") or "") != ds_id
        ]
        meta["factorAuthRevocations"] = revocations
        app_row["status"] = "approved"
        msg = f"已批准「{dws.name}」的因子解锁申请，下游可重新引用贵司因子"
        memo = "APPROVE_FACTOR_AUTH"
    else:
        app_row["status"] = "rejected"
        msg = f"已拒绝「{dws.name}」的因子解锁申请"
        memo = "REJECT_FACTOR_AUTH"

    app_row["reviewedAt"] = now_iso
    app_row["reviewNote"] = (payload.note or "").strip() or None
    meta["factorAuthApplications"] = apps
    _save_workspace_meta(ws, meta)

    bal = await _sum_gm(current_user.id, db)
    db.add(
        GMLedger(
            user_id=current_user.id,
            action=LedgerAction.earn,
            amount=Decimal("0"),
            balance_snap=bal,
            source_ref=f"approve_factor_auth/{binding.id}",
            memo=memo,
        )
    )
    await db.commit()
    usr_row = await db.execute(select(User).where(User.id == current_user.id))
    fresh_user = usr_row.scalar_one()
    dna = await build_app_state(fresh_user, db)
    return {
        "success": True,
        "approved": payload.approve,
        "bindingId": str(binding.id),
        "downstreamName": dws.name,
        "message": msg,
        "appState": jsonable_encoder(dna),
    }


@router.post("/supply/factor-rule-letters/batch", summary="批量下发因子规则变更函")
async def supply_factor_rule_letters_batch(
    payload: FactorRuleLetterBatchRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    ws = await _get_primary_workspace(current_user, db)
    if ws is None or _resolve_workspace_role(ws) != "ROLE_ORIGIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅工业原厂可下发规则变更函")
    sent: List[Dict[str, Any]] = []
    now_iso = datetime.now(timezone.utc).isoformat()
    meta = _parse_workspace_meta(ws)
    letters = _factor_rule_letters(meta)
    for bid in payload.binding_ids:
        r = await db.execute(
            select(SupplyChainBinding, Workspace)
            .join(Workspace, SupplyChainBinding.downstream_workspace_id == Workspace.id)
            .where(SupplyChainBinding.id == bid, SupplyChainBinding.origin_workspace_id == ws.id)
            .limit(1)
        )
        row = r.first()
        if row is None:
            continue
        binding, dws = row
        letter_id = f"FRL-{secrets.token_hex(6).upper()}"
        entry = {
            "letterId": letter_id,
            "bindingId": str(binding.id),
            "downstreamName": dws.name,
            "downstreamWorkspaceId": str(dws.id),
            "sentAt": now_iso,
            "readAt": None,
            "status": "sent",
            "issuer": f"{ws.name}-供应链管理部",
            "subject": "因子授权规则变更通知",
        }
        letters.insert(0, entry)
        sent.append(entry)
    meta["factorRuleLetters"] = letters[:500]
    _save_workspace_meta(ws, meta)
    bal = await _sum_gm(current_user.id, db)
    db.add(
        GMLedger(
            user_id=current_user.id,
            action=LedgerAction.earn,
            amount=Decimal("0"),
            balance_snap=bal,
            source_ref=f"batch_factor_rule_letter/{now_iso}",
            memo="BATCH_FACTOR_RULE_LETTER",
        )
    )
    await db.commit()
    return {
        "success": True,
        "sentCount": len(sent),
        "letters": sent,
        "message": f"已向 {len(sent)} 家下游下发规则变更函",
    }


@router.get("/supply/factor-rule-letters/history", summary="规则变更函下发历史")
async def supply_factor_rule_letters_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    ws = await _get_primary_workspace(current_user, db)
    if ws is None:
        return {"letters": []}
    meta = _parse_workspace_meta(ws)
    return {"letters": _factor_rule_letters(meta)}


@router.post("/factor-consume", summary="下游引用原厂确权因子（写入消费台账，幂等）")
async def factor_consume(
    payload: FactorConsumeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    ws = await _get_primary_workspace(current_user, db)
    if ws is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请先建立企业数字档案")
    # 绑定校验（#2）：必须存在原厂已确认的绑定，否则不允许跨供应链匹配
    r = await db.execute(
        select(SupplyChainBinding, Workspace)
        .join(Workspace, SupplyChainBinding.origin_workspace_id == Workspace.id)
        .where(
            SupplyChainBinding.downstream_workspace_id == ws.id,
            SupplyChainBinding.status == "confirmed",
            Workspace.verified_factor.isnot(None),
            Workspace.verified_factor > 0,
        )
        .order_by(SupplyChainBinding.reviewed_at.desc())
        .limit(1)
    )
    row = r.first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无已确认的供应链绑定关系，不允许跨供应链引用因子；请先申报并等待原厂确认",
        )
    binding, origin_ws = row
    origin_meta = _parse_workspace_meta(origin_ws)
    if _is_downstream_factor_revoked(origin_meta, ws.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="原厂已撤回因子授权；请向原厂提交申请后重新解锁",
        )
    claim_mode = "claimed" if str(payload.claim_mode or "").strip().lower() == "claimed" else "anonymous"
    # 幂等：同批次重复引用直接返回既有记录
    r = await db.execute(
        select(FactorConsumption).where(
            FactorConsumption.consumer_workspace_id == ws.id,
            FactorConsumption.batch_id == payload.batch_id.strip(),
        ).limit(1)
    )
    existing = r.scalar_one_or_none()
    factor = origin_ws.verified_factor or Decimal("0")
    if existing is not None:
        existing_saved = (existing.tax_saved_eur or Decimal("0"))
        return {
            "success": True, "duplicated": True,
            "consumptionId": str(existing.id), "certId": existing.cert_id,
            "factor": float(existing.factor_value or factor),
            "carbonTonnage": float(existing.carbon_tonnage or 0),
            "taxSavedEur": float(existing_saved),
            "serviceFeeEur": float((existing_saved * FACTOR_SERVICE_FEE_PCT).quantize(Decimal("0.01"))),
            "nursingFundEur": float((existing_saved * FACTOR_NURSING_FUND_PCT).quantize(Decimal("0.01"))),
            "claimMode": existing.claim_mode,
            "originName": origin_ws.name,
            "message": "该批次已引用过原厂因子（幂等返回）",
        }
    qty = payload.qty_tons or Decimal("0")
    carbon_tonnage = (qty * factor).quantize(Decimal("0.0001"))
    # 估算口径：缺省惩罚值 = 确权因子 × 1.35；挽回 = 差额 × 吨位 × 碳价（计费基数以指令文档为准）
    tax_saved = (
        factor * (RESONANCE_PENALTY_MULTIPLIER - Decimal("1")) * qty * FACTOR_CONSUME_CARBON_PRICE
    ).quantize(Decimal("0.01"))
    service_fee = (tax_saved * FACTOR_SERVICE_FEE_PCT).quantize(Decimal("0.01"))
    nursing_fund = (tax_saved * FACTOR_NURSING_FUND_PCT).quantize(Decimal("0.01"))
    rec = FactorConsumption(
        origin_workspace_id=origin_ws.id,
        consumer_workspace_id=ws.id,
        consumer_user_id=current_user.id,
        binding_id=binding.id,
        cert_id=origin_ws.verified_factor_cert_id,
        industry_code=_norm_resonance_industry(origin_ws.industry_code),
        batch_id=payload.batch_id.strip(),
        qty_tons=qty,
        factor_value=factor,
        carbon_tonnage=carbon_tonnage,
        tax_saved_eur=tax_saved,
        claim_mode=claim_mode,
        region_tag=ws.region_tag,
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    return {
        "success": True, "duplicated": False,
        "consumptionId": str(rec.id), "certId": rec.cert_id,
        "factor": float(factor), "carbonTonnage": float(carbon_tonnage),
        "taxSavedEur": float(tax_saved), "claimMode": rec.claim_mode,
        "serviceFeeEur": float(service_fee),
        "nursingFundEur": float(nursing_fund),
        "originName": origin_ws.name,
        "message": "因子引用已记入原厂消费台账",
    }


@router.get("/origin-factor-ledger", summary="原厂因子消费台账（聚合 + 实名/匿名分层 + 待确认绑定）")
async def origin_factor_ledger(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    ws = await _get_primary_workspace(current_user, db)
    if ws is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请先建立企业数字档案")
    if _resolve_workspace_role(ws) != "ROLE_ORIGIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="消费台账仅面向工业原厂企业")

    r = await db.execute(
        select(FactorConsumption, Workspace)
        .join(Workspace, FactorConsumption.consumer_workspace_id == Workspace.id)
        .where(FactorConsumption.origin_workspace_id == ws.id)
        .order_by(FactorConsumption.created_at.asc())
    )
    rows = r.all()

    total_count = 0
    total_tonnage = Decimal("0")
    total_saved = Decimal("0")
    by_industry: Dict[str, Dict[str, Any]] = {}
    by_month: Dict[str, Dict[str, Any]] = {}
    claimed_map: Dict[str, Dict[str, Any]] = {}
    downstream_optins_map: Dict[str, Dict[str, Any]] = {}
    anon_rows: List[Dict[str, Any]] = []
    anon_industry_consumers: Dict[str, set] = {}

    for rec, cws in rows:
        total_count += 1
        total_tonnage += rec.carbon_tonnage or Decimal("0")
        total_saved += rec.tax_saved_eur or Decimal("0")
        ind = rec.industry_code or "steel"
        bi = by_industry.setdefault(ind, {
            "industryCode": ind,
            "industryLabel": _INDUSTRY_LABELS_ZH.get(ind, ind),
            "count": 0, "carbonTonnage": Decimal("0"),
        })
        bi["count"] += 1
        bi["carbonTonnage"] += rec.carbon_tonnage or Decimal("0")
        month = rec.created_at.strftime("%Y-%m") if rec.created_at else "—"
        bm = by_month.setdefault(month, {
            "month": month, "count": 0,
            "carbonTonnage": Decimal("0"), "taxSavedEur": Decimal("0"),
        })
        bm["count"] += 1
        bm["carbonTonnage"] += rec.carbon_tonnage or Decimal("0")
        bm["taxSavedEur"] += rec.tax_saved_eur or Decimal("0")
        if rec.claim_mode == "claimed":
            key = str(rec.consumer_workspace_id)
            c = claimed_map.setdefault(key, {
                "workspaceId": key, "companyName": cws.name,
                "industryCode": cws.industry_code,
                "claimedAt": rec.created_at.isoformat() if rec.created_at else None,
                "refCount": 0,
            })
            c["refCount"] += 1
            d = downstream_optins_map.setdefault(key, {
                "workspaceId": key,
                "companyName": cws.name,
                "optInAt": rec.created_at.isoformat() if rec.created_at else None,
                "status": "active",
            })
            if _is_downstream_factor_revoked(_parse_workspace_meta(ws), rec.consumer_workspace_id):
                d["status"] = "factor_auth_revoked"
                d["factorAuthRequired"] = True
                d["tag"] = "需申请因子"
            if rec.created_at:
                ts = rec.created_at.isoformat()
                if not d.get("optInAt") or ts < str(d.get("optInAt")):
                    d["optInAt"] = ts
        else:
            cons_ind = (cws.industry_code or ind)
            anon_industry_consumers.setdefault(cons_ind, set()).add(str(rec.consumer_workspace_id))
            anon_rows.append({
                "industryCode": cons_ind,
                "regionRaw": rec.region_tag or "",
                "refAt": rec.created_at.strftime("%Y-%m") if rec.created_at else None,  # 月级精度防去匿名化
            })

    # k-匿名（#4）：同行业匿名消费者不足阈值时，地区降级为「已脱敏」
    anonymous_consumers = []
    for a in anon_rows:
        k = len(anon_industry_consumers.get(a["industryCode"], set()))
        anonymous_consumers.append({
            "industryCode": a["industryCode"],
            "region": (a["regionRaw"] or "已脱敏") if k >= ANON_K_THRESHOLD else "已脱敏",
            "refAt": a["refAt"],
        })

    pending = await supply_binding_pending(current_user=current_user, db=db)
    r_conf = await db.execute(
        select(SupplyChainBinding, Workspace)
        .join(Workspace, SupplyChainBinding.downstream_workspace_id == Workspace.id)
        .where(
            SupplyChainBinding.origin_workspace_id == ws.id,
            SupplyChainBinding.status == "confirmed",
        )
        .order_by(SupplyChainBinding.reviewed_at.desc())
    )
    confirmed_bindings = [
        dict(
            _binding_to_dict(
                b,
                origin_name=ws.name,
                downstream_name=dws.name,
                origin_ws=ws,
                downstream_ws_id=dws.id,
            ),
            downstreamWorkspaceId=str(dws.id),
        )
        for b, dws in r_conf.all()
    ]
    origin_meta = _parse_workspace_meta(ws)
    service_fee = (total_saved * FACTOR_SERVICE_FEE_PCT).quantize(Decimal("0.01"))
    nursing_fund = (total_saved * FACTOR_NURSING_FUND_PCT).quantize(Decimal("0.01"))
    return {
        "consumptionLedger": {
            "total": {
                "count": total_count,
                "carbonTonnage": float(total_tonnage),
                "taxSavedEur": float(total_saved),
            },
            "byIndustry": [
                {**v, "carbonTonnage": float(v["carbonTonnage"])}
                for v in by_industry.values()
            ],
            "byMonth": [
                {**v, "carbonTonnage": float(v["carbonTonnage"]), "taxSavedEur": float(v["taxSavedEur"])}
                for v in sorted(by_month.values(), key=lambda x: x["month"])
            ],
            "claimedConsumers": list(claimed_map.values()),
            "downstreamOptIns": list(downstream_optins_map.values()),
            "anonymousConsumers": anonymous_consumers,
            "anonymousRecords": anonymous_consumers,
            "visibilityScope": {
                "identityDisclosure": "auto_on_commitment",
                "consumptionLedgerDisclosure": "opt_in_required",
            },
            "serviceFeePct": float(FACTOR_SERVICE_FEE_PCT),
            "nursingFundPct": float(FACTOR_NURSING_FUND_PCT),
            "serviceFeeEur": float(service_fee),
            "nursingFundEur": float(nursing_fund),
        },
        "pendingBindings": pending.get("pendingBindings", []),
        "confirmedBindings": confirmed_bindings,
        "factorAuthRevocations": _factor_auth_revocations(origin_meta),
        "factorAuthApplications": _factor_auth_applications(origin_meta),
        "factorRuleLetters": _factor_rule_letters(origin_meta),
    }


async def _cbam_save_gm_already_awarded(
    db: AsyncSession,
    user_id: uuid.UUID,
    workspace_id: uuid.UUID,
) -> bool:
    """同一 user + workspace 下已有 CBAM 测算记分 GM 落账则不再发放（防刷单）。"""
    rep_rows = await db.execute(
        select(CBAMReport.id).where(
            CBAMReport.workspace_id == workspace_id,
            CBAMReport.owner_id == user_id,
        )
    )
    rep_ids = [row[0] for row in rep_rows.all()]
    if not rep_ids:
        return False
    refs = [f"cbam_report_save/{rid}" for rid in rep_ids]
    cnt = await db.execute(
        select(func.count())
        .select_from(GMLedger)
        .where(
            GMLedger.user_id == user_id,
            GMLedger.action == LedgerAction.earn,
            GMLedger.amount > 0,
            GMLedger.source_ref.in_(refs),
        )
    )
    return int(cnt.scalar_one() or 0) > 0


@router.post("/cbam-report-save", response_model=CBAMReportSaveResponse, summary="CBAM 测算结果落库")
async def cbam_report_save(
    payload: CBAMReportSaveRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CBAMReportSaveResponse:
    ws = await _get_primary_workspace(current_user, db)
    if ws is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请先保存企业数字档案以创建企业空间",
        )
    period = (payload.reporting_period or "ad-hoc").strip() or "ad-hoc"
    fx = _fx_from_cbam_payload(payload.payload_json)
    cov: Optional[Decimal] = None
    roi_r: Optional[Decimal] = None
    tax_eur = payload.risk_exposure_eur or Decimal("0")
    _, roi_m = _roi_tax_from_risk_eur(tax_eur, fx)
    if roi_m is not None:
        roi_r = roi_m
    if payload.payload_json:
        try:
            meta = json.loads(payload.payload_json)
            if isinstance(meta, dict) and meta.get("coverage") is not None:
                cov = Decimal(str(meta["coverage"]))
        except Exception:
            pass

    gm_already = await _cbam_save_gm_already_awarded(db, current_user.id, ws.id)

    report = CBAMReport(
        workspace_id=ws.id,
        owner_id=current_user.id,
        reporting_period=period,
        status=CBAMStatus.submitted,
        tco2e_total=payload.tco2e_total,
        risk_exposure_eur=payload.risk_exposure_eur,
        payload_json=payload.payload_json,
        submitted_at=datetime.now(timezone.utc),
        roi_ratio=roi_r,
        supply_chain_coverage=cov,
        cbam_tax_estimate=payload.risk_exposure_eur,
    )
    db.add(report)
    await db.flush()

    await _sync_workspace_after_cbam_save(ws, report, payload.payload_json, db, current_user.id)

    gm_earned = Decimal("0") if gm_already else CBAM_REPORT_SAVE_GM
    if gm_earned > 0:
        bal_before = await _sum_gm(current_user.id, db)
        db.add(
            GMLedger(
                user_id=current_user.id,
                action=LedgerAction.earn,
                amount=gm_earned,
                balance_snap=bal_before + gm_earned,
                source_ref=f"cbam_report_save/{report.id}",
                memo="CBAM 测算结果已写入企业底座",
            )
        )
    await db.commit()
    await db.refresh(report)
    usr_row = await db.execute(select(User).where(User.id == current_user.id))
    fresh_user = usr_row.scalar_one()
    dna = await build_app_state(fresh_user, db)
    return CBAMReportSaveResponse(
        report_id=report.id,
        gm_earned=gm_earned,
        message="CBAM 报告已落库" + ("" if gm_earned > 0 else "（数据已更新，本次不重复发放 GM）"),
        app_state=jsonable_encoder(dna),
    )


async def _supplier_invite_gm_already_awarded(
    db: AsyncSession,
    user_id: uuid.UUID,
    node_id: uuid.UUID,
) -> bool:
    ref = f"supplier_invite/{node_id}"
    exists = await db.execute(
        select(func.count())
        .select_from(GMLedger)
        .where(
            GMLedger.user_id == user_id,
            GMLedger.source_ref == ref,
            GMLedger.action == LedgerAction.earn,
        )
    )
    return int(exists.scalar_one() or 0) > 0


async def _find_supplier_node_for_invite(
    ws_id: uuid.UUID,
    payload: SupplierInviteRequest,
    db: AsyncSession,
) -> Optional[SupplierNode]:
    if payload.supplier_node_id:
        r = await db.execute(
            select(SupplierNode).where(
                SupplierNode.id == payload.supplier_node_id,
                SupplierNode.workspace_id == ws_id,
            )
        )
        return r.scalar_one_or_none()
    name = (payload.supplier_name or "").strip()
    if not name:
        return None
    slot = _parse_supplier_slot(name)
    if slot is not None:
        by_slot = await _find_supplier_node_by_slot(ws_id, slot, db)
        if by_slot is not None:
            return by_slot
    r = await db.execute(
        select(SupplierNode)
        .where(
            SupplierNode.workspace_id == ws_id,
            func.lower(SupplierNode.supplier_name) == name.lower(),
        )
        .order_by(SupplierNode.created_at.asc())
    )
    return r.scalars().first()


async def _resolve_supplier_node_in_ws(
    ws_id: uuid.UUID,
    db: AsyncSession,
    node_id: Optional[uuid.UUID] = None,
    supplier_name: Optional[str] = None,
) -> Optional[SupplierNode]:
    if node_id:
        r = await db.execute(
            select(SupplierNode).where(
                SupplierNode.id == node_id,
                SupplierNode.workspace_id == ws_id,
            )
        )
        return r.scalar_one_or_none()
    name = (supplier_name or "").strip()
    if not name:
        return None
    r = await db.execute(
        select(SupplierNode)
        .where(
            SupplierNode.workspace_id == ws_id,
            func.lower(SupplierNode.supplier_name) == name.lower(),
        )
        .order_by(SupplierNode.created_at.asc())
    )
    return r.scalars().first()


@router.post(
    "/supplier-merge-duplicates",
    response_model=SupplierMergeDuplicatesResponse,
    summary="合并重复供应链节点（如误建节点11并入节点10）",
)
async def supplier_merge_duplicates(
    payload: SupplierMergeDuplicatesRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SupplierMergeDuplicatesResponse:
    ws = await _get_primary_workspace(current_user, db)
    if ws is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请先保存企业数字档案")

    keep = await _resolve_supplier_node_in_ws(
        ws.id, db, payload.keep_node_id, payload.keep_supplier_name
    )
    remove = await _resolve_supplier_node_in_ws(
        ws.id, db, payload.remove_node_id, payload.remove_supplier_name
    )
    if keep is None or remove is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="未找到要合并的节点，请检查节点名称或 ID",
        )
    if keep.id == remove.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="保留节点与删除节点不能相同")

    if remove.invite_code and not (keep.invite_code or "").strip():
        keep.invite_code = remove.invite_code
    if remove.submission_token and not (keep.submission_token or "").strip():
        keep.submission_token = remove.submission_token
    if remove.contact_email and not keep.contact_email:
        keep.contact_email = remove.contact_email
    if remove.supplier_credit_code and not keep.supplier_credit_code:
        keep.supplier_credit_code = remove.supplier_credit_code

    remove_done = remove.status in (SupplierStatus.submitted, SupplierStatus.confirmed)
    keep_done = keep.status in (SupplierStatus.submitted, SupplierStatus.confirmed)
    if remove_done and not keep_done:
        keep.status = remove.status
        keep.submitted_at = remove.submitted_at
        keep.tco2e_reported = remove.tco2e_reported
        keep.data_quality_score = remove.data_quality_score
    elif (
        remove.tco2e_reported is not None
        and (keep.tco2e_reported is None or keep.tco2e_reported == 0)
        and float(remove.tco2e_reported or 0) > 0
    ):
        keep.tco2e_reported = remove.tco2e_reported
        if remove.submitted_at:
            keep.submitted_at = remove.submitted_at
        if remove.status in (SupplierStatus.submitted, SupplierStatus.confirmed):
            keep.status = remove.status

    if (keep.invite_code or "").strip() and keep.status not in (
        SupplierStatus.submitted,
        SupplierStatus.confirmed,
    ):
        keep.status = SupplierStatus.invited

    _apply_civilization_flags(keep)
    db.add(keep)
    await db.delete(remove)
    await db.commit()
    await db.refresh(keep)

    usr_row = await db.execute(select(User).where(User.id == current_user.id))
    fresh_user = usr_row.scalar_one()
    dna = await build_app_state(fresh_user, db)
    return SupplierMergeDuplicatesResponse(
        kept_node_id=keep.id,
        removed_node_id=remove.id,
        message=f"已合并：「{remove.supplier_name}」并入「{keep.supplier_name}」，重复节点已删除",
        app_state=jsonable_encoder(dna),
    )


@router.post(
    "/supplier-reconcile",
    response_model=SupplierReconcileResponse,
    summary="整理供应链节点槽位（合并重复节点 9/9、修复假确权）",
)
async def supplier_reconcile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SupplierReconcileResponse:
    ws = await _get_primary_workspace(current_user, db)
    if ws is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请先保存企业数字档案")
    removed = await _reconcile_supplier_nodes(ws.id, db)
    await db.commit()
    usr_row = await db.execute(select(User).where(User.id == current_user.id))
    fresh_user = usr_row.scalar_one()
    dna = await build_app_state(fresh_user, db)
    return SupplierReconcileResponse(
        removed_duplicates=removed,
        message=(
            f"节点槽位已整理：合并删除 {removed} 条重复记录；"
            "名称规范为「供应链节点 N」（N 为固定槽位编号，删除合并不会导致编号乱跳）。"
        ),
        app_state=jsonable_encoder(dna),
    )


@router.post("/supplier-invite", response_model=SupplierInviteResponse, summary="签发供应商穿透填报邀请")
async def supplier_invite(
    payload: SupplierInviteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SupplierInviteResponse:
    ws = await _get_primary_workspace(current_user, db)
    if ws is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请先保存企业数字档案",
        )
    bits: List[str] = []
    if payload.contact_person_name:
        bits.append(f"联系人:{payload.contact_person_name}")
    if payload.contact_phone:
        bits.append(f"电话:{payload.contact_phone}")
    if payload.contact_email:
        bits.append(payload.contact_email)
    contact_blob = " · ".join(bits)[:320] if bits else None

    await _reconcile_supplier_nodes(ws.id, db)
    existing = await _find_supplier_node_for_invite(ws.id, payload, db)
    if existing is None:
        slot = _parse_supplier_slot((payload.supplier_name or "").strip())
        if slot is not None:
            existing = await _find_supplier_node_by_slot(ws.id, slot, db)
    gm_earned = Decimal("0")
    message = "邀请已落库，请将链接分享给供应商"

    if existing is not None:
        if existing.status in (SupplierStatus.submitted, SupplierStatus.confirmed):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"「{existing.supplier_name}」已完成填报确权，无需重复邀请。请在管理台查看碳强度。",
            )
        token = secrets.token_urlsafe(24)
        invite_code = await _unique_invite_code(db)
        slot = _parse_supplier_slot(existing.supplier_name)
        if slot is not None:
            existing.supplier_name = _canonical_supplier_slot_name(slot)
        else:
            existing.supplier_name = (payload.supplier_name or existing.supplier_name).strip()[:256]
        if payload.supplier_credit_code:
            existing.supplier_credit_code = (payload.supplier_credit_code or "").strip() or None
        if contact_blob:
            existing.contact_email = contact_blob
        existing.status = SupplierStatus.invited
        existing.submission_token = token
        existing.invite_code = invite_code
        existing.submitted_at = None
        existing.tco2e_reported = None
        _apply_civilization_flags(existing)
        db.add(existing)
        await db.flush()
        node = existing
        message = "已刷新该节点的穿透邀请链接（未重复创建节点）"
        if not await _supplier_invite_gm_already_awarded(db, current_user.id, node.id):
            gm_earned = SUPPLIER_INVITE_GM
            bal_before = await _sum_gm(current_user.id, db)
            db.add(
                GMLedger(
                    user_id=current_user.id,
                    action=LedgerAction.earn,
                    amount=gm_earned,
                    balance_snap=bal_before + gm_earned,
                    source_ref=f"supplier_invite/{node.id}",
                    memo="签发供应链穿透填报邀请",
                )
            )
        else:
            message = "邀请链接已刷新 · 该节点 GM 已发放过，不再重复加分"
    else:
        slot = _parse_supplier_slot(payload.supplier_name.strip())
        new_name = (
            _canonical_supplier_slot_name(slot) if slot is not None else payload.supplier_name.strip()
        )
        token = secrets.token_urlsafe(24)
        invite_code = await _unique_invite_code(db)
        node = SupplierNode(
            workspace_id=ws.id,
            invited_by_user_id=current_user.id,
            supplier_name=new_name,
            supplier_credit_code=(payload.supplier_credit_code or "").strip() or None,
            contact_email=contact_blob,
            status=SupplierStatus.invited,
            invite_code=invite_code,
            submission_token=token,
        )
        _apply_civilization_flags(node)
        db.add(node)
        await db.flush()
        gm_earned = SUPPLIER_INVITE_GM
        bal_before = await _sum_gm(current_user.id, db)
        db.add(
            GMLedger(
                user_id=current_user.id,
                action=LedgerAction.earn,
                amount=gm_earned,
                balance_snap=bal_before + gm_earned,
                source_ref=f"supplier_invite/{node.id}",
                memo="签发供应链穿透填报邀请",
            )
        )

    await db.commit()
    await db.refresh(node)
    usr_row = await db.execute(select(User).where(User.id == current_user.id))
    fresh_user = usr_row.scalar_one()
    dna = await build_app_state(fresh_user, db)
    return SupplierInviteResponse(
        supplier_node_id=node.id,
        submission_token=node.submission_token or token,
        invite_code=node.invite_code or invite_code,
        gm_earned=gm_earned,
        message=message,
        app_state=jsonable_encoder(dna),
    )


@eco_router.post(
    "/resonance-request",
    response_model=ResonanceRequestResponse,
    status_code=status.HTTP_200_OK,
    summary="中小企业发起原厂因子确权技术请求（产业链压力汇聚）",
)
async def eco_resonance_request(
    payload: ResonanceRequestSubmit,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ResonanceRequestResponse:
    ws = await _get_primary_workspace(current_user, db)
    if ws is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请先建立企业数字档案后再发起技术请求",
        )
    ind = _norm_resonance_industry(payload.industry_code)
    origin_q = (payload.origin_query or "").strip() or None
    product = (payload.product_category or "").strip() or None

    req = ResonanceRequest(
        requester_workspace_id=ws.id,
        requester_user_id=current_user.id,
        industry_code=ind,
        origin_query=origin_q,
        product_category=product,
        status="pending",
    )
    db.add(req)
    await db.flush()
    await _sync_upstream_resonance_counters(db, ind)
    await db.commit()
    await db.refresh(req)

    pending_count = await _count_pending_resonance(db, ind)
    dna = jsonable_encoder(await build_app_state(current_user, db))
    return ResonanceRequestResponse(
        success=True,
        request_id=req.id,
        industry_code=ind,
        pending_count_for_industry=pending_count,
        message="技术请求已记录。已在公共诉求大盘中为您点亮一个共振节点。",
        app_state=dna,
    )


@eco_router.post(
    "/supplier-submit",
    response_model=SupplierSubmitResponse,
    status_code=status.HTTP_200_OK,
    summary="H5 供应商碳数据提交（公开 · 触发链主端实时闭环）",
)
async def supplier_submit_public(
    payload: SupplierSubmitRequest,
    db: AsyncSession = Depends(get_db),
) -> SupplierSubmitResponse:
    """
    供应商 H5 填报落库（无需鉴权）：
    ① 校验一次性 submission_token
    ② 写入 SupplierNode.submitted + tco2e_reported
    ③ 重算 Scope3 穿透率并写回 Workspace + CBAMReport（含 risk_exposure_eur）
    ④ 链主 GM 奖励入账（幂等）
    """
    supplier_node = await _find_invited_supplier_node(
        db,
        submission_token=payload.submission_token,
        invite_code=payload.invite_code,
    )
    if supplier_node is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="无效或已使用的邀请链接，请在链主端重新签发穿透卡片后再试。",
        )

    supplier_node.supplier_name = (payload.supplier_name or supplier_node.supplier_name or "").strip()[:256]
    if payload.contact_email:
        supplier_node.contact_email = payload.contact_email.strip()[:320]
    supplier_node.tco2e_reported = payload.tco2e_reported
    supplier_node.status = SupplierStatus.submitted
    supplier_node.submission_token = None
    supplier_node.invite_code = None
    if supplier_node.data_quality_score is None:
        supplier_node.data_quality_score = Decimal("85")
    sovereign_payload: Dict[str, Any] = {}
    if payload.payload_json:
        try:
            parsed = json.loads(payload.payload_json)
            sovereign_payload = parsed if isinstance(parsed, dict) else {"raw": parsed}
        except Exception:
            sovereign_payload = {"raw": payload.payload_json}
    sovereign_payload.setdefault("isolation", "supplier_sovereign")
    sovereign_payload.setdefault("buyerVisibleFields", ["carbonIntensity", "confidenceLevel", "clIvcHash"])
    cl_hash, _timeliness = await _record_supplier_submission(
        db,
        supplier_node,
        tco2e=payload.tco2e_reported,
        sovereign_payload=sovereign_payload,
    )
    _apply_civilization_flags(supplier_node)
    db.add(supplier_node)

    workspace_id = supplier_node.workspace_id
    new_scope3 = await _scope3_coverage(workspace_id, db)

    ws_result = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    workspace: Workspace = ws_result.scalar_one()
    latest_report = await _latest_report(workspace_id, db)
    await _sync_scope3_and_risk_exposure(workspace, latest_report, new_scope3, db)

    if new_scope3 >= Decimal("0.8") and not workspace.is_complete:
        workspace.is_complete = True
        if workspace.stage == WorkspaceStage.incomplete:
            workspace.stage = WorkspaceStage.sandbox
        db.add(workspace)

    owner_result = await db.execute(
        select(User)
        .join(UserWorkspace, UserWorkspace.user_id == User.id)
        .where(
            UserWorkspace.workspace_id == workspace_id,
            UserWorkspace.role == "owner",
        )
        .limit(1)
    )
    owner: Optional[User] = owner_result.scalar_one_or_none()
    gm_awarded = Decimal("0")
    if owner is not None:
        gm_awarded = await _record_supplier_submit_gm_if_needed(db, owner.id, supplier_node)

    await db.commit()

    app_state_payload: Optional[Dict[str, Any]] = None
    if owner is not None:
        await db.refresh(owner)
        app_state_payload = jsonable_encoder(await build_app_state(owner, db))

    return SupplierSubmitResponse(
        supplier_node_id=supplier_node.id,
        workspace_name=workspace.name,
        supplier_name=supplier_node.supplier_name,
        tco2e_reported=supplier_node.tco2e_reported or Decimal("0"),
        new_scope3_coverage=new_scope3,
        gm_awarded_to_owner=gm_awarded,
        cl_ivc_hash=cl_hash,
        confidence_level=_confidence_level_label(supplier_node.data_quality_score),
        message=(
            f"供应商数据已确权入库，碳强度 {float(supplier_node.tco2e_reported or 0):.2f} tCO₂e/t · "
            f"Scope3 穿透率 {float(new_scope3) * 100:.1f}%。"
        ),
        app_state=app_state_payload,
    )


@eco_router.post(
    "/supplier-claim-confirm",
    response_model=SupplierClaimConfirmResponse,
    status_code=status.HTTP_200_OK,
    summary="H5 工厂碳管家账号认领确权（生成可核验凭证）",
)
async def supplier_claim_confirm(
    payload: SupplierClaimConfirmRequest,
    db: AsyncSession = Depends(get_db),
) -> SupplierClaimConfirmResponse:
    supplier_node: Optional[SupplierNode] = None
    if payload.supplier_node_id:
        r = await db.execute(
            select(SupplierNode).where(SupplierNode.id == payload.supplier_node_id)
        )
        supplier_node = r.scalar_one_or_none()
    if supplier_node is None:
        supplier_node = await _find_invited_supplier_node(
            db,
            submission_token=payload.submission_token,
            invite_code=payload.invite_code,
        )
    if supplier_node is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="未找到供应商节点。请先完成碳足迹提交，再认领账号。",
        )
    if supplier_node.status not in (SupplierStatus.submitted, SupplierStatus.confirmed):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请先完成 Screen2「生成碳足迹」后再认领账号。",
        )

    phone = (payload.contact_phone or "").strip()
    email = (payload.contact_email or "").strip().lower()
    channel_raw = (payload.verify_channel or "").strip().lower()
    if channel_raw in ("phone", "sms"):
        verify_channel = "phone"
    elif channel_raw in ("email", "mail"):
        verify_channel = "email"
    elif phone:
        verify_channel = "phone"
    else:
        verify_channel = "email"
    if verify_channel == "phone":
        if not phone.isdigit() or len(phone) != 11:
            raise HTTPException(status_code=400, detail="请输入有效的 11 位手机号")
    else:
        if ("@" not in email) or ("." not in email.split("@", 1)[-1]):
            raise HTTPException(status_code=400, detail="请输入有效邮箱地址用于验证码")

    now = datetime.now(timezone.utc)
    if not supplier_node.claim_certificate_id:
        supplier_node.claim_certificate_id = await _unique_claim_certificate_id(db)
    supplier_node.claim_contact_name = (payload.contact_name or "").strip()[:128]
    supplier_node.claim_phone = phone if verify_channel == "phone" else None
    supplier_node.claim_confirmed_at = now
    account_ref = phone if verify_channel == "phone" else email
    claim_blob = (
        f"认领|联系人:{supplier_node.claim_contact_name}|通道:{verify_channel}"
        f"|账号:{account_ref}|验证码:{(payload.sms_code or '').strip()[:8]}"
        f"|凭证:{supplier_node.claim_certificate_id}"
    )
    if supplier_node.contact_email:
        supplier_node.contact_email = (supplier_node.contact_email + " · " + claim_blob)[:320]
    else:
        supplier_node.contact_email = claim_blob[:320]
    _apply_civilization_flags(supplier_node)
    db.add(supplier_node)

    ws_result = await db.execute(select(Workspace).where(Workspace.id == supplier_node.workspace_id))
    workspace = ws_result.scalar_one_or_none()
    await db.commit()
    await db.refresh(supplier_node)

    cert_id = supplier_node.claim_certificate_id or ""
    verify_path = f"/static/HengAI_Supplier_H5.html?claim_verify={cert_id}"
    verify_url = verify_path

    return SupplierClaimConfirmResponse(
        claim_certificate_id=cert_id,
        supplier_name=supplier_node.supplier_name,
        contact_name=supplier_node.claim_contact_name or payload.contact_name,
        verify_channel=verify_channel,
        contact_phone_masked=_mask_phone(phone) if verify_channel == "phone" else None,
        contact_email_masked=_mask_email(email) if verify_channel == "email" else None,
        carbon_intensity=supplier_node.tco2e_reported,
        workspace_name=workspace.name if workspace else None,
        claim_confirmed_at=_dt(now) or now.isoformat(),
        verify_url=verify_url,
        message=(
            "工厂碳管家账号认领已确权落库，可凭凭证编号向链主/采购商核验。"
            + ("建议后续补充手机号用于紧急通知。" if verify_channel == "email" else "")
        ),
    )


@eco_router.get(
    "/claim-verify/{certificate_id}",
    response_model=SupplierClaimVerifyResponse,
    summary="公开核验认领凭证（扫码/分享链接）",
)
async def supplier_claim_verify(
    certificate_id: str,
    db: AsyncSession = Depends(get_db),
) -> SupplierClaimVerifyResponse:
    cid = (certificate_id or "").strip().upper()
    if not cid.startswith("CL-CLAIM-"):
        return SupplierClaimVerifyResponse(valid=False, message="凭证编号格式无效")
    r = await db.execute(
        select(SupplierNode).where(SupplierNode.claim_certificate_id == cid)
    )
    node = r.scalar_one_or_none()
    if node is None:
        return SupplierClaimVerifyResponse(valid=False, message="未找到该认领凭证，可能已失效或编号错误")
    ws_result = await db.execute(select(Workspace).where(Workspace.id == node.workspace_id))
    workspace = ws_result.scalar_one_or_none()
    ch = _claim_channel_from_blob(node.contact_email)
    account = _claim_account_from_blob(node.contact_email)
    phone_masked = _mask_phone(node.claim_phone)
    email_masked = _mask_email(account) if ch == "email" else None
    return SupplierClaimVerifyResponse(
        valid=True,
        claim_certificate_id=cid,
        supplier_name=node.supplier_name,
        contact_name=node.claim_contact_name,
        verify_channel=ch or ("phone" if node.claim_phone else None),
        contact_phone_masked=phone_masked,
        contact_email_masked=email_masked,
        carbon_intensity=node.tco2e_reported,
        workspace_name=workspace.name if workspace else None,
        claim_confirmed_at=_dt(node.claim_confirmed_at),
        message="凭证有效 · HengAI CL-IVC 账号认领已确权",
    )


@router.get(
    "/supplier-conclusion/{node_id}",
    response_model=SupplierConclusionResponse,
    summary="甲方只读 · 供应商碳强度结论（不含原始数据）",
)
async def get_supplier_conclusion(
    node_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SupplierConclusionResponse:
    ws = await _get_primary_workspace(current_user, db)
    if ws is None:
        raise HTTPException(status_code=404, detail="未找到企业工作台")
    r = await db.execute(
        select(SupplierNode).where(
            SupplierNode.id == node_id,
            SupplierNode.workspace_id == ws.id,
        )
    )
    node = r.scalar_one_or_none()
    if node is None:
        raise HTTPException(status_code=404, detail="供应商节点不存在或无权访问")
    if node.status not in (SupplierStatus.submitted, SupplierStatus.confirmed):
        raise HTTPException(status_code=400, detail="该供应商尚未完成填报")
    collab = _collaboration_score_for_supplier(node)
    return SupplierConclusionResponse(
        supplier_node_id=node.id,
        supplier_name=node.supplier_name,
        carbon_intensity=node.tco2e_reported,
        confidence_level=_confidence_level_label(node.data_quality_score),
        cl_ivc_hash=node.cl_ivc_hash,
        submitted_at=_dt(node.submitted_at),
        collaboration_score=collab,
        is_premium_partner=collab >= 80,
        message="甲方仅可查阅碳强度结论，不可访问原始数据",
    )


@eco_router.get(
    "/supplier-sovereign",
    response_model=SupplierSovereignResponse,
    summary="供应商主权 · 凭 CL-IVC 哈希访问原始填报载荷",
)
async def get_supplier_sovereign(
    hash: str,
    db: AsyncSession = Depends(get_db),
) -> SupplierSovereignResponse:
    h = (hash or "").strip().upper()
    if not h.startswith("CL-IVC-"):
        return SupplierSovereignResponse(valid=False, message="哈希格式无效")
    r = await db.execute(select(SupplierNode).where(SupplierNode.cl_ivc_hash == h))
    node = r.scalar_one_or_none()
    if node is None:
        return SupplierSovereignResponse(valid=False, message="未找到匹配的 CL-IVC 链上记录")
    payload = _parse_sovereign_payload(node.sovereign_payload_json)
    return SupplierSovereignResponse(
        valid=True,
        cl_ivc_hash=node.cl_ivc_hash,
        supplier_name=node.supplier_name,
        carbon_intensity=node.tco2e_reported,
        sovereign_payload=payload,
        submitted_at=_dt(node.submitted_at),
        message="主权载荷已解密 · 此数据属于供应商，甲方不可访问",
    )


@router.post("/decision-package", response_model=DecisionPackageResponse, summary="决策层呈送包生成记录")
async def decision_package_submit(
    payload: DecisionPackageRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DecisionPackageResponse:
    gm_earned = DECISION_PACKAGE_GM
    bal_before = await _sum_gm(current_user.id, db)
    memo = (payload.body or "")[:512]
    db.add(
        GMLedger(
            user_id=current_user.id,
            action=LedgerAction.earn,
            amount=gm_earned,
            balance_snap=bal_before + gm_earned,
            source_ref="decision_package",
            memo=f"决策包:{payload.title[:120]} | {memo}",
        )
    )
    await db.commit()
    return DecisionPackageResponse(
        gm_earned=gm_earned,
        message="决策层呈送包已登记",
    )


@router.post("/regulation-read", response_model=RegulationReadResponse, summary="企业法规库阅读落库")
async def regulation_read(
    payload: RegulationReadRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RegulationReadResponse:
    rid = (payload.regulation_id or "").strip()
    if not rid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="regulation_id 不能为空")
    title = (payload.title or rid).strip()[:256]
    progress = int(payload.progress_pct if payload.progress_pct is not None else 100)
    progress = max(0, min(100, progress))
    source_ref = f"{REGULATION_READ_PREFIX}{rid}"

    existing_r = await db.execute(
        select(GMLedger)
        .where(GMLedger.user_id == current_user.id, GMLedger.source_ref == source_ref)
        .order_by(GMLedger.created_at.desc())
        .limit(1)
    )
    existing = existing_r.scalar_one_or_none()
    if existing:
        read_at = _dt(existing.created_at) or datetime.now(timezone.utc).isoformat()
        usr_row = await db.execute(select(User).where(User.id == current_user.id))
        fresh_user = usr_row.scalar_one()
        dna = await build_app_state(fresh_user, db)
        return RegulationReadResponse(
            regulation_id=rid,
            read_at=read_at,
            progress_pct=progress,
            gm_earned=Decimal("0"),
            already_read=True,
            message="本篇法规已记录过阅读",
            app_state=jsonable_encoder(dna),
        )

    gm_earned = REGULATION_READ_GM
    bal_before = await _sum_gm(current_user.id, db)
    now = datetime.now(timezone.utc)
    db.add(
        GMLedger(
            user_id=current_user.id,
            action=LedgerAction.earn,
            amount=gm_earned,
            balance_snap=bal_before + gm_earned,
            source_ref=source_ref,
            memo=f"阅读法规：{title}",
        )
    )
    await db.commit()
    usr_row = await db.execute(select(User).where(User.id == current_user.id))
    fresh_user = usr_row.scalar_one()
    dna = await build_app_state(fresh_user, db)
    read_at = _dt(now) or now.isoformat()
    return RegulationReadResponse(
        regulation_id=rid,
        read_at=read_at,
        progress_pct=progress,
        gm_earned=gm_earned,
        already_read=False,
        message="阅读已记入绿印流水",
        app_state=jsonable_encoder(dna),
    )


@router.post("/dld-apply", response_model=DLDApplyResponse, summary="DLD 绿色信贷申请登记")
async def dld_apply(
    payload: DLDApplyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DLDApplyResponse:
    gm_earned = DLD_APPLY_GM
    bal_before = await _sum_gm(current_user.id, db)
    amt = payload.requested_amount_cny
    purpose = (payload.purpose or "")[:400]
    db.add(
        GMLedger(
            user_id=current_user.id,
            action=LedgerAction.earn,
            amount=gm_earned,
            balance_snap=bal_before + gm_earned,
            source_ref="dld_apply",
            memo=f"DLD申请 金额:{amt} 用途:{purpose}",
        )
    )
    await db.commit()
    return DLDApplyResponse(
        gm_earned=gm_earned,
        message="绿色信贷申请已受理登记",
    )


# ─── 序列化工具 ───────────────────────────────────────────────────────────────

def _dec(v: Optional[Decimal]) -> Optional[float]:
    """Decimal → float，None 保持 None（前端判空用）。"""
    return float(v) if v is not None else None


def _gm_scalar(v: Optional[Decimal]) -> float:
    """GM 类字段：禁止 null，无数据时为 0.0。"""
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _dt(v: Optional[datetime]) -> Optional[str]:
    """datetime → ISO8601 字符串。"""
    return v.isoformat() if v else None


def _supplier_invite_issued(s: SupplierNode) -> bool:
    return bool((s.invite_code or "").strip())


def _serialize_supplier(s: SupplierNode) -> Dict:
    _, _, suggestion = _civilization_flags_for_supplier(s)
    responded = s.status in (SupplierStatus.submitted, SupplierStatus.confirmed)
    invite_issued = _supplier_invite_issued(s)
    collab = _collaboration_score_for_supplier(s)
    conf_label = _confidence_level_label(s.data_quality_score)
    cl_hash = s.cl_ivc_hash
    if not cl_hash and responded and s.submitted_at:
        cl_hash = _compute_cl_ivc_hash(s.supplier_name, s.submitted_at, s.tco2e_reported or 0, s.id)
    timeliness = float(s.report_timeliness) if s.report_timeliness is not None else 0.0
    if timeliness <= 0 and responded:
        timeliness = _timeliness_score(s.created_at, s.submitted_at) if s.submitted_at else 0.82
    consecutive = int(s.consecutive_submissions or 0)
    if consecutive <= 0 and responded:
        consecutive = max(1, int(s.submission_count or 0))
    return {
        "id"                : str(s.id),
        "supplierName"      : s.supplier_name,
        "supplierCreditCode": s.supplier_credit_code,
        "status"            : s.status.value,
        "inviteIssued"      : invite_issued,
        "responded"         : responded,
        "tco2eReported"     : _dec(s.tco2e_reported),
        "dataQualityScore"  : _dec(s.data_quality_score),
        "confidenceLevel"   : conf_label,
        "collaborationScore": collab,
        "consecutiveSubmissions": consecutive,
        "submissionCount"   : int(s.submission_count or 0),
        "reportTimeliness"  : round(timeliness, 2) if responded else 0,
        "isPremiumPartner"  : collab >= 80,
        "clIvcHash"         : cl_hash,
        "isInsured"         : bool(s.is_insured),
        "isWhiteListed"     : bool(s.is_white_listed),
        "insuranceSuggestion": suggestion,
        "submittedAt"       : _dt(s.submitted_at),
        "submissionToken"   : s.submission_token,
        "inviteCode"        : s.invite_code,
        "carbonIntensityIndex": _dec(s.tco2e_reported),
        "slotIndex"         : _parse_supplier_slot(s.supplier_name),
        "claimCertificateId": s.claim_certificate_id,
        "claimConfirmedAt"  : _dt(s.claim_confirmed_at),
        "claimContactName"  : s.claim_contact_name,
        "claimPhoneMasked"  : _mask_phone(s.claim_phone) if s.claim_phone else None,
    }


def _mask_phone(phone: Optional[str]) -> Optional[str]:
    p = (phone or "").strip()
    if len(p) < 7:
        return p or None
    return p[:3] + "****" + p[-4:]


def _mask_email(email: Optional[str]) -> Optional[str]:
    e = (email or "").strip()
    if "@" not in e:
        return e or None
    local, domain = e.split("@", 1)
    if len(local) <= 2:
        local_masked = (local[:1] or "*") + "*"
    else:
        local_masked = local[:2] + "*" * (len(local) - 2)
    return f"{local_masked}@{domain}"


def _claim_channel_from_blob(blob: Optional[str]) -> Optional[str]:
    txt = blob or ""
    m = re.search(r"通道:(phone|email)", txt)
    return m.group(1) if m else None


def _claim_account_from_blob(blob: Optional[str]) -> Optional[str]:
    txt = blob or ""
    m = re.search(r"账号:([^|·]+)", txt)
    return m.group(1).strip() if m else None


def _new_claim_certificate_id() -> str:
    suffix = secrets.token_hex(4).upper()
    return f"CL-CLAIM-{suffix}"


async def _unique_claim_certificate_id(db: AsyncSession) -> str:
    for _ in range(12):
        cid = _new_claim_certificate_id()
        exists = await db.execute(
            select(SupplierNode.id).where(SupplierNode.claim_certificate_id == cid).limit(1)
        )
        if exists.scalar_one_or_none() is None:
            return cid
    raise HTTPException(status_code=500, detail="认领凭证编号生成失败")


def _serialize_badge(b: UserBadge) -> Dict:
    return {
        "id"       : str(b.id),
        "badgeCode": b.badge_code,
        "badgeName": b.badge_name,
        "awardedAt": _dt(b.awarded_at),
    }


def _next_action(
    phase: str,
    ws: Optional[Workspace],
    tco2e: Decimal,
    supplier_count: int,
) -> Optional[str]:
    if phase == "Phase1":
        if ws is None:
            return "创建企业空间，开始碳合规之旅"
        return "完善企业信息（信用代码+行业），解锁碳风险全景图"
    if phase == "Phase2":
        if tco2e == 0:
            return "录入用能数据，AI 立即核算 CBAM 风险敞口"
        if supplier_count == 0:
            return "邀请首批供应商，穿透 Scope3 数据缺口"
        return "生成 ROI 对冲报告，锁定合规升级方案"
    return None  # Phase3 全量开放，无需引导
