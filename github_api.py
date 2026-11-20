"""GitHub REST API helpers for PR bot."""

from __future__ import annotations

import base64
import logging
import re
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

API = "https://api.github.com"
STATUS_CONTEXT = "RuleCloud Guardrail"
INLINE_MARKER_PREFIX = "rulecloud-inline:"

_REPORT_VIOLATIONS_RE = re.compile(
    r"\|\s*\*\*Violations\*\*\s*\|\s*(\d+)\s*\|",
    re.IGNORECASE,
)


def parse_previous_violation_count(report_body: str) -> Optional[int]:
    match = _REPORT_VIOLATIONS_RE.search(report_body or "")
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def inline_comment_marker(rule_id: str) -> str:
    return f"<!-- {INLINE_MARKER_PREFIX}{rule_id} -->"


def parse_inline_markers(
    comments: list[dict[str, Any]],
) -> set[tuple[str, int, str]]:
    """Return set of (path, line, rule_id) from existing review comments."""
    out: set[tuple[str, int, str]] = set()
    for comment in comments:
        body = comment.get("body") or ""
        path = comment.get("path") or ""
        line = int(comment.get("line") or comment.get("original_line") or 0)
        if INLINE_MARKER_PREFIX not in body:
            continue
        match = re.search(rf"<!-- {re.escape(INLINE_MARKER_PREFIX)}([^>]+) -->", body)
        if match and path and line:
            out.add((path, line, match.group(1).strip()))
    return out


class GitHubClient:
    def __init__(self, token: Optional[str]) -> None:
        self._token = token

    def has_token(self) -> bool:
        return bool(self._token)

    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        return headers

    def set_commit_status(
        self,
        owner: str,
        repo: str,
        sha: str,
        *,
        state: str,
        description: str,
        target_url: Optional[str] = None,
    ) -> None:
        if not self._token:
            logger.warning("No GitHub token; skipping commit status")
            return
        url = f"{API}/repos/{owner}/{repo}/statuses/{sha}"
        body: dict[str, Any] = {
            "state": state,
            "description": description[:140],
            "context": STATUS_CONTEXT,
        }
        if target_url:
            body["target_url"] = target_url
        with httpx.Client(timeout=30.0) as client:
            res = client.post(url, headers=self._headers(), json=body)
            if res.status_code >= 400:
                logger.error("commit status failed: %s %s", res.status_code, res.text)

    def list_pr_files(
        self, owner: str, repo: str, pr_number: int
    ) -> list[dict[str, Any]]:
        if not self._token:
            return []
        url = f"{API}/repos/{owner}/{repo}/pulls/{pr_number}/files"
        with httpx.Client(timeout=60.0) as client:
            res = client.get(url, headers=self._headers())
            res.raise_for_status()
            data = res.json()
            return data if isinstance(data, list) else []

    def fetch_raw_url(self, raw_url: str) -> Optional[str]:
        if not self._token:
            return None
        with httpx.Client(timeout=60.0) as client:
            res = client.get(raw_url, headers=self._headers())
            if res.status_code >= 400:
                return None
            text = res.text
            if text is None or not text.strip():
                return None
            return text

    def get_file_at_ref(
        self, owner: str, repo: str, path: str, ref: str
    ) -> Optional[str]:
        """Load file bytes via GitHub Contents API (reliable with fine-grained PATs)."""
        if not self._token:
            return None
        path = path.strip().lstrip("/")
        url = f"{API}/repos/{owner}/{repo}/contents/{path}"
        with httpx.Client(timeout=60.0) as client:
            res = client.get(url, headers=self._headers(), params={"ref": ref})
            if res.status_code != 200:
                return None
            payload = res.json()
            if not isinstance(payload, dict):
                return None
            enc = payload.get("content")
            if not enc:
                return None
            try:
                text = base64.b64decode(enc).decode("utf-8")
            except Exception:  # noqa: BLE001
                return None
            if not text.strip():
                return None
            return text

    def get_rules_yaml_at_ref(self, owner: str, repo: str, ref: str) -> Optional[str]:
        if not self._token:
            return None
        from guardrail_eval import RULES_FILE_CANDIDATES

        paths = RULES_FILE_CANDIDATES
        for path in paths:
            url = f"{API}/repos/{owner}/{repo}/contents/{path}"
            with httpx.Client(timeout=30.0) as client:
                res = client.get(url, headers=self._headers(), params={"ref": ref})
                if res.status_code != 200:
                    continue
                payload = res.json()
                if not isinstance(payload, dict):
                    continue
                content = payload.get("content")
                if not content:
                    continue
                try:
                    raw = base64.b64decode(content).decode("utf-8")
                    if raw.strip():
                        return raw
                except Exception:  # noqa: BLE001
                    continue
        return None

    def find_report_comment(
        self, owner: str, repo: str, pr_number: int, marker: str
    ) -> Optional[tuple[int, str]]:
        if not self._token:
            return None
        url = f"{API}/repos/{owner}/{repo}/issues/{pr_number}/comments"
        with httpx.Client(timeout=30.0) as client:
            res = client.get(url, headers=self._headers())
            if res.status_code >= 400:
                return None
            payload = res.json()
            for comment in payload if isinstance(payload, list) else []:
                if isinstance(comment, dict) and marker in (comment.get("body") or ""):
                    return int(comment["id"]), str(comment.get("body") or "")
        return None

    def find_report_comment_id(self, owner: str, repo: str, pr_number: int, marker: str) -> Optional[int]:
        found = self.find_report_comment(owner, repo, pr_number, marker)
        return found[0] if found else None

    def upsert_pr_comment(
        self,
        owner: str,
        repo: str,
        pr_number: int,
        body: str,
        marker: str,
    ) -> None:
        if not self._token:
            logger.warning("No GitHub token; skipping PR comment")
            return
        existing = self.find_report_comment_id(owner, repo, pr_number, marker)
        headers = self._headers()
        with httpx.Client(timeout=30.0) as client:
            if existing:
                url = f"{API}/repos/{owner}/{repo}/issues/comments/{existing}"
                client.patch(url, headers=headers, json={"body": body})
            else:
                url = f"{API}/repos/{owner}/{repo}/issues/{pr_number}/comments"
                client.post(url, headers=headers, json={"body": body})

    def list_pull_review_comments(
        self, owner: str, repo: str, pr_number: int
    ) -> list[dict[str, Any]]:
        if not self._token:
            return []
        url = f"{API}/repos/{owner}/{repo}/pulls/{pr_number}/comments"
        with httpx.Client(timeout=60.0) as client:
            res = client.get(url, headers=self._headers())
            if res.status_code >= 400:
                logger.warning("list review comments %s", res.status_code)
                return []
            data = res.json()
            return data if isinstance(data, list) else []

    def create_pull_request_review(
        self,
        owner: str,
        repo: str,
        pr_number: int,
        *,
        commit_id: str,
        event: str,
        comments: list[dict[str, Any]],
    ) -> None:
        if not self._token or not comments:
            return
        url = f"{API}/repos/{owner}/{repo}/pulls/{pr_number}/reviews"
        body: dict[str, Any] = {
            "commit_id": commit_id,
            "event": event,
            "comments": comments,
        }
        with httpx.Client(timeout=60.0) as client:
            res = client.post(url, headers=self._headers(), json=body)
            if res.status_code == 422:
                logger.warning(
                    "GitHub rejected inline review (422): %s — skipping inline comments",
                    res.text[:300],
                )
                return
            if res.status_code >= 400:
                logger.warning("create review failed %s %s", res.status_code, res.text[:200])