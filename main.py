"""
Rulecloud API — FastAPI backend that runs the Guardrail static analysis CLI in isolated workspaces.
"""

from __future__ import annotations

import logging
import os
from typing import Annotated, Any, Optional

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator

from ai_copilot import AUTOFIX_PRO_DETAIL, autofix_violation, generate_rules_yaml, llm_configured
from api_keys import create_api_key_store
from auth import AuthUser, get_current_user, get_optional_user
from billing import create_billing_store
from defaults import DEFAULT_RULES_YAML
from github_webhook import extract_scan_target, should_trigger_scan, verify_github_signature
from job_store import JobStore, SourceType, create_job_store
from quota import enforce_workspace_quota, usage_for_workspace
from scan_auth import ScanCaller, resolve_scan_caller
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

_cors_origins = ["http://localhost:3000"]
_frontend = (os.getenv("FRONTEND_URL") or "").strip()
if _frontend and _frontend != "*" and _frontend not in _cors_origins:
    _cors_origins.append(_frontend)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

jobs = create_job_store()
api_key_store = create_api_key_store()
billing = create_billing_store()


async def get_scan_caller(
    request: Request,
    authorization: Annotated[Optional[str], Header()] = None,
    x_api_key: Annotated[Optional[str], Header(alias="X-API-Key")] = None,
) -> ScanCaller:
    return await resolve_scan_caller(
        request, jobs, api_key_store, authorization, x_api_key
    )


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
    workspace_id: Optional[str] = Field(default=None, description="Optional workspace override")

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


class CreateKeyRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class GenerateRulesRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=4000)


class AutofixRequest(BaseModel):
    code: str = Field(min_length=1, max_length=200_000)
    violation: dict[str, Any]
    rules_yaml: str = Field(min_length=1, max_length=100_000)


def _infer_source_type(body: ScanRequest, webhook: bool = False) -> SourceType:
    if webhook:
        return "github_webhook"
    if body.code_snippet:
        return "snippet"
    return "api"


def _resolve_workspace(caller: ScanCaller, body: ScanRequest) -> tuple[Optional[str], Optional[AuthUser]]:
    user = caller.user
    workspace_id = caller.workspace_id or body.workspace_id
    if user and not workspace_id:
        workspace_id = jobs.resolve_workspace_id(user.user_id)
    return workspace_id, user


def _guard_quota(workspace_id: Optional[str]) -> None:
    if workspace_id:
        enforce_workspace_quota(jobs, workspace_id)


def _run_job(job_id: str, payload: dict[str, Any], webhook_meta: Optional[dict[str, Any]] = None) -> None:
    jobs.mark_running(job_id)
    try:
        scan_payload = {
            k: v
            for k, v in payload.items()
            if k not in ("_webhook_meta", "_meta", "workspace_id")
        }
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
    caller: ScanCaller,
    *,
    webhook_meta: Optional[dict[str, Any]] = None,
    source_type: Optional[SourceType] = None,
) -> str:
    workspace_id, user = _resolve_workspace(caller, body)
    _guard_quota(workspace_id)

    payload = body.model_dump()
    if webhook_meta:
        payload["_webhook_meta"] = webhook_meta

    inferred = source_type or _infer_source_type(body, webhook=bool(webhook_meta))
    user_id = user.user_id if user else None

    store_request = {k: v for k, v in payload.items() if k != "_webhook_meta"}
    record = jobs.create(
        store_request,
        user_id=user_id,
        workspace_id=workspace_id,
        source_type=inferred,
        rules_yaml=body.rules_yaml,
    )
    background_tasks.add_task(_run_job, record.job_id, payload, webhook_meta)
    return record.job_id


def _workspace_for_user(user: AuthUser) -> str:
    workspace_id = jobs.resolve_workspace_id(user.user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No workspace found for user")
    return workspace_id


def _frontend_base() -> str:
    base = (os.getenv("FRONTEND_URL") or "http://localhost:3000").strip().rstrip("/")
    return base


@app.get("/api/defaults")
def get_defaults() -> dict[str, str]:
    """Canonical starter guardrail rules YAML for clients."""
    return {"rules_yaml": DEFAULT_RULES_YAML}


@app.get("/health")
def health() -> dict[str, Any]:
    ok, detail = guardrail_available()
    status = "ok" if ok else "degraded"
    return {
        "status": status,
        "guardrail": {"available": ok, "detail": detail},
    }


@app.get("/api/usage")
def get_usage(user: Annotated[AuthUser, Depends(get_current_user)]) -> dict[str, Any]:
    workspace_id = _workspace_for_user(user)
    snapshot = usage_for_workspace(jobs, workspace_id)
    return {
        "plan": snapshot.plan,
        "used": snapshot.used,
        "limit": snapshot.limit,
    }


@app.post("/api/keys")
def create_api_key(
    body: CreateKeyRequest,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, Any]:
    if not api_key_store.enabled:
        raise HTTPException(status_code=503, detail="API keys not configured")
    workspace_id = _workspace_for_user(user)
    try:
        created = api_key_store.create_key(
            workspace_id=workspace_id,
            name=body.name,
            owner_id=user.user_id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("create_api_key failed")
        raise HTTPException(status_code=500, detail="Could not create API key") from exc
    return created


@app.get("/api/keys")
def list_api_keys(user: Annotated[AuthUser, Depends(get_current_user)]) -> dict[str, Any]:
    if not api_key_store.enabled:
        raise HTTPException(status_code=503, detail="API keys not configured")
    workspace_id = _workspace_for_user(user)
    try:
        keys = api_key_store.list_keys(workspace_id=workspace_id, owner_id=user.user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return {"keys": keys}


@app.post("/api/billing/checkout")
def billing_checkout(user: Annotated[AuthUser, Depends(get_current_user)]) -> dict[str, str]:
    if not billing.stripe_enabled or not billing.supabase_enabled:
        raise HTTPException(status_code=503, detail="Billing is not configured")
    workspace_id = _workspace_for_user(user)
    base = _frontend_base()
    try:
        url = billing.create_checkout_session(
            workspace_id=workspace_id,
            customer_email=user.email,
            success_url=f"{base}/?billing=success",
            cancel_url=f"{base}/?billing=canceled",
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("checkout session failed")
        raise HTTPException(status_code=500, detail="Could not start checkout") from exc
    return {"url": url}


@app.post("/api/billing/portal")
def billing_portal(user: Annotated[AuthUser, Depends(get_current_user)]) -> dict[str, str]:
    if not billing.stripe_enabled or not billing.supabase_enabled:
        raise HTTPException(status_code=503, detail="Billing is not configured")
    workspace_id = _workspace_for_user(user)
    snapshot = billing.get_workspace_billing(workspace_id)
    if not snapshot.stripe_customer_id:
        raise HTTPException(
            status_code=400,
            detail="No Stripe customer yet. Complete checkout to manage billing.",
        )
    base = _frontend_base()
    try:
        url = billing.create_portal_session(
            customer_id=snapshot.stripe_customer_id,
            return_url=f"{base}/?billing=portal",
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("portal session failed")
        raise HTTPException(status_code=500, detail="Could not open billing portal") from exc
    return {"url": url}


@app.post("/api/webhook/stripe")
async def stripe_webhook(
    request: Request,
    stripe_signature: Annotated[Optional[str], Header(alias="Stripe-Signature")] = None,
) -> dict[str, bool]:
    if not billing.stripe_enabled:
        raise HTTPException(status_code=503, detail="Stripe webhooks not configured")
    raw = await request.body()
    try:
        event = billing.verify_webhook(raw, stripe_signature)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("stripe webhook verification failed")
        raise HTTPException(status_code=400, detail="Invalid webhook") from exc
    try:
        billing.handle_webhook_event(event)
    except Exception as exc:  # noqa: BLE001
        logger.exception("stripe webhook handler failed for %s", event.get("type"))
        raise HTTPException(status_code=500, detail="Webhook handler failed") from exc
    return {"received": True}


@app.post("/api/ai/generate-rules")
def ai_generate_rules(
    body: GenerateRulesRequest,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, str]:
    if not llm_configured():
        raise HTTPException(status_code=503, detail="AI Copilot is not configured")
    workspace_id = _workspace_for_user(user)
    plan = jobs.get_workspace_plan(workspace_id)
    try:
        return generate_rules_yaml(
            body.prompt,
            workspace_id=workspace_id,
            plan=plan,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("generate-rules failed")
        raise HTTPException(status_code=500, detail="Could not generate rules") from exc


@app.post("/api/ai/autofix")
def ai_autofix(
    body: AutofixRequest,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, str]:
    if not llm_configured():
        raise HTTPException(status_code=503, detail="AI Copilot is not configured")
    workspace_id = _workspace_for_user(user)
    plan = jobs.get_workspace_plan(workspace_id).strip().lower()
    if plan != "pro":
        raise HTTPException(status_code=402, detail=AUTOFIX_PRO_DETAIL)
    try:
        return autofix_violation(
            code=body.code,
            violation=body.violation,
            rules_yaml=body.rules_yaml,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("autofix failed")
        raise HTTPException(status_code=500, detail="Auto-fix failed") from exc


@app.delete("/api/keys/{key_id}")
def revoke_api_key(
    key_id: str,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, bool]:
    if not api_key_store.enabled:
        raise HTTPException(status_code=503, detail="API keys not configured")
    try:
        ok = api_key_store.revoke_key(key_id=key_id, owner_id=user.user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(status_code=404, detail="API key not found")
    return {"revoked": True}


@app.post("/api/scan", response_model=ScanResponse)
def scan_sync(
    body: ScanRequest,
    caller: Annotated[ScanCaller, Depends(get_scan_caller)],
) -> ScanResponse:
    workspace_id, _ = _resolve_workspace(caller, body)
    _guard_quota(workspace_id)
    result = run_scan(**body.model_dump(exclude={"workspace_id"}))
    return ScanResponse(**result.to_dict())


@app.post("/api/jobs/scan", response_model=JobCreateResponse, status_code=202)
def scan_async(
    body: ScanRequest,
    background_tasks: BackgroundTasks,
    caller: Annotated[ScanCaller, Depends(get_scan_caller)],
) -> JobCreateResponse:
    job_id = _enqueue_scan(background_tasks, body, caller)
    return JobCreateResponse(job_id=job_id, state="queued")


@app.get("/api/jobs")
def list_jobs(user: Annotated[AuthUser, Depends(get_current_user)]) -> dict[str, Any]:
    return {"jobs": jobs.list_for_user(user.user_id, limit=50)}


@app.get("/api/jobs/{job_id}")
def get_job(
    job_id: str,
    user: Annotated[Optional[AuthUser], Depends(get_optional_user)] = None,
) -> dict[str, Any]:
    record = jobs.get(job_id)
    if not record:
        raise HTTPException(status_code=404, detail="Job not found")
    if record.user_id:
        if user is None:
            raise HTTPException(status_code=401, detail="Sign in to view this scan")
        if record.user_id != user.user_id:
            raise HTTPException(status_code=403, detail="Not allowed to view this job")
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
    caller = ScanCaller(mode="anonymous")
    job_id = _enqueue_scan(
        background_tasks,
        scan_body,
        caller,
        webhook_meta=meta,
        source_type="github_webhook",
    )
    meta["job_id"] = job_id
    logger.info("github_webhook_queued", extra={"scan_meta": meta})
    return {"accepted": True, "job_id": job_id, "scan": meta}