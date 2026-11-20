"""Cloud Rulespacks: CRUD, seed packs, and merged guardrail bundle."""

from __future__ import annotations

import hashlib
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

import yaml

from defaults import DEFAULT_RULES_YAML

logger = logging.getLogger(__name__)

STARTER_PACKS: list[dict[str, str]] = [
    {
        "slug": "zero-secrets",
        "name": "Zero Secrets",
        "description": "Blocks hardcoded credentials, tokens, and private keys.",
        "rules_yaml": """version: 1
timeout_ms: 5000
include:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.py"
  - "**/*.js"
  - "**/*.cs"
  - "**/*.go"
rules:
  - id: no-hardcoded-secrets
    severity: high
    type: regex
    pattern: '(?i)(api_key|password|secret|token|private_key)\\s*[=:]\\s*["\\'][^"\\']{6,}["\\']'
    message: Hardcoded credential — use environment variables or a secret manager
  - id: aws-access-key
    severity: critical
    type: regex
    pattern: 'AKIA[0-9A-Z]{16}'
    message: Possible AWS access key in source
""",
    },
    {
        "slug": "clean-architecture",
        "name": "Clean Architecture",
        "description": "Layer boundaries — presentation must not reach into data directly.",
        "rules_yaml": """version: 1
timeout_ms: 5000
include:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.py"
  - "**/*.cs"
rules:
  - id: presentation-imports-data
    severity: medium
    from: "**/presentation/**"
    to: "**/data/**"
    message: Layer violation — presentation must not import the data layer directly
  - id: ui-direct-db
    severity: high
    type: regex
    match: "**/components/**"
    pattern: '(?i)(SqlConnection|NpgsqlConnection|mongoose\\.connect|createClient\\()'
    message: Direct database client usage in UI layer
""",
    },
    {
        "slug": "ai-agent-hygiene",
        "name": "AI-Agent Anti-Drift",
        "description": "Surfaces TODOs, debug logging, and placeholder stubs left by AI agents.",
        "rules_yaml": """version: 1
timeout_ms: 5000
include:
  - "**/*"
rules:
  - id: hygiene-todo
    severity: low
    type: regex
    pattern: '(?i)\\b(TODO|FIXME|HACK|XXX)\\b'
    message: Resolve TODO/FIXME before merging
  - id: console-log
    severity: medium
    type: regex
    pattern: 'console\\.(log|debug)\\('
    message: Debug logging left in source — remove before shipping
  - id: placeholder-impl
    severity: medium
    type: regex
    pattern: '(?i)(throw new NotImplementedException|pass\\s*#\\s*todo|NotImplementedError)'
    message: Unimplemented placeholder — finish the function
""",
    },
]


@dataclass(frozen=True)
class RulespackRow:
    id: str
    workspace_id: str
    slug: str
    name: str
    description: Optional[str]
    rules_yaml: str
    enabled: bool
    updated_at: Optional[str]


def merge_rulespack_yamls(yaml_texts: list[str]) -> str:
    """Merge multiple rulespack documents into one canonical guardrail.yaml."""
    merged = _empty_bundle()
    for text in yaml_texts:
        if not (text or "").strip():
            continue
        try:
            doc = yaml.safe_load(text)
        except Exception:  # noqa: BLE001
            logger.warning("Skipping unparseable rulespack fragment")
            continue
        if not isinstance(doc, dict):
            continue
        inc = doc.get("include") or []
        if isinstance(inc, list):
            for item in inc:
                s = str(item)
                if s not in merged["include"]:
                    merged["include"].append(s)
        exc = doc.get("exclude") or []
        if isinstance(exc, list):
            for item in exc:
                s = str(item)
                if s not in merged["exclude"]:
                    merged["exclude"].append(s)
        rules = doc.get("rules") or []
        if isinstance(rules, list):
            for rule in rules:
                if not isinstance(rule, dict) or not rule.get("id"):
                    continue
                rid = str(rule["id"])
                if rid in merged["_seen"]:
                    continue
                merged["_seen"].add(rid)
                merged["rules"].append(rule)
        timeout = doc.get("timeout_ms")
        if timeout is not None:
            try:
                merged["timeout_ms"] = max(int(merged["timeout_ms"]), int(timeout))
            except (TypeError, ValueError):
                pass
    del merged["_seen"]
    if not merged["rules"]:
        return DEFAULT_RULES_YAML
    return yaml.safe_dump(merged, sort_keys=False)


def _empty_bundle() -> dict[str, Any]:
    return {
        "version": 1,
        "timeout_ms": 5000,
        "include": ["**/*.ts", "**/*.tsx", "**/*.py", "**/*.js", "**/*.cs"],
        "exclude": [],
        "rules": [],
        "_seen": set(),
    }


def bundle_etag(yaml_text: str) -> str:
    digest = hashlib.sha256(yaml_text.encode("utf-8")).hexdigest()
    return digest[:16]


def _row_to_pack(row: dict[str, Any]) -> RulespackRow:
    return RulespackRow(
        id=str(row["id"]),
        workspace_id=str(row["workspace_id"]),
        slug=str(row["slug"]),
        name=str(row["name"]),
        description=row.get("description"),
        rules_yaml=str(row["rules_yaml"]),
        enabled=bool(row.get("enabled", True)),
        updated_at=row.get("updated_at"),
    )


class RulespackStore:
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

    def list_for_workspace(
        self, workspace_id: str, owner_id: str, *, seed_if_empty: bool = True
    ) -> list[RulespackRow]:
        self._assert_workspace_owner(workspace_id, owner_id)
        client = self._require()
        if seed_if_empty:
            self._seed_starter_packs(workspace_id)
        res = (
            client.table("rulespacks")
            .select("*")
            .eq("workspace_id", workspace_id)
            .order("slug")
            .execute()
        )
        return [_row_to_pack(r) for r in res.data or []]

    def list_enabled_yaml(self, workspace_id: str) -> list[str]:
        if not self.enabled:
            return []
        client = self._require()
        res = (
            client.table("rulespacks")
            .select("rules_yaml")
            .eq("workspace_id", workspace_id)
            .eq("enabled", True)
            .execute()
        )
        return [str(r["rules_yaml"]) for r in res.data or [] if r.get("rules_yaml")]

    def bundle_for_workspace(self, workspace_id: str) -> tuple[str, str]:
        """Return (merged rules_yaml, etag)."""
        yamls = self.list_enabled_yaml(workspace_id)
        if not yamls:
            return DEFAULT_RULES_YAML, bundle_etag(DEFAULT_RULES_YAML)
        merged = merge_rulespack_yamls(yamls)
        return merged, bundle_etag(merged)

    def seed_starter_packs_if_empty(self, workspace_id: str) -> None:
        self._seed_starter_packs(workspace_id)

    def _seed_starter_packs(self, workspace_id: str) -> None:
        client = self._require()
        res = (
            client.table("rulespacks")
            .select("id")
            .eq("workspace_id", workspace_id)
            .limit(1)
            .execute()
        )
        if res.data:
            return
        rows = [
            {
                "workspace_id": workspace_id,
                "slug": p["slug"],
                "name": p["name"],
                "description": p.get("description"),
                "rules_yaml": p["rules_yaml"],
                "enabled": True,
            }
            for p in STARTER_PACKS
        ]
        try:
            client.table("rulespacks").insert(rows).execute()
        except Exception:  # noqa: BLE001
            logger.exception("Failed to seed starter rulespacks for %s", workspace_id)

    def create(
        self,
        *,
        workspace_id: str,
        owner_id: str,
        slug: str,
        name: str,
        description: Optional[str],
        rules_yaml: str,
        enabled: bool = True,
    ) -> RulespackRow:
        self._assert_workspace_owner(workspace_id, owner_id)
        client = self._require()
        row = {
            "workspace_id": workspace_id,
            "slug": slug.strip(),
            "name": name.strip(),
            "description": description,
            "rules_yaml": rules_yaml,
            "enabled": enabled,
        }
        res = client.table("rulespacks").insert(row).select("*").execute()
        data = (res.data or [None])[0]
        if not data:
            raise RuntimeError("Insert failed")
        return _row_to_pack(data)

    def update(
        self,
        pack_id: str,
        owner_id: str,
        *,
        rules_yaml: Optional[str] = None,
        enabled: Optional[bool] = None,
        name: Optional[str] = None,
        description: Optional[str] = None,
    ) -> Optional[RulespackRow]:
        client = self._require()
        res = (
            client.table("rulespacks")
            .select("workspace_id")
            .eq("id", pack_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return None
        workspace_id = str(rows[0]["workspace_id"])
        self._assert_workspace_owner(workspace_id, owner_id)
        fields: dict[str, Any] = {}
        if rules_yaml is not None:
            fields["rules_yaml"] = rules_yaml
        if enabled is not None:
            fields["enabled"] = enabled
        if name is not None:
            fields["name"] = name
        if description is not None:
            fields["description"] = description
        if not fields:
            return self.get_by_id(pack_id, owner_id)
        fields["updated_at"] = datetime.now(timezone.utc).isoformat()
        client.table("rulespacks").update(fields).eq("id", pack_id).execute()
        return self.get_by_id(pack_id, owner_id)

    def get_by_id(self, pack_id: str, owner_id: str) -> Optional[RulespackRow]:
        client = self._require()
        res = client.table("rulespacks").select("*").eq("id", pack_id).limit(1).execute()
        rows = res.data or []
        if not rows:
            return None
        pack = _row_to_pack(rows[0])
        self._assert_workspace_owner(pack.workspace_id, owner_id)
        return pack

    def delete(self, pack_id: str, owner_id: str) -> bool:
        pack = self.get_by_id(pack_id, owner_id)
        if not pack:
            return False
        client = self._require()
        client.table("rulespacks").delete().eq("id", pack_id).execute()
        return True


_store: Optional[RulespackStore] = None


def create_rulespack_store() -> RulespackStore:
    return RulespackStore()


def get_rulespack_store() -> RulespackStore:
    global _store
    if _store is None:
        _store = create_rulespack_store()
    return _store


def workspace_guardrail_bundle(workspace_id: Optional[str]) -> str:
    if not workspace_id:
        return DEFAULT_RULES_YAML
    store = get_rulespack_store()
    if not store.enabled:
        return DEFAULT_RULES_YAML
    bundle, _ = store.bundle_for_workspace(workspace_id)
    return bundle