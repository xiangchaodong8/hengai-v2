# schemas.py — HengAI V3.0 API 契约法典
# 宪章§2：AI 严禁私自捏造字段名！以下为唯一权威 Schema 定义
# 全面采用 CamelCase alias 适配前端，后端保持 snake_case 主权

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator


# ---------------------------------------------------------------------------
# 公共配置 Mixin
# ---------------------------------------------------------------------------

class IndustryType(str, Enum):
    """广东省 2026 重点监控 + CBAM 八大高耗能行业代码（V3.5 全谱系）。"""
    STEEL = "steel"
    CEMENT = "cement"
    PETRO = "petro"
    PAPER = "paper"
    AVIATION = "aviation"
    CERAMIC = "ceramic"
    PORT = "port"
    IDC = "idc"
    ALUMINUM = "aluminum"
    FERTILIZER = "fertilizer"
    ELECTRICITY = "electricity"
    HYDROGEN = "hydrogen"
    OTHER = "other"


class IntensityUnit(str, Enum):
    """确权因子池 · 多单位碳强度（非吨位行业）。"""
    TCO2E_PER_T = "tCO2e/t"
    TCO2E_PER_RTK = "tCO2e/RTK"
    TCO2E_PER_TEU = "tCO2e/TEU"
    TCO2E_PER_MWH = "tCO2e/MWh"
    TCO2E_PER_M2 = "tCO2e/m2"
    TCO2E_PER_KWH = "tCO2e/kWh"
    TCO2E_PER_SQM = "tCO2e/sqm"
    TCO2E_PER_UNIT = "tCO2e/unit"
    PUE_RATIO = "PUE"
    TCO2E_PER_COMPUTE = "tCO2e/compute_unit"


class MaterialVolumeUnit(str, Enum):
    """Scope 3 原料年用量计量单位（组装业非吨位）。"""
    T = "t"
    KWH = "kWh"
    SQM = "sqm"
    UNIT = "unit"


class CamelModel(BaseModel):
    """
    所有对外 Schema 的基类。
    - 后端字段：snake_case（数据库友好）
    - 前端序列化：camelCase alias（宪章§3 前端双向绑定）
    """
    model_config = ConfigDict(
        populate_by_name=True,          # 允许同时用 snake & camel 赋值
        alias_generator=lambda s: "".join(
            word.capitalize() if i else word
            for i, word in enumerate(s.split("_"))
        ),
        from_attributes=True,           # ORM → Schema 直接映射
    )


# ---------------------------------------------------------------------------
# Enum 镜像（与 models.py 保持一致，供前端直接消费）
# ---------------------------------------------------------------------------

class WorkspaceStageSchema(str, Enum):
    incomplete = "Incomplete"
    sandbox    = "Sandbox"
    certified  = "Certified"


class CBAMStatusSchema(str, Enum):
    draft     = "draft"
    submitted = "submitted"
    verified  = "verified"
    rejected  = "rejected"


class SupplierStatusSchema(str, Enum):
    invited   = "invited"
    submitted = "submitted"
    confirmed = "confirmed"


class PhaseSchema(str, Enum):
    """
    宪章三阶段状态机——前端渲染核心判据。
    Phase1: 个体启蒙 / Phase2: 业务映射 / Phase3: 全域共治
    """
    phase1 = "Phase1"
    phase2 = "Phase2"
    phase3 = "Phase3"


# ---------------------------------------------------------------------------
# Sub-Schema: User（宪章§2-1）
# ---------------------------------------------------------------------------

class UserSchema(CamelModel):
    """
    宪章契约字段：id, email, name, gm_balance, current_level, tokens_left
    扩展：backup_email（宪章§4 明确预留）
    """
    id           : uuid.UUID
    email        : str
    backup_email : Optional[str]  = None
    name         : str            = Field(description="为空时由邮箱前缀动态生成，严禁硬编码'王磊'")
    gm_balance   : Decimal        = Field(description="由 GMLedger SUM 实时聚合，非静态字段")
    gm_generational: Decimal = Field(
        default=Decimal("0"),
        description="代际收益：一级供应商贡献 GM 的 20%，无数据时为 0",
    )
    current_level: int
    tokens_left  : int
    created_at   : datetime

    @field_validator("name", mode="before")
    @classmethod
    def derive_name_from_email(cls, v: Optional[str], info) -> str:
        """如果 name 为空，从 email 提取用户名部分作为显示名。"""
        if v:
            return v
        # 从 info.data 中读取 email 字段（Pydantic v2 验证顺序保证 email 先到）
        email = (info.data or {}).get("email", "")
        return email.split("@")[0] if email else "未知用户"


# ---------------------------------------------------------------------------
# Sub-Schema: Company（Workspace 对外呈现，宪章§2-2）
# ---------------------------------------------------------------------------

class CompanySchema(CamelModel):
    """
    宪章契约字段：id, name, credit_code, stage, is_complete
    V3.2 扩展：企业档案完整 11 字段全量落库（铝/钢/水泥/化肥/电力/氢 CBAM 必备）
    """
    id          : uuid.UUID
    name        : str
    credit_code : Optional[str]         = None
    stage       : WorkspaceStageSchema
    is_complete : bool
    industry_code: Optional[str]        = None
    country_code : Optional[str]        = None
    # —— V3.2 企业档案完整字段 ——
    main_product        : Optional[str]     = None
    hs_code             : Optional[str]     = None
    annual_capacity_tons: Optional[Decimal] = None
    annual_export_tons  : Optional[Decimal] = None
    export_countries    : Optional[str]     = None
    annual_power_kwh    : Optional[Decimal] = None
    power_grid          : Optional[str]     = None
    contact_email       : Optional[str]     = None
    verified_factor     : Optional[Decimal] = Field(
        None, description="原厂确权单位产品碳强度 tCO2e/t（核验池 Pull）"
    )
    verified_factor_cert_id: Optional[str] = Field(
        None, description="CL-COP-XXXX 官方确权编号"
    )
    sovereignty_claim_status: Optional[str] = Field(
        None, description="主权认领审核状态 none|pending|approved|rejected"
    )
    sovereignty_claim_submitted_at: Optional[str] = None
    sovereignty_auth_letter_filename: Optional[str] = None
    sovereignty_claim_reviewer_note: Optional[str] = None
    sovereignty_claim_reviewed_at: Optional[str] = None
    sovereignty_ai_prescreen: Optional[Dict[str, Any]] = None


class SovereigntyClaimSubmitResponse(CamelModel):
    workspace_id: uuid.UUID
    sovereignty_claim_status: str
    message: str
    app_state: Optional[Dict[str, Any]] = None


class SovereigntyClaimReviewRequest(CamelModel):
    action: str = Field(..., description="approve 或 reject")
    note: Optional[str] = Field(None, max_length=2000, description="审核意见（驳回时建议填写）")


class SovereigntyClaimReviewResponse(CamelModel):
    workspace_id: uuid.UUID
    sovereignty_claim_status: str
    message: str
    app_state: Optional[Dict[str, Any]] = None


class SovereigntyClaimPendingItem(CamelModel):
    workspace_id: uuid.UUID
    company_name: str
    credit_code: Optional[str] = None
    submitted_at: Optional[str] = None
    auth_letter_filename: Optional[str] = None
    ai_prescreen: Optional[Dict[str, Any]] = None


class SovereigntyClaimPendingListResponse(CamelModel):
    items: List["SovereigntyClaimPendingItem"]
    total: int


class IndustryFactorAttestRequest(CamelModel):
    """工业原厂确权：仅接受脱敏后的碳强度与同比，严禁工序绝对能耗。"""
    carbon_intensity: Decimal = Field(..., ge=0, description="碳强度数值（配合 intensity_unit）")
    intensity_unit: str = Field(
        default=IntensityUnit.TCO2E_PER_T.value,
        max_length=32,
        description="碳强度单位：tCO2e/t · tCO2e/RTK · tCO2e/TEU · tCO2e/MWh · PUE 等",
    )
    yoy_change_pct: Optional[Decimal] = Field(None, description="同比增减率 %")
    industry_code: Optional[str] = Field(None, max_length=32)
    product_label: Optional[str] = Field(None, max_length=128)
    production_line: Optional[str] = Field(None, max_length=16, description="产线编号，如 L01")


class IndustryFactorAttestResponse(CamelModel):
    cert_id: str
    verification_code: Optional[str] = None
    carbon_intensity: Decimal
    yoy_change_pct: Optional[Decimal] = None
    gm_earned: Decimal = Field(default=Decimal("0"))
    badge_awarded: bool = False
    message: str
    app_state: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Hub 并网 Sync（精算芯 buildHubSyncPayload · SYNC_CONTRACT_v2）
# ---------------------------------------------------------------------------

class HubSyncQualityTag(CamelModel):
    calibration: str = "placeholder"
    mat_box_locked: bool = Field(default=False, validation_alias=AliasChoices("matBoxLocked", "mat_box_locked"))
    credibility_score: Optional[float] = Field(None, validation_alias=AliasChoices("credibilityScore", "credibility_score"))
    suspicion_level: Optional[str] = Field(None, validation_alias=AliasChoices("suspicionLevel", "suspicion_level"))
    maturity_tier: str = Field(
        default="L0_present",
        validation_alias=AliasChoices("maturityTier", "maturity_tier"),
    )
    provenance_grade: str = Field(
        default="unregistered",
        validation_alias=AliasChoices("provenanceGrade", "provenance_grade"),
    )
    risk_flags: List[str] = Field(default_factory=list, validation_alias=AliasChoices("riskFlags", "risk_flags"))
    active_jurisdiction: str = Field(
        default="cbam",
        validation_alias=AliasChoices("activeJurisdiction", "active_jurisdiction"),
    )
    funding_mode: Optional[str] = Field(None, validation_alias=AliasChoices("fundingMode", "funding_mode"))


class HubSyncDataFitSummary(CamelModel):
    fit_degree_pct: Optional[float] = Field(None, validation_alias=AliasChoices("fitDegreePct", "fit_degree_pct"))
    credibility_score: Optional[float] = Field(None, validation_alias=AliasChoices("credibilityScore", "credibility_score"))
    suspicion_level: Optional[str] = Field(None, validation_alias=AliasChoices("suspicionLevel", "suspicion_level"))
    gm_reward: Optional[int] = Field(None, validation_alias=AliasChoices("gmReward", "gm_reward"))
    eu_audit_risk: Optional[str] = Field(None, validation_alias=AliasChoices("euAuditRisk", "eu_audit_risk"))


class HubSyncDeviationSummary(CamelModel):
    count: int = 0
    has_critical: bool = Field(default=False, validation_alias=AliasChoices("hasCritical", "has_critical"))
    has_warning: bool = Field(default=False, validation_alias=AliasChoices("hasWarning", "has_warning"))


class HubSyncRequest(CamelModel):
    """精算芯 L0/L1 脱敏摘要并网；禁止 processes[] / 绝对能耗。"""
    model_config = ConfigDict(
        populate_by_name=True,
        extra="forbid",
        alias_generator=lambda s: "".join(
            word.capitalize() if i else word
            for i, word in enumerate(s.split("_"))
        ),
        from_attributes=True,
    )
    sync_tier: str = Field(..., validation_alias=AliasChoices("syncTier", "sync_tier"))
    source: str
    industry_id: str = Field(..., validation_alias=AliasChoices("industryId", "industry_id"))
    batch_id: str = Field(..., validation_alias=AliasChoices("batchId", "batch_id"))
    data_fingerprint: str = Field(..., validation_alias=AliasChoices("dataFingerprint", "data_fingerprint"))
    enc_hash: Optional[str] = Field(None, validation_alias=AliasChoices("encHash", "enc_hash"))
    carbon_intensity: Decimal = Field(..., ge=0, validation_alias=AliasChoices("carbonIntensity", "carbon_intensity"))
    gm_reward: int = Field(default=0, ge=0, validation_alias=AliasChoices("gmReward", "gm_reward"))
    holder: str = Field(..., min_length=1)
    production_entity: str = Field(..., min_length=2, validation_alias=AliasChoices("productionEntity", "production_entity"))
    production_entity_source: Optional[str] = Field(
        None, validation_alias=AliasChoices("productionEntitySource", "production_entity_source"),
    )
    enterprise_registry_id: Optional[str] = Field(
        None, validation_alias=AliasChoices("enterpriseRegistryId", "enterprise_registry_id"),
    )
    quality_tag: HubSyncQualityTag = Field(
        default_factory=HubSyncQualityTag,
        validation_alias=AliasChoices("qualityTag", "quality_tag"),
    )
    cn_code: Optional[str] = Field(None, validation_alias=AliasChoices("cnCode", "cn_code"))
    total_emission: Optional[Decimal] = Field(None, ge=0, validation_alias=AliasChoices("totalEmission", "total_emission"))
    product_output_t: Optional[Decimal] = Field(None, ge=0, validation_alias=AliasChoices("productOutputT", "product_output_t"))
    certificate_id: Optional[str] = Field(None, validation_alias=AliasChoices("certificateId", "certificate_id"))
    issued_at: Optional[str] = Field(None, validation_alias=AliasChoices("issuedAt", "issued_at"))
    data_fit_report: Optional[HubSyncDataFitSummary] = Field(
        None, validation_alias=AliasChoices("dataFitReport", "data_fit_report"),
    )
    deviation_summary: Optional[HubSyncDeviationSummary] = Field(
        None, validation_alias=AliasChoices("deviationSummary", "deviation_summary"),
    )
    funding_mode: Optional[str] = Field(None, validation_alias=AliasChoices("fundingMode", "funding_mode"))

    @field_validator("sync_tier")
    @classmethod
    def _sync_tier_l0_l1(cls, v: str) -> str:
        t = (v or "").strip().upper()
        if t not in ("L0", "L1"):
            raise ValueError("INVALID_SYNC_TIER")
        return t


class HubSyncResonanceInfo(CamelModel):
    industry_id: str = Field(..., validation_alias=AliasChoices("industryId", "industry_id"))
    visible_to_bound_chain: bool = Field(
        default=True, validation_alias=AliasChoices("visibleToBoundChain", "visible_to_bound_chain"),
    )
    visible_to_industry_board: bool = Field(
        default=True, validation_alias=AliasChoices("visibleToIndustryBoard", "visible_to_industry_board"),
    )


class HubSyncResponse(CamelModel):
    sync_tier: str
    city_state: str
    pull_eligible: bool
    gm_balance: Decimal
    gm_reward_applied: int
    certificate_id: Optional[str] = None
    holder: str
    synced_at: str
    message: str
    resonance: HubSyncResonanceInfo
    app_state: Optional[Dict[str, Any]] = None


class VerifiedFactorPoolEntry(CamelModel):
    workspace_id: uuid.UUID
    origin_name: str
    credit_code: Optional[str] = None
    industry_code: Optional[str] = None
    carbon_intensity: Decimal
    intensity_unit: str = Field(default=IntensityUnit.TCO2E_PER_T.value)
    cert_id: str
    verification_code: Optional[str] = None
    product_label: Optional[str] = None
    attested_at: Optional[str] = None
    production_line: Optional[str] = None


class VerifiedFactorPoolSearchResponse(CamelModel):
    match: bool
    entry: Optional[VerifiedFactorPoolEntry] = None
    message: str = ""


class ResonanceRequestSubmit(CamelModel):
    """中小企业向产业链原厂发起的确权技术请求（客观压力信号）。"""
    industry_code: str = Field(..., min_length=2, max_length=32)
    origin_query: Optional[str] = Field(None, max_length=256)
    product_category: Optional[str] = Field(None, max_length=128)
    material_factor: Optional[Decimal] = Field(None, ge=0, description="当前采用的默认因子（配合 material_unit）")
    material_unit: Optional[str] = Field(
        None, max_length=16,
        description="原料因子分母单位：t / kWh / sqm / unit",
    )
    material_volume_unit: Optional[str] = Field(
        None, max_length=16,
        description="原料年用量单位，与 CBAM 前端 f-mat-vol 联动",
    )


class ResonanceRequestResponse(CamelModel):
    success: bool = True
    request_id: uuid.UUID
    industry_code: str
    pending_count_for_industry: int = Field(..., description="该行业全网待响应请求数")
    message: str
    app_state: Optional[Dict[str, Any]] = None


class ResonanceTriggerSubmit(CamelModel):
    """SYNC §6 · 实名举力 +1（无资金归集）。"""
    production_entity: str = Field(..., min_length=2, max_length=128, validation_alias=AliasChoices("productionEntity", "production_entity"))
    holder: str = Field(..., min_length=1, max_length=256)
    message: Optional[str] = Field(None, max_length=512)


class ResonanceTriggerStatus(CamelModel):
    production_entity: str = Field(..., validation_alias=AliasChoices("productionEntity", "production_entity"))
    holder: str = ""
    target_count: int = Field(..., validation_alias=AliasChoices("targetCount", "target_count"))
    current_count: int = Field(..., validation_alias=AliasChoices("currentCount", "current_count"))
    participant_count: int = Field(..., validation_alias=AliasChoices("participantCount", "participant_count"))
    status: str = "collecting"
    funding_mode: str = Field(default="resonance_triggered", validation_alias=AliasChoices("fundingMode", "funding_mode"))
    message: str = ""
    already_participated: bool = Field(default=False, validation_alias=AliasChoices("alreadyParticipated", "already_participated"))


class ResonanceTriggerFulfillRequest(CamelModel):
    production_entity: str = Field(..., min_length=2, max_length=128, validation_alias=AliasChoices("productionEntity", "production_entity"))
    holder: Optional[str] = Field(None, max_length=256)


# ---------------------------------------------------------------------------
# 供应链绑定（双向握手）与因子消费台账
# ---------------------------------------------------------------------------

class SupplyBindingDeclareRequest(CamelModel):
    """下游申报上游原厂（自由文本，后端匹配 + 原厂确认后生效）。"""
    origin_query: str = Field(..., min_length=2, max_length=256)
    material_type: Optional[str] = Field(None, max_length=128)


class SupplyBindingConfirmRequest(CamelModel):
    """原厂确认/拒绝下游绑定申报。"""
    binding_id: uuid.UUID
    approve: bool = True
    note: Optional[str] = Field(None, max_length=512)


class FactorConsumeRequest(CamelModel):
    """下游引用原厂确权因子（核验批次维度，幂等）。"""
    batch_id: str = Field(..., min_length=1, max_length=64)
    qty_tons: Optional[Decimal] = Field(None, ge=0)
    claim_mode: str = Field("anonymous", pattern="^(claimed|anonymous)$")


class EvidenceRedeemRequest(CamelModel):
    """精算芯兑换包入库（钥匙码 / QR token · 产品主路径）。"""
    redeem_code: Optional[str] = Field(None, min_length=8, max_length=8192)
    qr_token: Optional[str] = Field(None, min_length=8, max_length=8192)


class EvidenceRedeemResponse(CamelModel):
    success: bool = True
    city_state: str
    pull_eligible: bool
    certificate_id: Optional[str] = None
    message: str
    app_state: Optional[Dict[str, Any]] = None


class FactorAuthRevokeRequest(CamelModel):
    """原厂撤回下游因子授权（绑定链维度）。"""
    binding_id: uuid.UUID
    note: Optional[str] = Field(None, max_length=512)


class FactorAuthApplyRequest(CamelModel):
    """下游向原厂申请重新解锁因子授权。"""
    binding_id: uuid.UUID
    note: Optional[str] = Field(None, max_length=1024)


class FactorAuthApproveRequest(CamelModel):
    """原厂审批下游因子解锁申请。"""
    binding_id: Optional[uuid.UUID] = None
    application_id: Optional[uuid.UUID] = None
    approve: bool = True
    note: Optional[str] = Field(None, max_length=512)


class FactorRuleLetterBatchRequest(CamelModel):
    """批量下发因子规则变更函（供应链协同页）。"""
    binding_ids: List[uuid.UUID] = Field(..., min_length=1, max_length=200)


class ResonanceOriginStatus(CamelModel):
    verified: bool = False
    cert_id: Optional[str] = None
    carbon_intensity: Optional[Decimal] = None
    origin_name: Optional[str] = None
    industry_code: Optional[str] = None


# ---------------------------------------------------------------------------
# Sub-Schema: Impact（宏观碳数据，宪章§2-3）
# ---------------------------------------------------------------------------

class ImpactSchema(CamelModel):
    """
    宪章契约字段：tCO2e_total, global_rank, scope3_coverage, risk_exposure_eur
    Phase1 空壳状态下全部为 null，严禁填写假数据。
    """
    tco2e_total      : Optional[Decimal] = Field(None, alias="tCO2eTotal")
    global_rank      : Optional[int]     = None
    scope3_coverage  : Optional[Decimal] = Field(
        None, description="0.0~1.0，Scope3 供应链覆盖率"
    )
    risk_exposure_eur: Optional[Decimal] = None

    model_config = ConfigDict(
        populate_by_name=True,
        from_attributes=True,
    )


# ---------------------------------------------------------------------------
# Sub-Schema: CBAM 报告摘要
# ---------------------------------------------------------------------------

class CBAMReportSummary(CamelModel):
    id              : uuid.UUID
    reporting_period: str
    status          : CBAMStatusSchema
    tco2e_total     : Optional[Decimal] = Field(None, alias="tCO2eTotal")
    risk_exposure_eur: Optional[Decimal] = None
    submitted_at    : Optional[datetime] = None

    model_config = ConfigDict(
        populate_by_name=True,
        from_attributes=True,
    )


# ---------------------------------------------------------------------------
# Sub-Schema: 供应商节点摘要
# ---------------------------------------------------------------------------

class SupplierNodeSummary(CamelModel):
    id                  : uuid.UUID
    supplier_name       : str
    supplier_credit_code: Optional[str] = None
    status              : SupplierStatusSchema
    tco2e_reported      : Optional[Decimal] = None
    data_quality_score  : Optional[Decimal] = None
    is_insured          : bool = False
    is_white_listed     : bool = False
    insurance_suggestion: Optional[str] = Field(
        None,
        description="商业文明氛围：建议投保 | 已承保 | 待评估",
    )
    submitted_at        : Optional[datetime] = None


# ---------------------------------------------------------------------------
# Sub-Schema: 碳信用城池四维（供应链协同雷达图数据源）
# ---------------------------------------------------------------------------

class FortressSchema(CamelModel):
    """
    碳信用城池成长面板。dims = [穿透覆盖, 主权确权, 代际网络, 信任存证]，每维 0–100。
    前端据 dims 实时计算 SVG 多边形坐标；level_label 取
    [地基/初建/要塞/堡垒/主权城池]。无数据时全 0、等级「地基」，严禁 null。
    """
    source       : str = Field(default="server")
    level_label  : str = Field(default="地基", description="城池等级中文标签")
    avg_score    : int = Field(default=0, description="四维综合得分 0–100")
    dims         : List[int] = Field(
        default_factory=lambda: [0, 0, 0, 0],
        description="[穿透覆盖, 主权确权, 代际网络, 信任存证]，各 0–100",
    )
    dim_coverage    : Optional[str] = None
    dim_sovereignty : Optional[str] = None
    dim_network     : Optional[str] = None
    dim_trust       : Optional[str] = None


# ---------------------------------------------------------------------------
# Sub-Schema: Phase 元数据（前端渲染逻辑锚点）
# ---------------------------------------------------------------------------

class PhaseMetaSchema(CamelModel):
    """
    前端根据 current_phase 决定解锁哪些功能区块。
    unlock_features 为显式白名单——前端不得自行推断。
    """
    current_phase   : PhaseSchema
    phase_label     : str   = Field(description="宪章中文阶段名")
    unlock_features : List[str] = Field(
        description="当前阶段已解锁的功能 slug 列表"
    )
    next_action     : Optional[str] = Field(
        None, description="引导用户进入下一阶段的核心逼单点"
    )


# ---------------------------------------------------------------------------
# 🚩 HubOverviewResponse — 上帝接口·超级 JSON（宪章§4-后端-1）
#    GET /api/v1/hub/overview 的唯一响应体
#    一次性嵌套：user + company + impact + phase_meta + 报告列表 + 供应商列表
# ---------------------------------------------------------------------------

class HubOverviewResponse(CamelModel):
    """
    宪章§4 规定的"唯一入口"聚合响应。
    前端 window.AppState 绑定此对象；applyRealData 映射约定：
    - user.gm_balance（JSON: gmBalance）→ GM 余额；user.current_level（JSON: currentLevel）→ 等级；
    - impact.tco2e_total（JSON: tCO2eTotal）→ 累计减排 tCO₂e；
    - impact.risk_exposure_eur（JSON: riskExposureEur）→ 碳税敞口 EUR；impact.scope3_coverage（JSON: scope3Coverage）→ 0~1；
    - phase_meta.current_phase（JSON: currentPhase）→ Phase1 | Phase2 | Phase3。

    结构层次：
    {
      "user":         UserSchema,
      "company":      CompanySchema | null,   # Phase1 时为 null
      "impact":       ImpactSchema,
      "phaseMeta":    PhaseMetaSchema,
      "recentReports": [...],
      "supplierNodes": [...],
      "serverTime":   "ISO8601"
    }
    """
    user           : UserSchema
    company        : Optional[CompanySchema]       = None
    impact         : ImpactSchema
    phase_meta     : PhaseMetaSchema
    fortress       : Optional[FortressSchema]      = None
    recent_reports : List[CBAMReportSummary]       = Field(default_factory=list)
    supplier_nodes : List[SupplierNodeSummary]     = Field(default_factory=list)
    server_time    : datetime


# ---------------------------------------------------------------------------
# 请求 Schema：供应商 H5 提交（触发自动化链路，宪章§4-后端-2）
# ---------------------------------------------------------------------------

class SupplierSubmitRequest(CamelModel):
    """
    POST /eco/supplier-submit
    供应商填写完 H5 表单后提交。支持 submission_token 或 invite_id（短码）。
    """
    submission_token: Optional[str] = None
    invite_code: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("invite_code", "invite_id", "inviteId"),
    )
    supplier_name: str
    contact_email: Optional[str] = None
    tco2e_reported: Decimal = Field(ge=Decimal("0"))
    payload_json: Optional[str] = None

    @model_validator(mode="after")
    def _require_token_or_invite(self) -> "SupplierSubmitRequest":
        tok = (self.submission_token or "").strip()
        inv = (self.invite_code or "").strip()
        if not tok and not inv:
            raise ValueError("submission_token 或 invite_id 至少提供一个")
        return self


class SupplierSubmitResponse(CamelModel):
    """提交成功后返回的确认信息。"""
    supplier_node_id : uuid.UUID
    workspace_name   : str
    supplier_name    : Optional[str] = None
    tco2e_reported   : Optional[Decimal] = None
    new_scope3_coverage: Decimal
    gm_awarded_to_owner: Decimal
    cl_ivc_hash      : Optional[str] = None
    confidence_level : Optional[str] = None
    message          : str
    app_state        : Optional[Dict[str, Any]] = Field(
        default=None,
        description="H5 提交后回灌的全量 AppState DNA（链主端实时刷新）",
    )


class SupplierMergeDuplicatesRequest(CamelModel):
    """合并误建的重复供应链节点（如 节点11 → 并入 节点10）。"""
    keep_node_id: Optional[uuid.UUID] = None
    remove_node_id: Optional[uuid.UUID] = None
    keep_supplier_name: Optional[str] = Field(None, max_length=256)
    remove_supplier_name: Optional[str] = Field(None, max_length=256)


class SupplierMergeDuplicatesResponse(CamelModel):
    kept_node_id: uuid.UUID
    removed_node_id: uuid.UUID
    message: str
    app_state: Optional[Dict[str, Any]] = None


class SupplierReconcileResponse(CamelModel):
    removed_duplicates: int = 0
    message: str
    app_state: Optional[Dict[str, Any]] = None


class SupplierClaimConfirmRequest(CamelModel):
    """H5 工厂碳管家账号认领确权（须在 supplier-submit 之后）。"""
    supplier_node_id: Optional[uuid.UUID] = None
    submission_token: Optional[str] = None
    invite_code: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("invite_code", "invite_id", "inviteId"),
    )
    contact_name: str = Field(..., min_length=2, max_length=128)
    contact_phone: Optional[str] = Field(None, min_length=11, max_length=11)
    contact_email: Optional[str] = Field(None, max_length=320)
    verify_channel: Optional[str] = Field(
        default=None,
        description="验证码通道：phone/email，缺省按提交字段自动推断",
    )
    sms_code: Optional[str] = Field(None, max_length=8, description="短信验证码（演示环境记录备查）")


class SupplierClaimConfirmResponse(CamelModel):
    claim_certificate_id: str
    supplier_name: str
    contact_name: str
    verify_channel: str
    contact_phone_masked: Optional[str] = None
    contact_email_masked: Optional[str] = None
    carbon_intensity: Optional[Decimal] = None
    workspace_name: Optional[str] = None
    claim_confirmed_at: str
    verify_url: str
    message: str


class SupplierClaimVerifyResponse(CamelModel):
    valid: bool
    claim_certificate_id: Optional[str] = None
    supplier_name: Optional[str] = None
    contact_name: Optional[str] = None
    verify_channel: Optional[str] = None
    contact_phone_masked: Optional[str] = None
    contact_email_masked: Optional[str] = None
    carbon_intensity: Optional[Decimal] = None
    workspace_name: Optional[str] = None
    claim_confirmed_at: Optional[str] = None
    message: str


class SupplierConclusionResponse(CamelModel):
    """甲方只读视图：仅碳强度结论，不含原始能耗/工艺数据。"""
    supplier_node_id: uuid.UUID
    supplier_name: str
    carbon_intensity: Optional[Decimal] = None
    confidence_level: Optional[str] = None
    cl_ivc_hash: Optional[str] = None
    submitted_at: Optional[str] = None
    collaboration_score: Optional[int] = None
    is_premium_partner: bool = False
    data_visibility: str = "buyer_readonly"
    message: str = "甲方仅可查阅碳强度结论，不可访问原始数据"


class SupplierSovereignResponse(CamelModel):
    """供应商主权视图：凭 CL-IVC 哈希访问原始填报载荷。"""
    valid: bool
    cl_ivc_hash: Optional[str] = None
    supplier_name: Optional[str] = None
    carbon_intensity: Optional[Decimal] = None
    sovereign_payload: Optional[Dict[str, Any]] = None
    submitted_at: Optional[str] = None
    message: str


# ---------------------------------------------------------------------------
# 请求 Schema：企业数字档案写入（workspace-update）
# ---------------------------------------------------------------------------

class WorkspaceUpdateRequest(CamelModel):
    """
    企业数字档案录入接口 · V3.2 全字段
    前端 11 字段全部走该接口落库到 PostgreSQL workspaces 表
    """
    name: str = Field(..., min_length=2, max_length=256)
    industry_code: Optional[str] = Field(None, max_length=32)
    credit_code: Optional[str] = Field(None, max_length=64)
    # —— V3.2 扩展 8 字段 ——
    main_product:        Optional[str]     = Field(None, max_length=128, description="主营产品 CBAM 类别")
    hs_code:             Optional[str]     = Field(None, max_length=32,  description="HS 编码")
    annual_capacity_tons:Optional[Decimal] = Field(None, ge=0, description="年产能（吨）")
    annual_export_tons:  Optional[Decimal] = Field(None, ge=0, description="年出口欧盟量（吨）")
    export_countries:    Optional[str]     = Field(None, max_length=512, description="出口国（逗号分隔）")
    annual_power_kwh:    Optional[Decimal] = Field(None, ge=0, description="年用电量 kWh")
    power_grid:          Optional[str]     = Field(None, max_length=16,  description="电网枚举：east/north/south/northeast/northwest/central")
    contact_email:       Optional[str]     = Field(None, max_length=320, description="合规联系邮箱")
    region_tag:          Optional[str]     = Field(
        None, max_length=32,
        description="地域标签：gd/guangdong/广东 等，用于 GD-ETS 2026 政策感知",
    )


class WorkspaceUpdateResponse(CamelModel):
    workspace_id: uuid.UUID
    is_complete: bool
    stage: WorkspaceStageSchema
    gm_earned: Decimal = Field(default=Decimal("0"))
    message: str
    app_state: Optional[Dict[str, Any]] = Field(
        default=None,
        description="与 GET /api/v1/hub/overview 同构的全量 DNA；保存成功后由后端聚合写入，前端无刷新重绘。",
    )


# ---------------------------------------------------------------------------
# Hub 扩展：CBAM 落库 / 供应链邀请 / 决策包 / DLD 申请（AppState.commit 对齐）
# ---------------------------------------------------------------------------

class CBAMReportSaveRequest(CamelModel):
    """前端测算完成后写入 cbam_reports + 可选 GM 奖励。"""
    reporting_period: Optional[str] = Field(None, max_length=16, description="如 2026-Q2，缺省为 ad-hoc")
    risk_exposure_eur: Optional[Decimal] = Field(None, description="碳税敞口 EUR")
    tco2e_total: Optional[Decimal] = Field(None, description="总排放量 tCO2e")
    payload_json: Optional[str] = Field(
        None,
        description=(
            "完整测算 JSON 快照；建议包含 mainProduct、mainProductLabel、scope3MaterialLabel、"
            "scope3MaterialFactor、scope3MaterialUnit（t/kWh/sqm/unit）、scope3MaterialVolume、"
            "scope3MaterialVolumeUnit、usesChinaDefaultLibrary、scope3UpstreamExempt 等字段，"
            "与 CBAM 测算工具行业-原料联动一致。"
        ),
    )


class CBAMReportSaveResponse(CamelModel):
    report_id: uuid.UUID
    gm_earned: Decimal = Field(default=Decimal("0"))
    message: str
    app_state: Optional[Dict[str, Any]] = None


class SupplierInviteRequest(CamelModel):
    supplier_node_id: Optional[uuid.UUID] = Field(
        None,
        description="已有节点 ID：刷新穿透链接，不重复建节点、不重复发 GM",
    )
    supplier_name: str = Field(..., min_length=1, max_length=256)
    supplier_credit_code: Optional[str] = Field(None, max_length=64)
    contact_email: Optional[str] = Field(None, max_length=320)
    contact_phone: Optional[str] = Field(None, max_length=32)
    contact_person_name: Optional[str] = Field(None, max_length=128)


class SupplierInviteResponse(CamelModel):
    supplier_node_id: uuid.UUID
    submission_token: str
    invite_code: str
    gm_earned: Decimal = Field(default=Decimal("0"))
    message: str
    app_state: Optional[Dict[str, Any]] = Field(
        default=None,
        description="签发邀请后回灌的全量 AppState DNA",
    )


class DecisionPackageRequest(CamelModel):
    title: str = Field(..., min_length=2, max_length=256)
    body: Optional[str] = Field(None, max_length=12000)


class DecisionPackageResponse(CamelModel):
    gm_earned: Decimal = Field(default=Decimal("15"))
    message: str


class DLDApplyRequest(CamelModel):
    requested_amount_cny: Optional[Decimal] = Field(None, ge=0, description="申请金额（人民币）")
    purpose: Optional[str] = Field(None, max_length=2000)


class DLDApplyResponse(CamelModel):
    gm_earned: Decimal = Field(default=Decimal("5"))
    message: str


class RegulationReadRequest(CamelModel):
    """企业法规库 · 单篇阅读落库（写 GMLedger + 回灌 AppState.regulation）。"""
    regulation_id: str = Field(..., min_length=1, max_length=64, description="法规条目稳定 ID，如 cbam-2026-eu")
    title: Optional[str] = Field(None, max_length=256, description="展示标题，写入流水 memo")
    progress_pct: Optional[int] = Field(100, ge=0, le=100, description="阅读进度 0–100")


class RegulationReadResponse(CamelModel):
    regulation_id: str
    read_at: str
    progress_pct: int = 100
    gm_earned: Decimal = Field(default=Decimal("0"))
    already_read: bool = False
    message: str
    app_state: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# 通用响应包装
# ---------------------------------------------------------------------------

class APISuccess(BaseModel):
    success : bool = True
    message : str  = "ok"


class APIError(BaseModel):
    success : bool = False
    code    : str
    message : str
    detail  : Optional[str] = None

# ---------------------------------------------------------------------------
# 🚩 BillParserResponse — 电费单视觉识别响应（宪章§4-后端-3）
#    POST /api/v1/assets/parse-bill 的统一响应体
#    命名为 BillParserResponse（V3 统一命名，禁止再使用 BillExtractionResult / BillParseResponse）
# ---------------------------------------------------------------------------

class BillParserResponse(BaseModel):
    """电费单视觉解析的标准响应体。"""
    electricity_kwh: float = Field(..., description="当期总用电量 kWh")
    month: str = Field(..., description="账单月份 YYYY-MM")
    confidence: float = Field(..., ge=0.0, le=1.0, description="识别置信度 0~1")


# 历史别名兼容（防止外部代码继续 import 旧名而崩溃）；新代码请直接使用 BillParserResponse。
BillExtractionResult = BillParserResponse
BillParseResponse = BillParserResponse
