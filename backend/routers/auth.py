from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from auth_utils import create_access_token, decode_access_token, hash_password, verify_password
from database import get_db
from models import User
from schemas import Token, UserCreate, UserLogin, UserResponse

router = APIRouter(tags=["auth"])
security = HTTPBearer(auto_error=False)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise _unauthorized("未提供有效的 Bearer Token")
    try:
        payload = decode_access_token(credentials.credentials)
        sub = payload.get("sub")
        if sub is None:
            raise _unauthorized("Token 无效或已过期")
        user_id = int(sub)
    except JWTError:
        raise _unauthorized("Token 无效或已过期")
    except ValueError:
        raise _unauthorized("Token 无效或已过期")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise _unauthorized("Token 无效或已过期")
    return user


@router.post("/api/auth/register", response_model=Token)
async def register(body: UserCreate, db: AsyncSession = Depends(get_db)) -> Token:
    result = await db.execute(select(User).where(User.phone == body.phone))
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="该手机号已被注册")

    user = User(
        phone=body.phone,
        hashed_password=hash_password(body.password),
        real_name=body.real_name,
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="该手机号已被注册")
    await db.refresh(user)
    return Token(access_token=create_access_token(subject=str(user.id)))


@router.post("/api/auth/login", response_model=Token)
async def login(body: UserLogin, db: AsyncSession = Depends(get_db)) -> Token:
    result = await db.execute(select(User).where(User.phone == body.phone))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="该手机号未注册")

    if not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="密码错误")

    return Token(access_token=create_access_token(subject=str(user.id)))


@router.get("/api/user/profile", response_model=UserResponse)
async def profile(current_user: User = Depends(get_current_user)) -> User:
    return current_user
