"""In-memory async scan job store (swap for Redis/DB at scale)."""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal, Optional

JobState = Literal["queued", "running", "completed", "failed"]


@dataclass
class JobRecord:
    job_id: str
    state: JobState = "queued"
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    request: dict[str, Any] = field(default_factory=dict)
    result: Optional[dict[str, Any]] = None
    error: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "state": self.state,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "request": self.request,
            "result": self.result,
            "error": self.error,
        }


class JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, JobRecord] = {}
        self._lock = threading.Lock()

    def create(self, request: dict[str, Any]) -> JobRecord:
        job_id = str(uuid.uuid4())
        record = JobRecord(job_id=job_id, request=request)
        with self._lock:
            self._jobs[job_id] = record
        return record

    def get(self, job_id: str) -> Optional[JobRecord]:
        with self._lock:
            return self._jobs.get(job_id)

    def mark_running(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job.state = "running"
            job.updated_at = datetime.now(timezone.utc).isoformat()

    def complete(self, job_id: str, result: dict[str, Any]) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job.state = "completed"
            job.result = result
            job.updated_at = datetime.now(timezone.utc).isoformat()

    def fail(self, job_id: str, error: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job.state = "failed"
            job.error = error
            job.updated_at = datetime.now(timezone.utc).isoformat()