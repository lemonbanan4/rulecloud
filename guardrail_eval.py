"""Deterministic Python evaluation of guardrail.yaml rules (hybrid with Go CLI)."""

from __future__ import annotations

import fnmatch
import logging
import re
from pathlib import Path
from typing import Any, Optional

import yaml

logger = logging.getLogger(__name__)

SKIP_DIRS = {
    ".git",
    "node_modules",
    "vendor",
    ".venv",
    "venv",
    "__pycache__",
    "dist",
    "build",
    "target",
    ".guard",
    ".guardrail",
}

RULES_FILE_CANDIDATES = (
    ".guardrail.yml",
    "guardrail.yaml",
    "guardrail.yml",
    ".guard/general/quality.yml",
    ".guard/general/quality.yaml",
    ".guard/rules.yml",
)


def parse_rules_document(yaml_text: str) -> dict[str, Any]:
    data = yaml.safe_load(yaml_text)
    if not isinstance(data, dict):
        raise ValueError("Rules YAML root must be a mapping")
    return data


def _glob_to_regex(pattern: str) -> re.Pattern[str]:
    p = pattern.replace("\\", "/").strip()
    if p.startswith("./"):
        p = p[2:]
    parts: list[str] = []
    i = 0
    while i < len(p):
        if p[i : i + 3] == "**/":
            parts.append("(?:.*/)?")
            i += 3
        elif p[i : i + 2] == "**":
            parts.append(".*")
            i += 2
        elif p[i] == "*":
            parts.append("[^/]*")
            i += 1
        elif p[i] == "?":
            parts.append("[^/]")
            i += 1
        else:
            j = i
            while j < len(p) and p[j] not in "*?":
                j += 1
            parts.append(re.escape(p[i:j]))
            i = j
    return re.compile("^" + "".join(parts) + "$", re.IGNORECASE)


def path_matches(pattern: str, relpath: str) -> bool:
    relpath = relpath.replace("\\", "/").lstrip("./")
    if "**" in pattern or "*" in pattern or "?" in pattern:
        try:
            return _glob_to_regex(pattern).match(relpath) is not None
        except re.error:
            return fnmatch.fnmatch(relpath, pattern)
    return pattern in relpath or relpath.endswith(pattern)


def path_matches_any(patterns: list[str], relpath: str) -> bool:
    return any(path_matches(p, relpath) for p in patterns)


def _rule_patterns(rule: dict[str, Any], default_include: list[str]) -> list[str]:
    for key in ("match", "include", "files"):
        val = rule.get(key)
        if isinstance(val, str) and val.strip():
            return [val.strip()]
        if isinstance(val, list) and val:
            return [str(x) for x in val]
    return list(default_include)


def _normalize_rules_list(data: dict[str, Any]) -> tuple[list[str], list[str], list[dict[str, Any]]]:
    include = [str(x) for x in (data.get("include") or ["**/*"])]
    exclude = [str(x) for x in (data.get("exclude") or [])]
    rules = data.get("rules") or []
    if not isinstance(rules, list):
        rules = []
    norm: list[dict[str, Any]] = []
    for item in rules:
        if isinstance(item, dict) and item.get("id"):
            norm.append(item)
    return include, exclude, norm


def _finding_key(f: dict[str, Any]) -> tuple[str, str, int]:
    rid = str(f.get("id") or "")
    file_ = str(f.get("file") or "")
    line = int(f.get("line") or 0)
    return (rid, file_, line)


def dedupe_findings(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str, int]] = set()
    out: list[dict[str, Any]] = []
    for f in findings:
        key = _finding_key(f)
        if key in seen:
            continue
        seen.add(key)
        out.append(f)
    return out


def _make_finding(
    *,
    rule_id: str,
    message: str,
    file_path: str,
    line: int,
    severity: str,
    snippet: str,
    source: str = "python",
) -> dict[str, Any]:
    return {
        "id": rule_id,
        "message": message,
        "file": file_path,
        "line": line,
        "severity": severity,
        "snippet": snippet.strip()[:240],
        "source": source,
    }


def _eval_regex_rule(
    rule: dict[str, Any],
    relpath: str,
    lines: list[str],
    patterns: list[str],
) -> list[dict[str, Any]]:
    if not path_matches_any(patterns, relpath):
        return []
    raw = rule.get("pattern") or rule.get("regex") or ""
    if not raw:
        return []
    try:
        rx = re.compile(str(raw))
    except re.error as exc:
        logger.warning("Invalid regex for rule %s: %s", rule.get("id"), exc)
        return []
    sev = str(rule.get("severity") or "warning")
    msg = str(rule.get("message") or rule.get("description") or rule.get("id"))
    rid = str(rule["id"])
    out: list[dict[str, Any]] = []
    for lineno, line in enumerate(lines, start=1):
        if rx.search(line):
            out.append(
                _make_finding(
                    rule_id=rid,
                    message=msg,
                    file_path=relpath,
                    line=lineno,
                    severity=sev,
                    snippet=line,
                )
            )
    return out


def _eval_max_lines(
    rule: dict[str, Any],
    relpath: str,
    lines: list[str],
    patterns: list[str],
) -> list[dict[str, Any]]:
    max_lines = rule.get("max_lines")
    if max_lines is None:
        return []
    try:
        limit = int(max_lines)
    except (TypeError, ValueError):
        return []
    if not path_matches_any(patterns, relpath):
        return []
    if len(lines) <= limit:
        return []
    rid = str(rule["id"])
    msg = str(rule.get("message") or f"File exceeds {limit} lines ({len(lines)})")
    sev = str(rule.get("severity") or "warning")
    return [
        _make_finding(
            rule_id=rid,
            message=msg,
            file_path=relpath,
            line=1,
            severity=sev,
            snippet=f"{len(lines)} lines",
        )
    ]


def _eval_layer_rule(
    rule: dict[str, Any],
    relpath: str,
    lines: list[str],
) -> list[dict[str, Any]]:
    from_pat = rule.get("from")
    to_pat = rule.get("to")
    if not from_pat or not to_pat:
        return []
    if not path_matches(str(from_pat), relpath):
        return []
    to_s = str(to_pat).replace("\\", "/")
    to_rx: Optional[re.Pattern[str]] = None
    if any(c in to_s for c in "*?["):
        to_rx = _glob_to_regex(to_s)
    rid = str(rule["id"])
    msg = str(rule.get("message") or "Forbidden layer dependency")
    sev = str(rule.get("severity") or "medium")
    out: list[dict[str, Any]] = []
    import_markers = (
        re.compile(r"^\s*import\s+"),
        re.compile(r"^\s*from\s+"),
        re.compile(r"^\s*using\s+"),
    )
    for lineno, line in enumerate(lines, start=1):
        if not any(m.search(line) for m in import_markers):
            continue
        hit = False
        if to_rx and to_rx.search(line.replace("\\", "/")):
            hit = True
        elif to_s in line.replace("\\", "/"):
            hit = True
        elif "/data/" in to_s and re.search(r"['\"].*(\.\./data/|/data/)", line):
            hit = True
        if hit:
            out.append(
                _make_finding(
                    rule_id=rid,
                    message=msg,
                    file_path=relpath,
                    line=lineno,
                    severity=sev,
                    snippet=line,
                )
            )
    return out


def _iter_scan_files(scan_root: Path) -> list[tuple[str, Path]]:
    out: list[tuple[str, Path]] = []
    for path in scan_root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(scan_root).as_posix()
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if rel.startswith(".guard/") or rel.startswith(".guardrail/"):
            continue
        out.append((rel, path))
    return out


def evaluate_rules_on_tree(scan_root: Path, rules_yaml: str) -> list[dict[str, Any]]:
    """Evaluate rules against all files under scan_root."""
    try:
        data = parse_rules_document(rules_yaml)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Python evaluator could not parse rules: %s", exc)
        return []

    include, exclude, rules = _normalize_rules_list(data)
    findings: list[dict[str, Any]] = []

    for relpath, path in _iter_scan_files(scan_root):
        if exclude and path_matches_any(exclude, relpath):
            continue
        if not path_matches_any(include, relpath):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        lines = text.splitlines()

        for rule in rules:
            rule_type = (rule.get("type") or "").strip().lower()
            patterns = _rule_patterns(rule, include)

            if rule.get("from") and rule.get("to"):
                findings.extend(_eval_layer_rule(rule, relpath, lines))

            if rule.get("max_lines") is not None:
                findings.extend(_eval_max_lines(rule, relpath, lines, patterns))

            if rule_type in ("regex", "pattern", "") or rule.get("pattern") or rule.get("regex"):
                findings.extend(_eval_regex_rule(rule, relpath, lines, patterns))

    return dedupe_findings(findings)


def rules_yaml_for_go_cli(data: dict[str, Any]) -> str:
    """Strip to fields the Moeid Go loader accepts (KnownFields)."""
    include = data.get("include") or [
        "**/*.go",
        "**/*.js",
        "**/*.ts",
        "**/*.tsx",
        "**/*.py",
        "**/*.cs",
    ]
    go_rules: list[dict[str, Any]] = []
    for rule in data.get("rules") or []:
        if not isinstance(rule, dict) or not rule.get("id"):
            continue
        pat = rule.get("pattern") or rule.get("regex")
        if not pat:
            continue
        go_rules.append(
            {
                "id": rule["id"],
                "type": "regex",
                "description": rule.get("description") or rule.get("message") or "",
                "pattern": str(pat),
                "message": rule.get("message") or rule.get("description") or rule["id"],
            }
        )
    if not go_rules:
        return ""
    payload = {
        "version": 1,
        "timeout_ms": int(data.get("timeout_ms") or 5000),
        "include": include,
        "rules": go_rules,
    }
    return yaml.safe_dump(payload, sort_keys=False)