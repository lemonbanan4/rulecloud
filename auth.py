"""Supabase JWT validation for FastAPI."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Optional

import jwt
from fastapi import Depends, Header, HTTPException
from jwt import PyJWKClient

logger = logging.getLogger(__name__)

SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").rstrip("/")
JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
JWT_AUDIENCE = "authenticated"
JWKS_ALGORITHMS = ("ES256", "RS256")
LEGACY_ALGORITHMS = ("HS256",)


@dataclass(frozen=True)
class AuthUser:
    user_id: str
    email: Optional[str] = None


@lru_cache(maxsize=1)
def _jwks_client() -> Optional[PyJWKClient]:
    if not SUPABASE_URL:
        return None
    jwks_url = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
    try:
        return PyJWKClient(jwks_url, cache_keys=True)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to initialize JWKS client for %s", jwks_url)
        return None


def _parse_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


def _user_from_payload(payload: dict) -> AuthUser:
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Invalid token subject")
    email = payload.get("email")
    if isinstance(email, str):
        email = email.strip() or None
    else:
        email = None
    return AuthUser(user_id=str(sub), email=email)


def _decode_supabase_jwt(token: str) -> AuthUser:
    decode_opts = {"require": ["exp", "sub"]}
    last_error: Exception | None = None

    client = _jwks_client()
    if client is not None:
        try:
            signing_key = client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=list(JWKS_ALGORITHMS),
                audience=JWT_AUDIENCE,
                options=decode_opts,
            )
            return _user_from_payload(payload)
        except jwt.ExpiredSignatureError as exc:
            raise HTTPException(status_code=401, detail="Token expired") from exc
        except jwt.InvalidTokenError as exc:
            last_error = exc

    if JWT_SECRET:
        try:
            payload = jwt.decode(
                token,
                JWT_SECRET,
                algorithms=list(LEGACY_ALGORITHMS),
                audience=JWT_AUDIENCE,
                options=decode_opts,
            )
            return _user_from_payload(payload)
        except jwt.ExpiredSignatureError as exc:
            raise HTTPException(status_code=401, detail="Token expired") from exc
        except jwt.InvalidTokenError as exc:
            last_error = exc

    if not client and not JWT_SECRET:
        raise HTTPException(status_code=503, detail="Auth not configured on server")

    if last_error:
        logger.debug("JWT validation failed: %s", last_error)
    raise HTTPException(status_code=401, detail="Invalid token")


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