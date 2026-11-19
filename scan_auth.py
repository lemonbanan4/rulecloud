"""Resolve scan caller: API key, Supabase JWT, or anonymous demo."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Literal, Optional

from fastapi import Header, HTTPException, Request

from anonymous_limit import check_anonymous_scan_allowed
from api_keys import ApiKeyStore
from auth import AuthUser, user_from_authorization
from job_store import JobStore


@dataclass(frozen=True)
class ScanCaller:
    mode: Literal["anonymous", "user", "api_key"]
    workspace_id: Optional[str] = None
    plan: str = "free"
    user: Optional[AuthUser] = None


async def resolve_scan_caller(
    request: Request,
    jobs: JobStore,
    api_keys: ApiKeyStore,
    authorization: Annotated[Optional[str], Header()] = None,
    x_api_key: Annotated[Optional[str], Header(alias="X-API-Key")] = None,
) -> ScanCaller:
    raw_key = (x_api_key or "").strip()
    if raw_key:
        if not api_keys.enabled:
            raise HTTPException(status_code=503, detail="API keys not configured")
        ctx = api_keys.authenticate(raw_key)
        if not ctx:
            raise HTTPException(status_code=401, detail="Invalid API key")
        return ScanCaller(
            mode="api_key",
            workspace_id=ctx.workspace_id,
            plan=ctx.plan,
        )

    user = user_from_authorization(authorization)
    if user:
        workspace_id = jobs.ensure_workspace_id(user.user_id)
        plan = jobs.get_workspace_plan(workspace_id)
        return ScanCaller(
            mode="user",
            user=user,
            workspace_id=workspace_id,
            plan=plan,
        )

    check_anonymous_scan_allowed(request)
    return ScanCaller(mode="anonymous")