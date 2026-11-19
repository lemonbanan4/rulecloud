"""GitHub App JWT and installation access tokens."""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any, Optional

import httpx
import jwt

logger = logging.getLogger(__name__)

GITHUB_API = "https://api.github.com"
_TOKEN_CACHE: dict[int, tuple[str, float]] = {}
_CACHE_LOCK = threading.Lock()
_TOKEN_TTL_SEC = 50 * 60


def _app_id() -> str:
    return (os.getenv("GITHUB_APP_ID") or "").strip()


def _normalize_app_slug(raw: str) -> str:
    """Slug only (rulecloud-guardrail), not a full github.com/apps/... URL."""
    slug = raw.strip().rstrip("/")
    prefix = "https://github.com/apps/"
    if slug.startswith(prefix):
        slug = slug[len(prefix) :]
    if slug.startswith("http://") or slug.startswith("https://"):
        slug = slug.rsplit("/", 1)[-1]
    return slug or "rulecloud-guardrail"


def _app_slug() -> str:
    return _normalize_app_slug(os.getenv("GITHUB_APP_SLUG") or "rulecloud-guardrail")


def _app_private_key() -> str:
    raw = (os.getenv("GITHUB_APP_PRIVATE_KEY") or "").strip()
    if not raw:
        return ""
    if "\\n" in raw:
        raw = raw.replace("\\n", "\n")
    return raw


def github_app_configured() -> bool:
    return bool(_app_id() and _app_private_key())


def generate_app_jwt() -> str:
    app_id = _app_id()
    key = _app_private_key()
    if not app_id or not key:
        raise RuntimeError("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set")
    now = int(time.time())
    payload = {
        "iat": now - 60,
        "exp": now + 540,
        "iss": app_id,
    }
    return jwt.encode(payload, key, algorithm="RS256")


def get_installation_token(installation_id: int) -> str:
    if installation_id <= 0:
        raise ValueError("invalid installation_id")
    now = time.time()
    with _CACHE_LOCK:
        cached = _TOKEN_CACHE.get(installation_id)
        if cached and cached[1] > now:
            return cached[0]

    app_jwt = generate_app_jwt()
    url = f"{GITHUB_API}/app/installations/{installation_id}/access_tokens"
    with httpx.Client(timeout=30.0) as client:
        res = client.post(
            url,
            headers={
                "Authorization": f"Bearer {app_jwt}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        res.raise_for_status()
        data = res.json()
    token = str(data.get("token") or "")
    if not token:
        raise RuntimeError("GitHub returned empty installation token")
    with _CACHE_LOCK:
        _TOKEN_CACHE[installation_id] = (token, now + _TOKEN_TTL_SEC)
    return token


def get_installation(installation_id: int) -> dict[str, Any]:
    app_jwt = generate_app_jwt()
    url = f"{GITHUB_API}/app/installations/{installation_id}"
    with httpx.Client(timeout=30.0) as client:
        res = client.get(
            url,
            headers={
                "Authorization": f"Bearer {app_jwt}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        res.raise_for_status()
        return res.json()


def list_installation_repos(installation_id: int) -> list[dict[str, Any]]:
    token = get_installation_token(installation_id)
    repos: list[dict[str, Any]] = []
    page = 1
    with httpx.Client(timeout=45.0) as client:
        while True:
            res = client.get(
                f"{GITHUB_API}/installation/repositories",
                params={"per_page": 100, "page": page},
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            )
            res.raise_for_status()
            data = res.json()
            batch = data.get("repositories") or []
            if not isinstance(batch, list):
                break
            repos.extend(batch)
            if len(batch) < 100:
                break
            page += 1
    return repos


def install_url_for_workspace(workspace_id: str) -> Optional[str]:
    if not github_app_configured():
        return None
    slug = _app_slug()
    return f"https://github.com/apps/{slug}/installations/new?state={workspace_id}"