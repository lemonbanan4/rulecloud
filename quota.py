"""Workspace scan quotas by plan."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Optional

from fastapi import HTTPException

if TYPE_CHECKING:
    from job_store import JobStore

PLAN_LIMITS: dict[str, int] = {
    "free": 50,
    "pro": 2000,
}

QUOTA_EXCEEDED_DETAIL = (
    "Monthly scan quota reached. Upgrade to Pro for 2,000 scans/month."
)


@dataclass(frozen=True)
class UsageSnapshot:
    plan: str
    used: int
    limit: int


def limit_for_plan(plan: str | None) -> int:
    normalized = (plan or "free").strip().lower()
    return PLAN_LIMITS.get(normalized, PLAN_LIMITS["free"])


def usage_for_workspace(jobs: "JobStore", workspace_id: str) -> UsageSnapshot:
    plan = jobs.get_workspace_plan(workspace_id)
    used = jobs.count_workspace_scans_month(workspace_id)
    return UsageSnapshot(plan=plan, used=used, limit=limit_for_plan(plan))


def enforce_workspace_quota(jobs: "JobStore", workspace_id: str) -> None:
    snapshot = usage_for_workspace(jobs, workspace_id)
    if snapshot.used >= snapshot.limit:
        raise HTTPException(status_code=429, detail=QUOTA_EXCEEDED_DETAIL)


def workspace_quota_blocked(jobs: "JobStore", workspace_id: str) -> Optional[str]:
    """Return quota message if blocked, else None (for non-HTTP callers like MCP)."""
    snapshot = usage_for_workspace(jobs, workspace_id)
    if snapshot.used >= snapshot.limit:
        return QUOTA_EXCEEDED_DETAIL
    return None