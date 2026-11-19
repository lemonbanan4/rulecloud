"""API key generation, storage, and authentication."""

from __future__ import annotations

import hashlib
import logging
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

KEY_PREFIX = "rc_live_"


@dataclass(frozen=True)
class ApiKeyContext:
    key_id: str
    workspace_id: str
    plan: str


def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ApiKeyStore:
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
            raise RuntimeError("Supabase not configured for API keys")
        return self._client

    def generate_raw_key(self) -> tuple[str, str, str]:
        """Return (raw_key, key_prefix, key_hash)."""
        secret_part = secrets.token_hex(16)
        raw = f"{KEY_PREFIX}{secret_part}"
        prefix = f"{KEY_PREFIX}{secret_part[:4]}"
        return raw, prefix, _hash_key(raw)

    def authenticate(self, raw_key: str) -> Optional[ApiKeyContext]:
        if not raw_key.startswith(KEY_PREFIX):
            return None
        client = self._client
        if not client:
            return None
        digest = _hash_key(raw_key.strip())
        try:
            res = (
                client.table("api_keys")
                .select("id, workspace_id, revoked_at")
                .eq("key_hash", digest)
                .limit(1)
                .execute()
            )
        except Exception:  # noqa: BLE001
            logger.exception("API key lookup failed")
            return None
        rows = res.data or []
        if not rows:
            return None
        row = rows[0]
        if row.get("revoked_at"):
            return None
        key_id = str(row["id"])
        workspace_id = str(row["workspace_id"])
        plan = self._workspace_plan(workspace_id)
        try:
            client.table("api_keys").update({"last_used_at": _now_iso()}).eq(
                "id", key_id
            ).execute()
        except Exception:  # noqa: BLE001
            logger.exception("Failed to update last_used_at for key %s", key_id)
        return ApiKeyContext(key_id=key_id, workspace_id=workspace_id, plan=plan)

    def _workspace_plan(self, workspace_id: str) -> str:
        client = self._require()
        res = (
            client.table("workspaces")
            .select("plan")
            .eq("id", workspace_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return "free"
        plan = rows[0].get("plan") or "free"
        return str(plan)

    def create_key(
        self, *, workspace_id: str, name: str, owner_id: str
    ) -> dict[str, Any]:
        client = self._require()
        if not self._user_owns_workspace(workspace_id, owner_id):
            raise PermissionError("Workspace not found")
        raw, prefix, digest = self.generate_raw_key()
        row = {
            "workspace_id": workspace_id,
            "name": name.strip(),
            "key_prefix": prefix,
            "key_hash": digest,
        }
        res = client.table("api_keys").insert(row).execute()
        inserted = (res.data or [{}])[0]
        return {
            "id": inserted.get("id"),
            "name": row["name"],
            "key_prefix": prefix,
            "api_key": raw,
            "created_at": inserted.get("created_at"),
        }

    def list_keys(self, *, workspace_id: str, owner_id: str) -> list[dict[str, Any]]:
        client = self._require()
        if not self._user_owns_workspace(workspace_id, owner_id):
            raise PermissionError("Workspace not found")
        res = (
            client.table("api_keys")
            .select("id, name, key_prefix, last_used_at, created_at, revoked_at")
            .eq("workspace_id", workspace_id)
            .is_("revoked_at", "null")
            .order("created_at", desc=True)
            .execute()
        )
        return res.data or []

    def revoke_key(self, *, key_id: str, owner_id: str) -> bool:
        client = self._require()
        res = (
            client.table("api_keys")
            .select("id, workspace_id")
            .eq("id", key_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return False
        workspace_id = str(rows[0]["workspace_id"])
        if not self._user_owns_workspace(workspace_id, owner_id):
            raise PermissionError("Not allowed")
        client.table("api_keys").update({"revoked_at": _now_iso()}).eq(
            "id", key_id
        ).execute()
        return True

    def _user_owns_workspace(self, workspace_id: str, owner_id: str) -> bool:
        client = self._require()
        res = (
            client.table("workspaces")
            .select("id")
            .eq("id", workspace_id)
            .eq("owner_id", owner_id)
            .limit(1)
            .execute()
        )
        return bool(res.data)


def create_api_key_store() -> ApiKeyStore:
    return ApiKeyStore()