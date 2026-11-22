"""
Rulecloud API — FastAPI backend that runs the Guardrail static analysis CLI in isolated workspaces.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Annotated, Any, Optional

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field, model_validator

from ai_copilot import (
    AUTOFIX_PRO_DETAIL,
    autofix_violation,
    format_llm_error,
    generate_rules_yaml,
    llm_configured,
    test_llm_connection,
)
from workspace_ai import create_workspace_ai_store
from api_keys import create_api_key_store
from auth import AuthUser, get_current_user, get_optional_user
from billing import create_billing_store
from defaults import DEFAULT_RULES_YAML
from github_app_auth import (
    check_github_app,
    get_installation,
    github_app_configured,
    install_url_for_workspace,
    list_app_installations,
    list_installation_repos,
)
from github_connections import create_github_connection_store
from github_installations import create_github_installation_store
from github_pr_pipeline import process_github_event
from github_webhook import (
    connection_from_github_app,
    parse_github_webhook_body,
    resolve_webhook_connection,
    should_trigger_scan,
    verify_github_signature,
)
from job_store import JobStore, SourceType, create_job_store
from mcp_server import create_mcp_server
from quota import enforce_workspace_quota, usage_for_workspace
from rulespacks import create_rulespack_store
from scan_auth import ScanCaller, resolve_scan_caller
from scan_runner import guardrail_available, run_scan

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

jobs = create_job_store()
api_key_store = create_api_key_store()
billing = create_billing_store()
github_store = create_github_connection_store()
github_app_store = create_github_installation_store()
rulespack_store = create_rulespack_store()
workspace_ai_store = create_workspace_ai_store()

_mcp_server = create_mcp_server(jobs=jobs, api_keys=api_key_store)
_mcp_asgi = _mcp_server.http_app(
    path="/",
    transport="streamable-http",
    stateless_http=True,
)


@asynccontextmanager
async def _app_lifespan(app: FastAPI):
    async with _mcp_asgi.lifespan(app):
        yield


app = FastAPI(
    title="Rulecloud Guardrail API",
    version="1.0.0",
    description="Run Guardrail static analysis on repositories and code snippets via HTTP.",
    lifespan=_app_lifespan,
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


class GitHubConnectRequest(BaseModel):
    repo_full_name: str = Field(min_length=3, max_length=200, examples=["owner/repo"])
    github_token: Optional[str] = Field(default=None, max_length=500)
    auto_fix_comments: bool = True


class GitHubConnectionPatch(BaseModel):
    auto_fix_comments: Optional[bool] = None
    github_token: Optional[str] = Field(default=None, max_length=500)


class GitHubAppCallbackRequest(BaseModel):
    installation_id: int = Field(ge=1)


class GitHubAppAutoFixPatch(BaseModel):
    auto_fix_comments: bool


class RulespackCreateRequest(BaseModel):
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9-]+$")
    name: str = Field(min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)
    rules_yaml: str = Field(min_length=1, max_length=100_000)
    enabled: bool = True


class RulespackPatchRequest(BaseModel):
    rules_yaml: Optional[str] = Field(default=None, max_length=100_000)
    enabled: Optional[bool] = None
    name: Optional[str] = Field(default=None, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)


class WatchEventRequest(BaseModel):
    file: str = Field(min_length=1, max_length=500)
    findings: list[dict[str, Any]] = Field(default_factory=list)
    duration_ms: int = Field(default=0, ge=0)
    repo_label: Optional[str] = Field(default=None, max_length=200)


class WorkspaceAiPatch(BaseModel):
    llm_provider: Optional[str] = Field(default=None, max_length=32)
    llm_api_key: Optional[str] = Field(default=None, max_length=500)
    clear_api_key: bool = False


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
    label = "Personal Workspace"
    if user.email:
        label = f"{user.email.split('@')[0]}'s workspace"
    workspace_id = jobs.ensure_workspace_id(user.user_id, name=label)
    if not workspace_id:
        raise HTTPException(
            status_code=503,
            detail=(
                "Workspace unavailable. If you applied migrations manually, "
                "run supabase/migrations/005_service_role_grants.sql in the SQL Editor."
            ),
        )
    return workspace_id


def _frontend_base() -> str:
    base = (os.getenv("FRONTEND_URL") or "http://localhost:3000").strip().rstrip("/")
    return base


def _try_auto_link_github_installation(payload: dict[str, Any]) -> bool:
    """Link a new GitHub App installation to a workspace (webhook or post-install)."""
    if not github_app_store.enabled:
        return False
    inst = payload.get("installation") or {}
    raw_id = inst.get("id")
    if raw_id is None:
        return False
    installation_id = int(raw_id)
    if github_app_store.get_by_installation_id(installation_id):
        return False
    account = inst.get("account") or {}
    login = str(account.get("login") or "unknown")
    account_type = str(account.get("type") or "User")
    workspace_id: Optional[str] = None

    intent = github_app_store.single_active_link_intent()
    if intent:
        workspace_id = intent[0]
    if not workspace_id and github_store.enabled:
        workspace_id = github_store.find_workspace_id_for_repo_owner(login)

    if not workspace_id:
        logger.info(
            "github_app_installation_unlinked",
            extra={"installation_id": installation_id, "account": login},
        )
        return False

    try:
        github_app_store.upsert_from_service(
            workspace_id=workspace_id,
            installation_id=installation_id,
            account_login=login,
            account_type=account_type,
        )
        github_app_store.clear_link_intent(workspace_id)
        logger.info(
            "github_app_installation_auto_linked",
            extra={
                "installation_id": installation_id,
                "workspace_id": workspace_id,
                "account": login,
            },
        )
        return True
    except Exception:  # noqa: BLE001
        logger.exception("auto-link installation %s", installation_id)
        return False


@app.get("/api/defaults")
def get_defaults() -> dict[str, str]:
    """Canonical starter guardrail rules YAML for clients."""
    return {"rules_yaml": DEFAULT_RULES_YAML}


MCP_REGISTRY_NAME = "io.github.lemonbanan4/rulecloud"


def _public_api_base(request: Request) -> str:
    env = (os.getenv("BACKEND_URL") or "").strip().rstrip("/")
    if env:
        return env
    return str(request.base_url).rstrip("/")


def _mcp_cursor_snippet(mcp_url: str) -> str:
    return (
        '{\n  "mcpServers": {\n    "rulecloud": {\n'
        f'      "url": "{mcp_url}",\n'
        '      "headers": { "X-API-Key": "rc_live_YOUR_KEY" }\n'
        "    }\n  }\n}"
    )


@app.get("/api/mcp")
def mcp_setup_info(request: Request) -> JSONResponse | HTMLResponse:
    """
    Human-friendly MCP setup (use this URL in a browser).
    The Streamable HTTP endpoint at /mcp/ requires an MCP client — not a browser tab.
    """
    base = _public_api_base(request)
    mcp_url = f"{base}/mcp/"
    console = (os.getenv("FRONTEND_URL") or "https://rulecloud.vercel.app").rstrip("/")
    payload = {
        "registry_name": MCP_REGISTRY_NAME,
        "transport": "streamable-http",
        "mcp_url": mcp_url,
        "browser_note": (
            "Opening /mcp/ in a browser returns a JSON-RPC error — that is expected. "
            "Use an MCP client (Cursor, Claude Code, VS Code) with the config below."
        ),
        "api_key_url": f"{console}/dashboard/keys",
        "docs_url": f"{console}/docs",
        "mcp_config_example": {
            "mcpServers": {
                "rulecloud": {
                    "url": mcp_url,
                    "headers": {"X-API-Key": "rc_live_YOUR_KEY"},
                }
            }
        },
        "tools": [
            "scan_code",
            "get_default_rules",
            "generate_guardrail_rules",
            "suggest_fix",
        ],
    }
    accept = (request.headers.get("accept") or "").lower()
    if "text/html" in accept and "application/json" not in accept:
        snippet = _mcp_cursor_snippet(mcp_url)
        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>RuleCloud MCP</title>
  <style>
    body {{ font-family: system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }}
    code, pre {{ background: #111; color: #eee; border-radius: 8px; }}
    pre {{ padding: 1rem; overflow-x: auto; }}
    a {{ color: #22d3ee; }}
  </style>
</head>
<body>
  <h1>RuleCloud MCP</h1>
  <p><strong>{MCP_REGISTRY_NAME}</strong> · Streamable HTTP</p>
  <p>{payload["browser_note"]}</p>
  <p>MCP endpoint: <code>{mcp_url}</code></p>
  <p>Create an API key: <a href="{console}/dashboard/keys">RuleCloud console → API Keys</a></p>
  <h2>Cursor <code>.cursor/mcp.json</code></h2>
  <pre>{snippet}</pre>
  <p>Or run <code>npx rulecloud init</code> in your repo to wire MCP automatically.</p>
  <p><a href="{console}/docs">Full docs</a></p>
</body>
</html>"""
        return HTMLResponse(html)
    return JSONResponse(payload)


@app.get("/health")
def health() -> dict[str, Any]:
    ok, detail = guardrail_available()
    status = "ok" if ok else "degraded"
    out: dict[str, Any] = {
        "status": status,
        "guardrail": {"available": ok, "detail": detail},
    }
    if github_app_configured():
        gh = check_github_app()
        out["github_app"] = {
            "configured": True,
            "ok": bool(gh.get("ok")),
            "error": None if gh.get("ok") else gh.get("error"),
            "app_slug": gh.get("app_slug"),
        }
    else:
        out["github_app"] = {"configured": False}
    return out


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
            success_url=f"{base}/dashboard/billing?billing=success",
            cancel_url=f"{base}/dashboard/billing?billing=canceled",
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
            return_url=f"{base}/dashboard/billing?billing=portal",
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
    workspace_id = _workspace_for_user(user)
    if not llm_configured(workspace_id):
        raise HTTPException(status_code=503, detail="AI Copilot is not configured")
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
    caller: Annotated[ScanCaller, Depends(get_scan_caller)],
) -> dict[str, str]:
    if caller.mode == "anonymous":
        raise HTTPException(status_code=401, detail="API key or sign-in required")
    workspace_id = caller.workspace_id
    if not workspace_id:
        raise HTTPException(status_code=400, detail="Workspace not resolved")
    if not llm_configured(workspace_id):
        raise HTTPException(status_code=503, detail="AI Copilot is not configured")
    plan = (caller.plan or jobs.get_workspace_plan(workspace_id)).strip().lower()
    if plan != "pro":
        raise HTTPException(status_code=402, detail=AUTOFIX_PRO_DETAIL)
    try:
        return autofix_violation(
            code=body.code,
            violation=body.violation,
            rules_yaml=body.rules_yaml,
            workspace_id=workspace_id,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("autofix failed")
        raise HTTPException(status_code=500, detail=format_llm_error(exc)) from exc


@app.get("/api/workspace/ai-settings")
def get_workspace_ai_settings(
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, Any]:
    if not workspace_ai_store.enabled:
        raise HTTPException(status_code=503, detail="Workspace AI settings not configured")
    workspace_id = _workspace_for_user(user)
    try:
        settings = workspace_ai_store.get_settings(workspace_id, user.user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    platform_ok = llm_configured(workspace_id)
    return {
        "llm_provider": settings.llm_provider,
        "has_api_key": settings.has_api_key,
        "platform_llm_configured": platform_ok,
        "allowed_providers": ["openai", "gemini", "anthropic"],
    }


@app.patch("/api/workspace/ai-settings")
def patch_workspace_ai_settings(
    body: WorkspaceAiPatch,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, Any]:
    if not workspace_ai_store.enabled:
        raise HTTPException(status_code=503, detail="Workspace AI settings not configured")
    workspace_id = _workspace_for_user(user)
    plan = jobs.get_workspace_plan(workspace_id).strip().lower()
    if plan != "pro":
        raise HTTPException(status_code=402, detail="AI Engine BYOK is available on Pro")
    try:
        settings = workspace_ai_store.update_settings(
            workspace_id,
            user.user_id,
            llm_provider=body.llm_provider,
            llm_api_key=body.llm_api_key,
            clear_api_key=body.clear_api_key,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "llm_provider": settings.llm_provider,
        "has_api_key": settings.has_api_key,
    }


@app.post("/api/workspace/ai-settings/test")
def test_workspace_ai_settings(
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, str]:
    workspace_id = _workspace_for_user(user)
    plan = jobs.get_workspace_plan(workspace_id).strip().lower()
    if plan != "pro":
        raise HTTPException(status_code=402, detail="AI Engine BYOK is available on Pro")
    if not llm_configured(workspace_id):
        raise HTTPException(status_code=503, detail="AI Copilot is not configured")
    try:
        return test_llm_connection(workspace_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("AI connection test failed")
        raise HTTPException(status_code=502, detail=str(exc)) from exc


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


def _rulespack_to_dict(pack: Any) -> dict[str, Any]:
    return {
        "id": pack.id,
        "workspace_id": pack.workspace_id,
        "slug": pack.slug,
        "name": pack.name,
        "description": pack.description,
        "rules_yaml": pack.rules_yaml,
        "enabled": pack.enabled,
        "updated_at": pack.updated_at,
    }


@app.get("/api/rulespacks")
def list_rulespacks(
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, Any]:
    if not rulespack_store.enabled:
        raise HTTPException(status_code=503, detail="Rulespacks not configured")
    workspace_id = _workspace_for_user(user)
    try:
        packs = rulespack_store.list_for_workspace(
            workspace_id, user.user_id, seed_if_empty=True
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    bundle, etag = rulespack_store.bundle_for_workspace(workspace_id)
    return {
        "packs": [_rulespack_to_dict(p) for p in packs],
        "bundle_etag": etag,
        "synced_channels": ["cli", "mcp", "github_pr"],
    }


@app.post("/api/rulespacks")
def create_rulespack(
    body: RulespackCreateRequest,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, Any]:
    if not rulespack_store.enabled:
        raise HTTPException(status_code=503, detail="Rulespacks not configured")
    workspace_id = _workspace_for_user(user)
    try:
        pack = rulespack_store.create(
            workspace_id=workspace_id,
            owner_id=user.user_id,
            slug=body.slug,
            name=body.name,
            description=body.description,
            rules_yaml=body.rules_yaml,
            enabled=body.enabled,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("create rulespack failed")
        raise HTTPException(status_code=500, detail="Could not create rulespack") from exc
    return {"pack": _rulespack_to_dict(pack)}


@app.patch("/api/rulespacks/{pack_id}")
def patch_rulespack(
    pack_id: str,
    body: RulespackPatchRequest,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, Any]:
    if not rulespack_store.enabled:
        raise HTTPException(status_code=503, detail="Rulespacks not configured")
    if all(
        v is None
        for v in (body.rules_yaml, body.enabled, body.name, body.description)
    ):
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        pack = rulespack_store.update(
            pack_id,
            user.user_id,
            rules_yaml=body.rules_yaml,
            enabled=body.enabled,
            name=body.name,
            description=body.description,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not pack:
        raise HTTPException(status_code=404, detail="Rulespack not found")
    return {"pack": _rulespack_to_dict(pack)}


@app.delete("/api/rulespacks/{pack_id}")
def delete_rulespack(
    pack_id: str,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, bool]:
    if not rulespack_store.enabled:
        raise HTTPException(status_code=503, detail="Rulespacks not configured")
    try:
        ok = rulespack_store.delete(pack_id, user.user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(status_code=404, detail="Rulespack not found")
    return {"deleted": True}


@app.get("/api/rulespacks/bundle")
def rulespack_bundle(
    caller: Annotated[ScanCaller, Depends(get_scan_caller)],
    if_none_match: Annotated[Optional[str], Header()] = None,
) -> Any:
    from fastapi.responses import JSONResponse, Response

    if caller.mode == "anonymous":
        raise HTTPException(status_code=401, detail="API key or sign-in required")
    workspace_id = caller.workspace_id
    if not workspace_id:
        raise HTTPException(status_code=400, detail="Workspace not resolved")

    if not rulespack_store.enabled:
        from defaults import DEFAULT_RULES_YAML
        from rulespacks import bundle_etag

        etag = bundle_etag(DEFAULT_RULES_YAML)
        if if_none_match and if_none_match.strip('"') == etag:
            return Response(status_code=304)
        return JSONResponse(
            {"rules_yaml": DEFAULT_RULES_YAML, "etag": etag},
            headers={"ETag": f'"{etag}"'},
        )

    rulespack_store.seed_starter_packs_if_empty(workspace_id)

    bundle, etag = rulespack_store.bundle_for_workspace(workspace_id)
    if if_none_match and if_none_match.strip('"') == etag:
        return Response(status_code=304)
    return JSONResponse(
        {"rules_yaml": bundle, "etag": etag},
        headers={"ETag": f'"{etag}"'},
    )


@app.post("/api/watch/events", status_code=202)
def watch_event(
    body: WatchEventRequest,
    caller: Annotated[ScanCaller, Depends(get_scan_caller)],
) -> dict[str, Any]:
    if caller.mode == "anonymous":
        raise HTTPException(status_code=401, detail="X-API-Key required")
    workspace_id = caller.workspace_id
    if not workspace_id:
        raise HTTPException(status_code=400, detail="Workspace not resolved")
    _guard_quota(workspace_id)

    violations = len(body.findings)
    status = "pass" if violations == 0 else "violations"
    user_id = caller.user.user_id if caller.user else None
    bundle, _ = (
        rulespack_store.bundle_for_workspace(workspace_id)
        if rulespack_store.enabled
        else (DEFAULT_RULES_YAML, "")
    )

    record = jobs.create(
        {
            "watch_file": body.file,
            "repo_label": body.repo_label,
            "source": "cli_watch",
        },
        user_id=user_id,
        workspace_id=workspace_id,
        source_type="cli_watch",
        rules_yaml=bundle,
    )
    jobs.mark_running(record.job_id)
    result = {
        "status": status,
        "exit_code": 1 if status == "violations" else 0,
        "findings": body.findings,
        "duration_ms": body.duration_ms,
        "stdout": "",
        "stderr": "",
    }
    jobs.complete(record.job_id, result)
    return {"job_id": record.job_id, "accepted": True}


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
    elif record.workspace_id:
        if user is None:
            raise HTTPException(status_code=401, detail="Sign in to view this scan")
        ws = jobs.resolve_workspace_id(user.user_id)
        if not ws or ws != record.workspace_id:
            raise HTTPException(status_code=403, detail="Not allowed to view this job")
    return record.to_dict()


@app.get("/api/integrations/github")
def list_github_integrations(
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, Any]:
    if not github_store.enabled:
        raise HTTPException(status_code=503, detail="GitHub integrations not configured")
    workspace_id = _workspace_for_user(user)
    rows = github_store.list_for_workspace(workspace_id, user.user_id)
    backend = (os.getenv("BACKEND_URL") or "").strip().rstrip("/") or api_public_base()
    return {
        "repos": [
            {
                "id": r.id,
                "repo_full_name": r.repo_full_name,
                "webhook_url": f"{backend}/api/webhook/github",
                "webhook_secret": r.webhook_secret,
                "has_token": r.has_token,
                "auto_fix_comments": r.auto_fix_comments,
                "created_at": r.created_at,
            }
            for r in rows
        ]
    }


def api_public_base() -> str:
    return (os.getenv("BACKEND_URL") or "http://localhost:8000").strip().rstrip("/")


@app.post("/api/integrations/github")
def connect_github_repo(
    body: GitHubConnectRequest,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, Any]:
    if not github_store.enabled:
        raise HTTPException(status_code=503, detail="GitHub integrations not configured")
    workspace_id = _workspace_for_user(user)
    try:
        return github_store.create(
            workspace_id=workspace_id,
            owner_id=user.user_id,
            repo_full_name=body.repo_full_name,
            github_token=body.github_token,
            auto_fix_comments=body.auto_fix_comments,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("connect_github_repo failed")
        raise HTTPException(status_code=500, detail="Could not save connection") from exc


@app.patch("/api/integrations/github/{connection_id}")
def patch_github_connection(
    connection_id: str,
    body: GitHubConnectionPatch,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, Any]:
    if not github_store.enabled:
        raise HTTPException(status_code=503, detail="GitHub integrations not configured")
    if body.auto_fix_comments is None and not body.github_token:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        ok = github_store.update_connection(
            connection_id,
            user.user_id,
            github_token=body.github_token,
            auto_fix_comments=body.auto_fix_comments,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(status_code=404, detail="Connection not found")
    return {
        "updated": True,
        "auto_fix_comments": body.auto_fix_comments,
        "token_updated": bool(body.github_token and body.github_token.strip()),
    }


@app.get("/api/integrations/github-app/install-url")
def github_app_install_url(
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, Any]:
    workspace_id = _workspace_for_user(user)
    if not github_app_configured():
        return {"configured": False}
    url = install_url_for_workspace(workspace_id)
    check = check_github_app()
    if github_app_store.enabled:
        github_app_store.record_link_intent(workspace_id, user.user_id)
    return {
        "configured": True,
        "url": url,
        "workspace_id": workspace_id,
        "github_ok": bool(check.get("ok")),
        "github_error": None if check.get("ok") else check.get("error"),
        "app_slug": check.get("app_slug"),
        "app_name": check.get("app_name"),
    }


@app.get("/api/integrations/github-app/unlinked")
def list_unlinked_github_installations(
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, Any]:
    """Installations on GitHub not yet linked to any RuleCloud workspace."""
    del user
    if not github_app_configured():
        raise HTTPException(status_code=503, detail="GitHub App is not configured on the server")
    if not github_app_store.enabled:
        raise HTTPException(status_code=503, detail="GitHub integrations not configured")
    try:
        remote = list_app_installations()
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    unlinked: list[dict[str, Any]] = []
    for item in remote:
        raw_id = item.get("id")
        if raw_id is None:
            continue
        installation_id = int(raw_id)
        if github_app_store.get_by_installation_id(installation_id):
            continue
        account = item.get("account") or {}
        unlinked.append(
            {
                "installation_id": installation_id,
                "account_login": str(account.get("login") or "unknown"),
                "account_type": str(account.get("type") or "User"),
            }
        )
    return {"installations": unlinked}


@app.get("/api/integrations/github-app/status")
def github_app_status(
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, Any]:
    del user  # auth gate only
    result = check_github_app()
    if not result.get("ok"):
        raise HTTPException(
            status_code=503,
            detail=str(result.get("error") or "GitHub App check failed"),
        )
    return {
        "ok": True,
        "app_slug": result.get("app_slug"),
        "app_name": result.get("app_name"),
    }


@app.post("/api/integrations/github-app/callback")
def github_app_callback(
    body: GitHubAppCallbackRequest,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, Any]:
    if not github_app_configured():
        raise HTTPException(status_code=503, detail="GitHub App is not configured on the server")
    if not github_app_store.enabled:
        raise HTTPException(status_code=503, detail="GitHub integrations not configured")
    workspace_id = _workspace_for_user(user)
    try:
        meta = get_installation(body.installation_id)
    except RuntimeError as exc:
        logger.error(
            "verify installation %s failed: %s",
            body.installation_id,
            exc,
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("verify installation %s unexpected error", body.installation_id)
        raise HTTPException(
            status_code=502,
            detail=f"{type(exc).__name__}: {exc}",
        ) from exc
    account = meta.get("account") or {}
    login = str(account.get("login") or "unknown")
    account_type = str(account.get("type") or "User")
    try:
        row = github_app_store.upsert(
            workspace_id=workspace_id,
            owner_id=user.user_id,
            installation_id=body.installation_id,
            account_login=login,
            account_type=account_type,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except RuntimeError as exc:
        logger.exception("upsert installation %s", body.installation_id)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("upsert installation %s", body.installation_id)
        raise HTTPException(
            status_code=502,
            detail=f"Could not save installation: {type(exc).__name__}: {exc}",
        ) from exc
    github_app_store.clear_link_intent(workspace_id)
    try:
        repos = list_installation_repos(body.installation_id)
    except Exception:  # noqa: BLE001
        logger.exception("list repos for installation %s", body.installation_id)
        repos = []
    return {
        "installation_id": row.installation_id,
        "account_login": row.account_login,
        "account_type": row.account_type,
        "repo_count": len(repos),
        "repositories": [
            {
                "full_name": r.get("full_name"),
                "private": r.get("private"),
            }
            for r in repos[:50]
        ],
    }


@app.get("/api/integrations/github-app/installations")
def list_github_app_installations(
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, Any]:
    if not github_app_store.enabled:
        raise HTTPException(status_code=503, detail="GitHub integrations not configured")
    workspace_id = _workspace_for_user(user)
    rows = github_app_store.list_for_workspace(workspace_id, user.user_id)
    slug = (os.getenv("GITHUB_APP_SLUG") or "rulecloud-guardrail").strip()
    configure_url = f"https://github.com/apps/{slug}/installations/new"
    installations: list[dict[str, Any]] = []
    for row in rows:
        repo_count = 0
        if github_app_configured():
            try:
                repo_count = len(list_installation_repos(row.installation_id))
            except Exception:  # noqa: BLE001
                logger.exception("repo count for installation %s", row.installation_id)
        installations.append(
            {
                "id": row.id,
                "installation_id": row.installation_id,
                "account_login": row.account_login,
                "account_type": row.account_type,
                "auto_fix_comments": row.auto_fix_comments,
                "repo_count": repo_count,
                "avatar_url": f"https://github.com/{row.account_login}.png",
                "configure_url": configure_url,
                "created_at": row.created_at,
            }
        )
    return {
        "configured": github_app_configured(),
        "installations": installations,
    }


@app.patch("/api/integrations/github-app/installations/{installation_id}")
def patch_github_app_installation(
    installation_id: int,
    body: GitHubAppAutoFixPatch,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, bool]:
    if not github_app_store.enabled:
        raise HTTPException(status_code=503, detail="GitHub integrations not configured")
    try:
        ok = github_app_store.update_auto_fix(
            installation_id, user.user_id, body.auto_fix_comments
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(status_code=404, detail="Installation not found")
    return {"updated": True, "auto_fix_comments": body.auto_fix_comments}


@app.delete("/api/integrations/github-app/installations/{installation_id}")
def unlink_github_app_installation(
    installation_id: int,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, bool]:
    if not github_app_store.enabled:
        raise HTTPException(status_code=503, detail="GitHub integrations not configured")
    try:
        ok = github_app_store.unlink(installation_id, user.user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(status_code=404, detail="Installation not found")
    return {"unlinked": True}


@app.delete("/api/integrations/github/{connection_id}")
def disconnect_github_repo(
    connection_id: str,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, bool]:
    if not github_store.enabled:
        raise HTTPException(status_code=503, detail="GitHub integrations not configured")
    try:
        ok = github_store.delete(connection_id, user.user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(status_code=404, detail="Connection not found")
    return {"disconnected": True}


@app.post("/api/webhook/github")
async def github_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    x_hub_signature_256: Optional[str] = Header(default=None),
    x_github_event: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    raw = await request.body()
    fallback = os.getenv("GITHUB_WEBHOOK_SECRET", "")
    app_webhook_secret = (os.getenv("GITHUB_APP_WEBHOOK_SECRET") or "").strip()

    try:
        payload = parse_github_webhook_body(
            raw, request.headers.get("content-type")
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid GitHub webhook payload — set Content type to "
                "application/json, or send JSON in payload= for form encoding."
            ),
        ) from exc

    event_name = x_github_event or "unknown"
    repo_full_name = (payload.get("repository") or {}).get("full_name") or ""

    verified_app = bool(
        app_webhook_secret
        and verify_github_signature(raw, x_hub_signature_256, app_webhook_secret)
    )
    connection = None
    verified = verified_app

    if event_name == "installation":
        if not verified_app:
            raise HTTPException(status_code=401, detail="Invalid signature")
        action = payload.get("action", "")
        if action == "deleted":
            inst = (payload.get("installation") or {}).get("id")
            if inst is not None:
                github_app_store.delete_by_installation_id(int(inst))
        elif action in ("created", "new_permissions_accepted"):
            _try_auto_link_github_installation(payload)
        return {"accepted": True, "event": event_name, "action": action}

    if not verified:
        connections = (
            github_store.get_connection_for_webhook(repo_full_name) if repo_full_name else []
        )
        verified, connection = resolve_webhook_connection(
            raw, x_hub_signature_256, connections, fallback
        )
    if not verified:
        raise HTTPException(status_code=401, detail="Invalid signature")

    if verified_app and connection is None:
        connection = connection_from_github_app(payload, github_app_store)
    elif connection is None and repo_full_name:
        legacy = github_store.get_connection_for_webhook(repo_full_name)
        connection = legacy[0] if legacy else None

    if not should_trigger_scan(event_name, payload):
        return {"accepted": False, "reason": f"ignored event {event_name}"}

    if connection is None:
        logger.info(
            "github_webhook_no_connection",
            extra={"event": event_name, "repo": repo_full_name},
        )
        return {
            "accepted": False,
            "reason": "no linked workspace for this repository",
        }

    background_tasks.add_task(
        process_github_event,
        jobs=jobs,
        event_name=event_name,
        payload=payload,
        connection=connection,
    )
    logger.info(
        "github_webhook_accepted",
        extra={
            "event": event_name,
            "repo": repo_full_name,
            "connected": bool(connection),
            "github_app": verified_app,
        },
    )
    return {"accepted": True, "event": event_name, "repo": repo_full_name}


app.mount("/mcp", _mcp_asgi)