from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import User, UserWorkspaceLink, Workspace
from routers.auth import get_current_user
from schemas import HubOverviewResponse

router = APIRouter(tags=["hub"])


def _compute_phase(workspace: Workspace | None) -> int:
    if workspace is None:
        return 1
    if not workspace.is_complete:
        return 1
    stage = str(workspace.stage).upper()
    if stage == "CERTIFIED":
        return 3
    return 2


def _stage_name(stage: str) -> str:
    stage_value = str(stage).upper()
    if stage_value == "CERTIFIED":
        return "企业共治期"
    return "游客破冰期" if stage_value == "SANDBOX" else "状态未知"


def _next_level(current_level: str) -> str:
    try:
        current_num = int(current_level.replace("Lv.", ""))
    except ValueError:
        current_num = 1
    return f"Lv.{min(current_num + 1, 5)}"


@router.get("/api/v1/hub/overview", response_model=HubOverviewResponse)
async def get_hub_overview(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> HubOverviewResponse:
    try:
        ws_result = await db.execute(
            select(Workspace)
            .join(UserWorkspaceLink, UserWorkspaceLink.workspace_id == Workspace.id)
            .where(UserWorkspaceLink.user_id == current_user.id)
            .order_by(UserWorkspaceLink.workspace_id.asc())
            .limit(1)
        )
        workspace = ws_result.scalar_one_or_none()
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"读取全域中心数据失败: {exc}",
        )

    if workspace is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户尚未绑定企业空间",
        )

    current_phase = _compute_phase(workspace)
    level_progress = min(max(current_user.gm_balance / 1000, 0.0), 1.0)

    return HubOverviewResponse(
        currentPhase=current_phase,
        user={
            "name": current_user.real_name,
            "phone": current_user.phone,
            "tier": current_user.account_tier,
            "gmBalance": current_user.gm_balance,
            "currentLevel": current_user.current_level,
            "nextLevel": _next_level(current_user.current_level),
            "levelProgress": round(level_progress, 2),
        },
        company={
            "name": workspace.company_name,
            "industry": workspace.industry,
            "creditCode": workspace.credit_code,
            "isComplete": workspace.is_complete,
            "stage": workspace.stage,
            "stageName": _stage_name(workspace.stage),
            "cbam_risk": workspace.cbam_risk_exposure,
            "scope3_rate": workspace.scope3_coverage,
        },
        macro={
            "policySignal": "CBAM 申报窗口持续收紧",
            "nationalCarbonPrice": 86.5,
            "activeSuppliers": 0,
            "complianceScore": round(60 + current_phase * 10 + level_progress * 20, 1),
        },
    )
