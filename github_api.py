"""GitHub REST API helpers for PR bot."""

from __future__ import annotations

import base64
import logging
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

API = "https://api.github.com"
STATUS_CONTEXT = "RuleCloud Guardrail"


class GitHubClient:
    def __init__(self, token: Optional[str]) -> None:
        self._token = token

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
            return res.text

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

    def find_report_comment_id(self, owner: str, repo: str, pr_number: int, marker: str) -> Optional[int]:
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
                    return int(comment["id"])
        return None

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