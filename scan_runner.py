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
    stdout: str = ""
    stderr: str = ""
    duration_ms: int = 0
    error: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "status": self.status,
            "exit_code": self.exit_code,
            "findings": self.findings,
            "duration_ms": self.duration_ms,
            "stdout": self.stdout,
            "stderr": self.stderr,
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
        "severity": item.get("severity") or item.get("level"),
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


def _build_guardrail_cmd(workdir: Path) -> list[str]:
    extra = os.getenv("GUARDRAIL_ARGS", "").strip()
    cmd = [GUARDRAIL_BIN, "scan", "."]
    if extra:
        cmd.extend(extra.split())
    else:
        # Common flags across Guardrail CLI distributions
        cmd.extend(["--json"])
    config_path = workdir / "guardrail.yaml"
    if config_path.is_file():
        cmd.extend(["--config", str(config_path)])
    return cmd


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

        (scan_root / "guardrail.yaml").write_text(rules_yaml, encoding="utf-8")

        if not shutil.which(GUARDRAIL_BIN):
            return ScanResult(
                status="error",
                exit_code=-1,
                error=f"{GUARDRAIL_BIN} not found on PATH",
                duration_ms=int((time.perf_counter() - start) * 1000),
            )

        cmd = _build_guardrail_cmd(scan_root)
        try:
            proc = subprocess.run(
                cmd,
                cwd=str(scan_root),
                capture_output=True,
                text=True,
                timeout=GUARDRAIL_TIMEOUT_SEC,
            )
        except subprocess.TimeoutExpired:
            return ScanResult(
                status="error",
                exit_code=-1,
                error=f"guardrail timed out after {GUARDRAIL_TIMEOUT_SEC}s",
                duration_ms=int((time.perf_counter() - start) * 1000),
            )

        findings = _parse_findings(proc.stdout)
        duration_ms = int((time.perf_counter() - start) * 1000)

        if proc.returncode == 0:
            status: ScanStatus = "pass"
        elif findings or proc.returncode in (1, 2):
            status = "violations"
        else:
            status = "error"

        return ScanResult(
            status=status,
            exit_code=proc.returncode,
            findings=findings,
            stdout=proc.stdout,
            stderr=proc.stderr,
            duration_ms=duration_ms,
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