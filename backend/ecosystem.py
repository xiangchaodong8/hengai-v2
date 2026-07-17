"""
Co2Lion·HengAI — 跨端数据击穿引擎（重构版 v2）
文件：routers/ecosystem.py
接口：
  POST /api/v1/eco/supplier-submit   — H5 公开接口，供应商填报
  POST /api/v1/eco/recalc-scope3     — 内部接口，手动触发 Scope3 重算
  GET  /api/v1/eco/my-suppliers      — 链主查看供应商列表
  GET  /api/v1/eco/gm-ledger         — GM 流水分页查询

【联动核心】supplier-submit 完整闭环：
  1. 解析邀请码 → 反查链主 User + Workspace
  2. 写入 SupplierData（幂等：重复提交走 UPDATE）
  3. 触发 Scope3 穿透率重算：
       scope3_rate = SUM(supplier.carbon_intensity × supplier.output) / workspace_total_output × 100%
  4. 将重算结果写回 CBAMReport（最新一条）的 scope3_rate 字段
  5. 原子事务：向 GMLedger 插入 +200 GM 激励记录
  6. 同步更新 users.gm_balance 快照
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import get_current_user
from database import get_db
from models import CBAMReport, GMLedger, SupplierData, User, UserWorkspaceLink, Workspace

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/eco", tags=["Ecosystem 生态裂变引擎"])


# ─────────────────────────────────────────────────────────────────────
# § 1  业务常量
# ─────────────────────────────────────────────────────────────────────

GM_REWARD_FIRST_SUBMIT: int = 200
GM_REWARD_GRADE_UPGRADE: int = 100   # 重复提交且评级升至 A 时

# 行业平均碳强度（tCO₂/t 产品），用于供应商评级
_INDUSTRY_AVG_INTENSITY: dict[str, float] = {
    "压铸":   2.80, "注塑":   1.95, "锻造":   3.10,
    "电镀":   4.20, "冲压":   1.40, "焊接":   1.60,
    "喷涂":   2.20, "机加工": 1.30, "其他":   2.50,
}
_ALLOWED_INDUSTRIES = set(_INDUSTRY_AVG_INTENSITY.keys())

# Scope3 重算：贡献权重（碳强度 × 产量 / 链主总产量）
_SCOPE3_MIN_SUPPLIERS_FOR_STAT: int = 1   # 至少 1 家供应商才更新 scope3_rate


# ─────────────────────────────────────────────────────────────────────
# § 2  供应商评级纯函数
# ─────────────────────────────────────────────────────────────────────

class SupplierGrade(str, Enum):
    A = "A"
    B = "B"
    C = "C"


def _calc_completeness(form: "SupplierSubmitForm") -> float:
    """9 个关键字段完整度评分（0.0 ~ 1.0）"""
    checks = [
        form.company_name,
        form.contact_phone,
        form.industry_type,
        form.province,
        form.annual_electricity_mwh > 0 if form.annual_electricity_mwh else None,
        form.annual_output_tons     > 0 if form.annual_output_tons     else None,
        form.main_material,
        form.main_material_tons     > 0 if form.main_material_tons     else None,
        form.production_days        > 0 if form.production_days        else None,
    ]
    return round(sum(1 for c in checks if c) / len(checks), 4)


def _calc_supplier_ci(
    electricity_mwh: float,
    output_tons:     float,
    self_ci:         Optional[float] = None,
    grid_ef:         float = 0.6101,
) -> float:
    """
    供应商碳强度（tCO₂/t 产品）。
    优先使用自报碳强度；否则用电量 × 全国平均电网因子 / 产量。
    """
    if self_ci is not None and self_ci > 0:
        return round(self_ci, 6)
    if output_tons <= 0:
        return 9999.0
    return round((electricity_mwh * grid_ef) / output_tons, 6)


def _grade(
    completeness:     float,
    carbon_intensity: float,
    industry_type:    str,
) -> SupplierGrade:
    avg = _INDUSTRY_AVG_INTENSITY.get(industry_type, 2.50)
    if completeness >= 0.90 and carbon_intensity <= avg * 0.80:
        return SupplierGrade.A
    if completeness >= 0.60 and carbon_intensity <= avg * 1.20:
        return SupplierGrade.B
    return SupplierGrade.C


# ─────────────────────────────────────────────────────────────────────
# § 3  邀请码工具
# ─────────────────────────────────────────────────────────────────────

def _decode_invite_code(code: str) -> Optional[int]:
    """
    格式：HG-{user_id 十六进制}-{sha256 校验位前 2 位}
    示例：HG-1A-F3
    返回 user_id（int）或 None（无效）。
    """
    try:
        parts = code.upper().strip().split("-")
        if len(parts) != 3 or parts[0] != "HG":
            return None
        uid_hex  = parts[1]
        user_id  = int(uid_hex, 16)
        expected = hashlib.sha256(f"HG{uid_hex}".encode()).hexdigest()[:2].upper()
        return user_id if parts[2] == expected else None
    except (ValueError, IndexError):
        return None


def generate_invite_code(user_id: int) -> str:
    """注册时为用户生成邀请码，也可单独调用。"""
    uid_hex = format(user_id, "X")
    check   = hashlib.sha256(f"HG{uid_hex}".encode()).hexdigest()[:2].upper()
    return f"HG-{uid_hex}-{check}"


# ─────────────────────────────────────────────────────────────────────
# § 4  Scope3 穿透率重算（核心联动逻辑）
# ─────────────────────────────────────────────────────────────────────

async def _recalc_and_persist_scope3(
    workspace_id: int,
    db:           AsyncSession,
) -> float:
    """
    【联动核心】重算链主 Workspace 的 Scope3 穿透率并写回最新 CBAMReport。

    算法：
      加权碳强度均值 = SUM(supplier.carbon_intensity × supplier.annual_output_tons)
                      / SUM(supplier.annual_output_tons)
      scope3_rate   = 加权碳强度 / (workspace 最新报告 carbon_intensity) × 某比例
                    → 简化版：供应商 Scope3 总排放 / (Scope1+2 + Scope3) × 100%

    注：
      Scope3 总排放 = SUM(supplier.carbon_intensity × supplier.annual_output_tons)
      Scope1+2 排放 = 最新 CBAMReport.total_tco2
      穿透率 = Scope3 / (Scope1+2 + Scope3) × 100%
    """
    # 聚合所有供应商的加权碳排
    agg_stmt = select(
        func.sum(SupplierData.carbon_intensity * SupplierData.annual_output_tons).label("weighted_tco2"),
        func.count(SupplierData.id).label("supplier_count"),
    ).where(
        SupplierData.chain_master_id.in_(
            select(UserWorkspaceLink.user_id).where(
                UserWorkspaceLink.workspace_id == workspace_id
            )
        )
    )
    agg_result = await db.execute(agg_stmt)
    row = agg_result.one()
    scope3_tco2:     float = float(row.weighted_tco2 or 0.0)
    supplier_count:  int   = int(row.supplier_count  or 0)

    if supplier_count < _SCOPE3_MIN_SUPPLIERS_FOR_STAT or scope3_tco2 <= 0:
        return 0.0

    # 读取最新报告的 Scope1+2 总量
    latest_report_stmt = (
        select(CBAMReport)
        .where(CBAMReport.workspace_id == workspace_id)
        .order_by(CBAMReport.created_at.desc())
        .limit(1)
    )
    report_result = await db.execute(latest_report_stmt)
    latest_report = report_result.scalar_one_or_none()

    if latest_report is None:
        # 没有核算报告时，scope3_rate 仅基于供应商数据，暂存为 0
        return 0.0

    scope12_tco2 = latest_report.total_tco2 or 0.0
    total_all    = scope12_tco2 + scope3_tco2
    scope3_rate  = round((scope3_tco2 / total_all) * 100, 2) if total_all > 0 else 0.0

    # 写回最新报告的 scope3_rate 字段
    await db.execute(
        update(CBAMReport)
        .where(CBAMReport.id == latest_report.id)
        .values(scope3_rate=scope3_rate)
    )
    logger.info(
        "Scope3 穿透率重算完成: workspace_id=%s, scope3_tco2=%.2f, "
        "scope12_tco2=%.2f, scope3_rate=%.2f%%",
        workspace_id, scope3_tco2, scope12_tco2, scope3_rate,
    )
    return scope3_rate


# ─────────────────────────────────────────────────────────────────────
# § 5  Pydantic 模型
# ─────────────────────────────────────────────────────────────────────

class SupplierSubmitForm(BaseModel):
    invite_code:            str            = Field(..., min_length=6, max_length=20)
    company_name:           str            = Field(..., min_length=2, max_length=100)
    contact_phone:          str            = Field(..., pattern=r"^1[3-9]\d{9}$")
    province:               str            = Field(..., min_length=2, max_length=20)
    industry_type:          str            = Field(..., min_length=2, max_length=20)
    annual_electricity_mwh: float          = Field(..., gt=0, le=1_000_000)
    annual_output_tons:     float          = Field(..., gt=0, le=500_000)
    production_days:        Optional[int]  = Field(default=None, ge=1, le=365)
    main_material:          Optional[str]  = Field(default=None, max_length=50)
    main_material_tons:     Optional[float]= Field(default=None, ge=0)
    self_reported_ci:       Optional[float]= Field(default=None, ge=0,
                                                   description="自报碳强度 tCO₂/t，有则优先使用")

    @field_validator("industry_type")
    @classmethod
    def validate_industry(cls, v: str) -> str:
        if v not in _ALLOWED_INDUSTRIES:
            raise ValueError(f"行业类型须为：{', '.join(sorted(_ALLOWED_INDUSTRIES))}")
        return v

    model_config = {
        "json_schema_extra": {
            "example": {
                "invite_code": "HG-1A-F3",
                "company_name": "广东某压铸有限公司",
                "contact_phone": "13800138000",
                "province": "广东",
                "industry_type": "压铸",
                "annual_electricity_mwh": 12000,
                "annual_output_tons": 3000,
                "production_days": 300,
                "main_material": "ADC12铝合金",
                "main_material_tons": 3200,
            }
        }
    }


class SupplierSubmitResponse(BaseModel):
    success:                 bool
    supplier_grade:          SupplierGrade
    carbon_intensity:        float
    completeness_pct:        float
    scope3_rate_updated:     float = Field(..., description="触发重算后链主最新 Scope3 穿透率%")
    chain_master_gm_awarded: int
    message:                 str


class GMLedgerItem(BaseModel):
    id:         int
    amount:     int
    reason:     str
    created_at: datetime
    model_config = {"from_attributes": True}


class GMLedgerListResponse(BaseModel):
    total_gm_balance: int
    records:          list[GMLedgerItem]
    page:             int
    page_size:        int
    total_count:      int


class SupplierSummary(BaseModel):
    id:               int
    company_name:     str
    industry_type:    str
    province:         str
    grade:            SupplierGrade
    carbon_intensity: float
    gm_awarded:       int
    submitted_at:     datetime
    model_config = {"from_attributes": True}


class MySupplierListResponse(BaseModel):
    total_count:     int
    grade_a_count:   int
    grade_b_count:   int
    grade_c_count:   int
    total_gm_earned: int
    scope3_rate:     float = Field(..., description="当前 Scope3 穿透率%（来自最新 CBAMReport）")
    suppliers:       list[SupplierSummary]


# ─────────────────────────────────────────────────────────────────────
# § 6  主路由：供应商填报（H5 公开接口）
# ─────────────────────────────────────────────────────────────────────

@router.post(
    "/supplier-submit",
    response_model=SupplierSubmitResponse,
    status_code=status.HTTP_200_OK,
    summary="H5 供应商碳数据填报（公开接口，无需鉴权）",
    description=(
        "供应商通过链主分享的微信 H5 二维码填报后调用此接口。\n\n"
        "**闭环联动链路（单事务原子操作）：**\n"
        "1. 解析邀请码 → 反查链主 User + Workspace\n"
        "2. 计算碳强度与 A/B/C 评级\n"
        "3. 写入/更新 `supplier_data` 表\n"
        "4. **触发 Scope3 穿透率重算** → 写回 `cbam_reports.scope3_rate`\n"
        "5. 插入 `gm_ledger` +200 GM 激励记录\n"
        "6. 同步更新 `users.gm_balance` 快照"
    ),
)
async def supplier_submit(
    form: SupplierSubmitForm,
    db:   AsyncSession = Depends(get_db),
) -> SupplierSubmitResponse:
    """
    H5 无鉴权公开接口。
    所有数据库写操作（SupplierData + GMLedger + CBAMReport.scope3_rate + User.gm_balance）
    在同一事务内完成，任何步骤失败触发完整回滚。
    """

    # ── 1. 解析邀请码 ──────────────────────────────────────────────
    chain_master_id = _decode_invite_code(form.invite_code)
    if chain_master_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="邀请码格式非法或校验失败，请确认扫码链接",
        )

    # ── 2. 查询链主 User + Workspace ──────────────────────────────
    try:
        user_stmt = select(User).where(User.id == chain_master_id)
        chain_master: Optional[User] = (await db.execute(user_stmt)).scalar_one_or_none()
    except Exception as exc:
        logger.error("查询链主失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail="数据库服务暂时不可用")

    if chain_master is None:
        raise HTTPException(status_code=404, detail="邀请码对应账号不存在")

    # 获取链主工作空间
    try:
        ws_stmt = (
            select(Workspace)
            .join(UserWorkspaceLink, UserWorkspaceLink.workspace_id == Workspace.id)
            .where(UserWorkspaceLink.user_id == chain_master_id)
            .order_by(UserWorkspaceLink.created_at.asc())
            .limit(1)
        )
        workspace: Optional[Workspace] = (await db.execute(ws_stmt)).scalar_one_or_none()
    except Exception as exc:
        logger.error("查询链主工作空间失败: user_id=%s, %s", chain_master_id, exc, exc_info=True)
        raise HTTPException(status_code=503, detail="数据库服务暂时不可用")

    # ── 3. 碳强度与评级核算 ────────────────────────────────────────
    completeness     = _calc_completeness(form)
    carbon_intensity = _calc_supplier_ci(
        electricity_mwh=form.annual_electricity_mwh,
        output_tons=form.annual_output_tons,
        self_ci=form.self_reported_ci,
    )
    grade = _grade(completeness, carbon_intensity, form.industry_type)

    # ── 4. 幂等查重（同一链主 + 同一企业名）──────────────────────
    try:
        exist_stmt = select(SupplierData).where(
            SupplierData.chain_master_id == chain_master_id,
            SupplierData.company_name   == form.company_name,
        )
        existing: Optional[SupplierData] = (await db.execute(exist_stmt)).scalar_one_or_none()
    except Exception as exc:
        logger.error("供应商查重失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail="数据库服务暂时不可用")

    prev_grade       = existing.grade if existing else None
    is_first_submit  = existing is None
    gm_awarded       = 0

    try:
        if is_first_submit:
            # ── 首次填报：INSERT ──────────────────────────────────
            supplier = SupplierData(
                chain_master_id=chain_master_id,
                company_name=form.company_name,
                contact_phone=form.contact_phone,
                province=form.province,
                industry_type=form.industry_type,
                annual_electricity_mwh=form.annual_electricity_mwh,
                annual_output_tons=form.annual_output_tons,
                production_days=form.production_days,
                main_material=form.main_material,
                main_material_tons=form.main_material_tons,
                self_reported_ci=form.self_reported_ci,
                carbon_intensity=carbon_intensity,
                data_completeness=completeness,
                grade=grade.value,
                gm_awarded=GM_REWARD_FIRST_SUBMIT,
            )
            db.add(supplier)
            await db.flush()  # 获取 supplier.id

            gm_awarded = GM_REWARD_FIRST_SUBMIT
            db.add(GMLedger(
                user_id=chain_master_id,
                amount=gm_awarded,
                reason=f"推动供应商「{form.company_name}」完成首次碳数据填报，+{gm_awarded} GM",
            ))

        else:
            # ── 重复提交：UPDATE ──────────────────────────────────
            existing.annual_electricity_mwh = form.annual_electricity_mwh
            existing.annual_output_tons     = form.annual_output_tons
            existing.production_days        = form.production_days
            existing.main_material          = form.main_material
            existing.main_material_tons     = form.main_material_tons
            existing.self_reported_ci       = form.self_reported_ci
            existing.carbon_intensity       = carbon_intensity
            existing.data_completeness      = completeness
            existing.grade                  = grade.value
            existing.updated_at             = datetime.now(tz=timezone.utc)

            # 评级升至 A 增量奖励（仅奖励一次）
            if prev_grade != SupplierGrade.A.value and grade == SupplierGrade.A:
                gm_awarded = GM_REWARD_GRADE_UPGRADE
                db.add(GMLedger(
                    user_id=chain_master_id,
                    amount=gm_awarded,
                    reason=f"供应商「{form.company_name}」评级升至 A，+{gm_awarded} GM",
                ))
                existing.gm_awarded = (existing.gm_awarded or 0) + gm_awarded

        # ── 5. 同步更新链主 gm_balance 快照 ────────────────────
        if gm_awarded > 0:
            chain_master.gm_balance = (chain_master.gm_balance or 0) + gm_awarded

        await db.flush()  # 先 flush，确保 supplier_data 落盘后再重算

        # ── 6. 触发 Scope3 穿透率重算 ─────────────────────────
        scope3_rate_new = 0.0
        if workspace is not None:
            scope3_rate_new = await _recalc_and_persist_scope3(workspace.id, db)

        # ── 7. 提交整个事务 ─────────────────────────────────────
        await db.commit()

        logger.info(
            "供应商填报完成: chain_master_id=%s, company=%s, grade=%s, "
            "gm_awarded=%s, scope3_rate=%.2f%%",
            chain_master_id, form.company_name, grade.value,
            gm_awarded, scope3_rate_new,
        )

    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.error(
            "供应商填报事务失败: chain_master_id=%s, error=%s",
            chain_master_id, exc, exc_info=True,
        )
        raise HTTPException(status_code=500, detail="数据写入失败，请重试")

    return SupplierSubmitResponse(
        success=True,
        supplier_grade=grade,
        carbon_intensity=round(carbon_intensity, 4),
        completeness_pct=round(completeness * 100, 1),
        scope3_rate_updated=scope3_rate_new,
        chain_master_gm_awarded=gm_awarded,
        message=(
            f"填报成功！企业评级【{grade.value} 级】，"
            f"数据完整度 {round(completeness * 100, 1)}%。"
            + (f"链主获得 +{gm_awarded} GM。" if gm_awarded > 0 else "")
        ),
    )


# ─────────────────────────────────────────────────────────────────────
# § 7  手动触发 Scope3 重算（内部管理接口）
# ─────────────────────────────────────────────────────────────────────

class Scope3RecalcResponse(BaseModel):
    workspace_id:    int
    scope3_rate:     float
    recalculated_at: datetime


@router.post(
    "/recalc-scope3",
    response_model=Scope3RecalcResponse,
    status_code=status.HTTP_200_OK,
    summary="手动触发 Scope3 穿透率重算（需鉴权）",
    description="供管理员或定时任务调用，强制重算并写回最新 CBAMReport。",
)
async def recalc_scope3(
    current_user: User        = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
) -> Scope3RecalcResponse:
    try:
        ws_stmt = (
            select(Workspace)
            .join(UserWorkspaceLink, UserWorkspaceLink.workspace_id == Workspace.id)
            .where(UserWorkspaceLink.user_id == current_user.id)
            .limit(1)
        )
        workspace = (await db.execute(ws_stmt)).scalar_one_or_none()
        if workspace is None:
            raise HTTPException(status_code=404, detail="未找到工作空间")

        scope3_rate = await _recalc_and_persist_scope3(workspace.id, db)
        await db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.error("手动 Scope3 重算失败: user_id=%s, %s", current_user.id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="重算失败，请重试")

    return Scope3RecalcResponse(
        workspace_id=workspace.id,
        scope3_rate=scope3_rate,
        recalculated_at=datetime.now(tz=timezone.utc),
    )


# ─────────────────────────────────────────────────────────────────────
# § 8  我的供应商列表
# ─────────────────────────────────────────────────────────────────────

@router.get(
    "/my-suppliers",
    response_model=MySupplierListResponse,
    summary="查看我邀请的供应商列表（需鉴权）",
)
async def my_suppliers(
    current_user: User        = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
) -> MySupplierListResponse:
    try:
        stmt    = select(SupplierData).where(
            SupplierData.chain_master_id == current_user.id
        ).order_by(SupplierData.created_at.desc())
        records = (await db.execute(stmt)).scalars().all()

        # 读取最新报告的 scope3_rate
        ws_stmt = (
            select(Workspace)
            .join(UserWorkspaceLink, UserWorkspaceLink.workspace_id == Workspace.id)
            .where(UserWorkspaceLink.user_id == current_user.id)
            .limit(1)
        )
        workspace = (await db.execute(ws_stmt)).scalar_one_or_none()
        scope3_rate = 0.0
        if workspace:
            latest_rpt_stmt = (
                select(CBAMReport.scope3_rate)
                .where(CBAMReport.workspace_id == workspace.id)
                .order_by(CBAMReport.created_at.desc())
                .limit(1)
            )
            scope3_rate = float(
                (await db.execute(latest_rpt_stmt)).scalar_one_or_none() or 0.0
            )
    except Exception as exc:
        logger.error("查询供应商列表失败: user_id=%s, %s", current_user.id, exc, exc_info=True)
        raise HTTPException(status_code=503, detail="数据库服务暂时不可用")

    suppliers = [
        SupplierSummary(
            id=r.id,
            company_name=r.company_name,
            industry_type=r.industry_type,
            province=r.province,
            grade=SupplierGrade(r.grade),
            carbon_intensity=r.carbon_intensity,
            gm_awarded=r.gm_awarded or 0,
            submitted_at=r.created_at,
        )
        for r in records
    ]

    return MySupplierListResponse(
        total_count=len(suppliers),
        grade_a_count=sum(1 for s in suppliers if s.grade == SupplierGrade.A),
        grade_b_count=sum(1 for s in suppliers if s.grade == SupplierGrade.B),
        grade_c_count=sum(1 for s in suppliers if s.grade == SupplierGrade.C),
        total_gm_earned=sum(s.gm_awarded for s in suppliers),
        scope3_rate=scope3_rate,
        suppliers=suppliers,
    )


# ─────────────────────────────────────────────────────────────────────
# § 9  GM 流水明细（分页）
# ─────────────────────────────────────────────────────────────────────

@router.get(
    "/gm-ledger",
    response_model=GMLedgerListResponse,
    summary="GM 积分流水明细（需鉴权，分页）",
)
async def gm_ledger(
    current_user: User        = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
    page:         int         = Query(default=1,  ge=1),
    page_size:    int         = Query(default=20, ge=1, le=100),
) -> GMLedgerListResponse:
    offset = (page - 1) * page_size
    try:
        total = int(
            (await db.execute(
                select(func.count()).select_from(GMLedger)
                .where(GMLedger.user_id == current_user.id)
            )).scalar_one()
        )
        gm_sum = int(
            (await db.execute(
                select(func.coalesce(func.sum(GMLedger.amount), 0))
                .where(GMLedger.user_id == current_user.id)
            )).scalar_one()
        )
        rows = (
            await db.execute(
                select(GMLedger)
                .where(GMLedger.user_id == current_user.id)
                .order_by(GMLedger.created_at.desc())
                .offset(offset).limit(page_size)
            )
        ).scalars().all()
    except Exception as exc:
        logger.error("查询 GM 流水失败: user_id=%s, %s", current_user.id, exc, exc_info=True)
        raise HTTPException(status_code=503, detail="数据库服务暂时不可用")

    return GMLedgerListResponse(
        total_gm_balance=gm_sum,
        records=[
            GMledgerItem(id=r.id, amount=r.amount, reason=r.reason, created_at=r.created_at)
            for r in rows
        ],
        page=page,
        page_size=page_size,
        total_count=total,
    )
