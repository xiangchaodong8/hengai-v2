# hub.py — HengAI V3.0 上帝接口逻辑层
# GET /api/v1/hub/overview · 宪章§4 规定的唯一数据入口
# 严禁 Mock 硬编码！严禁写死"王磊"！
#
# 生产环境路由挂载以 main.py 为准：当前仅挂载 hub_engine.router。
# 全量 AppState DNA 的唯一聚合实现为 hub_engine.build_app_state —— 请勿在本文件复制该逻辑以免漂移。

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from auth import get_current_user
from hub_engine import (
    _apply_civilization_flags,
    _civilization_flags_for_supplier,
    build_app_state,
    compute_generational_gm,
)
from models import (
    CBAMReport,
    GMLedger,
    LedgerAction,
    SupplierNode,
    SupplierStatus,
    User,
    UserWorkspace,
    Workspace,
    WorkspaceStage,
)
from schemas import (
    CBAMReportSummary,
    CBAMStatusSchema,
    CompanySchema,
    HubOverviewResponse,
    ImpactSchema,
    PhaseMetaSchema,
    PhaseSchema,
    SupplierNodeSummary,
    SupplierStatusSchema,
    SupplierSubmitRequest,
    SupplierSubmitResponse,
    UserSchema,
    WorkspaceUpdateRequest,
    WorkspaceUpdateResponse,
    WorkspaceStageSchema,
)

router = APIRouter(tags=["全域中心"])
WORKSPACE_PROFILE_GM_REWARD = Decimal("50")


# ===========================================================================
# 🔑 核心算法：resolve_phase
# 宪章§3 三阶段状态机判定逻辑——此函数是整个产品的状态核心
# ===========================================================================

def resolve_phase(workspace: Optional[Workspace]) -> PhaseSchema:
    """
    根据 Workspace 状态判定当前所处阶段。

    Phase 1 — 个体启蒙 (The Enlightenment)
        判定条件：workspace 为 None，或 is_complete == False
        意义：用户尚未完成企业信息录入，处于纯个人学习状态。

    Phase 2 — 业务映射 (The Reality Projection)
        判定条件：is_complete == True AND stage == 'Sandbox'
        意义：企业信息已填完但尚未通过认证付费，显示"照妖镜"风险。

    Phase 3 — 全域共治 (The Governance)
        判定条件：stage == 'Certified'
        意义：全量功能解锁，海关直连 / DLD 信贷进入工作状态。
    """
    if workspace is None:
        return PhaseSchema.phase1

    if workspace.stage == WorkspaceStage.certified:
        return PhaseSchema.phase3

    if workspace.is_complete and workspace.stage == WorkspaceStage.sandbox:
        return PhaseSchema.phase2

    # 兜底：is_complete == False（含 Incomplete stage）
    return PhaseSchema.phase1


def build_phase_meta(phase: PhaseSchema) -> PhaseMetaSchema:
    """
    根据阶段返回前端渲染所需的元数据：
    - phase_label：宪章中文阶段名
    - unlock_features：白名单功能 slug
    - next_action：核心逼单点文案
    """
    if phase == PhaseSchema.phase1:
        return PhaseMetaSchema(
            current_phase="Phase1",
            phase_label="个体启蒙 · The Enlightenment",
            unlock_features=[
                "personal_dashboard",
                "learning_center",
                "gm_wallet",
                "earth_citizen_profile",
            ],
            next_action="完善企业信息，解锁企业碳风险全景图",
        )

    if phase == PhaseSchema.phase2:
        return PhaseMetaSchema(
            current_phase="Phase2",
            phase_label="业务映射 · The Reality Projection",
            unlock_features=[
                "personal_dashboard",
                "learning_center",
                "gm_wallet",
                "earth_citizen_profile",
                "cbam_risk_mirror",        # 照妖镜·红字风险
                "roi_hedge_report",        # 生成 ROI 对冲报告（逼单点）
                "supplier_invite",         # 邀请供应商（逼单点）
                "scope3_tracker",
            ],
            next_action="生成 ROI 对冲报告 · 或邀请供应商完成 Scope3 穿透",
        )

    # Phase 3
    return PhaseMetaSchema(
        current_phase="Phase3",
        phase_label="全域共治 · The Governance",
        unlock_features=[
            "personal_dashboard",
            "learning_center",
            "gm_wallet",
            "earth_citizen_profile",
            "cbam_risk_mirror",
            "roi_hedge_report",
            "supplier_invite",
            "scope3_tracker",
            "customs_direct_connect",   # 海关直连（大国重器）
            "dld_credit",               # DLD 信贷（大国重器）
            "corporate_civilization",   # 企业文明全景
            "supply_chain_governance",
        ],
        next_action=None,  # Phase3 无需引导，全量开放
    )


# ===========================================================================
# 🔑 动态汇算：gm_balance（宪章§4-后端-3）
# 严禁读取静态字段！必须实时 SUM ledger 表
# ===========================================================================

async def compute_gm_balance(user_id: uuid.UUID, db: AsyncSession) -> Decimal:
    """
    实时聚合 GMLedger.amount SUM。
    正数为获得，负数为消费，SUM 即为实时余额。
    """
    result = await db.execute(
        select(func.coalesce(func.sum(GMLedger.amount), Decimal("0")))
        .where(GMLedger.user_id == user_id)
    )
    return result.scalar_one()


# ===========================================================================
# 🔑 scope3_coverage 重算（宪章§4-后端-2 自动化触发）
# ===========================================================================

async def recalculate_scope3_coverage(
    workspace_id: uuid.UUID, db: AsyncSession
) -> Decimal:
    """
    Scope3 覆盖率 = 已提交供应商节点数 / 总邀请供应商节点数。
    分母为 0 时返回 0，防止除零异常。
    """
    total_result = await db.execute(
        select(func.count(SupplierNode.id))
        .where(SupplierNode.workspace_id == workspace_id)
    )
    submitted_result = await db.execute(
        select(func.count(SupplierNode.id))
        .where(
            SupplierNode.workspace_id == workspace_id,
            SupplierNode.status == "submitted",
        )
    )
    total     = total_result.scalar_one() or 0
    submitted = submitted_result.scalar_one() or 0

    if total == 0:
        return Decimal("0")
    return (Decimal(submitted) / Decimal(total)).quantize(Decimal("0.0001"))


# ===========================================================================
# 🔑 Impact 宏观数据汇算
# ===========================================================================

async def compute_impact(
    workspace: Optional[Workspace], db: AsyncSession
) -> ImpactSchema:
    """
    Phase1 时 workspace 为 None，全部返回 null 空壳。
    Phase2/3 从最新 CBAMReport 聚合 Impact 数据。
    """
    if workspace is None:
        return ImpactSchema(
            tco2e_total=None,
            global_rank=None,
            scope3_coverage=None,
            risk_exposure_eur=None,
        )

    # 取最新一份已提交或已认证的报告
    report_result = await db.execute(
        select(CBAMReport)
        .where(
            CBAMReport.workspace_id == workspace.id,
            CBAMReport.status.in_(["submitted", "verified"]),
        )
        .order_by(CBAMReport.submitted_at.desc())
        .limit(1)
    )
    latest_report: Optional[CBAMReport] = report_result.scalar_one_or_none()

    scope3 = await recalculate_scope3_coverage(workspace.id, db)

    if latest_report is None:
        return ImpactSchema(
            tco2e_total=None,
            global_rank=None,
            scope3_coverage=scope3 if scope3 > 0 else None,
            risk_exposure_eur=None,
        )

    return ImpactSchema(
        tco2e_total=latest_report.tco2e_total,
        global_rank=latest_report.global_rank,
        scope3_coverage=scope3,
        risk_exposure_eur=latest_report.risk_exposure_eur,
    )


# ===========================================================================
# 📡 GET /api/v1/hub/overview — 上帝接口
# ===========================================================================

@router.get(
    "/overview",
    response_model=HubOverviewResponse,
    summary="全域概览（唯一数据入口）",
    description=(
        "跨表聚合 User / Workspace / GMLedger / CBAMReport 全量实时数据。"
        "前端 window.AppState 绑定此接口返回值，所有数字齐步跳动。"
    ),
)
async def hub_overview(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> HubOverviewResponse:
    """
    宪章§4-后端-1：唯一入口，跨表实时聚合。
    执行顺序：
      1. 实时 SUM GMLedger → gm_balance
      2. 查询当前用户关联的 Workspace（取第一个；企业轨扩展时支持多租户）
      3. resolve_phase → PhaseSchema
      4. 聚合 Impact 数据
      5. 查询最近 5 份 CBAM 报告
      6. 查询供应商节点列表
      7. 组装 HubOverviewResponse 返回
    """

    # ── Step 1: 实时 GM 余额（严禁读静态字段）─────────────────────────────
    gm_balance = await compute_gm_balance(current_user.id, db)
    generational_gm = await compute_generational_gm(current_user.id, db)

    # ── Step 2: 查找关联 Workspace ─────────────────────────────────────────
    # 通过 user_workspace 关联表查询，取角色最高优先级的工作空间
    ws_result = await db.execute(
        select(Workspace)
        .join(Workspace.members)
        .where(User.id == current_user.id)
        .order_by(Workspace.created_at.asc())
        .limit(1)
    )
    workspace: Optional[Workspace] = ws_result.scalar_one_or_none()

    # ── Step 3: 阶段判定 ────────────────────────────────────────────────────
    phase      = resolve_phase(workspace)
    phase_meta = build_phase_meta(phase)

    # ── Step 4: Impact 数据聚合 ─────────────────────────────────────────────
    impact = await compute_impact(workspace, db)

    # ── Step 5: 最近 CBAM 报告（最多 5 份）─────────────────────────────────
    recent_reports: List[CBAMReportSummary] = []
    if workspace is not None:
        reports_result = await db.execute(
            select(CBAMReport)
            .where(CBAMReport.workspace_id == workspace.id)
            .order_by(CBAMReport.created_at.desc())
            .limit(5)
        )
        raw_reports = reports_result.scalars().all()
        recent_reports = [
            CBAMReportSummary(
                id=r.id,
                reporting_period=r.reporting_period,
                status=CBAMStatusSchema(r.status.value),
                tco2e_total=r.tco2e_total,
                risk_exposure_eur=r.risk_exposure_eur,
                submitted_at=r.submitted_at,
            )
            for r in raw_reports
        ]

    # ── Step 6: 供应商节点列表 ──────────────────────────────────────────────
    supplier_nodes_out: List[SupplierNodeSummary] = []
    if workspace is not None:
        sn_result = await db.execute(
            select(SupplierNode)
            .where(SupplierNode.workspace_id == workspace.id)
            .order_by(SupplierNode.created_at.desc())
        )
        raw_nodes = sn_result.scalars().all()
        supplier_nodes_out = []
        for sn in raw_nodes:
            _, _, suggestion = _civilization_flags_for_supplier(sn)
            supplier_nodes_out.append(
                SupplierNodeSummary(
                    id=sn.id,
                    supplier_name=sn.supplier_name,
                    supplier_credit_code=sn.supplier_credit_code,
                    status=SupplierStatusSchema(sn.status.value),
                    tco2e_reported=sn.tco2e_reported,
                    data_quality_score=sn.data_quality_score,
                    is_insured=bool(sn.is_insured),
                    is_white_listed=bool(sn.is_white_listed),
                    insurance_suggestion=suggestion,
                    submitted_at=sn.submitted_at,
                )
            )

    # ── Step 7: 动态生成 name（严禁硬编码）─────────────────────────────────
    display_name = current_user.name or current_user.email.split("@")[0]

    # ── Step 8: 组装 UserSchema ─────────────────────────────────────────────
    user_schema = UserSchema(
        id=current_user.id,
        email=current_user.email,
        backup_email=current_user.backup_email,
        name=display_name,
        gm_balance=gm_balance,          # 实时聚合值，非 cache 字段
        gm_generational=generational_gm,
        current_level=current_user.current_level,
        tokens_left=current_user.tokens_left,
        created_at=current_user.created_at,
    )

    # ── Step 9: 组装 CompanySchema（Phase1 返回 null）──────────────────────
    company_schema: Optional[CompanySchema] = None
    if workspace is not None:
        company_schema = CompanySchema(
            id=workspace.id,
            name=workspace.name,
            credit_code=workspace.credit_code,
            stage=WorkspaceStageSchema(workspace.stage.value),
            is_complete=workspace.is_complete,
            industry_code=workspace.industry_code,
            country_code=workspace.country_code,
        )

    # ── Final Assembly ───────────────────────────────────────────────────────
    return HubOverviewResponse(
        user=user_schema,
        company=company_schema,
        impact=impact,
        phase_meta=phase_meta,
        recent_reports=recent_reports,
        supplier_nodes=supplier_nodes_out,
        server_time=datetime.now(timezone.utc),
    )


@router.post(
    "/workspace-update",
    response_model=WorkspaceUpdateResponse,
    summary="更新企业数字档案",
)
async def workspace_update(
    payload: WorkspaceUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceUpdateResponse:
    ws_result = await db.execute(
        select(Workspace)
        .join(Workspace.members)
        .where(User.id == current_user.id)
        .order_by(Workspace.created_at.asc())
        .limit(1)
    )
    workspace: Optional[Workspace] = ws_result.scalar_one_or_none()
    if workspace is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="未找到当前用户关联的企业空间",
        )

    new_name = str(payload.name or "").strip()
    new_code = str(payload.credit_code or "").strip().upper()
    new_industry = str(payload.industry_code or "").strip().lower()
    if not new_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="企业名称不能为空")

    if new_code:
        dup_result = await db.execute(
            select(Workspace.id).where(
                Workspace.credit_code == new_code,
                Workspace.id != workspace.id,
            )
        )
        if dup_result.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="该统一社会信用代码已被其他企业占用",
            )

    was_empty_credit = not bool((workspace.credit_code or "").strip())
    workspace.name = new_name
    workspace.industry_code = new_industry or None
    workspace.credit_code = new_code or None

    # —— V3.2 完整字段落库（None 即跳过，不覆盖已有值） ——
    def _strip_or_none(v):
        if v is None:
            return None
        s = str(v).strip()
        return s if s else None

    if payload.main_product is not None:
        workspace.main_product = _strip_or_none(payload.main_product)
    if payload.hs_code is not None:
        workspace.hs_code = _strip_or_none(payload.hs_code)
    if payload.annual_capacity_tons is not None:
        workspace.annual_capacity_tons = payload.annual_capacity_tons
    if payload.annual_export_tons is not None:
        workspace.annual_export_tons = payload.annual_export_tons
    if payload.export_countries is not None:
        workspace.export_countries = _strip_or_none(payload.export_countries)
    if payload.annual_power_kwh is not None:
        workspace.annual_power_kwh = payload.annual_power_kwh
    if payload.power_grid is not None:
        workspace.power_grid = _strip_or_none(payload.power_grid)
    if payload.contact_email is not None:
        workspace.contact_email = _strip_or_none(payload.contact_email)

    gm_earned = Decimal("0")
    if was_empty_credit and new_code:
        workspace.is_complete = True
        if workspace.stage == WorkspaceStage.incomplete:
            workspace.stage = WorkspaceStage.sandbox
        current_balance = await compute_gm_balance(current_user.id, db)
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


# ===========================================================================
# 📡 POST /eco/supplier-submit — 供应商 H5 提交（自动化链路触发）
# 宪章§4-后端-2：提交 → 重算 scope3 → 更新 Phase → 给链主加 GM
# ===========================================================================

SUPPLIER_SUBMIT_GM_REWARD = Decimal("50")   # 每个供应商提交奖励的 GM 数（可配置化）


@router.post(
    "../../eco/supplier-submit",   # 实际注册为 /eco/supplier-submit，此处绕开 prefix
    response_model=SupplierSubmitResponse,
    summary="供应商 H5 提交（触发自动化重算链路）",
    tags=["eco"],
)
async def supplier_submit(
    payload: SupplierSubmitRequest,
    db: AsyncSession = Depends(get_db),
) -> SupplierSubmitResponse:
    """
    宪章§4-后端-2 自动化逻辑：
      ① 校验一次性令牌，找到 SupplierNode
      ② 更新 SupplierNode.status = submitted，写入碳数据
      ③ 重算链主 Workspace 的 scope3_coverage（写入最新 CBAMReport）
      ④ 判定是否触发 Phase 升级（is_complete 检查）
      ⑤ 给链主 User 写入 GMLedger（奖励 GM）
    """

    # ── ① 令牌校验 ─────────────────────────────────────────────────────────
    sn_result = await db.execute(
        select(SupplierNode).where(
            SupplierNode.submission_token == payload.submission_token,
            SupplierNode.status == SupplierStatus.invited,
        )
    )
    supplier_node: Optional[SupplierNode] = sn_result.scalar_one_or_none()

    if supplier_node is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="无效或已使用的提交令牌，请联系链主重新邀请。",
        )

    # ── ② 更新供应商节点 ────────────────────────────────────────────────────
    supplier_node.supplier_name    = payload.supplier_name
    supplier_node.contact_email    = payload.contact_email
    supplier_node.tco2e_reported   = payload.tco2e_reported
    supplier_node.status           = SupplierStatus.submitted
    supplier_node.submitted_at     = datetime.now(timezone.utc)
    supplier_node.submission_token = None   # 令牌一次性消费，置空防复用
    if supplier_node.data_quality_score is None:
        supplier_node.data_quality_score = Decimal("85")
    _apply_civilization_flags(supplier_node)
    db.add(supplier_node)

    # ── ③ 重算 scope3_coverage ──────────────────────────────────────────────
    workspace_id     = supplier_node.workspace_id
    new_scope3       = await recalculate_scope3_coverage(workspace_id, db)

    # 更新最新 CBAMReport 的 scope3_coverage（若存在）
    latest_report_result = await db.execute(
        select(CBAMReport)
        .where(CBAMReport.workspace_id == workspace_id)
        .order_by(CBAMReport.created_at.desc())
        .limit(1)
    )
    latest_report: Optional[CBAMReport] = latest_report_result.scalar_one_or_none()
    if latest_report:
        latest_report.scope3_coverage = new_scope3
        db.add(latest_report)

    # ── ④ 查找链主 Workspace，判定 Phase 是否变更 ─────────────────────────
    ws_result = await db.execute(
        select(Workspace).where(Workspace.id == workspace_id)
    )
    workspace: Workspace = ws_result.scalar_one()
    workspace_name = workspace.name

    # 如果 Scope3 覆盖率 >= 0.8（80%），自动标记 is_complete（可按业务调整阈值）
    if new_scope3 >= Decimal("0.8") and not workspace.is_complete:
        workspace.is_complete = True
        if workspace.stage == WorkspaceStage.incomplete:
            workspace.stage = WorkspaceStage.sandbox
        db.add(workspace)

    # ── ⑤ 查找链主 User，写入 GM 奖励账本 ─────────────────────────────────
    # 取 Workspace 第一个 owner（role='owner'）
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
        # 计算当前余额快照
        current_balance = await compute_gm_balance(owner.id, db)
        new_balance_snap = current_balance + SUPPLIER_SUBMIT_GM_REWARD

        ledger_entry = GMLedger(
            user_id=owner.id,
            action=LedgerAction.earn,
            amount=SUPPLIER_SUBMIT_GM_REWARD,
            balance_snap=new_balance_snap,
            source_ref=f"supplier_submit/{supplier_node.id}",
            memo=f"供应商「{payload.supplier_name}」完成碳数据提交",
        )
        db.add(ledger_entry)
        gm_awarded = SUPPLIER_SUBMIT_GM_REWARD

    # ── Commit ──────────────────────────────────────────────────────────────
    await db.commit()

    return SupplierSubmitResponse(
        supplier_node_id=supplier_node.id,
        workspace_name=workspace_name,
        new_scope3_coverage=new_scope3,
        gm_awarded_to_owner=gm_awarded,
        message=f"供应商数据提交成功，链主 Scope3 覆盖率已更新至 {new_scope3:.1%}。",
    )


# ===========================================================================
# 📡 辅助接口：Phase 状态查询（轻量，供前端轮询用）
# ===========================================================================

@router.get(
    "/phase",
    summary="查询当前用户阶段（轻量）",
    response_model=PhaseMetaSchema,
)
async def get_current_phase(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PhaseMetaSchema:
    """
    轻量接口，仅返回 PhaseMetaSchema，不做完整聚合。
    适合前端路由守卫和功能锁判定。
    """
    ws_result = await db.execute(
        select(Workspace)
        .join(Workspace.members)
        .where(User.id == current_user.id)
        .limit(1)
    )
    workspace = ws_result.scalar_one_or_none()
    phase = resolve_phase(workspace)
    return build_phase_meta(phase)
