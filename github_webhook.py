"""GitHub webhook signature verification and event parsing."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from typing import Any, Optional
from urllib.parse import parse_qs

logger = logging.getLogger(__name__)


def parse_github_webhook_body(raw: bytes, content_type: Optional[str] = None) -> dict[str, Any]:
    """Parse JSON body from GitHub (application/json or x-www-form-urlencoded)."""
    if not raw:
        raise ValueError("empty webhook body")
    ct = (content_type or "").lower()
    text = raw.decode("utf-8")
    if "application/x-www-form-urlencoded" in ct or text.lstrip().startswith("payload="):
        payload_key = parse_qs(text, keep_blank_values=True).get("payload", [""])[0]
        if not payload_key:
            raise ValueError("missing payload= in form body")
        return json.loads(payload_key)
    return json.loads(text)


def verify_github_signature(payload: bytes, signature_header: Optional[str], secret: str) -> bool:
    if not secret:
        logger.warning("GITHUB_WEBHOOK_SECRET is not set; rejecting webhook")
        return False
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    digest = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    expected = f"sha256={digest}"
    return hmac.compare_digest(expected, signature_header)


def extract_scan_target(event: dict[str, Any]) -> Optional[dict[str, str]]:
    """Return repo clone URL and optional branch for supported GitHub events."""
    repo = event.get("repository") or {}
    clone_url = repo.get("clone_url") or repo.get("git_url")
    if not clone_url:
        return None

    if "pull_request" in event:
        pr = event["pull_request"]
        head = pr.get("head") or {}
        return {
            "repo_url": clone_url,
            "branch": head.get("ref") or "",
            "sha": head.get("sha") or "",
            "pr_number": str(pr.get("number", "")),
            "event": "pull_request",
        }

    if "ref" in event and event.get("commits") is not None:
        ref = event.get("ref", "")
        branch = ref.split("/", 2)[-1] if ref.startswith("refs/heads/") else ref
        return {
            "repo_url": clone_url,
            "branch": branch,
            "sha": (event.get("after") or ""),
            "event": "push",
        }

    return None


def resolve_webhook_connection(
    payload: bytes,
    signature_header: Optional[str],
    connections: list[Any],
    fallback_secret: str,
) -> tuple[bool, Optional[Any]]:
    """Return (verified, connection_or_none)."""
    from github_connections import GitHubConnectionInternal

    for conn in connections:
        if isinstance(conn, GitHubConnectionInternal) and verify_github_signature(
            payload, signature_header, conn.webhook_secret
        ):
            return True, conn
    if fallback_secret and verify_github_signature(payload, signature_header, fallback_secret):
        return True, None
    return False, None


def should_trigger_scan(github_event: str, payload: dict[str, Any]) -> bool:
    if github_event == "pull_request":
        action = payload.get("action", "")
        return action in ("opened", "synchronize", "reopened")
    if github_event == "push":
        return True
    return False