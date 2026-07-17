# models.py — HengAI V3.1 最终数据库图纸
# 全字段覆盖版：支持 hub_engine.py 吐出完整 AppState DNA
from __future__ import annotations
import enum, uuid
from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from sqlalchemy import (BigInteger, Boolean, DateTime, Enum, ForeignKey,
    Integer, Numeric, String, Text, UniqueConstraint, func)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

class Base(DeclarativeBase):
    pass

# ─── Enums ────────────────────────────────────────────────────────────────────
class WorkspaceStage(str, enum.Enum):
    incomplete = "Incomplete"
    sandbox    = "Sandbox"
    certified  = "Certified"

class LedgerAction(str, enum.Enum):
    earn = "earn"; spend = "spend"; adjust = "adjust"

class CBAMStatus(str, enum.Enum):
    draft = "draft"; submitted = "submitted"; verified = "verified"; rejected = "rejected"

class SupplierStatus(str, enum.Enum):
    invited = "invited"; submitted = "submitted"; confirmed = "confirmed"

class UserTier(str, enum.Enum):
    seed = "Seed"; sprout = "Sprout"; guardian = "Guardian"; pioneer = "Pioneer"; sovereign = "Sovereign"

# ─── 关联表 ───────────────────────────────────────────────────────────────────
class UserWorkspace(Base):
    __tablename__ = "user_workspace"
    user_id      : Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    workspace_id : Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True)
    role         : Mapped[str]       = mapped_column(String(32), default="member", nullable=False)
    joined_at    : Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now())

# ─── Table 1: User ────────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"
    id               : Mapped[uuid.UUID]         = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email            : Mapped[str]               = mapped_column(String(320), unique=True, nullable=False, index=True)
    backup_email     : Mapped[Optional[str]]     = mapped_column(String(320), nullable=True)
    name             : Mapped[Optional[str]]     = mapped_column(String(128), nullable=True)
    avatar_url       : Mapped[Optional[str]]     = mapped_column(String(512), nullable=True)
    hashed_password  : Mapped[str]               = mapped_column(String(256), nullable=False)
    tier             : Mapped[UserTier]          = mapped_column(Enum(UserTier), default=UserTier.seed, nullable=False)
    current_level    : Mapped[int]               = mapped_column(Integer, default=1, nullable=False)
    total_co2e_saved : Mapped[Decimal]           = mapped_column(Numeric(20,4), default=Decimal("0"), nullable=False)
    badge_count      : Mapped[int]               = mapped_column(Integer, default=0, nullable=False)
    gm_balance_cache : Mapped[Decimal]           = mapped_column(Numeric(20,4), default=Decimal("0"), nullable=False, comment="禁止作为权威来源")
    tokens_left      : Mapped[int]               = mapped_column(BigInteger, default=10000, nullable=False)
    tokens_used      : Mapped[int]               = mapped_column(BigInteger, default=0, nullable=False)
    compliance_score : Mapped[int]               = mapped_column(Integer, default=0, nullable=False)
    is_active        : Mapped[bool]              = mapped_column(Boolean, default=True, nullable=False)
    last_login_at    : Mapped[Optional[datetime]]= mapped_column(DateTime(timezone=True), nullable=True)
    reg_date         : Mapped[datetime]          = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at       : Mapped[datetime]          = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at       : Mapped[datetime]          = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    workspaces  : Mapped[List["Workspace"]] = relationship("Workspace", secondary="user_workspace", back_populates="members", lazy="selectin")
    gm_ledger   : Mapped[List["GMLedger"]]  = relationship("GMLedger", back_populates="user", cascade="all, delete-orphan")
    cbam_reports: Mapped[List["CBAMReport"]]= relationship("CBAMReport", back_populates="owner")
    badges      : Mapped[List["UserBadge"]] = relationship("UserBadge", back_populates="user", cascade="all, delete-orphan")

# ─── Table 2: Workspace ───────────────────────────────────────────────────────
class Workspace(Base):
    __tablename__ = "workspaces"
    id                       : Mapped[uuid.UUID]         = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name                     : Mapped[str]               = mapped_column(String(256), nullable=False)
    credit_code              : Mapped[Optional[str]]     = mapped_column(String(64), nullable=True, unique=True, index=True)
    stage                    : Mapped[WorkspaceStage]    = mapped_column(Enum(WorkspaceStage), default=WorkspaceStage.incomplete, nullable=False)
    is_complete              : Mapped[bool]              = mapped_column(Boolean, default=False, nullable=False)
    industry_code            : Mapped[Optional[str]]     = mapped_column(String(32), nullable=True)
    industry_label           : Mapped[Optional[str]]     = mapped_column(String(64), nullable=True)
    region_tag               : Mapped[Optional[str]]     = mapped_column(
        String(32), nullable=True, comment="地域标签 gd/guangdong/广东 · GD-ETS 2026 政策感知"
    )
    country_code             : Mapped[Optional[str]]     = mapped_column(String(8), nullable=True)
    contact_email            : Mapped[Optional[str]]     = mapped_column(String(320), nullable=True)
    annual_revenue           : Mapped[Optional[Decimal]] = mapped_column(Numeric(20,4), nullable=True)
    employee_count           : Mapped[Optional[int]]     = mapped_column(Integer, nullable=True)
    risk_exposure_eur_cache  : Mapped[Optional[Decimal]] = mapped_column(Numeric(20,4), nullable=True)
    compliance_level         : Mapped[int]               = mapped_column(Integer, default=0, nullable=False)
    declared_supplier_count  : Mapped[Optional[int]]     = mapped_column(Integer, nullable=True)
    # —— V3.3 工业原厂因子确权（仅脱敏系数落库，工序绝对能耗严禁入库）——
    verified_factor          : Mapped[Optional[Decimal]] = mapped_column(
        Numeric(20, 4), nullable=True, comment="经原厂确权后的单位产品碳强度 tCO2e/t"
    )
    verified_factor_yoy_pct  : Mapped[Optional[Decimal]] = mapped_column(
        Numeric(8, 4), nullable=True, comment="同比增减率 %，相对上一申报期"
    )
    verified_factor_cert_id  : Mapped[Optional[str]]     = mapped_column(
        String(96), nullable=True, unique=True, index=True,
        comment="CL-COP-XXXX / CL-GTCID-* 确权编号（精算芯并网可长于32）",
    )
    verification_code        : Mapped[Optional[str]]     = mapped_column(
        String(64), nullable=True, unique=True, index=True,
        comment="GTCID 批次核验码 · 年月+产线 · 供下游 CBAM 认领",
    )
    verified_factor_meta_json: Mapped[Optional[str]]     = mapped_column(
        Text, nullable=True, comment="脱敏元数据 JSON：industryCode/productLabel/attestedAt/productionLine"
    )
    # —— V3.2 企业档案完整字段（HengAI 创世宪法 §2-2 扩展）——
    main_product             : Mapped[Optional[str]]     = mapped_column(String(128), nullable=True)
    hs_code                  : Mapped[Optional[str]]     = mapped_column(String(32), nullable=True)
    annual_capacity_tons     : Mapped[Optional[Decimal]] = mapped_column(Numeric(20,4), nullable=True)
    annual_export_tons       : Mapped[Optional[Decimal]] = mapped_column(Numeric(20,4), nullable=True)
    export_countries         : Mapped[Optional[str]]     = mapped_column(String(512), nullable=True)
    annual_power_kwh         : Mapped[Optional[Decimal]] = mapped_column(Numeric(20,4), nullable=True)
    power_grid               : Mapped[Optional[str]]     = mapped_column(String(16), nullable=True)
    # —— V3.4 主权认领 · 授权书存证与人工审核 ——
    sovereignty_claim_status       : Mapped[str]               = mapped_column(String(16), default="none", nullable=False, comment="none|pending|approved|rejected")
    sovereignty_claim_submitted_at   : Mapped[Optional[datetime]]= mapped_column(DateTime(timezone=True), nullable=True)
    sovereignty_auth_letter_path   : Mapped[Optional[str]]     = mapped_column(String(512), nullable=True)
    sovereignty_auth_letter_filename: Mapped[Optional[str]]    = mapped_column(String(256), nullable=True)
    sovereignty_auth_letter_mime     : Mapped[Optional[str]]     = mapped_column(String(128), nullable=True)
    sovereignty_claim_reviewer_note  : Mapped[Optional[str]]     = mapped_column(Text, nullable=True)
    sovereignty_claim_reviewed_at    : Mapped[Optional[datetime]]= mapped_column(DateTime(timezone=True), nullable=True)
    sovereignty_ai_prescreen_json    : Mapped[Optional[str]]     = mapped_column(Text, nullable=True)
    resonance_requests               : Mapped[int]               = mapped_column(Integer, default=0, nullable=False, comment="待响应的产业链确权技术请求数")
    created_at               : Mapped[datetime]          = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at               : Mapped[datetime]          = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    members        : Mapped[List["User"]]         = relationship("User", secondary="user_workspace", back_populates="workspaces", lazy="selectin")
    cbam_reports   : Mapped[List["CBAMReport"]]   = relationship("CBAMReport", back_populates="workspace", cascade="all, delete-orphan")
    supplier_nodes : Mapped[List["SupplierNode"]] = relationship("SupplierNode", back_populates="workspace", cascade="all, delete-orphan")
    energy_records : Mapped[List["EnergyRecord"]] = relationship("EnergyRecord", back_populates="workspace", cascade="all, delete-orphan")

# ─── Table 3: GMLedger ────────────────────────────────────────────────────────
class GMLedger(Base):
    __tablename__ = "gm_ledger"
    id           : Mapped[uuid.UUID]        = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id      : Mapped[uuid.UUID]        = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    action       : Mapped[LedgerAction]     = mapped_column(Enum(LedgerAction), nullable=False)
    amount       : Mapped[Decimal]          = mapped_column(Numeric(20,4), nullable=False)
    balance_snap : Mapped[Optional[Decimal]]= mapped_column(Numeric(20,4), nullable=True)
    source_ref   : Mapped[Optional[str]]    = mapped_column(String(256), nullable=True, comment="cbam_report_save/{id} · industry_factor_attest/{ws_id} 等幂等键")
    memo         : Mapped[Optional[str]]    = mapped_column(Text, nullable=True)
    created_at   : Mapped[datetime]         = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    user: Mapped["User"] = relationship("User", back_populates="gm_ledger")

# ─── Table 4: CBAMReport（金额/碳排字段 Numeric(20,4)，最大约 10^16 量级）────
class CBAMReport(Base):
    __tablename__ = "cbam_reports"
    id                   : Mapped[uuid.UUID]         = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id         : Mapped[uuid.UUID]         = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_id             : Mapped[Optional[uuid.UUID]]= mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reporting_period     : Mapped[str]               = mapped_column(String(16), nullable=False)
    status               : Mapped[CBAMStatus]        = mapped_column(Enum(CBAMStatus), default=CBAMStatus.draft, nullable=False)
    tco2e_total          : Mapped[Optional[Decimal]] = mapped_column(Numeric(20,4), nullable=True)
    global_rank          : Mapped[Optional[int]]     = mapped_column(BigInteger, nullable=True)
    scope3_coverage      : Mapped[Optional[Decimal]] = mapped_column(Numeric(20,4), nullable=True)
    risk_exposure_eur    : Mapped[Optional[Decimal]] = mapped_column(Numeric(20,4), nullable=True)
    roi_ratio            : Mapped[Optional[Decimal]] = mapped_column(Numeric(20,4), nullable=True)
    supply_chain_coverage: Mapped[Optional[Decimal]] = mapped_column(Numeric(20,4), nullable=True)
    cbam_tax_estimate    : Mapped[Optional[Decimal]] = mapped_column(Numeric(20,4), nullable=True)
    reduction_target     : Mapped[Optional[Decimal]] = mapped_column(Numeric(20,4), nullable=True)
    reduction_achieved   : Mapped[Optional[Decimal]] = mapped_column(Numeric(20,4), nullable=True)
    payload_json         : Mapped[Optional[str]]     = mapped_column(Text, nullable=True)
    submitted_at         : Mapped[Optional[datetime]]= mapped_column(DateTime(timezone=True), nullable=True)
    verified_at          : Mapped[Optional[datetime]]= mapped_column(DateTime(timezone=True), nullable=True)
    created_at           : Mapped[datetime]          = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at           : Mapped[datetime]          = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    workspace : Mapped["Workspace"]      = relationship("Workspace", back_populates="cbam_reports")
    owner     : Mapped[Optional["User"]] = relationship("User", back_populates="cbam_reports")

# ─── Table 5: SupplierNode ────────────────────────────────────────────────────
class SupplierNode(Base):
    __tablename__ = "supplier_nodes"
    __table_args__ = (UniqueConstraint("workspace_id", "supplier_credit_code", name="uq_workspace_supplier"),)
    id                   : Mapped[uuid.UUID]         = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id         : Mapped[uuid.UUID]         = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    invited_by_user_id   : Mapped[Optional[uuid.UUID]]= mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    supplier_name        : Mapped[str]               = mapped_column(String(256), nullable=False)
    supplier_credit_code : Mapped[Optional[str]]     = mapped_column(String(64), nullable=True)
    contact_email        : Mapped[Optional[str]]     = mapped_column(String(320), nullable=True)
    status               : Mapped[SupplierStatus]    = mapped_column(Enum(SupplierStatus), default=SupplierStatus.invited, nullable=False)
    tco2e_reported       : Mapped[Optional[Decimal]] = mapped_column(Numeric(20,4), nullable=True)
    data_quality_score   : Mapped[Optional[Decimal]] = mapped_column(Numeric(20,4), nullable=True)
    is_insured           : Mapped[bool]              = mapped_column(Boolean, default=False, nullable=False)
    is_white_listed      : Mapped[bool]              = mapped_column(Boolean, default=False, nullable=False)
    invite_code          : Mapped[Optional[str]]     = mapped_column(String(16), nullable=True, unique=True, index=True)
    submission_token     : Mapped[Optional[str]]     = mapped_column(String(128), nullable=True, unique=True)
    claim_contact_name   : Mapped[Optional[str]]     = mapped_column(String(128), nullable=True)
    claim_phone          : Mapped[Optional[str]]     = mapped_column(String(32), nullable=True)
    claim_certificate_id : Mapped[Optional[str]]     = mapped_column(String(64), nullable=True, unique=True, index=True)
    claim_confirmed_at   : Mapped[Optional[datetime]]= mapped_column(DateTime(timezone=True), nullable=True)
    cl_ivc_hash          : Mapped[Optional[str]]     = mapped_column(String(64), nullable=True, unique=True, index=True)
    sovereign_payload_json: Mapped[Optional[str]]    = mapped_column(Text, nullable=True)
    submission_count     : Mapped[int]               = mapped_column(default=0, nullable=False)
    consecutive_submissions: Mapped[int]             = mapped_column(default=0, nullable=False)
    report_timeliness    : Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 4), nullable=True)
    submitted_at         : Mapped[Optional[datetime]]= mapped_column(DateTime(timezone=True), nullable=True)
    created_at           : Mapped[datetime]          = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at           : Mapped[datetime]          = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    workspace: Mapped["Workspace"] = relationship("Workspace", back_populates="supplier_nodes")
    submission_logs: Mapped[List["SupplierSubmissionLog"]] = relationship(
        "SupplierSubmissionLog", back_populates="supplier_node", cascade="all, delete-orphan"
    )

# ─── Table 5b: SupplierSubmissionLog（供应商填报历史 · 协作评分）────
class SupplierSubmissionLog(Base):
    __tablename__ = "supplier_submission_logs"
    id               : Mapped[uuid.UUID]         = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    supplier_node_id : Mapped[uuid.UUID]         = mapped_column(UUID(as_uuid=True), ForeignKey("supplier_nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    submitted_at     : Mapped[datetime]          = mapped_column(DateTime(timezone=True), nullable=False)
    tco2e_reported   : Mapped[Optional[Decimal]] = mapped_column(Numeric(20, 4), nullable=True)
    timeliness_score : Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 4), nullable=True)
    cl_ivc_hash      : Mapped[Optional[str]]     = mapped_column(String(64), nullable=True)
    period_key       : Mapped[Optional[str]]     = mapped_column(String(16), nullable=True, index=True)
    supplier_node: Mapped["SupplierNode"] = relationship("SupplierNode", back_populates="submission_logs")

# ─── Table 6: EnergyRecord ───────────────────────────────────────────────────
class EnergyRecord(Base):
    __tablename__ = "energy_records"
    id           : Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id : Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    energy_type  : Mapped[str]            = mapped_column(String(32), nullable=False)
    energy_value : Mapped[Decimal]        = mapped_column(Numeric(20,4), nullable=False)
    energy_unit  : Mapped[str]            = mapped_column(String(16), nullable=False)
    tco2e_calc   : Mapped[Decimal]        = mapped_column(Numeric(20,4), nullable=False)
    period       : Mapped[Optional[str]]  = mapped_column(String(16), nullable=True)
    source_chat  : Mapped[Optional[str]]  = mapped_column(String(256), nullable=True)
    created_at   : Mapped[datetime]       = mapped_column(DateTime(timezone=True), server_default=func.now())
    workspace: Mapped["Workspace"] = relationship("Workspace", back_populates="energy_records")

# ─── Table 7: UserBadge ──────────────────────────────────────────────────────
class UserBadge(Base):
    __tablename__ = "user_badges"
    id         : Mapped[uuid.UUID]     = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id    : Mapped[uuid.UUID]     = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    badge_code : Mapped[str]           = mapped_column(String(64), nullable=False)
    badge_name : Mapped[str]           = mapped_column(String(128), nullable=False)
    awarded_at : Mapped[datetime]      = mapped_column(DateTime(timezone=True), server_default=func.now())
    source_ref : Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    user: Mapped["User"] = relationship("User", back_populates="badges")


# ─── Table 7b: ResonanceTriggerPool（实名举力 · 无资金归集 · SYNC §6）────
class ResonanceTriggerPool(Base):
    """指向单一 productionEntity 的共振计数池（非行业广播 ResonanceRequest）。"""
    __tablename__ = "resonance_trigger_pools"
    id                 : Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    production_entity  : Mapped[str]       = mapped_column(String(128), nullable=False, unique=True, index=True)
    holder             : Mapped[str]       = mapped_column(String(256), nullable=False, default="")
    target_count       : Mapped[int]       = mapped_column(Integer, nullable=False, default=30)
    current_count      : Mapped[int]       = mapped_column(Integer, nullable=False, default=0)
    status             : Mapped[str]       = mapped_column(
        String(16), nullable=False, default="collecting", index=True,
        comment="collecting|fulfilled|rejected|expired",
    )
    participants_json  : Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="参与方 JSON 列表")
    fulfilled_at       : Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at         : Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at         : Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ─── Table 8: ResonanceRequest（产业链主权共振 · 中小企业技术请求）────
class ResonanceRequest(Base):
    __tablename__ = "resonance_requests"
    id                      : Mapped[uuid.UUID]         = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    requester_workspace_id  : Mapped[uuid.UUID]         = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    requester_user_id       : Mapped[uuid.UUID]         = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    industry_code           : Mapped[str]               = mapped_column(String(32), nullable=False, index=True)
    origin_query            : Mapped[Optional[str]]     = mapped_column(String(256), nullable=True)
    product_category        : Mapped[Optional[str]]     = mapped_column(String(128), nullable=True)
    status                  : Mapped[str]               = mapped_column(String(16), default="pending", nullable=False, index=True)
    target_workspace_id     : Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True)
    fulfilled_cert_id       : Mapped[Optional[str]]     = mapped_column(String(32), nullable=True)
    fulfill_source          : Mapped[Optional[str]]     = mapped_column(
        String(16), nullable=True, comment="industry-pool=行业共振池广播 · bound=具名供应链绑定，仅 bound 计入计费台账"
    )
    created_at              : Mapped[datetime]          = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at              : Mapped[datetime]          = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ─── Table 9: SupplyChainBinding（供应链绑定声明 · 双向握手）────────────────
class SupplyChainBinding(Base):
    """下游申报上游原厂 → 原厂确认后方可消费因子（绑定真实性的单一真理源）。"""
    __tablename__ = "supply_chain_bindings"
    __table_args__ = (UniqueConstraint("downstream_workspace_id", "origin_workspace_id", name="uq_binding_pair"),)
    id                       : Mapped[uuid.UUID]           = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    downstream_workspace_id  : Mapped[uuid.UUID]           = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    origin_workspace_id      : Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True, index=True)
    origin_query             : Mapped[str]                 = mapped_column(String(256), nullable=False, comment="下游申报的上游原厂名（自由文本，匹配后写 origin_workspace_id）")
    material_type            : Mapped[Optional[str]]       = mapped_column(String(128), nullable=True, comment="原料类型，不含供应商配方细节")
    status                   : Mapped[str]                 = mapped_column(String(16), default="pending", nullable=False, index=True, comment="pending|confirmed|rejected")
    declared_by_user_id      : Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewer_note            : Mapped[Optional[str]]       = mapped_column(Text, nullable=True)
    reviewed_at              : Mapped[Optional[datetime]]  = mapped_column(DateTime(timezone=True), nullable=True)
    created_at               : Mapped[datetime]            = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at               : Mapped[datetime]            = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ─── Table 10: FactorConsumption（因子消费台账 · 原厂可计费的权威记录）──────
class FactorConsumption(Base):
    """下游每次引用原厂确权因子记一笔；claim_mode 决定原厂侧可见性（实名/匿名）。"""
    __tablename__ = "factor_consumptions"
    __table_args__ = (UniqueConstraint("consumer_workspace_id", "batch_id", name="uq_consumer_batch"),)
    id                      : Mapped[uuid.UUID]           = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    origin_workspace_id     : Mapped[uuid.UUID]           = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    consumer_workspace_id   : Mapped[uuid.UUID]           = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    consumer_user_id        : Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    binding_id              : Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("supply_chain_bindings.id", ondelete="SET NULL"), nullable=True)
    cert_id                 : Mapped[Optional[str]]       = mapped_column(String(32), nullable=True, comment="引用的 CL-COP 确权编号")
    industry_code           : Mapped[str]                 = mapped_column(String(32), nullable=False, index=True)
    batch_id                : Mapped[str]                 = mapped_column(String(64), nullable=False, comment="下游核验批次号（幂等键之一）")
    qty_tons                : Mapped[Optional[Decimal]]   = mapped_column(Numeric(20, 4), nullable=True)
    factor_value            : Mapped[Optional[Decimal]]   = mapped_column(Numeric(20, 4), nullable=True, comment="引用时点的确权因子快照")
    carbon_tonnage          : Mapped[Optional[Decimal]]   = mapped_column(Numeric(20, 4), nullable=True)
    tax_saved_eur           : Mapped[Optional[Decimal]]   = mapped_column(Numeric(20, 4), nullable=True, comment="估算口径，计费基数以指令文档为准")
    claim_mode              : Mapped[str]                 = mapped_column(String(16), default="anonymous", nullable=False, comment="claimed=实名认领 · anonymous=匿名引用")
    region_tag              : Mapped[Optional[str]]       = mapped_column(String(64), nullable=True)
    created_at              : Mapped[datetime]            = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
