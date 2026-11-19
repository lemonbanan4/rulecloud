"""GitHub App installation records per workspace."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class GitHubInstallation:
    id: str
    workspace_id: str
    installation_id: int
    account_login: str
    account_type: str
    auto_fix_comments: bool
    created_at: Optional[str] = None


class GitHubInstallationStore:
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

    def list_for_workspace(self, workspace_id: str, owner_id: str) -> list[GitHubInstallation]:
        self._assert_workspace_owner(workspace_id, owner_id)
        client = self._require()
        res = (
            client.table("github_installations")
            .select(
                "id, workspace_id, installation_id, account_login, account_type, auto_fix_comments, created_at"
            )
            .eq("workspace_id", workspace_id)
            .order("created_at", desc=True)
            .execute()
        )
        out: list[GitHubInstallation] = []
        for row in res.data or []:
            out.append(
                GitHubInstallation(
                    id=str(row["id"]),
                    workspace_id=str(row["workspace_id"]),
                    installation_id=int(row["installation_id"]),
                    account_login=str(row["account_login"]),
                    account_type=str(row.get("account_type") or "User"),
                    auto_fix_comments=bool(row.get("auto_fix_comments", True)),
                    created_at=row.get("created_at"),
                )
            )
        return out

    def get_by_installation_id(self, installation_id: int) -> Optional[GitHubInstallation]:
        client = self._client
        if not client:
            return None
        res = (
            client.table("github_installations")
            .select(
                "id, workspace_id, installation_id, account_login, account_type, auto_fix_comments, created_at"
            )
            .eq("installation_id", installation_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return None
        row = rows[0]
        return GitHubInstallation(
            id=str(row["id"]),
            workspace_id=str(row["workspace_id"]),
            installation_id=int(row["installation_id"]),
            account_login=str(row["account_login"]),
            account_type=str(row.get("account_type") or "User"),
            auto_fix_comments=bool(row.get("auto_fix_comments", True)),
            created_at=row.get("created_at"),
        )

    def upsert(
        self,
        *,
        workspace_id: str,
        owner_id: str,
        installation_id: int,
        account_login: str,
        account_type: str = "User",
        auto_fix_comments: bool = True,
    ) -> GitHubInstallation:
        self._assert_workspace_owner(workspace_id, owner_id)
        client = self._require()
        existing = (
            client.table("github_installations")
            .select("id")
            .eq("installation_id", installation_id)
            .limit(1)
            .execute()
        )
        row = {
            "workspace_id": workspace_id,
            "installation_id": installation_id,
            "account_login": account_login,
            "account_type": account_type,
            "auto_fix_comments": auto_fix_comments,
        }
        if existing.data:
            inst_uuid = existing.data[0]["id"]
            client.table("github_installations").update(
                {
                    "workspace_id": workspace_id,
                    "account_login": account_login,
                    "account_type": account_type,
                }
            ).eq("id", inst_uuid).execute()
        else:
            ins = client.table("github_installations").insert(row).execute()
            inst_uuid = (ins.data or [{}])[0].get("id")
        got = self.get_by_installation_id(installation_id)
        if not got:
            raise RuntimeError("upsert failed")
        return got

    def delete_by_installation_id(self, installation_id: int) -> bool:
        client = self._client
        if not client:
            return False
        try:
            client.table("github_installations").delete().eq(
                "installation_id", installation_id
            ).execute()
        except Exception:  # noqa: BLE001
            logger.exception("delete installation %s", installation_id)
            return False
        return True

    def unlink(self, installation_id: int, owner_id: str) -> bool:
        client = self._require()
        res = (
            client.table("github_installations")
            .select("workspace_id")
            .eq("installation_id", installation_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return False
        self._assert_workspace_owner(str(rows[0]["workspace_id"]), owner_id)
        client.table("github_installations").delete().eq(
            "installation_id", installation_id
        ).execute()
        return True

    def update_auto_fix(
        self, installation_id: int, owner_id: str, enabled: bool
    ) -> bool:
        client = self._require()
        res = (
            client.table("github_installations")
            .select("workspace_id")
            .eq("installation_id", installation_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return False
        self._assert_workspace_owner(str(rows[0]["workspace_id"]), owner_id)
        client.table("github_installations").update({"auto_fix_comments": enabled}).eq(
            "installation_id", installation_id
        ).execute()
        return True


def create_github_installation_store() -> GitHubInstallationStore:
    return GitHubInstallationStore()