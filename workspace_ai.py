"""Workspace AI / BYOK settings (encrypted API keys)."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any, Optional

from github_token_crypto import decrypt_token, encrypt_token, looks_encrypted

logger = logging.getLogger(__name__)

ALLOWED_PROVIDERS = frozenset({"openai", "gemini", "anthropic"})


@dataclass(frozen=True)
class WorkspaceAiSettings:
    llm_provider: Optional[str]
    has_api_key: bool


class WorkspaceAiStore:
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

    def get_settings(self, workspace_id: str, owner_id: str) -> WorkspaceAiSettings:
        self._assert_workspace_owner(workspace_id, owner_id)
        client = self._require()
        res = (
            client.table("workspaces")
            .select("llm_provider, llm_api_key_encrypted")
            .eq("id", workspace_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return WorkspaceAiSettings(llm_provider=None, has_api_key=False)
        row = rows[0]
        enc = row.get("llm_api_key_encrypted")
        return WorkspaceAiSettings(
            llm_provider=row.get("llm_provider"),
            has_api_key=bool(enc and str(enc).strip()),
        )

    def get_llm_credentials(self, workspace_id: str) -> tuple[Optional[str], Optional[str]]:
        """Return (provider, raw_api_key) for workspace BYOK if set."""
        if not self.enabled:
            return None, None
        client = self._require()
        res = (
            client.table("workspaces")
            .select("llm_provider, llm_api_key_encrypted")
            .eq("id", workspace_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return None, None
        row = rows[0]
        enc = row.get("llm_api_key_encrypted")
        if not enc or not str(enc).strip():
            return (str(row["llm_provider"]).strip() if row.get("llm_provider") else None), None
        try:
            if looks_encrypted(str(enc)):
                key = decrypt_token(str(enc))
            else:
                key = str(enc)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to decrypt workspace LLM key for %s", workspace_id)
            return None, None
        provider = (row.get("llm_provider") or "").strip() or None
        return provider, key

    def update_settings(
        self,
        workspace_id: str,
        owner_id: str,
        *,
        llm_provider: Optional[str] = None,
        llm_api_key: Optional[str] = None,
        clear_api_key: bool = False,
    ) -> WorkspaceAiSettings:
        self._assert_workspace_owner(workspace_id, owner_id)
        client = self._require()
        fields: dict[str, Any] = {}
        if llm_provider is not None:
            prov = llm_provider.strip().lower()
            if prov and prov not in ALLOWED_PROVIDERS:
                raise ValueError(f"Unsupported llm_provider: {llm_provider}")
            fields["llm_provider"] = prov or None
        if clear_api_key:
            fields["llm_api_key_encrypted"] = None
        elif llm_api_key is not None and llm_api_key.strip():
            fields["llm_api_key_encrypted"] = encrypt_token(llm_api_key.strip())
        if not fields:
            return self.get_settings(workspace_id, owner_id)
        client.table("workspaces").update(fields).eq("id", workspace_id).execute()
        return self.get_settings(workspace_id, owner_id)


_store: Optional[WorkspaceAiStore] = None


def create_workspace_ai_store() -> WorkspaceAiStore:
    return WorkspaceAiStore()


def get_workspace_ai_store() -> WorkspaceAiStore:
    global _store
    if _store is None:
        _store = create_workspace_ai_store()
    return _store