# action_executor.py — HengAI V3.1 动作指令执行器
# 将 IntentRecognizer 生成的 ActionInstruction 落地为精确的数据库操作
# 每次执行后写入 ActionLog 和 GMLedger，保证全链路可追溯

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

# V3.1 心脏移植：统一绝对导入。
from intent_engine import ActionInstruction, ActionType
from models import (
    CBAMReport,
    CBAMStatus,
    GMLedger,
    LedgerAction,
    SupplierNode,
    User,
    Workspace,
    WorkspaceStage,
)


# ---------------------------------------------------------------------------
# 执行结果数据结构
# ---------------------------------------------------------------------------

@dataclass
class ActionResult:
    """单个动作的执行结果，汇总后注入 AI 回复的 System Role。"""
    action_type   : ActionType
    success       : bool
    changes       : Dict[str, Any]    = field(default_factory=dict)
    gm_awarded    : Decimal           = Decimal("0")
    error_message : Optional[str]     = None

    def to_context_string(self) -> str:
        """转为可直接注入 System Role 的人类可读字符串。"""
        if not self.success:
            return f"[执行失败] {self.action_type.value}: {self.error_message}"
        parts = [f"[已写入] {self.action_type.value}"]
        for k, v in self.changes.items():
            parts.append(f"  · {k}: {v}")
        if self.gm_awarded > 0:
            parts.append(f"  · GM奖励: +{self.gm_awarded}")
        return "\n".join(parts)


@dataclass
class ExecutionSummary:
    """一轮对话中所有动作的执行汇总，注入 AI System Role。"""
    results         : List[ActionResult] = field(default_factory=list)
    total_gm_awarded: Decimal            = Decimal("0")
    phase_changed   : Optional[str]      = None   # 如发生阶段升级，记录新 Phase

    def to_system_context(self) -> str:
        """输出可直接拼入 System Role 的字符串块。"""
        if not self.results:
            return ""
        lines = ["=== 本轮对话已触发以下数据写入 ==="]
        for r in self.results:
            lines.append(r.to_context_string())
        if self.total_gm_awarded > 0:
            lines.append(f"\n✅ 本轮共奖励用户 GM: +{self.total_gm_awarded}")
        if self.phase_changed:
            lines.append(f"\n🚀 阶段升级触发: 用户已进入 {self.phase_changed}")
        lines.append("=== 以上数据已实时写入数据库，请基于最新数据回复 ===")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# 核心执行器
# ---------------------------------------------------------------------------

class ActionExecutor:
    """
    消费 ActionInstruction 列表，异步逐条写入数据库。
    置信度 < 0.6 的动作只记录日志，不执行写操作。
    """

    CONFIDENCE_THRESHOLD = 0.6

    def __init__(self, db: AsyncSession, current_user: User):
        self.db   = db
        self.user = current_user

    async def execute_all(
        self, instructions: List[ActionInstruction]
    ) -> ExecutionSummary:
        """批量执行，返回汇总结果。"""
        summary = ExecutionSummary()
        ws0 = await self._get_workspace()
        phase_before = self._resolve_workspace_phase(ws0)

        for inst in instructions:
            if inst.confidence < self.CONFIDENCE_THRESHOLD:
                # 低置信度：仅记录，不写库
                summary.results.append(ActionResult(
                    action_type=inst.action_type,
                    success=False,
                    error_message=f"置信度不足 ({inst.confidence:.0%})，跳过执行",
                ))
                continue

            result = await self._dispatch(inst)
            summary.results.append(result)

            if result.success and result.gm_awarded > 0:
                summary.total_gm_awarded += result.gm_awarded

        # 仅在本轮动作真正触发阶段跃迁时通知（禁止每轮对话重复广播当前 Phase）
        phase_change = await self._check_phase_upgrade(phase_before)
        if phase_change:
            summary.phase_changed = phase_change

        await self.db.commit()
        return summary

    async def _dispatch(self, inst: ActionInstruction) -> ActionResult:
        """按 action_type 路由到具体执行方法。"""
        handler_map = {
            ActionType.UPDATE_WORKSPACE_INFO   : self._exec_update_workspace_info,
            ActionType.UPDATE_ENERGY_DATA      : self._exec_update_energy_data,
            ActionType.UPDATE_SUPPLIER_COUNT   : self._exec_update_supplier_count,
            ActionType.CREATE_CBAM_DRAFT       : self._exec_create_cbam_draft,
            ActionType.RECORD_CARBON_FOOTPRINT : self._exec_record_carbon_footprint,
            ActionType.UPDATE_SCOPE3_COVERAGE  : self._exec_update_scope3_coverage,
            ActionType.AWARD_GM                : self._exec_award_gm,
        }
        handler = handler_map.get(inst.action_type)
        if handler is None:
            return ActionResult(
                action_type=inst.action_type, success=False,
                error_message="未知动作类型"
            )
        try:
            return await handler(inst)
        except Exception as exc:
            return ActionResult(
                action_type=inst.action_type, success=False,
                error_message=str(exc)
            )

    # ── 具体执行方法 ──────────────────────────────────────────────────────

    async def _get_workspace(self) -> Optional[Workspace]:
        """获取当前用户的主工作空间。"""
        result = await self.db.execute(
            select(Workspace)
            .join(Workspace.members)
            .where(User.id == self.user.id)
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _exec_update_workspace_info(self, inst: ActionInstruction) -> ActionResult:
        ws = await self._get_workspace()
        if ws is None:
            return ActionResult(
                action_type=inst.action_type, success=False,
                error_message="当前用户尚无关联企业空间，无法写入企业信息"
            )

        changes: Dict[str, Any] = {}
        allowed_fields = {"name", "credit_code", "industry_code", "country_code", "contact_email"}

        for key, val in inst.payload.items():
            if key in allowed_fields and val is not None:
                setattr(ws, key, val)
                changes[key] = val

        # 检查是否达到 is_complete 条件（名称 + 信用代码 + 行业至少填齐）
        if ws.name and ws.credit_code and ws.industry_code and not ws.is_complete:
            ws.is_complete = True
            if ws.stage == WorkspaceStage.incomplete:
                ws.stage = WorkspaceStage.sandbox
            changes["is_complete"] = True
            changes["stage"] = "Sandbox"

        self.db.add(ws)

        # GM 奖励
        gm = await self._award_gm(inst.gm_reward, f"update_workspace/{ws.id}")

        return ActionResult(
            action_type=inst.action_type,
            success=True,
            changes=changes,
            gm_awarded=gm,
        )

    async def _exec_update_energy_data(self, inst: ActionInstruction) -> ActionResult:
        ws = await self._get_workspace()
        if ws is None:
            return ActionResult(
                action_type=inst.action_type, success=False,
                error_message="尚无关联企业空间"
            )

        # 找或创建当期 CBAM 草稿报告
        period = inst.payload.get("period") or f"{datetime.now().year}-FY"
        report = await self._get_or_create_cbam_draft(ws.id, period)

        tco2e_calc = Decimal(str(inst.payload.get("tco2e_calc", 0)))
        old_total  = report.tco2e_total or Decimal("0")
        report.tco2e_total = old_total + tco2e_calc
        self.db.add(report)

        changes = {
            "能源类型"   : inst.payload.get("energy_unit"),
            "用能数值"   : inst.payload.get("energy_value"),
            "本次碳当量" : f"{tco2e_calc} tCO2e",
            "累计碳排放" : f"{report.tco2e_total} tCO2e",
            "统计周期"   : period,
        }
        gm = await self._award_gm(inst.gm_reward, f"energy_data/{report.id}")

        return ActionResult(
            action_type=inst.action_type,
            success=True,
            changes=changes,
            gm_awarded=gm,
        )

    async def _exec_update_supplier_count(self, inst: ActionInstruction) -> ActionResult:
        ws = await self._get_workspace()
        if ws is None:
            return ActionResult(
                action_type=inst.action_type, success=False,
                error_message="尚无关联企业空间"
            )

        declared = inst.payload.get("declared_count", 0)
        current  = inst.payload.get("current_db_count", 0)

        # 将声明数量存入 workspace 扩展字段（如有），或写入最新 CBAM 报告备注
        period = f"{datetime.now().year}-FY"
        report = await self._get_or_create_cbam_draft(ws.id, period)

        # 用 payload_json 字段存储声明元数据
        import json
        meta = {}
        if report.payload_json:
            try:
                meta = json.loads(report.payload_json)
            except Exception:
                meta = {}
        meta["declared_supplier_count"] = declared
        report.payload_json = json.dumps(meta, ensure_ascii=False)
        self.db.add(report)

        gm = await self._award_gm(inst.gm_reward, f"supplier_count/{ws.id}")

        return ActionResult(
            action_type=inst.action_type,
            success=True,
            changes={
                "声明供应商总数" : declared,
                "已录入数量"     : current,
                "当前Scope3缺口" : max(0, declared - current),
            },
            gm_awarded=gm,
        )

    async def _exec_create_cbam_draft(self, inst: ActionInstruction) -> ActionResult:
        ws = await self._get_workspace()
        if ws is None:
            return ActionResult(
                action_type=inst.action_type, success=False,
                error_message="尚无关联企业空间"
            )

        import json
        period = inst.payload.get("reporting_period") or f"{datetime.now().year}-FY"
        goods  = inst.payload.get("goods", {})

        report = await self._get_or_create_cbam_draft(ws.id, period)

        # 计算初步风险敞口（CBAM 碳价约 €50/tCO2e，此为估算）
        cbam_carbon_price_eur = Decimal("50")
        total_tco2e = Decimal("0")
        for name, info in goods.items():
            factor = info.get("factor")
            if factor:
                # 暂无重量数据，仅标记品类
                pass

        meta = {}
        if report.payload_json:
            try:
                meta = json.loads(report.payload_json)
            except Exception:
                pass
        meta["cbam_goods"] = list(goods.keys())
        report.payload_json = json.dumps(meta, ensure_ascii=False)
        self.db.add(report)

        gm = await self._award_gm(inst.gm_reward, f"cbam_draft/{report.id}")

        return ActionResult(
            action_type=inst.action_type,
            success=True,
            changes={
                "CBAM报告ID" : str(report.id),
                "统计周期"   : period,
                "涉及商品"   : list(goods.keys()),
                "报告状态"   : "draft",
            },
            gm_awarded=gm,
        )

    async def _exec_record_carbon_footprint(self, inst: ActionInstruction) -> ActionResult:
        ws = await self._get_workspace()
        if ws is None:
            return ActionResult(
                action_type=inst.action_type, success=False,
                error_message="尚无关联企业空间"
            )

        period = inst.payload.get("period") or f"{datetime.now().year}-FY"
        report = await self._get_or_create_cbam_draft(ws.id, period)

        tco2e = Decimal(str(inst.payload.get("tco2e_total", 0)))
        report.tco2e_total = tco2e
        self.db.add(report)

        gm = await self._award_gm(inst.gm_reward, f"carbon/{report.id}")

        return ActionResult(
            action_type=inst.action_type,
            success=True,
            changes={
                "碳排放总量" : f"{tco2e} tCO2e",
                "Scope范围"  : inst.payload.get("scope", "scope1"),
                "统计周期"   : period,
            },
            gm_awarded=gm,
        )

    async def _exec_update_scope3_coverage(self, inst: ActionInstruction) -> ActionResult:
        ws = await self._get_workspace()
        if ws is None:
            return ActionResult(action_type=inst.action_type, success=False, error_message="无企业空间")

        period = f"{datetime.now().year}-FY"
        report = await self._get_or_create_cbam_draft(ws.id, period)
        coverage = Decimal(str(inst.payload.get("scope3_coverage", 0)))
        report.scope3_coverage = coverage
        self.db.add(report)

        gm = await self._award_gm(inst.gm_reward, f"scope3/{ws.id}")

        return ActionResult(
            action_type=inst.action_type,
            success=True,
            changes={"Scope3覆盖率": f"{coverage:.1%}"},
            gm_awarded=gm,
        )

    async def _exec_award_gm(self, inst: ActionInstruction) -> ActionResult:
        amount = Decimal(str(inst.payload.get("amount", 0)))
        gm = await self._award_gm(amount, inst.payload.get("source_ref", "manual"))
        return ActionResult(
            action_type=inst.action_type,
            success=True,
            changes={"GM奖励": f"+{gm}"},
            gm_awarded=gm,
        )

    # ── 工具方法 ──────────────────────────────────────────────────────────

    async def _get_or_create_cbam_draft(
        self, workspace_id: uuid.UUID, period: str
    ) -> CBAMReport:
        """获取或创建当期草稿报告。"""
        result = await self.db.execute(
            select(CBAMReport).where(
                CBAMReport.workspace_id == workspace_id,
                CBAMReport.reporting_period == period,
                CBAMReport.status == CBAMStatus.draft,
            ).limit(1)
        )
        report = result.scalar_one_or_none()
        if report is None:
            report = CBAMReport(
                workspace_id=workspace_id,
                owner_id=self.user.id,
                reporting_period=period,
                status=CBAMStatus.draft,
            )
            self.db.add(report)
            await self.db.flush()   # 获取 id
        return report

    async def _award_gm(self, amount: Decimal, source_ref: str) -> Decimal:
        """写入 GM 奖励账本。"""
        if amount <= 0:
            return Decimal("0")

        from sqlalchemy import func
        bal_result = await self.db.execute(
            select(func.coalesce(func.sum(GMLedger.amount), Decimal("0")))
            .where(GMLedger.user_id == self.user.id)
        )
        current_balance = bal_result.scalar_one()

        ledger = GMLedger(
            user_id=self.user.id,
            action=LedgerAction.earn,
            amount=amount,
            balance_snap=current_balance + amount,
            source_ref=source_ref,
            memo="对话录入自动奖励",
        )
        self.db.add(ledger)
        return amount

    @staticmethod
    def _resolve_workspace_phase(ws) -> str:
        from hub_engine import resolve_phase
        return resolve_phase(ws)

    @staticmethod
    def _phase_rank(phase: str) -> int:
        p = str(phase or "Phase1")
        if p.startswith("Phase3"):
            return 3
        if p.startswith("Phase2"):
            return 2
        return 1

    @staticmethod
    def _phase_upgrade_label(phase: str) -> Optional[str]:
        if phase == "Phase3":
            return "Phase3 · 全域共治"
        if phase == "Phase2":
            return "Phase2 · 业务映射"
        return None

    async def _check_phase_upgrade(self, phase_before: str) -> Optional[str]:
        """
        检查本轮动作是否触发阶段跃迁。
        仅当 Phase 序号上升时返回展示文案；已是 Phase2 的用户不得每轮对话重复触发。
        """
        ws = await self._get_workspace()
        if ws is None:
            return None

        await self.db.refresh(ws)
        phase_after = self._resolve_workspace_phase(ws)
        if self._phase_rank(phase_after) <= self._phase_rank(phase_before):
            return None
        return self._phase_upgrade_label(phase_after)
