"""RuleCloud MCP server (Streamable HTTP) for AI IDEs."""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastmcp import FastMCP
from fastmcp.server.dependencies import get_http_headers

from ai_copilot import AUTOFIX_PRO_DETAIL, autofix_violation, generate_rules_yaml, llm_configured
from api_keys import KEY_PREFIX, ApiKeyContext, ApiKeyStore
from defaults import DEFAULT_RULES_YAML
from job_store import JobStore
from quota import workspace_quota_blocked
from scan_runner import run_scan

logger = logging.getLogger(__name__)


def _header_lookup(headers: dict[str, str], name: str) -> str:
    lower = name.lower()
    for key, value in headers.items():
        if key.lower() == lower:
            return (value or "").strip()
    return ""


def _extract_api_key(headers: dict[str, str]) -> Optional[str]:
    raw = _header_lookup(headers, "x-api-key")
    if raw:
        return raw
    auth = _header_lookup(headers, "authorization")
    if auth.lower().startswith("bearer "):
        token = auth.split(" ", 1)[1].strip()
        if token.startswith(KEY_PREFIX):
            return token
    return None


def _authenticate(api_keys: ApiKeyStore) -> tuple[Optional[ApiKeyContext], Optional[str]]:
    try:
        headers = get_http_headers(include_all=True)
    except RuntimeError:
        return None, "MCP auth failed: no HTTP request context (use Streamable HTTP transport)."
    raw_key = _extract_api_key(headers)
    if not raw_key:
        return (
            None,
            "Missing API key. Send header X-API-Key: rc_live_... or "
            "Authorization: Bearer rc_live_...",
        )
    if not api_keys.enabled:
        return None, "API keys are not configured on this server."
    ctx = api_keys.authenticate(raw_key)
    if not ctx:
        return None, "Invalid or revoked API key."
    return ctx, None


def _violations_from_findings(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    violations: list[dict[str, Any]] = []
    for item in findings:
        violations.append(
            {
                "rule_id": item.get("rule_id") or item.get("id"),
                "message": item.get("message") or item.get("description"),
                "file": item.get("file") or item.get("path"),
                "line": item.get("line") or item.get("start_line"),
                "severity": item.get("severity"),
            }
        )
    return violations


def create_mcp_server(*, jobs: JobStore, api_keys: ApiKeyStore) -> FastMCP:
    mcp = FastMCP("RuleCloud Guardrails")

    @mcp.tool
    def scan_code(
        code: str,
        filename: str,
        rules_yaml: str = "",
    ) -> dict[str, Any]:
        """Scan inline source with hybrid Guardrail + Python rules; counts toward monthly quota."""
        ctx, err = _authenticate(api_keys)
        if err:
            return {"error": err}
        assert ctx is not None
        blocked = workspace_quota_blocked(jobs, ctx.workspace_id)
        if blocked:
            return {"error": blocked}

        rules = (rules_yaml or "").strip() or DEFAULT_RULES_YAML
        record = jobs.create(
            {
                "code_snippet": code,
                "filename": filename,
                "rules_yaml": rules,
            },
            workspace_id=ctx.workspace_id,
            source_type="mcp",
            rules_yaml=rules,
        )
        jobs.mark_running(record.job_id)
        try:
            result = run_scan(code_snippet=code, filename=filename, rules_yaml=rules)
            payload = result.to_dict()
            jobs.complete(record.job_id, payload)
        except Exception as exc:  # noqa: BLE001
            logger.exception("MCP scan_code failed job %s", record.job_id)
            jobs.fail(record.job_id, str(exc))
            return {"error": str(exc), "job_id": record.job_id}

        findings = payload.get("findings") or []
        violations = _violations_from_findings(findings)
        passed = result.status == "pass" and len(violations) == 0
        return {
            "job_id": record.job_id,
            "passed": passed,
            "violation_count": len(violations),
            "violations": violations,
            "status": payload.get("status"),
            "duration_ms": payload.get("duration_ms"),
        }

    @mcp.tool
    def get_default_rules() -> dict[str, str]:
        """Return the canonical starter guardrail.yaml schema and example rules."""
        _, err = _authenticate(api_keys)
        if err:
            return {"error": err}
        return {"rules_yaml": DEFAULT_RULES_YAML}

    @mcp.tool
    def generate_guardrail_rules(description: str) -> dict[str, str]:
        """Compile plain-English policy into valid guardrail.yaml (uses AI Copilot)."""
        ctx, err = _authenticate(api_keys)
        if err:
            return {"error": err}
        assert ctx is not None
        if not llm_configured():
            return {"error": "AI Copilot is not configured on this server (LLM_API_KEY)."}
        try:
            from fastapi import HTTPException

            return generate_rules_yaml(
                description,
                workspace_id=ctx.workspace_id,
                plan=ctx.plan,
            )
        except HTTPException as exc:
            return {"error": str(exc.detail)}
        except Exception as exc:  # noqa: BLE001
            logger.exception("MCP generate_guardrail_rules failed")
            return {"error": str(exc)}

    @mcp.tool
    def suggest_fix(
        code: str,
        rule_id: str,
        violation_message: str,
        line: int,
    ) -> dict[str, str]:
        """Pro: minimal patch for a violation (Free plan returns upgrade prompt)."""
        ctx, err = _authenticate(api_keys)
        if err:
            return {"error": err}
        assert ctx is not None
        if (ctx.plan or "free").strip().lower() != "pro":
            return {"error": AUTOFIX_PRO_DETAIL}
        if not llm_configured():
            return {"error": "AI Copilot is not configured on this server (LLM_API_KEY)."}
        violation: dict[str, Any] = {
            "rule_id": rule_id,
            "message": violation_message,
            "line": line,
        }
        try:
            return autofix_violation(
                code=code,
                violation=violation,
                rules_yaml=DEFAULT_RULES_YAML,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("MCP suggest_fix failed")
            return {"error": str(exc)}

    return mcp