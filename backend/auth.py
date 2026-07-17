"""
Co2Lion·HengAI — Auth 认证路由（V3.0 对齐 models.User）

User / Workspace / GMLedger / UserWorkspace 以 models.py 为唯一真源。
JWT 依赖 get_current_user 来自 core.security → security.py，返回完整 User ORM。
"""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from database import get_db
from models import (
    GMLedger,
    LedgerAction,
    User,
    UserWorkspace,
    Workspace,
    WorkspaceStage,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["认证"])

_REGISTER_GM_GIFT: Decimal = Decimal("50")
_DUMMY_HASH = "$2b$12$dummyhashfortimingattackprevention00000000000000000000"


def _mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    if len(local) <= 1:
        return email
    return f"{local[0]}{'*' * min(len(local) - 1, 4)}@{domain}"


class RegisterRequest(BaseModel):
    email: EmailStr = Field(..., description="邮箱（登录主凭证）")
    password: str = Field(..., min_length=8, max_length=64)
    company_name: str = Field(..., min_length=2, max_length=256, description="企业名称 → workspaces.name")

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if not any(c.isdigit() for c in v):
            raise ValueError("密码必须包含至少一个数字")
        if not any(c.isalpha() for c in v):
            raise ValueError("密码必须包含至少一个字母")
        return v


class LoginRequest(BaseModel):
    email: EmailStr = Field(..., description="邮箱登录")
    password: str = Field(..., min_length=1, max_length=64)


class ResetPasswordRequest(BaseModel):
    account: str = Field(..., min_length=1, max_length=320, description="邮箱主账号")
    backup_email: EmailStr = Field(..., description="注册时预留备用邮箱")
    new_password: str = Field(..., min_length=8, max_length=64)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str = Field(..., description="UUID 字符串")
    email_masked: str
    tier_code: str = Field(..., description="由 current_level 映射，如 LV1")
    gm_balance: str = Field(..., description="实时余额字符串（Decimal 序列化）")


def _tier_code_from_user(user: User) -> str:
    return f"LV{user.current_level}"


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="新用户注册",
)
async def register(
    payload: RegisterRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    try:
        dup_email = await db.execute(select(User.id).where(User.email == str(payload.email)))
        if dup_email.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="该邮箱已注册，请直接登录",
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("注册查重异常: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail="数据库服务暂时不可用")

    try:
        # 使用前端提交的原始密码字符串，不做二次改写；72 字节保护在 security.hash_password 内处理
        raw_password = str(payload.password)
        pwd_hash = hash_password(raw_password)
    except Exception as exc:
        logger.error("密码哈希失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="密码处理失败")

    try:
        new_user = User(
            id=uuid.uuid4(),
            email=str(payload.email),
            hashed_password=pwd_hash,
            gm_balance_cache=_REGISTER_GM_GIFT,
            current_level=1,
            tokens_left=10000,
            is_active=True,
        )
        db.add(new_user)
        await db.flush()

        db.add(
            GMLedger(
                id=uuid.uuid4(),
                user_id=new_user.id,
                action=LedgerAction.earn,
                amount=_REGISTER_GM_GIFT,
                balance_snap=_REGISTER_GM_GIFT,
                source_ref="REGISTER_GIFT",
                memo=f"新用户注册赠礼，+{_REGISTER_GM_GIFT} GM",
            )
        )

        new_workspace = Workspace(
            id=uuid.uuid4(),
            name=payload.company_name,
            credit_code=f"TEMP-{uuid.uuid4().hex[:10]}",
            stage=WorkspaceStage.incomplete,
            is_complete=False,
        )
        db.add(new_workspace)
        await db.flush()

        db.add(
            UserWorkspace(
                user_id=new_user.id,
                workspace_id=new_workspace.id,
                role="owner",
            )
        )

        await db.commit()
        await db.refresh(new_user)

        logger.info(
            "注册成功: user_id=%s | email=%s | workspace_id=%s",
            new_user.id,
            _mask_email(str(payload.email)),
            new_workspace.id,
        )

    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.error("注册事务失败: email=%s | %s", payload.email, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="注册失败，请稍后重试")

    token = create_access_token(
        subject=str(new_user.id),
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )

    return TokenResponse(
        access_token=token,
        user_id=str(new_user.id),
        email_masked=_mask_email(str(payload.email)),
        tier_code=_tier_code_from_user(new_user),
        gm_balance=str(_REGISTER_GM_GIFT),
    )


@router.post(
    "/login",
    response_model=TokenResponse,
    status_code=status.HTTP_200_OK,
    summary="用户登录（邮箱）",
)
async def login(
    payload: LoginRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    try:
        stmt = select(
            User.id,
            User.email,
            User.hashed_password,
            User.is_active,
            User.current_level,
            User.gm_balance_cache,
        ).where(User.email == str(payload.email))
        result = await db.execute(stmt)
        row = result.one_or_none()
    except Exception as exc:
        logger.error("登录查库异常: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail="数据库服务暂时不可用")

    _invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="邮箱或密码错误",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if row is None:
        verify_password("__dummy__", _DUMMY_HASH)
        raise _invalid

    if not verify_password(payload.password, row.hashed_password):
        raise _invalid

    if not row.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账号已被停用，请联系管理员",
        )

    token = create_access_token(
        subject=str(row.id),
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )

    gm_disp = row.gm_balance_cache if row.gm_balance_cache is not None else Decimal("0")

    logger.info("登录成功: user_id=%s | email=%s", row.id, _mask_email(row.email or ""))

    return TokenResponse(
        access_token=token,
        user_id=str(row.id),
        email_masked=_mask_email(row.email or ""),
        tier_code=f"LV{row.current_level}",
        gm_balance=str(gm_disp),
    )


@router.post(
    "/reset_password",
    status_code=status.HTTP_200_OK,
    summary="通过备用邮箱重置密码",
)
async def reset_password(
    payload: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    account = str(payload.account).strip().lower()
    backup = str(payload.backup_email).strip().lower()

    stmt = select(User).where(User.email == account)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="账号不存在")

    user_backup = (user.backup_email or "").strip().lower()
    if not user_backup or user_backup != backup:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="备用邮箱校验失败")

    user.hashed_password = hash_password(payload.new_password)
    await db.commit()
    return {"message": "密码重置成功，请使用新密码登录"}


@router.get("/me")
async def read_users_me(current_user: User = Depends(get_current_user)):
    return {
        "email": current_user.email,
        "tier_code": _tier_code_from_user(current_user),
        "current_level": current_user.current_level,
    }
