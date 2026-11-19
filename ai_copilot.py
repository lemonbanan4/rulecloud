"""AI Copilot — natural language rules YAML and Pro auto-fix."""

from __future__ import annotations

import difflib
import json
import logging
import os
import re
import threading
import time
from typing import Any, Optional

import httpx
import yaml

from defaults import DEFAULT_RULES_YAML

logger = logging.getLogger(__name__)

FREE_GENERATE_PER_DAY = int(os.getenv("AI_GENERATE_FREE_DAILY_LIMIT", "15"))
GENERATE_WINDOW_SEC = 86400

_LOCK = threading.Lock()
_GENERATE_USAGE: dict[str, tuple[int, float]] = {}

AUTOFIX_PRO_DETAIL = (
    "AI Auto-Fix is a Pro feature. Upgrade to unlock one-click code fixes."
)

_RULES_SYSTEM = f"""You are a Guardrail rules assistant. Output ONLY valid YAML for guardrail.yaml.
Match this schema exactly (version, timeout_ms, include globs, rules array with id, type, description, pattern, message for regex rules):

Example reference:
```yaml
{DEFAULT_RULES_YAML.strip()}
```

Rules:
- Output raw YAML only. No markdown fences. No commentary.
- Use type: regex unless the user asks for another supported type.
- Patterns must be valid regex strings (quote with single quotes when needed).
- Include sensible include globs for the languages mentioned.
"""

_AUTOFIX_SYSTEM = """You fix code to resolve a static analysis violation while preserving behavior.
Respond with JSON only (no markdown) using keys:
- explanation: short string
- patched_code: full updated source file
- diff: unified diff string (--- original / +++ patched)
"""


def _provider() -> str:
    return (os.getenv("LLM_PROVIDER") or "openai").strip().lower()


def _api_key() -> str:
    key = (os.getenv("LLM_API_KEY") or "").strip()
    if not key:
        raise RuntimeError("LLM_API_KEY is not configured")
    return key


def _openai_model() -> str:
    return (os.getenv("LLM_MODEL") or "gpt-4o-mini").strip()


def _gemini_model() -> str:
    return (os.getenv("LLM_MODEL") or "gemini-2.0-flash").strip()


def _strip_fences(text: str) -> str:
    cleaned = text.strip()
    fence = re.match(r"^```(?:yaml)?\s*\n?(.*?)\n?```\s*$", cleaned, re.DOTALL | re.IGNORECASE)
    if fence:
        return fence.group(1).strip()
    return cleaned


def _parse_json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    fence = re.match(r"^```(?:json)?\s*\n?(.*?)\n?```\s*$", cleaned, re.DOTALL | re.IGNORECASE)
    if fence:
        cleaned = fence.group(1).strip()
    return json.loads(cleaned)


def _validate_rules_yaml(yaml_text: str) -> str:
    data = yaml.safe_load(yaml_text)
    if not isinstance(data, dict):
        raise ValueError("YAML root must be a mapping")
    if "version" not in data:
        raise ValueError("Missing version key")
    if "rules" not in data or not isinstance(data["rules"], list):
        raise ValueError("Missing rules list")
    return yaml_text.strip() + "\n"


def _chat_completion(system: str, user: str, *, json_mode: bool = False) -> str:
    provider = _provider()
    key = _api_key()
    timeout = float(os.getenv("LLM_TIMEOUT_SEC", "60"))

    if provider == "gemini":
        model = _gemini_model()
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent"
        )
        body: dict[str, Any] = {
            "contents": [{"role": "user", "parts": [{"text": f"{system}\n\n{user}"}]}],
            "generationConfig": {"temperature": 0.2},
        }
        if json_mode:
            body["generationConfig"]["responseMimeType"] = "application/json"
        with httpx.Client(timeout=timeout) as client:
            res = client.post(url, params={"key": key}, json=body)
            res.raise_for_status()
            payload = res.json()
        candidates = payload.get("candidates") or []
        if not candidates:
            raise RuntimeError("Gemini returned no candidates")
        parts = candidates[0].get("content", {}).get("parts") or []
        if not parts:
            raise RuntimeError("Gemini returned empty content")
        return str(parts[0].get("text") or "")

    model = _openai_model()
    body = {
        "model": model,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    with httpx.Client(timeout=timeout) as client:
        res = client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json=body,
        )
        res.raise_for_status()
        payload = res.json()
    choices = payload.get("choices") or []
    if not choices:
        raise RuntimeError("OpenAI returned no choices")
    return str(choices[0].get("message", {}).get("content") or "")


def _check_generate_rate_limit(workspace_id: str, plan: str) -> None:
    normalized = (plan or "free").strip().lower()
    if normalized == "pro":
        return
    now = time.time()
    with _LOCK:
        used, reset_at = _GENERATE_USAGE.get(workspace_id, (0, now + GENERATE_WINDOW_SEC))
        if now > reset_at:
            used, reset_at = 0, now + GENERATE_WINDOW_SEC
        if used >= FREE_GENERATE_PER_DAY:
            from fastapi import HTTPException

            raise HTTPException(
                status_code=429,
                detail=(
                    f"Free plan AI rule generation limit ({FREE_GENERATE_PER_DAY}/day). "
                    "Upgrade to Pro for unlimited generations."
                ),
            )
        _GENERATE_USAGE[workspace_id] = (used + 1, reset_at)


def generate_rules_yaml(prompt: str, *, workspace_id: str, plan: str) -> dict[str, str]:
    _check_generate_rate_limit(workspace_id, plan)
    user_msg = f"Write guardrail.yaml rules for:\n{prompt.strip()}"
    raw = _chat_completion(_RULES_SYSTEM, user_msg)
    yaml_text = _validate_rules_yaml(_strip_fences(raw))
    return {"rules_yaml": yaml_text}


def autofix_violation(
    *,
    code: str,
    violation: dict[str, Any],
    rules_yaml: str,
) -> dict[str, str]:
    violation_json = json.dumps(violation, indent=2)
    user_msg = (
        f"Rules YAML:\n{rules_yaml}\n\n"
        f"Violation:\n{violation_json}\n\n"
        f"Source code:\n{code}"
    )
    raw = _chat_completion(_AUTOFIX_SYSTEM, user_msg, json_mode=True)
    parsed = _parse_json_object(raw)
    explanation = str(parsed.get("explanation") or "").strip()
    patched = str(parsed.get("patched_code") or "").strip()
    diff = str(parsed.get("diff") or "").strip()
    if not patched:
        raise ValueError("LLM did not return patched_code")
    if not diff:
        diff = "".join(
            difflib.unified_diff(
                code.splitlines(keepends=True),
                patched.splitlines(keepends=True),
                fromfile="original",
                tofile="patched",
            )
        )
    return {
        "explanation": explanation or "Suggested fix applied.",
        "patched_code": patched,
        "diff": diff,
    }


def llm_configured() -> bool:
    return bool((os.getenv("LLM_API_KEY") or "").strip())