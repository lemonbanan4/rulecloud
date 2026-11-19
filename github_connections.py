"""GitHub repo connections per workspace."""

from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass
from typing import Any, Optional

import os

from github_token_crypto import decrypt_token, encrypt_token, looks_encrypted

logger = logging.getLogger(__name__)

REPORT_MARKER = "<!-- rulecloud-guardrail-report -->"


@dataclass(frozen=True)
class GitHubConnection:
    id: str
    workspace_id: str
    repo_full_name: str
    webhook_secret: str
    has_token: bool
    auto_fix_comments: bool
    created_at: Optional[str] = None


@dataclass(frozen=True)
class GitHubConnectionInternal:
    id: str
    workspace_id: str
    repo_full_name: str
    webhook_secret: str
    github_token: Optional[str]
    auto_fix_comments: bool


class GitHubConnectionStore:
    def __init__(self) -> None:
        self._client = None
        url = (os.getenv("SUPABASE_URL") or "").strip()
        key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
        if url and key:
            from supabase import create_client

            self._client = create_client(url, key)

    @property
    def enabled(self) -> bool:
        return self._client is not None

    def _require(self) -> Any:
        if not self._client:
            raise RuntimeError("Supabase not configured")
        return self._client

    def _assert_workspace_owner(self, workspace_id: str, owner_id: str) -> None:
        client = self._require()
        res = (
            client.table("workspaces")
            .select("id")
            .eq("id", workspace_id)
            .eq("owner_id", owner_id)
            .limit(1)
            .execute()
        )
        if not res.data:
            raise PermissionError("Workspace not found")

    def list_for_workspace(self, workspace_id: str, owner_id: str) -> list[GitHubConnection]:
        self._assert_workspace_owner(workspace_id, owner_id)
        client = self._require()
        res = (
            client.table("github_connections")
            .select(
                "id, workspace_id, repo_full_name, webhook_secret, auto_fix_comments, created_at, github_token_encrypted"
            )
            .eq("workspace_id", workspace_id)
            .order("created_at", desc=True)
            .execute()
        )
        out: list[GitHubConnection] = []
        for row in res.data or []:
            out.append(
                GitHubConnection(
                    id=str(row["id"]),
                    workspace_id=str(row["workspace_id"]),
                    repo_full_name=row["repo_full_name"],
                    webhook_secret=str(row.get("webhook_secret") or ""),
                    has_token=bool(row.get("github_token_encrypted")),
                    auto_fix_comments=bool(row.get("auto_fix_comments", True)),
                    created_at=row.get("created_at"),
                )
            )
        return out

    def create(
        self,
        *,
        workspace_id: str,
        owner_id: str,
        repo_full_name: str,
        github_token: Optional[str] = None,
        auto_fix_comments: bool = True,
    ) -> dict[str, Any]:
        self._assert_workspace_owner(workspace_id, owner_id)
        repo = repo_full_name.strip()
        if "/" not in repo or repo.count("/") != 1:
            raise ValueError("repo_full_name must be owner/repo")

        token_enc: Optional[str] = None
        if github_token and github_token.strip():
            token_enc = encrypt_token(github_token.strip())
            if not looks_encrypted(token_enc):
                raise RuntimeError("GitHub PAT encryption failed — check TOKEN_ENCRYPTION_KEY")

        client = self._require()
        existing = (
            client.table("github_connections")
            .select("id, webhook_secret, auto_fix_comments, github_token_encrypted")
            .eq("workspace_id", workspace_id)
            .eq("repo_full_name", repo)
            .limit(1)
            .execute()
        )
        backend = (os.getenv("BACKEND_URL") or "").strip().rstrip("/") or "https://your-api.example.com"
        webhook_url = f"{backend}/api/webhook/github"

        if existing.data:
            row = existing.data[0]
            if token_enc is not None:
                client.table("github_connections").update(
                    {"github_token_encrypted": token_enc}
                ).eq("id", row["id"]).execute()
            has_token = bool(token_enc or row.get("github_token_encrypted"))
            return {
                "id": row["id"],
                "repo_full_name": repo,
                "webhook_url": webhook_url,
                "webhook_secret": row["webhook_secret"],
                "has_token": has_token,
                "auto_fix_comments": bool(row.get("auto_fix_comments", True)),
                "updated": True,
            }

        webhook_secret = secrets.token_urlsafe(32)
        row = {
            "workspace_id": workspace_id,
            "repo_full_name": repo,
            "webhook_secret": webhook_secret,
            "github_token_encrypted": token_enc,
            "auto_fix_comments": auto_fix_comments,
        }
        res = client.table("github_connections").insert(row).execute()
        data = (res.data or [None])[0]
        if not data:
            raise RuntimeError("Insert failed")
        return {
            "id": data["id"],
            "repo_full_name": repo,
            "webhook_url": webhook_url,
            "webhook_secret": webhook_secret,
            "has_token": bool(token_enc),
            "auto_fix_comments": auto_fix_comments,
            "updated": False,
        }

    def delete(self, connection_id: str, owner_id: str) -> bool:
        client = self._require()
        res = (
            client.table("github_connections")
            .select("workspace_id")
            .eq("id", connection_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return False
        self._assert_workspace_owner(str(rows[0]["workspace_id"]), owner_id)
        client.table("github_connections").delete().eq("id", connection_id).execute()
        return True

    def update_connection(
        self,
        connection_id: str,
        owner_id: str,
        *,
        github_token: Optional[str] = None,
        auto_fix_comments: Optional[bool] = None,
    ) -> bool:
        client = self._require()
        res = (
            client.table("github_connections")
            .select("workspace_id")
            .eq("id", connection_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return False
        self._assert_workspace_owner(str(rows[0]["workspace_id"]), owner_id)
        updates: dict[str, Any] = {}
        if github_token is not None and github_token.strip():
            enc = encrypt_token(github_token.strip())
            if not looks_encrypted(enc):
                raise RuntimeError("GitHub PAT encryption failed — check TOKEN_ENCRYPTION_KEY")
            updates["github_token_encrypted"] = enc
        if auto_fix_comments is not None:
            updates["auto_fix_comments"] = auto_fix_comments
        if not updates:
            return True
        client.table("github_connections").update(updates).eq("id", connection_id).execute()
        return True

    def update_auto_fix(self, connection_id: str, owner_id: str, enabled: bool) -> bool:
        client = self._require()
        res = (
            client.table("github_connections")
            .select("workspace_id")
            .eq("id", connection_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return False
        self._assert_workspace_owner(str(rows[0]["workspace_id"]), owner_id)
        client.table("github_connections").update({"auto_fix_comments": enabled}).eq(
            "id", connection_id
        ).execute()
        return True

    def get_connection_for_webhook(
        self, repo_full_name: str
    ) -> list[GitHubConnectionInternal]:
        client = self._client
        if not client:
            return []
        res = (
            client.table("github_connections")
            .select("*")
            .eq("repo_full_name", repo_full_name)
            .execute()
        )
        out: list[GitHubConnectionInternal] = []
        for row in res.data or []:
            token = None
            enc = row.get("github_token_encrypted")
            if enc:
                try:
                    token = decrypt_token(enc)
                except Exception:  # noqa: BLE001
                    logger.exception("Failed to decrypt GitHub token for %s", repo_full_name)
            out.append(
                GitHubConnectionInternal(
                    id=str(row["id"]),
                    workspace_id=str(row["workspace_id"]),
                    repo_full_name=row["repo_full_name"],
                    webhook_secret=row["webhook_secret"],
                    github_token=token,
                    auto_fix_comments=bool(row.get("auto_fix_comments", True)),
                )
            )
        return out

    def get_with_secret(self, connection_id: str, owner_id: str) -> Optional[dict[str, Any]]:
        client = self._require()
        res = (
            client.table("github_connections")
            .select("*")
            .eq("id", connection_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return None
        row = rows[0]
        self._assert_workspace_owner(str(row["workspace_id"]), owner_id)
        backend = (os.getenv("BACKEND_URL") or "").strip().rstrip("/") or "https://your-api.example.com"
        return {
            "id": row["id"],
            "repo_full_name": row["repo_full_name"],
            "webhook_url": f"{backend}/api/webhook/github",
            "webhook_secret": row["webhook_secret"],
            "has_token": bool(row.get("github_token_encrypted")),
            "auto_fix_comments": bool(row.get("auto_fix_comments", True)),
        }


def create_github_connection_store() -> GitHubConnectionStore:
    return GitHubConnectionStore()