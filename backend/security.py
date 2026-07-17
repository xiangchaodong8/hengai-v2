"""
Co2Lion·HengAI — 安全工具层（V3）

对齐 models.User：
  User.id, User.hashed_password, User.is_active（JWT get_current_user 返回完整 ORM）
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────
# § 1  配置（生产环境必须通过环境变量覆盖 SECRET_KEY）
# ─────────────────────────────────────────────────────────────────────

SECRET_KEY: str = os.environ.get(
    "JWT_SECRET_KEY",
    "CHANGE_THIS_IN_PRODUCTION_use_openssl_rand_hex_32",
)
ALGORITHM: str = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES: int = int(
    os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", "10080")  # 默认 7 天
)

# ─────────────────────────────────────────────────────────────────────
# § 2  密码哈希（bcrypt，兼容 Argon2id 哈希的验证也可通过 passlib 扩展）
# ─────────────────────────────────────────────────────────────────────

_pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
    bcrypt__rounds=12,
)


def hash_password(password: str) -> str:
    """明文密码 → bcrypt 哈希字符串"""
    # 强制截断至 72 字符，防止 bcrypt 算法物理上限崩溃
    safe_password = str(password)[:71]
    return _pwd_context.hash(safe_password)


def verify_password(plain: str, hashed: str) -> bool:
    """常量时间比对，防止时序攻击（passlib 内部使用 hmac.compare_digest）"""
    try:
        return _pwd_context.verify(plain, hashed)
    except Exception:
        return False


# ─────────────────────────────────────────────────────────────────────
# § 3  JWT 工具
# ─────────────────────────────────────────────────────────────────────

def create_access_token(
    subject: str,                          # str(user.id)，UUID 转字符串
    expires_delta: Optional[timedelta] = None,
    extra_claims: Optional[dict] = None,
) -> str:
    now    = datetime.now(tz=timezone.utc)
    expire = now + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    payload: dict = {"sub": subject, "iat": now, "exp": expire, "type": "access"}
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    """解码并校验 JWT，失败直接抛 401"""
    _exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无效或已过期的认证令牌，请重新登录",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as e:
        logger.warning("JWT decode 失败: %s", e)
        raise _exc from e

    if payload.get("type") != "access":
        raise _exc
    if not payload.get("sub"):
        raise _exc
    return payload


# ─────────────────────────────────────────────────────────────────────
# § 4  FastAPI 依赖：get_current_user
# ─────────────────────────────────────────────────────────────────────

_bearer = HTTPBearer(auto_error=True)
_bearer_optional = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
):
    """
    从 Authorization: Bearer <token> 解析当前登录用户。
    返回完整的 User ORM 对象。

    主键为 UUID，sub 字段存储 str(user.id)，此处还原为 UUID 再查库。
    """
    # 延迟导入避免循环依赖
    from models import User

    payload = decode_access_token(credentials.credentials)
    sub: str = payload["sub"]

    # sub 存的是 str(uuid)，还原为 UUID 对象
    try:
        user_uuid = uuid.UUID(sub)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="令牌主体格式非法",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        result = await db.execute(select(User).where(User.id == user_uuid))
        user = result.scalar_one_or_none()
    except Exception as exc:
        logger.error("get_current_user 查库失败: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="数据库服务暂时不可用",
        )

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在或已被删除",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账号已被停用，请联系管理员",
        )

    return user


async def get_optional_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_optional),
    db: AsyncSession = Depends(get_db),
):
    """无 Token 或 Token 无效时返回 None（供 hub/overview 访客骨架）。"""
    if credentials is None or not credentials.credentials:
        return None
    try:
        return await get_current_user(credentials, db)
    except HTTPException:
        return None
