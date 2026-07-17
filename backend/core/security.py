"""
Re-export JWT / password helpers from the project-root `security` module
so that `from core.security import ...` resolves when running `uvicorn main:app`
from the `backend/` directory.
"""

from security import (  # noqa: I001
    ACCESS_TOKEN_EXPIRE_MINUTES,
    ALGORITHM,
    SECRET_KEY,
    create_access_token,
    decode_access_token,
    get_current_user,
    get_optional_current_user,
    hash_password,
    verify_password,
)

__all__ = [
    "ACCESS_TOKEN_EXPIRE_MINUTES",
    "ALGORITHM",
    "SECRET_KEY",
    "create_access_token",
    "decode_access_token",
    "get_current_user",
    "get_optional_current_user",
    "hash_password",
    "verify_password",
]
