"""
Rulecloud API — FastAPI backend that runs the Guardrail static analysis CLI in isolated workspaces.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator

from defaults import DEFAULT_RULES_YAML
from github_webhook import extract_scan_target, should_trigger_scan, verify_github_signature
from job_store import JobStore
from scan_runner import guardrail_available, run_scan

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Rulecloud Guardrail API",
    version="1.0.0",
    description="Run Guardrail static analysis on repositories and code snippets via HTTP.",
)

_frontend = os.getenv("FRONTEND_URL", "*")
_cors_origins = ["http://localhost:3000"]
if _frontend and _frontend not in _cors_origins:
    _cors_origins.append(_frontend)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

jobs = JobStore()


class ScanRequest(BaseModel):
    repo_url: Optional[str] = Field(
        default=None,
        description="Git repository URL (shallow clone)",
    )
    code_snippet: Optional[str] = Field(
        default=None,
        description="Inline source to scan when repo_url is omitted",
    )
    filename: Optional[str] = Field(
        default=None,
        examples=["Program.cs"],
        description="File name used when writing code_snippet",
    )
    rules_yaml: str = Field(default=DEFAULT_RULES_YAML)
    branch: Optional[str] = Field(default=None, description="Optional git branch to clone")

    @model_validator(mode="after")
    def require_source(self) -> "ScanRequest":
        if not self.repo_url and not self.code_snippet:
            raise ValueError("Either repo_url or code_snippet must be provided")
        if self.repo_url and self.code_snippet:
            raise ValueError("Provide repo_url or code_snippet, not both")
        return self


class ScanResponse(BaseModel):
    status: str
    exit_code: int
    findings: list[dict[str, Any]]
    duration_ms: int
    stdout: str
    stderr: str
    error: Optional[str] = None


class JobCreateResponse(BaseModel):
    job_id: str
    state: str


def _run_job(job_id: str, payload: dict[str, Any], webhook_meta: Optional[dict[str, Any]] = None) -> None:
    jobs.mark_running(job_id)
    try:
        scan_payload = {k: v for k, v in payload.items() if k != "_webhook_meta"}
        result = run_scan(**scan_payload)
        result_dict = result.to_dict()
        jobs.complete(job_id, result_dict)
        if webhook_meta:
            logger.info(
                "github_scan_completed",
                extra={
                    "check_run": {
                        "job_id": job_id,
                        "head_sha": webhook_meta.get("sha"),
                        "pr_number": webhook_meta.get("pr_number"),
                        "status": result_dict.get("status"),
                        "exit_code": result_dict.get("exit_code"),
                        "findings_count": len(result_dict.get("findings") or []),
                        "duration_ms": result_dict.get("duration_ms"),
                    }
                },
            )
    except Exception as exc:  # noqa: BLE001
        logger.exception("job %s failed", job_id)
        jobs.fail(job_id, str(exc))


def _enqueue_scan(
    background_tasks: BackgroundTasks,
    body: ScanRequest,
    webhook_meta: Optional[dict[str, Any]] = None,
) -> str:
    payload = body.model_dump()
    if webhook_meta:
        payload["_webhook_meta"] = webhook_meta
    record = jobs.create({k: v for k, v in payload.items() if k != "_webhook_meta"})
    background_tasks.add_task(_run_job, record.job_id, payload, webhook_meta)
    return record.job_id


@app.get("/health")
def health() -> dict[str, Any]:
    ok, detail = guardrail_available()
    status = "ok" if ok else "degraded"
    return {
        "status": status,
        "guardrail": {"available": ok, "detail": detail},
    }


@app.post("/api/scan", response_model=ScanResponse)
def scan_sync(body: ScanRequest) -> ScanResponse:
    result = run_scan(**body.model_dump())
    return ScanResponse(**result.to_dict())


@app.post("/api/jobs/scan", response_model=JobCreateResponse, status_code=202)
def scan_async(body: ScanRequest, background_tasks: BackgroundTasks) -> JobCreateResponse:
    job_id = _enqueue_scan(background_tasks, body)
    return JobCreateResponse(job_id=job_id, state="queued")


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    record = jobs.get(job_id)
    if not record:
        raise HTTPException(status_code=404, detail="Job not found")
    return record.to_dict()


@app.post("/api/webhook/github")
async def github_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    x_hub_signature_256: Optional[str] = Header(default=None),
    x_github_event: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    secret = os.getenv("GITHUB_WEBHOOK_SECRET", "")
    raw = await request.body()

    if not verify_github_signature(raw, x_hub_signature_256, secret):
        raise HTTPException(status_code=401, detail="Invalid signature")

    try:
        payload = await request.json()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid JSON payload") from exc

    event_name = x_github_event or "unknown"
    if not should_trigger_scan(event_name, payload):
        return {"accepted": False, "reason": f"ignored event {event_name}"}

    target = extract_scan_target(payload)
    if not target:
        raise HTTPException(status_code=422, detail="Could not resolve repository from payload")

    scan_body = ScanRequest(
        repo_url=target["repo_url"],
        branch=target.get("branch") or None,
        rules_yaml=DEFAULT_RULES_YAML,
    )
    meta = {
        "event": event_name,
        "repo_url": target["repo_url"],
        "branch": target.get("branch"),
        "sha": target.get("sha"),
        "pr_number": target.get("pr_number"),
    }
    job_id = _enqueue_scan(background_tasks, scan_body, webhook_meta=meta)
    meta["job_id"] = job_id
    logger.info("github_webhook_queued", extra={"scan_meta": meta})
    return {"accepted": True, "job_id": job_id, "scan": meta}