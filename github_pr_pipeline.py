"""GitHub pull_request webhook processing pipeline."""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Optional

from ai_copilot import autofix_violation, llm_configured
from defaults import DEFAULT_RULES_YAML
from github_api import GitHubClient, STATUS_CONTEXT
from github_connections import REPORT_MARKER, GitHubConnectionInternal
from job_store import JobStore
from quota import enforce_workspace_quota
from scan_runner import SUPPORTED_CODE_EXTENSIONS, ScanResult, run_scan_directory

logger = logging.getLogger(__name__)


def _frontend_scans_url(job_id: str) -> str:
    base = (os.getenv("FRONTEND_URL") or "http://localhost:3000").strip().rstrip("/")
    return f"{base}/dashboard/scans?job={job_id}"


def _severity_rank(sev: Optional[str]) -> int:
    s = (sev or "").lower()
    if "crit" in s or "error" in s or "high" in s:
        return 0
    if "warn" in s:
        return 1
    return 2


def _build_markdown_report(
    result: ScanResult,
    job_id: str,
    suggestions: list[str],
) -> str:
    status = result.status
    badge = "✅ Pass" if status == "pass" else "❌ Violations" if status == "violations" else "⚠️ Error"
    count = len(result.findings)
    lines = [
        REPORT_MARKER,
        f"## RuleCloud Guardrail",
        "",
        f"| | |",
        f"|---|---|",
        f"| **Status** | {badge} |",
        f"| **Violations** | {count} |",
        f"| **Duration** | {result.duration_ms} ms |",
        f"| **Report** | [Open in RuleCloud]({_frontend_scans_url(job_id)}) |",
        "",
    ]
    if result.findings:
        lines.append("| Rule | File | Severity | Message |")
        lines.append("|---|---|---|---|")
        for f in result.findings[:25]:
            rule = f.get("id") or "—"
            file_ = f.get("file") or "—"
            line = f.get("line")
            loc = f"{file_}:{line}" if line else file_
            sev = f.get("severity") or "warning"
            msg = (f.get("message") or "")[:120]
            lines.append(f"| `{rule}` | `{loc}` | {sev} | {msg} |")
        lines.append("")
    for block in suggestions:
        lines.append(block)
        lines.append("")
    if result.error:
        lines.append(f"> Scan error: {result.error}")
    return "\n".join(lines)


def _materialize_pr_files(
    files_meta: list[dict[str, Any]],
    gh: GitHubClient,
) -> dict[str, str]:
    out: dict[str, str] = {}
    for item in files_meta:
        status = item.get("status")
        if status == "removed":
            continue
        filename = item.get("filename") or ""
        if not filename or filename.endswith((".png", ".jpg", ".gif", ".pdf", ".zip")):
            continue
        ext = Path(filename).suffix.lower()
        if ext and ext not in SUPPORTED_CODE_EXTENSIONS:
            continue
        raw_url = item.get("raw_url")
        if not raw_url:
            continue
        text = gh.fetch_raw_url(raw_url)
        if text is not None:
            out[filename] = text
    return out


def _write_tree(base: Path, files: dict[str, str]) -> None:
    for name, content in files.items():
        path = base / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


def _suggestion_blocks(
    findings: list[dict[str, Any]],
    files: dict[str, str],
    rules_yaml: str,
    limit: int = 5,
) -> list[str]:
    if not llm_configured():
        return []
    ranked = sorted(findings, key=lambda f: _severity_rank(str(f.get("severity"))))
    blocks: list[str] = []
    for finding in ranked[:limit]:
        file_path = str(finding.get("file") or "")
        code = files.get(file_path) or files.get(file_path.lstrip("./"))
        if not code:
            continue
        try:
            fix = autofix_violation(
                code=code,
                violation=finding,
                rules_yaml=rules_yaml,
            )
        except Exception:  # noqa: BLE001
            logger.exception("autofix skipped for %s", file_path)
            continue
        patched = fix.get("patched_code") or ""
        explanation = fix.get("explanation") or "Suggested fix"
        # Use first changed hunk lines for suggestion if small enough
        lines = patched.strip().splitlines()
        suggestion_body = (
            patched.strip()
            if len(lines) <= 12
            else "\n".join(lines[:12]) + "\n// …"
        )
        line = finding.get("line")
        loc = f"{file_path}:{line}" if line else file_path
        blocks.append(
            f"### `{loc}` — {finding.get('id') or 'violation'}\n\n"
            f"{explanation}\n\n"
            f"```suggestion\n{suggestion_body.strip()}\n```"
        )
    return blocks


def process_pull_request(
    *,
    jobs: JobStore,
    payload: dict[str, Any],
    connection: GitHubConnectionInternal,
) -> None:
    pr = payload.get("pull_request") or {}
    repo = payload.get("repository") or {}
    full_name = repo.get("full_name") or connection.repo_full_name
    owner, repo_name = full_name.split("/", 1)
    pr_number = int(pr.get("number") or 0)
    head = pr.get("head") or {}
    sha = head.get("sha") or ""
    if not sha or not pr_number:
        logger.warning("PR webhook missing sha or number")
        return

    workspace_id = connection.workspace_id
    try:
        enforce_workspace_quota(jobs, workspace_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("quota blocked PR scan for %s: %s", workspace_id, exc)
        return

    token = connection.github_token or (os.getenv("GITHUB_TOKEN") or "").strip() or None
    gh = GitHubClient(token)
    target_url = _frontend_scans_url("pending")

    gh.set_commit_status(
        owner,
        repo_name,
        sha,
        state="pending",
        description="RuleCloud Guardrail scan running…",
        target_url=target_url,
    )

    try:
        pr_files = gh.list_pr_files(owner, repo_name, pr_number)
        rules_yaml = (
            gh.get_rules_yaml_at_ref(owner, repo_name, sha) or DEFAULT_RULES_YAML
        )

        record = jobs.create(
            {
                "repo_url": repo.get("clone_url"),
                "branch": head.get("ref"),
                "pr_number": pr_number,
                "sha": sha,
            },
            user_id=None,
            workspace_id=workspace_id,
            source_type="github_webhook",
            rules_yaml=rules_yaml,
        )
        job_id = record.job_id
        jobs.mark_running(job_id)
        file_contents = _materialize_pr_files(pr_files, gh)
        if not file_contents:
            result = ScanResult(
                status="pass",
                exit_code=0,
                findings=[],
                duration_ms=0,
                stdout="",
                stderr="",
            )
        else:
            with tempfile.TemporaryDirectory(prefix="rulecloud-pr-") as tmp:
                root = Path(tmp)
                _write_tree(root, file_contents)
                result = run_scan_directory(root, rules_yaml)

        jobs.complete(job_id, result.to_dict())

        plan = jobs.get_workspace_plan(workspace_id).lower()
        suggestions: list[str] = []
        if (
            plan == "pro"
            and connection.auto_fix_comments
            and result.findings
        ):
            suggestions = _suggestion_blocks(
                result.findings, file_contents, rules_yaml, limit=5
            )

        body = _build_markdown_report(result, job_id, suggestions)
        gh.upsert_pr_comment(owner, repo_name, pr_number, body, REPORT_MARKER)

        scan_url = _frontend_scans_url(job_id)
        if result.status == "pass":
            gh.set_commit_status(
                owner,
                repo_name,
                sha,
                state="success",
                description="No Guardrail violations",
                target_url=scan_url,
            )
        elif result.status == "violations":
            gh.set_commit_status(
                owner,
                repo_name,
                sha,
                state="failure",
                description=f"{len(result.findings)} violation(s) found",
                target_url=scan_url,
            )
        else:
            gh.set_commit_status(
                owner,
                repo_name,
                sha,
                state="error",
                description=result.error or "Scan error",
                target_url=scan_url,
            )
        logger.info(
            "github_pr_scan_done",
            extra={"job_id": job_id, "repo": full_name, "status": result.status},
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("PR pipeline failed for %s", full_name)
        jobs.fail(job_id, str(exc))
        gh.set_commit_status(
            owner,
            repo_name,
            sha,
            state="error",
            description="RuleCloud scan failed",
            target_url=_frontend_scans_url(job_id),
        )


def process_github_event(
    *,
    jobs: JobStore,
    event_name: str,
    payload: dict[str, Any],
    connection: Optional[GitHubConnectionInternal],
) -> None:
    if event_name == "pull_request" and connection:
        process_pull_request(jobs=jobs, payload=payload, connection=connection)
        return

    # Legacy push / unconnected: shallow clone scan (existing behavior)
    from github_webhook import extract_scan_target
    from scan_runner import run_scan

    target = extract_scan_target(payload)
    if not target:
        return
    workspace_id = connection.workspace_id if connection else None
    if workspace_id:
        try:
            enforce_workspace_quota(jobs, workspace_id)
        except Exception:  # noqa: BLE001
            return
    record = jobs.create(
        {"repo_url": target["repo_url"], "branch": target.get("branch")},
        workspace_id=workspace_id,
        source_type="github_webhook",
    )
    jobs.mark_running(record.job_id)
    result = run_scan(
        repo_url=target["repo_url"],
        branch=target.get("branch") or None,
    )
    if result.status == "error" and result.error:
        jobs.fail(record.job_id, result.error)
    else:
        jobs.complete(record.job_id, result.to_dict())