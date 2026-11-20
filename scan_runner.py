"""Run Guardrail CLI against an isolated workspace directory."""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Optional

from defaults import DEFAULT_RULES_YAML
from guardrail_eval import (
    evaluate_rules_on_tree,
    parse_rules_document,
    rules_yaml_for_go_cli,
)

logger = logging.getLogger(__name__)

GUARDRAIL_BIN = os.getenv("GUARDRAIL_BIN", "guardrail")
GUARDRAIL_TIMEOUT_SEC = int(os.getenv("GUARDRAIL_TIMEOUT_SEC", "60"))
GIT_CLONE_TIMEOUT_SEC = int(os.getenv("GIT_CLONE_TIMEOUT_SEC", "30"))
DEFAULT_SNIPPET_FILENAME = "snippet.txt"


ScanStatus = Literal["pass", "violations", "error"]


@dataclass
class ScanResult:
    status: ScanStatus
    exit_code: int
    findings: list[dict[str, Any]] = field(default_factory=list)
    suppressions: list[dict[str, Any]] = field(default_factory=list)
    stdout: str = ""
    stderr: str = ""
    duration_ms: int = 0
    error: Optional[str] = None
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "status": self.status,
            "exit_code": self.exit_code,
            "findings": self.findings,
            "suppressions": self.suppressions,
            "duration_ms": self.duration_ms,
            "stdout": self.stdout,
            "stderr": self.stderr,
            "meta": self.meta,
        }
        if self.error:
            payload["error"] = self.error
        return payload


def guardrail_available() -> tuple[bool, str]:
    """Return whether the guardrail binary is on PATH and runnable."""
    path = shutil.which(GUARDRAIL_BIN)
    if not path:
        return False, f"{GUARDRAIL_BIN} not found on PATH"
    try:
        proc = subprocess.run(
            [path, "--version"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        detail = (proc.stdout or proc.stderr or "").strip() or "unknown version"
        if proc.returncode != 0:
            return False, detail
        return True, detail
    except subprocess.TimeoutExpired:
        return False, "guardrail --version timed out"
    except OSError as exc:
        return False, str(exc)


def _parse_findings(stdout: str) -> list[dict[str, Any]]:
    """Best-effort parse of JSON or structured CLI output."""
    if not stdout.strip():
        return []

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError:
        return _parse_text_findings(stdout)

    if isinstance(data, list):
        return [_normalize_finding(item) for item in data if isinstance(item, dict)]

    if not isinstance(data, dict):
        return []

    # MoeidHeidari/guardrail: guardrail check --format json
    files = data.get("files")
    if isinstance(files, list):
        flattened: list[dict[str, Any]] = []
        for file_result in files:
            if not isinstance(file_result, dict):
                continue
            for item in file_result.get("findings") or []:
                if isinstance(item, dict):
                    flattened.append(_normalize_finding(item))
        if flattened:
            return flattened

    for key in ("findings", "violations", "issues", "results", "data"):
        bucket = data.get(key)
        if isinstance(bucket, list):
            return [_normalize_finding(item) for item in bucket if isinstance(item, dict)]
        if isinstance(bucket, dict):
            nested = bucket.get("findings") or bucket.get("violations") or bucket.get("issues")
            if isinstance(nested, list):
                return [_normalize_finding(item) for item in nested if isinstance(item, dict)]

    return []


def _normalize_finding(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id") or item.get("rule") or item.get("ruleId"),
        "message": item.get("message") or item.get("description") or item.get("title"),
        "severity": item.get("severity") or item.get("level") or item.get("kind"),
        "file": item.get("file") or item.get("path") or item.get("filename"),
        "line": item.get("line") or item.get("startLine") or item.get("location", {}).get("line")
        if isinstance(item.get("location"), dict)
        else item.get("line"),
        "raw": item,
    }


def _parse_text_findings(stdout: str) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    pattern = re.compile(
        r"(?P<file>[^:]+):(?P<line>\d+)(?::\d+)?:\s*(?P<msg>.+)",
    )
    for line in stdout.splitlines():
        match = pattern.match(line.strip())
        if match:
            findings.append(
                {
                    "file": match.group("file"),
                    "line": int(match.group("line")),
                    "message": match.group("msg").strip(),
                    "raw": {"line": line.strip()},
                }
            )
    return findings


def _git_clone_shallow(repo_url: str, dest: Path, branch: Optional[str] = None) -> None:
    cmd = ["git", "clone", "--depth", "1", repo_url, str(dest)]
    if branch:
        cmd.insert(4, "--branch")
        cmd.insert(5, branch)
    subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=GIT_CLONE_TIMEOUT_SEC,
        check=True,
    )


def _build_guardrail_cmd(_workdir: Path) -> list[str]:
    """MoeidHeidari/guardrail: `guardrail check` against `.guard/**/*.yml`."""
    extra = os.getenv("GUARDRAIL_ARGS", "").strip()
    cmd = [GUARDRAIL_BIN, "check", ".", "--format", "json"]
    if extra:
        cmd.extend(extra.split())
    return cmd


def _probe_guardrail_cli() -> dict[str, Any]:
    """Discover supported guardrail subcommands."""
    meta: dict[str, Any] = {
        "binary": GUARDRAIL_BIN,
        "on_path": bool(shutil.which(GUARDRAIL_BIN)),
        "subcommands": [],
        "version_stdout": "",
        "version_stderr": "",
        "version_exit_code": None,
    }
    if not meta["on_path"]:
        return meta
    try:
        ver = subprocess.run(
            [GUARDRAIL_BIN, "--version"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        meta["version_exit_code"] = ver.returncode
        meta["version_stdout"] = ver.stdout or ""
        meta["version_stderr"] = ver.stderr or ""
    except (OSError, subprocess.TimeoutExpired) as exc:
        meta["probe_error"] = str(exc)
        return meta
    try:
        help_proc = subprocess.run(
            [GUARDRAIL_BIN, "--help"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        text = (help_proc.stdout or "") + (help_proc.stderr or "")
        for sub in ("check", "watch", "ci", "scan", "rules"):
            if sub in text.lower():
                meta["subcommands"].append(sub)
    except (OSError, subprocess.TimeoutExpired):
        pass
    if "check" not in meta["subcommands"]:
        meta["subcommands"].append("check")
    return meta


def _write_guard_rules(scan_root: Path, rules_yaml: str) -> None:
    """Materialize rules for Go CLI, `.guardrail/`, and legacy root files."""
    try:
        data = parse_rules_document(rules_yaml)
    except Exception:  # noqa: BLE001
        data = parse_rules_document(DEFAULT_RULES_YAML)

    guardrail_dir = scan_root / ".guardrail"
    guardrail_dir.mkdir(parents=True, exist_ok=True)
    (guardrail_dir / "rules.yml").write_text(rules_yaml, encoding="utf-8")

    guard_dir = scan_root / ".guard" / "general"
    guard_dir.mkdir(parents=True, exist_ok=True)

    go_yaml = rules_yaml_for_go_cli(data)
    if go_yaml:
        (guard_dir / "quality.yml").write_text(go_yaml, encoding="utf-8")
    else:
        (guard_dir / "quality.yml").write_text(rules_yaml, encoding="utf-8")

    (scan_root / "guardrail.yaml").write_text(rules_yaml, encoding="utf-8")
    (scan_root / ".guardrail.yml").write_text(rules_yaml, encoding="utf-8")


def _run_go_guardrail(scan_root: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Run Go guardrail check when available; return findings + CLI metadata."""
    cli_meta: dict[str, Any] = {
        "probe": _probe_guardrail_cli(),
        "command": None,
        "exit_code": None,
        "stdout": "",
        "stderr": "",
        "skipped": False,
        "skip_reason": None,
        "cli_findings_count": 0,
        "unrecognized_command": False,
    }
    if not cli_meta["probe"].get("on_path"):
        cli_meta["skipped"] = True
        cli_meta["skip_reason"] = f"{GUARDRAIL_BIN} not on PATH"
        return [], cli_meta

    cmd = _build_guardrail_cmd(scan_root)
    cli_meta["command"] = " ".join(cmd)
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(scan_root),
            capture_output=True,
            text=True,
            timeout=GUARDRAIL_TIMEOUT_SEC,
        )
    except subprocess.TimeoutExpired:
        cli_meta["skipped"] = True
        cli_meta["skip_reason"] = "CLI timed out"
        return [], cli_meta

    cli_meta["exit_code"] = proc.returncode
    cli_meta["stdout"] = proc.stdout or ""
    cli_meta["stderr"] = proc.stderr or ""
    stderr_lc = cli_meta["stderr"].lower()
    if any(
        phrase in stderr_lc
        for phrase in ("unknown command", "not defined", "invalid command", "usage:")
    ) and proc.returncode != 0:
        cli_meta["unrecognized_command"] = True

    findings = _parse_findings(cli_meta["stdout"])
    for item in findings:
        item.setdefault("source", "go")
    cli_meta["cli_findings_count"] = len(findings)
    return findings, cli_meta


def _merge_findings(
    python_findings: list[dict[str, Any]],
    go_findings: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[tuple[str, str, int]] = set()
    for item in python_findings + go_findings:
        rid = str(item.get("id") or "")
        file_ = str(item.get("file") or "")
        line = int(item.get("line") or 0)
        key = (rid, file_, line)
        if key in seen:
            continue
        seen.add(key)
        merged.append(item)
    return merged


def _resolve_scan_status(
    merged: list[dict[str, Any]],
    cli_meta: dict[str, Any],
) -> tuple[ScanStatus, Optional[str], int]:
    """Never report pass when CLI failed without findings and Python found nothing."""
    exit_code = cli_meta.get("exit_code")
    if merged:
        return "violations", None, exit_code if exit_code is not None else 1

    if cli_meta.get("skipped"):
        reason = cli_meta.get("skip_reason") or "CLI skipped"
        if f"{GUARDRAIL_BIN} not on PATH" in reason:
            return "pass", None, 0
        return "error", reason, -1

    if exit_code == 0:
        return "pass", None, 0

    if exit_code in (1, 2) and (cli_meta.get("cli_findings_count") or 0) == 0:
        err = (cli_meta.get("stderr") or "").strip() or "Guardrail CLI reported violations but returned no parseable findings"
        return "error", err, exit_code or -1

    if cli_meta.get("unrecognized_command"):
        return "error", "Unrecognized guardrail CLI command", exit_code or -1

    if exit_code not in (0, None):
        err = (cli_meta.get("stderr") or "Guardrail CLI failed").strip()
        return "error", err[:500], exit_code or -1

    return "pass", None, exit_code or 0


def _run_hybrid_scan(scan_root: Path, rules_yaml: str, start: float) -> ScanResult:
    _write_guard_rules(scan_root, rules_yaml)
    python_findings, suppressions = evaluate_rules_on_tree(scan_root, rules_yaml)
    go_findings, cli_meta = _run_go_guardrail(scan_root)
    merged = _merge_findings(python_findings, go_findings)
    status, error, exit_code = _resolve_scan_status(merged, cli_meta)
    if status == "error":
        exit_code = exit_code if exit_code not in (0, None) else -1
    duration_ms = int((time.perf_counter() - start) * 1000)
    meta = {
        "cli": cli_meta,
        "python_findings_count": len(python_findings),
        "go_findings_count": len(go_findings),
        "merged_count": len(merged),
        "suppressions_count": len(suppressions),
    }
    return ScanResult(
        status=status,
        exit_code=exit_code if exit_code is not None else 0,
        findings=merged,
        suppressions=suppressions,
        stdout=cli_meta.get("stdout", ""),
        stderr=cli_meta.get("stderr", ""),
        duration_ms=duration_ms,
        error=error,
        meta=meta,
    )


SUPPORTED_CODE_EXTENSIONS = frozenset(
    {
        ".py",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".cs",
        ".go",
        ".java",
        ".rb",
        ".php",
        ".rs",
        ".kt",
    }
)


def run_scan_directory(scan_root: Path, rules_yaml: str) -> ScanResult:
    """Run hybrid Python + Go guardrail on an existing directory tree."""
    start = time.perf_counter()
    try:
        return _run_hybrid_scan(scan_root, rules_yaml, start)
    except subprocess.TimeoutExpired:
        return ScanResult(
            status="error",
            exit_code=-1,
            error=f"guardrail timed out after {GUARDRAIL_TIMEOUT_SEC}s",
            duration_ms=int((time.perf_counter() - start) * 1000),
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("run_scan_directory failed")
        return ScanResult(
            status="error",
            exit_code=-1,
            error=str(exc),
            duration_ms=int((time.perf_counter() - start) * 1000),
        )


def run_scan(
    *,
    repo_url: Optional[str] = None,
    code_snippet: Optional[str] = None,
    filename: Optional[str] = None,
    rules_yaml: str = DEFAULT_RULES_YAML,
    branch: Optional[str] = None,
) -> ScanResult:
    """Clone or materialize code, run guardrail, return structured result."""
    start = time.perf_counter()
    workdir: Optional[tempfile.TemporaryDirectory[str]] = None

    try:
        if not repo_url and not code_snippet:
            return ScanResult(
                status="error",
                exit_code=-1,
                error="Either repo_url or code_snippet is required",
                duration_ms=int((time.perf_counter() - start) * 1000),
            )

        workdir = tempfile.TemporaryDirectory(prefix="rulecloud-scan-")
        root = Path(workdir.name)

        if repo_url:
            clone_dest = root / "repo"
            clone_dest.mkdir(parents=True, exist_ok=True)
            try:
                _git_clone_shallow(repo_url, clone_dest, branch=branch)
            except subprocess.CalledProcessError as exc:
                return ScanResult(
                    status="error",
                    exit_code=exc.returncode,
                    stderr=exc.stderr or "",
                    stdout=exc.stdout or "",
                    error=f"git clone failed: {(exc.stderr or exc.stdout or '').strip()}",
                    duration_ms=int((time.perf_counter() - start) * 1000),
                )
            except subprocess.TimeoutExpired:
                return ScanResult(
                    status="error",
                    exit_code=-1,
                    error=f"git clone timed out after {GIT_CLONE_TIMEOUT_SEC}s",
                    duration_ms=int((time.perf_counter() - start) * 1000),
                )
            scan_root = clone_dest
        else:
            scan_root = root / "snippet"
            scan_root.mkdir(parents=True, exist_ok=True)
            target_name = filename or DEFAULT_SNIPPET_FILENAME
            (scan_root / target_name).write_text(code_snippet or "", encoding="utf-8")

        try:
            return _run_hybrid_scan(scan_root, rules_yaml, start)
        except subprocess.TimeoutExpired:
            return ScanResult(
                status="error",
                exit_code=-1,
                error=f"guardrail timed out after {GUARDRAIL_TIMEOUT_SEC}s",
                duration_ms=int((time.perf_counter() - start) * 1000),
            )
    except Exception as exc:  # noqa: BLE001 — surface scan failures to API clients
        logger.exception("scan failed")
        return ScanResult(
            status="error",
            exit_code=-1,
            error=str(exc),
            duration_ms=int((time.perf_counter() - start) * 1000),
        )
    finally:
        if workdir is not None:
            workdir.cleanup()