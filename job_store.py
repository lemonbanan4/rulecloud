"""Scan job store — in-memory fallback or Supabase Postgres persistence."""

from __future__ import annotations

import logging
import os
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal, Optional

logger = logging.getLogger(__name__)

JobState = Literal["queued", "running", "completed", "failed"]
SourceType = Literal["snippet", "github_webhook", "api"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _month_bounds_utc() -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if now.month == 12:
        end = start.replace(year=now.year + 1, month=1)
    else:
        end = start.replace(month=now.month + 1)
    return start.isoformat(), end.isoformat()


@dataclass
class JobRecord:
    job_id: str
    state: JobState = "queued"
    created_at: str = field(default_factory=_now_iso)
    updated_at: str = field(default_factory=_now_iso)
    request: dict[str, Any] = field(default_factory=dict)
    result: Optional[dict[str, Any]] = None
    error: Optional[str] = None
    user_id: Optional[str] = None
    workspace_id: Optional[str] = None
    source_type: SourceType = "api"

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "state": self.state,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "request": self.request,
            "result": self.result,
            "error": self.error,
            "user_id": self.user_id,
            "workspace_id": self.workspace_id,
            "source_type": self.source_type,
        }

    def to_summary(self) -> dict[str, Any]:
        status = None
        violation_count = 0
        if self.result:
            status = self.result.get("status")
            violation_count = len(self.result.get("findings") or [])
        return {
            "job_id": self.job_id,
            "state": self.state,
            "created_at": self.created_at,
            "source_type": self.source_type,
            "violation_count": violation_count,
            "scan_status": status,
            "error": self.error,
        }


class _SupabasePersistence:
    def __init__(self, url: str, service_key: str) -> None:
        from supabase import create_client

        self._client = create_client(url, service_key)

    def insert_job(
        self,
        job_id: str,
        *,
        user_id: Optional[str],
        workspace_id: Optional[str],
        source_type: SourceType,
        rules_yaml: Optional[str],
    ) -> None:
        row = {
            "id": job_id,
            "workspace_id": workspace_id,
            "user_id": user_id,
            "status": "queued",
            "source_type": source_type,
            "rules_yaml": rules_yaml,
        }
        self._client.table("scan_jobs").insert(row).execute()

    def update_job(self, job_id: str, fields: dict[str, Any]) -> None:
        self._client.table("scan_jobs").update(fields).eq("id", job_id).execute()

    def fetch_job(self, job_id: str) -> Optional[JobRecord]:
        res = (
            self._client.table("scan_jobs")
            .select("*")
            .eq("id", job_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return None
        return _row_to_record(rows[0])

    def list_user_jobs(self, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
        res = (
            self._client.table("scan_jobs")
            .select(
                "id, status, created_at, source_type, violation_count, result_json, error_message"
            )
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        summaries: list[dict[str, Any]] = []
        for row in res.data or []:
            result = row.get("result_json") if isinstance(row.get("result_json"), dict) else None
            scan_status = result.get("status") if result else None
            summaries.append(
                {
                    "job_id": row["id"],
                    "state": row.get("status") or "queued",
                    "created_at": row.get("created_at"),
                    "source_type": row.get("source_type"),
                    "violation_count": row.get("violation_count") or 0,
                    "scan_status": scan_status,
                    "error": row.get("error_message"),
                }
            )
        return summaries

    def resolve_workspace_id(self, user_id: str) -> Optional[str]:
        res = (
            self._client.table("workspaces")
            .select("id")
            .eq("owner_id", user_id)
            .order("created_at", desc=False)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return None
        return str(rows[0]["id"])

    def ensure_workspace_id(self, user_id: str, *, name: str = "Personal Workspace") -> Optional[str]:
        found = self.resolve_workspace_id(user_id)
        if found:
            return found
        try:
            res = (
                self._client.table("workspaces")
                .insert(
                    {
                        "owner_id": user_id,
                        "name": name,
                        "plan": "free",
                    }
                )
                .execute()
            )
            rows = res.data or []
            if rows:
                return str(rows[0]["id"])
        except Exception:  # noqa: BLE001
            logger.exception("Failed to insert workspace for user %s", user_id)
        return self.resolve_workspace_id(user_id)

    def get_workspace_plan(self, workspace_id: str) -> str:
        res = (
            self._client.table("workspaces")
            .select("plan")
            .eq("id", workspace_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return "free"
        plan = rows[0].get("plan") or "free"
        return str(plan)

    def count_workspace_scans_month(self, workspace_id: str) -> int:
        start, end = _month_bounds_utc()
        res = (
            self._client.table("scan_jobs")
            .select("id", count="exact")
            .eq("workspace_id", workspace_id)
            .gte("created_at", start)
            .lt("created_at", end)
            .execute()
        )
        return int(res.count or 0)


def _row_to_record(row: dict[str, Any]) -> JobRecord:
    result = row.get("result_json")
    if result is not None and not isinstance(result, dict):
        result = None
    state = row.get("status") or "queued"
    if state not in ("queued", "running", "completed", "failed"):
        state = "queued"
    source = row.get("source_type") or "api"
    if source not in ("snippet", "github_webhook", "api"):
        source = "api"
    created = row.get("created_at")
    if isinstance(created, str):
        created_at = created
    else:
        created_at = _now_iso()
    return JobRecord(
        job_id=str(row["id"]),
        state=state,  # type: ignore[arg-type]
        created_at=created_at,
        updated_at=created_at,
        request={},
        result=result,
        error=row.get("error_message"),
        user_id=str(row["user_id"]) if row.get("user_id") else None,
        workspace_id=str(row["workspace_id"]) if row.get("workspace_id") else None,
        source_type=source,  # type: ignore[arg-type]
    )


def create_job_store() -> "JobStore":
    url = (os.getenv("SUPABASE_URL") or "").strip()
    key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    persistence: Optional[_SupabasePersistence] = None
    if url and key:
        try:
            persistence = _SupabasePersistence(url, key)
            logger.info("Job store: Supabase persistence enabled")
        except Exception as exc:  # noqa: BLE001
            logger.exception("Supabase init failed, using memory only: %s", exc)
    else:
        logger.info("Job store: in-memory only (Supabase env not set)")
    return JobStore(persistence)


class JobStore:
    def __init__(self, persistence: Optional[_SupabasePersistence] = None) -> None:
        self._jobs: dict[str, JobRecord] = {}
        self._lock = threading.Lock()
        self._db = persistence

    def create(
        self,
        request: dict[str, Any],
        *,
        user_id: Optional[str] = None,
        workspace_id: Optional[str] = None,
        source_type: SourceType = "api",
        rules_yaml: Optional[str] = None,
    ) -> JobRecord:
        job_id = str(uuid.uuid4())
        record = JobRecord(
            job_id=job_id,
            request=request,
            user_id=user_id,
            workspace_id=workspace_id,
            source_type=source_type,
        )
        with self._lock:
            self._jobs[job_id] = record
        if self._db:
            try:
                self._db.insert_job(
                    job_id,
                    user_id=user_id,
                    workspace_id=workspace_id,
                    source_type=source_type,
                    rules_yaml=rules_yaml,
                )
            except Exception:  # noqa: BLE001
                logger.exception("Failed to persist job create %s", job_id)
        return record

    def get(self, job_id: str) -> Optional[JobRecord]:
        with self._lock:
            record = self._jobs.get(job_id)
        if record:
            return record
        if not self._db:
            return None
        try:
            record = self._db.fetch_job(job_id)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to fetch job %s", job_id)
            return None
        if record:
            with self._lock:
                self._jobs[job_id] = record
        return record

    def resolve_workspace_id(self, user_id: str) -> Optional[str]:
        if not self._db:
            return None
        try:
            return self._db.resolve_workspace_id(user_id)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to resolve workspace for user %s", user_id)
            return None

    def ensure_workspace_id(self, user_id: str, *, name: str = "Personal Workspace") -> Optional[str]:
        if not self._db:
            return None
        try:
            return self._db.ensure_workspace_id(user_id, name=name)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to ensure workspace for user %s", user_id)
            return None

    def get_workspace_plan(self, workspace_id: Optional[str]) -> str:
        if not workspace_id:
            return "free"
        if not self._db:
            return "free"
        try:
            return self._db.get_workspace_plan(workspace_id)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to get plan for workspace %s", workspace_id)
            return "free"

    def count_workspace_scans_month(self, workspace_id: str) -> int:
        if self._db:
            try:
                return self._db.count_workspace_scans_month(workspace_id)
            except Exception:  # noqa: BLE001
                logger.exception("Failed to count monthly scans for %s", workspace_id)
        start, end = _month_bounds_utc()
        with self._lock:
            count = 0
            for job in self._jobs.values():
                if job.workspace_id != workspace_id:
                    continue
                created = job.created_at
                if start <= created < end:
                    count += 1
            return count

    def list_for_user(self, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
        if not self._db:
            with self._lock:
                items = [
                    j.to_summary()
                    for j in self._jobs.values()
                    if j.user_id == user_id
                ]
            items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
            return items[:limit]
        try:
            return self._db.list_user_jobs(user_id, limit=limit)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to list jobs for user %s", user_id)
            return []

    def mark_running(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job.state = "running"
            job.updated_at = _now_iso()
        self._persist(job_id, {"status": "running"})

    def complete(self, job_id: str, result: dict[str, Any]) -> None:
        violations = len(result.get("findings") or [])
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job.state = "completed"
            job.result = result
            job.updated_at = _now_iso()
        self._persist(
            job_id,
            {
                "status": "completed",
                "result_json": result,
                "violation_count": violations,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    def fail(self, job_id: str, error: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job.state = "failed"
            job.error = error
            job.updated_at = _now_iso()
        self._persist(
            job_id,
            {
                "status": "failed",
                "error_message": error,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    def _persist(self, job_id: str, fields: dict[str, Any]) -> None:
        if not self._db:
            return
        try:
            self._db.update_job(job_id, fields)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to persist job update %s", job_id)