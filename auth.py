"""Supabase JWT validation for FastAPI."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Annotated, Optional

import jwt
from fastapi import Depends, Header, HTTPException

JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
JWT_AUDIENCE = "authenticated"
JWT_ALGORITHMS = ["HS256"]


@dataclass(frozen=True)
class AuthUser:
    user_id: str
    email: Optional[str] = None


def _parse_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


def _decode_supabase_jwt(token: str) -> AuthUser:
    if not JWT_SECRET:
        raise HTTPException(status_code=503, detail="Auth not configured on server")
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=JWT_ALGORITHMS,
            audience=JWT_AUDIENCE,
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Invalid token subject")
    email = payload.get("email")
    if isinstance(email, str):
        email = email.strip() or None
    else:
        email = None
    return AuthUser(user_id=str(sub), email=email)


async def get_optional_user(
    authorization: Annotated[Optional[str], Header()] = None,
) -> Optional[AuthUser]:
    token = _parse_bearer_token(authorization)
    if not token:
        return None
    return _decode_supabase_jwt(token)


async def get_current_user(
    user: Annotated[Optional[AuthUser], Depends(get_optional_user)],
) -> AuthUser:
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user