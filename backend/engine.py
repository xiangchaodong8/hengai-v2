"""
Co2Lion·HengAI — 核心核算大模型（重构版 v2）
文件：routers/engine.py
接口：
  POST /api/v1/engine/calculate      — 核算并持久化，返回完整 ROI 报告
  GET  /api/v1/engine/reports        — 查询本工作空间历史核算报告列表
  GET  /api/v1/engine/reports/{id}   — 查询单份报告详情

核算体系：
  ▸ ISO 14067:2018 产品碳足迹量化标准
  ▸ EU ETS Phase IV 产品基准值（Commission DR (EU) 2021/2153）
  ▸ IPCC AR6 燃料排放因子
  ▸ 生态环境部 2022 年度区域电网碳因子
  ▸ CBAM Regulation (EU) 2023/956 税基计算规则
  ▸ 惩罚税款系数：1.35×（对应 CBAM Art.26 违规附加税）
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import get_current_user
from database import get_db
from models import CBAMReport, User, UserWorkspaceLink, Workspace

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/engine", tags=["Engine CBAM 核算引擎"])


# ─────────────────────────────────────────────────────────────────────
# § 1  行业基准字典（EU ETS Phase IV，tCO₂e/t 产品）
# ─────────────────────────────────────────────────────────────────────

class IndustryCode(str, Enum):
    STEEL_HOT_ROLLED    = "steel_hot_rolled"
    STEEL_COLD_ROLLED   = "steel_cold_rolled"
    STEEL_REBAR         = "steel_rebar"
    ALUMINUM_PRIMARY    = "aluminum_primary"
    ALUMINUM_SECONDARY  = "aluminum_secondary"
    CEMENT_CLINKER      = "cement_clinker"
    CEMENT_GREY         = "cement_grey"
    FERTILIZER_AMMONIA  = "fertilizer_ammonia"
    FERTILIZER_UREA     = "fertilizer_urea"
    HYDROGEN_GREY       = "hydrogen_grey"
    GLASS_CONTAINER     = "glass_container"
    GLASS_FLAT          = "glass_flat"
    ELECTRICITY_GENERAL = "electricity_general"


EU_ETS_BENCHMARK: dict[IndustryCode, float] = {
    IndustryCode.STEEL_HOT_ROLLED:    1.328,
    IndustryCode.STEEL_COLD_ROLLED:   1.328,
    IndustryCode.STEEL_REBAR:         0.819,
    IndustryCode.ALUMINUM_PRIMARY:    1.514,
    IndustryCode.ALUMINUM_SECONDARY:  0.325,
    IndustryCode.CEMENT_CLINKER:      0.766,
    IndustryCode.CEMENT_GREY:         0.693,
    IndustryCode.FERTILIZER_AMMONIA:  1.694,
    IndustryCode.FERTILIZER_UREA:     2.273,
    IndustryCode.HYDROGEN_GREY:       5.490,
    IndustryCode.GLASS_CONTAINER:     0.540,
    IndustryCode.GLASS_FLAT:          0.453,
    IndustryCode.ELECTRICITY_GENERAL: 0.000,
}

INDUSTRY_NAME_CN: dict[IndustryCode, str] = {
    IndustryCode.STEEL_HOT_ROLLED:    "热轧钢",
    IndustryCode.STEEL_COLD_ROLLED:   "冷轧钢",
    IndustryCode.STEEL_REBAR:         "螺纹钢",
    IndustryCode.ALUMINUM_PRIMARY:    "原铝（电解铝）",
    IndustryCode.ALUMINUM_SECONDARY:  "再生铝",
    IndustryCode.CEMENT_CLINKER:      "水泥熟料",
    IndustryCode.CEMENT_GREY:         "灰水泥",
    IndustryCode.FERTILIZER_AMMONIA:  "合成氨",
    IndustryCode.FERTILIZER_UREA:     "尿素",
    IndustryCode.HYDROGEN_GREY:       "灰氢",
    IndustryCode.GLASS_CONTAINER:     "容器玻璃",
    IndustryCode.GLASS_FLAT:          "平板玻璃",
    IndustryCode.ELECTRICITY_GENERAL: "电力",
}


# ─────────────────────────────────────────────────────────────────────
# § 2  区域电网碳因子（tCO₂/MWh）
# ─────────────────────────────────────────────────────────────────────

class GridRegion(str, Enum):
    NORTH     = "north"
    NORTHEAST = "northeast"
    EAST      = "east"
    CENTRAL   = "central"
    NORTHWEST = "northwest"
    SOUTH     = "south"
    NATIONAL  = "national"


GRID_EMISSION_FACTOR: dict[GridRegion, float] = {
    GridRegion.NORTH:     0.8843,
    GridRegion.NORTHEAST: 0.7769,
    GridRegion.EAST:      0.7035,
    GridRegion.CENTRAL:   0.5257,
    GridRegion.NORTHWEST: 0.6671,
    GridRegion.SOUTH:     0.5271,
    GridRegion.NATIONAL:  0.6101,
}

GRID_REGION_CN: dict[GridRegion, str] = {
    GridRegion.NORTH:     "华北电网",
    GridRegion.NORTHEAST: "东北电网",
    GridRegion.EAST:      "华东电网",
    GridRegion.CENTRAL:   "华中电网",
    GridRegion.NORTHWEST: "西北电网",
    GridRegion.SOUTH:     "南方电网",
    GridRegion.NATIONAL:  "全国平均",
}

# ─────────────────────────────────────────────────────────────────────
# § 3  核算常量
# ─────────────────────────────────────────────────────────────────────

# 燃料排放因子（IPCC AR6 默认值）
_EF_NATURAL_GAS_PER_MWH:  float = 0.1820   # tCO₂/MWh 热值
_EF_COAL_PER_TON:         float = 2.6400   # tCO₂/t 标准煤
_EF_DIESEL_PER_LITER:     float = 0.002630 # tCO₂/L

# CBAM 规则参数
CBAM_PENALTY_MULTIPLIER:  float = 1.35     # Art.26 违规附加系数
MAT_EXEMPTION_RATIO:      float = 0.90     # 碳强度 ≤ 基准 × 90% 触发豁免
MAT_EXEMPTION_RATE:       float = 0.80     # 豁免比例
MAT_ANNUAL_FEE_EUR:       float = 8_800.0  # MAT 平台年费
CBAM_ADMIN_FEE_EUR:       float = 2_500.0  # Lv.2 人工凭证行政费


# ─────────────────────────────────────────────────────────────────────
# § 4  Pydantic 请求/响应模型
# ─────────────────────────────────────────────────────────────────────

class CalculateRequest(BaseModel):
    """POST /api/v1/engine/calculate 请求体（ISO 14067 标准输入）"""

    industry_code:         IndustryCode = Field(..., description="产品行业代码")
    grid_region:           GridRegion   = Field(default=GridRegion.NATIONAL, description="所在电网区域")

    # 产量
    annual_output_tons:    float = Field(..., gt=0, le=10_000_000, description="年产量（吨）")

    # 能耗（Scope 1 + Scope 2 原始输入）
    electricity_mwh:       float = Field(..., ge=0,  description="年用电量（MWh）")
    natural_gas_mwh:       float = Field(default=0.0, ge=0, description="年天然气消耗（MWh 热值当量）")
    coal_tons:             float = Field(default=0.0, ge=0, description="年燃煤量（吨标准煤）")
    diesel_liters:         float = Field(default=0.0, ge=0, description="年柴油消耗（升）")

    # 主材（Scope 3 上游，用于供应链穿透率计算）
    main_material_name:    Optional[str]   = Field(default=None, max_length=50, description="主要原材料名称")
    main_material_tons:    Optional[float] = Field(default=None, ge=0, description="年主材消耗量（吨）")
    main_material_ci:      Optional[float] = Field(default=None, ge=0, description="主材碳强度（tCO₂/t），如已知")

    # 碳价与出口参数
    cbam_carbon_price_eur: float = Field(default=65.0, gt=0, le=500, description="CBAM 碳价（€/tCO₂）")
    export_volume_ratio:   float = Field(default=1.0,  gt=0, le=1.0, description="出口至欧盟的产量占比")
    eur_cny_rate:          float = Field(default=7.82, gt=0,          description="EUR/CNY 汇率")

    # 中国 ETS 抵扣
    cn_ets_offset_tco2:    float = Field(default=0.0, ge=0, description="中国 ETS 持有配额（tCO₂），可抵扣 CBAM 税基")

    @model_validator(mode="after")
    def at_least_one_energy(self) -> "CalculateRequest":
        if all(v == 0 for v in [
            self.electricity_mwh, self.natural_gas_mwh,
            self.coal_tons, self.diesel_liters,
        ]):
            raise ValueError("至少填写一项能耗数据（电力/天然气/燃煤/柴油）")
        return self

    model_config = {
        "json_schema_extra": {
            "example": {
                "industry_code": "aluminum_primary",
                "grid_region": "south",
                "annual_output_tons": 50000,
                "electricity_mwh": 375000,
                "natural_gas_mwh": 12000,
                "coal_tons": 0,
                "main_material_name": "氧化铝",
                "main_material_tons": 97500,
                "main_material_ci": 0.45,
                "cbam_carbon_price_eur": 65.0,
                "export_volume_ratio": 0.6,
                "eur_cny_rate": 7.82,
                "cn_ets_offset_tco2": 5000,
            }
        }
    }


class EmissionDetail(BaseModel):
    scope1_fuel_tco2:        float = Field(..., description="Scope1 燃料直接排放 tCO₂")
    scope2_electricity_tco2: float = Field(..., description="Scope2 电力间接排放 tCO₂")
    scope3_upstream_tco2:    float = Field(..., description="Scope3 上游主材排放 tCO₂（如已提供主材数据）")
    total_tco2:              float = Field(..., description="合计排放 tCO₂e（Scope1+2，不含 Scope3 用于税基）")


class CostComparison(BaseModel):
    # Lv.2 人工凭证（无网关，全量缴税 + 1.35× 风险溢价）
    lv2_taxable_tco2:    float
    lv2_base_tax_eur:    float = Field(..., description="Lv.2 基础税额（€）")
    lv2_penalty_tax_eur: float = Field(..., description="Lv.2 惩罚税额（基础 × 1.35）（€）")
    lv2_admin_fee_eur:   float = Field(..., description="Lv.2 行政手续费（€）")
    lv2_total_cost_eur:  float = Field(..., description="Lv.2 总合规成本（€）")
    lv2_total_cost_cny:  float = Field(..., description="Lv.2 总合规成本（¥）")

    # Lv.4 MAT 网关（核证豁免 + 消除惩罚系数）
    lv4_taxable_tco2:    float
    lv4_base_tax_eur:    float
    lv4_mat_fee_eur:     float
    lv4_total_cost_eur:  float
    lv4_total_cost_cny:  float

    # ROI 计算
    net_saving_eur:      float = Field(..., description="接入 MAT 净节省（€）")
    net_saving_cny:      float = Field(..., description="净节省（¥）")
    roi_percent:         float = Field(..., description="MAT 投资回报率 ROI%")
    payback_months:      float = Field(..., description="MAT 投资回收期（月）")
    mat_exemption_triggered: bool


class CalculateResponse(BaseModel):
    """POST /api/v1/engine/calculate 完整响应"""
    report_id:            str
    db_record_id:         int   = Field(..., description="数据库写入的 cbam_reports.id")
    generated_at:         datetime

    industry_name:        str
    grid_region_name:     str
    annual_output_tons:   float

    # 碳强度对比
    carbon_intensity:     float = Field(..., description="实测碳强度 tCO₂/t产品")
    industry_benchmark:   float = Field(..., description="EU ETS 行业基准 tCO₂/t产品")
    vs_benchmark_pct:     float = Field(..., description="偏差%（负值=低于基准=优秀）")

    # Scope3 穿透率
    scope3_rate:          float = Field(..., description="供应链 Scope3 占总排放比例%")

    # 排放明细
    emissions:            EmissionDetail

    # 出口税基
    export_volume_tons:   float
    cn_ets_offset_tco2:   float
    net_exposed_tco2:     float

    # 方案对比
    cost_comparison:      CostComparison

    # 风险与建议
    risk_level:           str
    recommendation:       str


class ReportListItem(BaseModel):
    id:               int
    report_id:        str
    industry_name:    str
    total_tco2:       float
    carbon_intensity: float
    risk_level:       str
    net_saving_eur:   float
    created_at:       datetime
    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────────────────────
# § 5  ISO 14067 核算引擎（纯函数，无 I/O）
# ─────────────────────────────────────────────────────────────────────

def _calc_emissions(req: CalculateRequest) -> EmissionDetail:
    """
    按 ISO 14067 三范畴拆分计算。
    Scope3 仅计算上游主材，不纳入 CBAM 税基（税基为 Scope1+2）。
    """
    # Scope 1
    scope1 = (
        req.natural_gas_mwh * _EF_NATURAL_GAS_PER_MWH
        + req.coal_tons      * _EF_COAL_PER_TON
        + req.diesel_liters  * _EF_DIESEL_PER_LITER
    )

    # Scope 2（基于区域电网因子）
    ef       = GRID_EMISSION_FACTOR[req.grid_region]
    scope2   = req.electricity_mwh * ef

    # Scope 3 上游（主材）
    scope3 = 0.0
    if req.main_material_tons and req.main_material_ci:
        scope3 = req.main_material_tons * req.main_material_ci

    total_12 = scope1 + scope2  # CBAM 税基用 Scope1+2

    return EmissionDetail(
        scope1_fuel_tco2=round(scope1, 4),
        scope2_electricity_tco2=round(scope2, 4),
        scope3_upstream_tco2=round(scope3, 4),
        total_tco2=round(total_12, 4),
    )


def _calc_scope3_rate(emissions: EmissionDetail) -> float:
    """
    供应链 Scope3 穿透率 = Scope3 / (Scope1+2+3) × 100%
    当分母为 0 时返回 0.0。
    """
    total_all = emissions.total_tco2 + emissions.scope3_upstream_tco2
    if total_all <= 0:
        return 0.0
    return round((emissions.scope3_upstream_tco2 / total_all) * 100, 2)


def _calc_cost_comparison(
    total_tco2:        float,
    carbon_intensity:  float,
    benchmark:         float,
    net_exposed_tco2:  float,
    price_eur:         float,
    eur_cny:           float,
) -> CostComparison:
    """
    Lv.2 vs Lv.4 完整成本模型。

    Lv.2 惩罚税逻辑：
      无核证凭证时，CBAM 核查机构按实际碳排 × 1.35 倍计征罚款
      （依据 CBAM Regulation Art.26 第 2 款：罚款额 = 碳价 × 超量 × 1.35）
      此处保守估算：将基础税 × 1.35 作为合规风险成本。

    Lv.4 MAT 豁免逻辑：
      碳强度 ≤ 基准 × 90% → 超优部分 80% 可申请豁免
      同时消除 1.35× 惩罚系数（持有核证凭证）
    """
    # ── Lv.2 ─────────────────────────────────────────────────────────
    lv2_base_tax   = round(net_exposed_tco2 * price_eur, 2)
    lv2_penalty    = round(lv2_base_tax * CBAM_PENALTY_MULTIPLIER, 2)
    lv2_admin      = CBAM_ADMIN_FEE_EUR
    lv2_total      = round(lv2_penalty + lv2_admin, 2)

    # ── Lv.4 ─────────────────────────────────────────────────────────
    mat_triggered = (
        benchmark > 0
        and carbon_intensity <= benchmark * MAT_EXEMPTION_RATIO
    )

    if mat_triggered:
        exempt_intensity = benchmark - carbon_intensity
        # 超优部分按比例豁免 80%
        exempt_ratio  = min((exempt_intensity / benchmark) * MAT_EXEMPTION_RATE, 0.60)
        lv4_taxable   = max(0.0, round(net_exposed_tco2 * (1 - exempt_ratio), 4))
    else:
        lv4_taxable = net_exposed_tco2

    lv4_base_tax = round(lv4_taxable * price_eur, 2)   # 核证后无惩罚系数
    lv4_mat_fee  = MAT_ANNUAL_FEE_EUR
    lv4_total    = round(lv4_base_tax + lv4_mat_fee, 2)

    net_saving   = round(lv2_total - lv4_total, 2)
    roi_pct      = round((net_saving / lv4_mat_fee) * 100, 2) if lv4_mat_fee > 0 else 0.0
    payback      = round((lv4_mat_fee / (net_saving / 12)), 2) if net_saving > 0 else 9999.0

    return CostComparison(
        lv2_taxable_tco2=net_exposed_tco2,
        lv2_base_tax_eur=lv2_base_tax,
        lv2_penalty_tax_eur=lv2_penalty,
        lv2_admin_fee_eur=lv2_admin,
        lv2_total_cost_eur=lv2_total,
        lv2_total_cost_cny=round(lv2_total * eur_cny, 2),
        lv4_taxable_tco2=lv4_taxable,
        lv4_base_tax_eur=lv4_base_tax,
        lv4_mat_fee_eur=lv4_mat_fee,
        lv4_total_cost_eur=lv4_total,
        lv4_total_cost_cny=round(lv4_total * eur_cny, 2),
        net_saving_eur=net_saving,
        net_saving_cny=round(net_saving * eur_cny, 2),
        roi_percent=roi_pct,
        payback_months=payback,
        mat_exemption_triggered=mat_triggered,
    )


def _calc_risk_level(vs_benchmark_pct: float) -> tuple[str, str]:
    if vs_benchmark_pct <= -10:
        return ("Low",
                "碳强度显著低于基准，处于行业绿色领先区间。建议申请核证凭证锁定竞争优势，接入 MAT 网关可进一步实现税负豁免。")
    elif vs_benchmark_pct <= 10:
        return ("Medium",
                "碳强度接近行业基准，存在一定 CBAM 税负风险。建议近期接入 MAT 网关，通过核证数据争取豁免额度。")
    elif vs_benchmark_pct <= 40:
        return ("High",
                "碳强度明显高于基准，若不持有核证凭证将面临 1.35× 惩罚税。强烈建议立即启动绿色改造并接入 MAT 网关。")
    else:
        return ("Critical",
                "碳强度极高，CBAM 税负将严重侵蚀出口利润。建议紧急启动碳中和专项方案，优先替换高碳能源，同步对接 MAT 网关。")


# ─────────────────────────────────────────────────────────────────────
# § 6  工作空间查询工具
# ─────────────────────────────────────────────────────────────────────

async def _get_user_workspace(user_id: int, db: AsyncSession) -> Workspace:
    """查询用户的工作空间，不存在则抛 404。"""
    stmt = (
        select(Workspace)
        .join(UserWorkspaceLink, UserWorkspaceLink.workspace_id == Workspace.id)
        .where(UserWorkspaceLink.user_id == user_id)
        .order_by(UserWorkspaceLink.created_at.asc())
        .limit(1)
    )
    result = await db.execute(stmt)
    ws = result.scalar_one_or_none()
    if ws is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="未找到关联的工作空间，请先完成企业信息填写",
        )
    return ws


# ─────────────────────────────────────────────────────────────────────
# § 7  路由：核算并持久化
# ─────────────────────────────────────────────────────────────────────

@router.post(
    "/calculate",
    response_model=CalculateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="CBAM 核算（ISO 14067 标准，结果持久化）",
    description=(
        "接收能耗与产量数据，按 ISO 14067 标准核算碳排放，\n"
        "对比 EU ETS 基准线，计算 Lv.2 惩罚税（1.35×）与 Lv.4 MAT 优化 ROI，\n"
        "**将结果写入 `cbam_reports` 表**，并更新 Workspace 的最新风险状态。\n"
        "（绿印 GM 入账请走 `POST /api/v1/hub/cbam-report-save`，与本路由解耦。）"
    ),
)
async def calculate(
    payload:      CalculateRequest,
    current_user: User         = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
) -> CalculateResponse:

    # ── 1. 获取工作空间 ───────────────────────────────────────────────
    try:
        workspace = await _get_user_workspace(current_user.id, db)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("查询工作空间失败: user_id=%s, %s", current_user.id, exc, exc_info=True)
        raise HTTPException(status_code=503, detail="数据库服务暂时不可用")

    # ── 2. 核算（纯内存，< 1ms）──────────────────────────────────────
    emissions        = _calc_emissions(payload)
    total_tco2       = emissions.total_tco2
    benchmark        = EU_ETS_BENCHMARK.get(payload.industry_code, 1.0)
    carbon_intensity = round(total_tco2 / payload.annual_output_tons, 6) if payload.annual_output_tons > 0 else 0.0
    vs_benchmark_pct = round(((carbon_intensity - benchmark) / benchmark) * 100, 2) if benchmark > 0 else 0.0
    scope3_rate      = _calc_scope3_rate(emissions)

    export_tons      = round(payload.annual_output_tons * payload.export_volume_ratio, 2)
    export_tco2      = round(total_tco2 * payload.export_volume_ratio, 4)
    net_exposed      = max(0.0, round(export_tco2 - payload.cn_ets_offset_tco2, 4))

    comparison       = _calc_cost_comparison(
        total_tco2=total_tco2,
        carbon_intensity=carbon_intensity,
        benchmark=benchmark,
        net_exposed_tco2=net_exposed,
        price_eur=payload.cbam_carbon_price_eur,
        eur_cny=payload.eur_cny_rate,
    )
    risk_level, recommendation = _calc_risk_level(vs_benchmark_pct)

    # ── 3. 持久化到 cbam_reports 表 ──────────────────────────────────
    report_id = f"RPT-{current_user.id}-{int(datetime.now(tz=timezone.utc).timestamp())}"
    try:
        report = CBAMReport(
            user_id=current_user.id,
            workspace_id=workspace.id,
            report_id=report_id,
            input_snapshot=json.dumps(payload.model_dump(), ensure_ascii=False),
            industry_code=payload.industry_code.value,
            industry_name=INDUSTRY_NAME_CN[payload.industry_code],
            annual_output=payload.annual_output_tons,
            total_tco2=total_tco2,
            carbon_intensity=carbon_intensity,
            benchmark=benchmark,
            vs_benchmark_pct=vs_benchmark_pct,
            scope3_rate=scope3_rate,                     # ← 供 hub.py 读取
            net_exposed_tco2=net_exposed,
            lv2_total_cost_eur=comparison.lv2_total_cost_eur,
            lv4_total_cost_eur=comparison.lv4_total_cost_eur,
            net_saving_eur=comparison.net_saving_eur,
            roi_percent=comparison.roi_percent,
            risk_level=risk_level,                       # ← 供 hub.py 读取
        )
        db.add(report)
        await db.commit()
        await db.refresh(report)

        logger.info(
            "CBAM 核算完成并持久化: user_id=%s, workspace_id=%s, report_id=%s, "
            "tco2=%.2f, risk=%s, roi=%.1f%%",
            current_user.id, workspace.id, report_id,
            total_tco2, risk_level, comparison.roi_percent,
        )

    except Exception as exc:
        await db.rollback()
        logger.error("核算报告持久化失败: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="核算结果写入失败，请重试",
        )

    return CalculateResponse(
        report_id=report_id,
        db_record_id=report.id,
        generated_at=report.created_at,
        industry_name=INDUSTRY_NAME_CN[payload.industry_code],
        grid_region_name=GRID_REGION_CN[payload.grid_region],
        annual_output_tons=payload.annual_output_tons,
        carbon_intensity=carbon_intensity,
        industry_benchmark=benchmark,
        vs_benchmark_pct=vs_benchmark_pct,
        scope3_rate=scope3_rate,
        emissions=emissions,
        export_volume_tons=export_tons,
        cn_ets_offset_tco2=payload.cn_ets_offset_tco2,
        net_exposed_tco2=net_exposed,
        cost_comparison=comparison,
        risk_level=risk_level,
        recommendation=recommendation,
    )


# ─────────────────────────────────────────────────────────────────────
# § 8  路由：历史报告列表
# ─────────────────────────────────────────────────────────────────────

@router.get(
    "/reports",
    response_model=list[ReportListItem],
    status_code=status.HTTP_200_OK,
    summary="查询本工作空间历史核算报告",
)
async def list_reports(
    current_user: User        = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
    page:         int         = Query(default=1, ge=1),
    page_size:    int         = Query(default=10, ge=1, le=50),
) -> list[ReportListItem]:
    try:
        workspace = await _get_user_workspace(current_user.id, db)
        stmt = (
            select(CBAMReport)
            .where(CBAMReport.workspace_id == workspace.id)
            .order_by(CBAMReport.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        result  = await db.execute(stmt)
        reports = result.scalars().all()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("查询报告列表失败: user_id=%s, %s", current_user.id, exc, exc_info=True)
        raise HTTPException(status_code=503, detail="数据库服务暂时不可用")

    return [
        ReportListItem(
            id=r.id,
            report_id=r.report_id,
            industry_name=r.industry_name,
            total_tco2=r.total_tco2,
            carbon_intensity=r.carbon_intensity,
            risk_level=r.risk_level,
            net_saving_eur=r.net_saving_eur,
            created_at=r.created_at,
        )
        for r in reports
    ]


# ─────────────────────────────────────────────────────────────────────
# § 9  路由：报告详情
# ─────────────────────────────────────────────────────────────────────

@router.get(
    "/reports/{report_db_id}",
    response_model=ReportListItem,
    status_code=status.HTTP_200_OK,
    summary="查询单份核算报告详情",
)
async def get_report(
    report_db_id: int,
    current_user: User        = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
) -> ReportListItem:
    try:
        workspace = await _get_user_workspace(current_user.id, db)
        stmt = select(CBAMReport).where(
            CBAMReport.id == report_db_id,
            CBAMReport.workspace_id == workspace.id,   # 隔离其他工作空间
        )
        result = await db.execute(stmt)
        report = result.scalar_one_or_none()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("查询报告详情失败: id=%s, %s", report_db_id, exc, exc_info=True)
        raise HTTPException(status_code=503, detail="数据库服务暂时不可用")

    if report is None:
        raise HTTPException(status_code=404, detail="报告不存在或无权访问")

    return ReportListItem(
        id=report.id,
        report_id=report.report_id,
        industry_name=report.industry_name,
        total_tco2=report.total_tco2,
        carbon_intensity=report.carbon_intensity,
        risk_level=report.risk_level,
        net_saving_eur=report.net_saving_eur,
        created_at=report.created_at,
    )
