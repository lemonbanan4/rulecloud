"""GitHub App JWT and installation access tokens."""

from __future__ import annotations

import base64
import logging
import os
import threading
import time
from typing import Any, Optional

import httpx
import jwt
from cryptography.hazmat.primitives.serialization import load_pem_private_key

logger = logging.getLogger(__name__)

GITHUB_API = "https://api.github.com"
_TOKEN_CACHE: dict[int, tuple[str, float]] = {}
_CACHE_LOCK = threading.Lock()
_TOKEN_TTL_SEC = 50 * 60
_PEM_CACHE: Optional[str] = None
_USER_AGENT = "RuleCloud-Guardrail"


def _app_id() -> str:
    return (os.getenv("GITHUB_APP_ID") or "").strip()


def _validate_app_id(app_id: str) -> None:
    if not app_id:
        raise RuntimeError("Missing GITHUB_APP_ID")
    if not app_id.isdigit():
        raise RuntimeError(
            "GITHUB_APP_ID must be the numeric GitHub App ID (Settings → General), "
            "not the Client ID (values like Iv23… are OAuth client IDs)"
        )


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


def _normalize_pem_string(raw: str) -> str:
    s = raw.strip()
    while len(s) >= 2 and (
        (s[0] == '"' and s[-1] == '"') or (s[0] == "'" and s[-1] == "'")
    ):
        s = s[1:-1].strip()
    if "\\n" in s:
        s = s.replace("\\n", "\n")
    return s.replace("\r", "")


def _raw_key_material() -> str:
    b64 = (os.getenv("GITHUB_APP_PRIVATE_KEY_B64") or "").strip()
    if b64:
        try:
            return base64.b64decode(b64).decode("utf-8")
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"GITHUB_APP_PRIVATE_KEY_B64 decode error: {exc}") from exc
    return (os.getenv("GITHUB_APP_PRIVATE_KEY") or "").strip()


def _app_private_key() -> str:
    global _PEM_CACHE
    if _PEM_CACHE is not None:
        return _PEM_CACHE
    raw = _raw_key_material()
    if not raw:
        return ""
    pem = _normalize_pem_string(raw)
    try:
        load_pem_private_key(pem.encode("utf-8"), password=None)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"PEM key parse error: {exc}") from exc
    _PEM_CACHE = pem
    return pem


def github_app_configured() -> bool:
    if not _app_id():
        return False
    try:
        return bool(_app_private_key())
    except RuntimeError:
        return False


def github_app_headers(bearer_token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {bearer_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": _USER_AGENT,
    }


def generate_app_jwt() -> str:
    app_id = _app_id()
    _validate_app_id(app_id)
    key = _app_private_key()
    if not key:
        raise RuntimeError("Missing GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_B64")
    now = int(time.time())
    payload = {
        "iat": now - 60,
        "exp": now + 540,
        "iss": app_id,
    }
    try:
        return jwt.encode(payload, key, algorithm="RS256")
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"App JWT signing error: {exc}") from exc


def safe_http_error_message(response: httpx.Response, *, prefix: str = "GitHub API") -> str:
    body = (response.text or "").strip()
    if len(body) > 500:
        body = f"{body[:500]}…"
    if body:
        return f"{prefix} {response.status_code}: {body}"
    return f"{prefix} {response.status_code}"


def check_github_app() -> dict[str, Any]:
    """Sign an App JWT and call GET /app; safe for status endpoints."""
    try:
        app_jwt = generate_app_jwt()
    except RuntimeError as exc:
        return {"ok": False, "error": str(exc)}
    url = f"{GITHUB_API}/app"
    try:
        with httpx.Client(timeout=30.0) as client:
            res = client.get(url, headers=github_app_headers(app_jwt))
    except httpx.HTTPError as exc:
        return {"ok": False, "error": f"GitHub request failed: {exc}"}
    if res.status_code >= 400:
        return {"ok": False, "error": safe_http_error_message(res)}
    data = res.json()
    return {
        "ok": True,
        "app_slug": data.get("slug"),
        "app_name": data.get("name"),
    }


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
        res = client.post(url, headers=github_app_headers(app_jwt))
        if res.status_code >= 400:
            raise RuntimeError(safe_http_error_message(res))
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
        res = client.get(url, headers=github_app_headers(app_jwt))
        if res.status_code >= 400:
            raise RuntimeError(safe_http_error_message(res))
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
                headers=github_app_headers(token),
            )
            if res.status_code >= 400:
                raise RuntimeError(safe_http_error_message(res))
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