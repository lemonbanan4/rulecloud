"""GitHub webhook signature verification and event parsing."""

from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)


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


def should_trigger_scan(github_event: str, payload: dict[str, Any]) -> bool:
    if github_event == "pull_request":
        action = payload.get("action", "")
        return action in ("opened", "synchronize")
    if github_event == "push":
        return True
    return False