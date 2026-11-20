"""Inline PR review comments for RuleCloud guardrail findings."""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

from ai_copilot import autofix_violation, llm_configured
from github_api import GitHubClient, inline_comment_marker, parse_inline_markers
from github_diff import build_pr_diff_line_map
logger = logging.getLogger(__name__)


def _severity_rank(sev: Optional[str]) -> int:
    s = (sev or "").lower()
    if "crit" in s or "error" in s or "high" in s:
        return 0
    if "warn" in s or "med" in s:
        return 1
    return 2

INLINE_LIMIT = 5


def _severity_badge(sev: Optional[str]) -> str:
    s = (sev or "warning").lower()
    if "crit" in s or "high" in s:
        return "🔴 **HIGH**"
    if "warn" in s or "med" in s:
        return "🟡 **MEDIUM**"
    if "low" in s:
        return "🔵 **LOW**"
    return "⚪ **INFO**"


def _build_inline_body(
    finding: dict[str, Any],
    *,
    suggestion_text: Optional[str] = None,
) -> str:
    rule_id = str(finding.get("id") or "rule")
    msg = finding.get("message") or "Guardrail violation"
    sev = _severity_badge(str(finding.get("severity")))
    snippet = (finding.get("snippet") or "").strip()
    parts = [
        inline_comment_marker(rule_id),
        f"{sev} · `{rule_id}`",
        "",
        str(msg),
    ]
    if snippet:
        parts.extend(["", f"```\n{snippet[:400]}\n```"])
    if suggestion_text and suggestion_text.strip():
        parts.extend(["", "```suggestion", suggestion_text.strip(), "```"])
    return "\n".join(parts)


def _suggestion_for_finding(
    finding: dict[str, Any],
    files: dict[str, str],
    rules_yaml: str,
    *,
    workspace_id: Optional[str] = None,
) -> Optional[str]:
    if not llm_configured(workspace_id):
        return None
    file_path = str(finding.get("file") or "")
    code = files.get(file_path) or files.get(file_path.lstrip("./"))
    if not code:
        return None
    try:
        fix = autofix_violation(
            code=code,
            violation=finding,
            rules_yaml=rules_yaml,
            workspace_id=workspace_id,
        )
    except Exception:  # noqa: BLE001
        logger.exception("inline autofix skipped for %s", file_path)
        return None
    suggestion = (fix.get("suggestion_lines") or "").strip()
    if suggestion:
        return suggestion
    patched = (fix.get("patched_code") or "").strip()
    if not patched:
        return None
    line_no = int(finding.get("line") or 0)
    if line_no <= 0:
        return None
    patched_lines = patched.splitlines()
    if line_no <= len(patched_lines):
        return patched_lines[line_no - 1]
    return None


def post_inline_review_comments(
    gh: GitHubClient,
    *,
    owner: str,
    repo: str,
    pr_number: int,
    head_sha: str,
    findings: list[dict[str, Any]],
    pr_files_meta: list[dict[str, Any]],
    file_contents: dict[str, str],
    rules_yaml: str,
    auto_fix: bool,
    plan_pro: bool,
    workspace_id: Optional[str] = None,
) -> None:
    if not findings or not gh.has_token():
        return

    diff_map = build_pr_diff_line_map(pr_files_meta)
    existing = gh.list_pull_review_comments(owner, repo, pr_number)
    posted = parse_inline_markers(existing)

    ranked = sorted(findings, key=lambda f: _severity_rank(str(f.get("severity"))))
    comments: list[dict[str, Any]] = []

    for finding in ranked:
        if len(comments) >= INLINE_LIMIT:
            break
        path = str(finding.get("file") or "")
        line = int(finding.get("line") or 0)
        rule_id = str(finding.get("id") or "")
        if not path or line <= 0 or not rule_id:
            continue
        valid = diff_map.get(path) or set()
        if line not in valid:
            logger.debug("skip inline %s:%s — not in PR diff", path, line)
            continue
        if (path, line, rule_id) in posted:
            continue

        suggestion: Optional[str] = None
        if plan_pro and auto_fix:
            suggestion = _suggestion_for_finding(
                finding, file_contents, rules_yaml, workspace_id=workspace_id
            )

        comments.append(
            {
                "path": path,
                "line": line,
                "side": "RIGHT",
                "body": _build_inline_body(finding, suggestion_text=suggestion),
            }
        )

    if not comments:
        return

    try:
        gh.create_pull_request_review(
            owner,
            repo,
            pr_number,
            commit_id=head_sha,
            event="COMMENT",
            comments=comments,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("inline PR review failed (non-fatal): %s", exc)