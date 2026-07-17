"""
此脚本在容器内执行，一次性写入正确的 database.py 和 auth.py
执行方式：
  docker cp fix_inside_container.py hengai_backend:/app/fix_inside_container.py
  docker exec hengai_backend python /app/fix_inside_container.py
"""

# ─────────────────────────────────────────────────────────────────────
# 写入 database.py
# ─────────────────────────────────────────────────────────────────────
database_content = """\
import os
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://hengai:hengai_pass@db:5432/hengai_db",
)

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

# Base 统一使用 models.py 中定义的 Base，此处不重复定义
from models import Base  # noqa: F401,E402


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
"""

with open("/app/database.py", "w", encoding="utf-8") as f:
    f.write(database_content)
print("✅ database.py 写入完成")


# ─────────────────────────────────────────────────────────────────────
# 写入 auth.py
# ─────────────────────────────────────────────────────────────────────
auth_content = """\
\"\"\"
HengAI Auth Router — 校准版
严格对齐 models.py 字段：
  User.hashed_password  String (bcrypt)
  User.email            String(320) 主登录凭证
  User.account_tier     AccountTierEnum
  GMLedger.tx_type      GMLedgerTypeEnum
  GMLedger.reason_code  String(64) 必填
  GMLedger.balance_after Integer 必填
\"\"\"
from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
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
    AccountTierEnum,
    GMLedger,
    GMLedgerTypeEnum,
    User,
    UserWorkspaceLink,
    Workspace,
    WorkspaceRoleEnum,
    WorkspaceStageEnum,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Auth"])

_REGISTER_GM_GIFT = 50
_DUMMY_HASH = "$2b$12$dummyhashfortimingattackprevention00000000000000000000"
_PLACEHOLDER_CREDIT_CODE = "000000000000000000"


def _mask_phone(phone: Optional[str]) -> Optional[str]:
    if not phone or len(phone) < 7:
        return phone
    return f"{phone[:3]}****{phone[7:]}"


def _mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    if len(local) <= 1:
        return email
    return f"{local[0]}{'*' * min(len(local) - 1, 4)}@{domain}"


class RegisterRequest(BaseModel):
    email: EmailStr = Field(..., description="邮箱（登录主凭证）")
    password: str = Field(..., min_length=8, max_length=64)
    phone: Optional[str] = Field(default=None, pattern=r"^1[3-9]\\d{9}$")
    company_name: str = Field(..., min_length=2, max_length=200)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if not any(c.isdigit() for c in v):
            raise ValueError("密码必须包含至少一个数字")
        if not any(c.isalpha() for c in v):
            raise ValueError("密码必须包含至少一个字母")
        return v


class LoginRequest(BaseModel):
    email: Optional[EmailStr] = Field(default=None)
    phone: Optional[str] = Field(default=None, pattern=r"^1[3-9]\\d{9}$")
    password: str = Field(..., min_length=1, max_length=64)

    @model_validator(mode="after")
    def at_least_one(self) -> "LoginRequest":
        if not self.email and not self.phone:
            raise ValueError("请提供 email 或 phone 其中一项")
        return self


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    email_masked: str
    phone_masked: Optional[str] = None
    account_tier: str
    gm_balance: int


class MeResponse(BaseModel):
    user_id: str
    email_masked: str
    phone_masked: Optional[str] = None
    account_tier: str
    current_level: str
    gm_balance: int
    tokens_left: int
    is_active: bool


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)):
    try:
        dup = await db.execute(select(User.id).where(User.email == str(payload.email)))
        if dup.scalar_one_or_none() is not None:
            raise HTTPException(status_code=409, detail="该邮箱已注册，请直接登录")
        if payload.phone:
            dup2 = await db.execute(select(User.id).where(User.phone == payload.phone))
            if dup2.scalar_one_or_none() is not None:
                raise HTTPException(status_code=409, detail="该手机号已被其他账号绑定")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("注册查重异常: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail="数据库服务暂时不可用")

    pwd_hash = hash_password(payload.password)

    try:
        new_user = User(
            id=uuid.uuid4(),
            email=str(payload.email),
            phone=payload.phone,
            hashed_password=pwd_hash,
            account_tier=AccountTierEnum.FREE_USER,
            gm_balance=_REGISTER_GM_GIFT,
            tokens_left=100,
            is_active=True,
        )
        db.add(new_user)
        await db.flush()

        db.add(GMLedger(
            id=uuid.uuid4(),
            user_id=new_user.id,
            amount=_REGISTER_GM_GIFT,
            balance_after=_REGISTER_GM_GIFT,
            tx_type=GMLedgerTypeEnum.EARN,
            reason=f"新用户注册赠礼，+{_REGISTER_GM_GIFT} GM",
            reason_code="REGISTER_GIFT",
        ))

        new_workspace = Workspace(
            id=uuid.uuid4(),
            company_name=payload.company_name,
            credit_code=_PLACEHOLDER_CREDIT_CODE,
            stage=WorkspaceStageEnum.SANDBOX,
            is_complete=False,
        )
        db.add(new_workspace)
        await db.flush()

        db.add(UserWorkspaceLink(
            user_id=new_user.id,
            workspace_id=new_workspace.id,
            role=WorkspaceRoleEnum.OWNER,
        ))

        await db.commit()
        await db.refresh(new_user)
        logger.info("注册成功: user_id=%s", new_user.id)

    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.error("注册事务失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="注册失败，请稍后重试")

    token = create_access_token(
        subject=str(new_user.id),
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return TokenResponse(
        access_token=token,
        user_id=str(new_user.id),
        email_masked=_mask_email(str(payload.email)),
        phone_masked=_mask_phone(payload.phone),
        account_tier=new_user.account_tier.value,
        gm_balance=new_user.gm_balance,
    )


@router.post("/login", response_model=TokenResponse, status_code=200)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    try:
        if payload.email:
            stmt = select(
                User.id, User.email, User.phone,
                User.hashed_password, User.is_active,
                User.account_tier, User.gm_balance,
            ).where(User.email == str(payload.email))
        else:
            stmt = select(
                User.id, User.email, User.phone,
                User.hashed_password, User.is_active,
                User.account_tier, User.gm_balance,
            ).where(User.phone == payload.phone)
        result = await db.execute(stmt)
        row = result.one_or_none()
    except Exception as exc:
        logger.error("登录查库异常: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail="数据库服务暂时不可用")

    _invalid = HTTPException(
        status_code=401,
        detail="邮箱/手机号或密码错误",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if row is None:
        verify_password("__dummy__", _DUMMY_HASH)
        raise _invalid
    if not verify_password(payload.password, row.hashed_password):
        raise _invalid
    if not row.is_active:
        raise HTTPException(status_code=403, detail="账号已被停用")

    token = create_access_token(
        subject=str(row.id),
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    logger.info("登录成功: user_id=%s", row.id)
    return TokenResponse(
        access_token=token,
        user_id=str(row.id),
        email_masked=_mask_email(row.email or ""),
        phone_masked=_mask_phone(row.phone),
        account_tier=row.account_tier.value if row.account_tier else "FREE_USER",
        gm_balance=row.gm_balance or 0,
    )


@router.get("/me", response_model=MeResponse)
async def me(current_user: User = Depends(get_current_user)):
    return MeResponse(
        user_id=str(current_user.id),
        email_masked=_mask_email(current_user.email),
        phone_masked=_mask_phone(current_user.phone),
        account_tier=current_user.account_tier.value,
        current_level=current_user.current_level.value,
        gm_balance=current_user.gm_balance,
        tokens_left=current_user.tokens_left,
        is_active=current_user.is_active,
    )
"""

with open("/app/auth.py", "w", encoding="utf-8") as f:
    f.write(auth_content)
print("✅ auth.py 写入完成")

# ─────────────────────────────────────────────────────────────────────
# 验证
# ─────────────────────────────────────────────────────────────────────
import importlib, sys

# 重新加载 database 模块
if "database" in sys.modules:
    del sys.modules["database"]

from database import Base as dbBase
from models import Base as mBase

print(f"\n验证结果：")
print(f"  database.Base is models.Base : {dbBase is mBase}")
print(f"  注册到 metadata 的表数量     : {len(dbBase.metadata.tables)}")
print(f"  users 表存在                 : {'users' in dbBase.metadata.tables}")
print(f"  gm_ledger 表存在             : {'gm_ledger' in dbBase.metadata.tables}")
print("\n🎉 所有修复完成！现在执行: docker restart hengai_backend")
