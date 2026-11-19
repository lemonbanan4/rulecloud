#!/usr/bin/env python3
"""Verify hybrid scanner finds violations in sample checkout.ts."""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scan_runner import run_scan_directory

CHECKOUT = '''\
import { listUserIds } from "../data/users";

const API_KEY = "demo_hardcoded_secret_123";

export function checkoutDraft(): string {
  // TODO: replace with real billing integration
  const users = listUserIds();
  return `checkout:${users.length}:${API_KEY.slice(0, 4)}***`;
}
'''

RULES = """\
version: 1
include:
  - "**/*.ts"
rules:
  - id: hardcoded-credential
    severity: high
    type: regex
    pattern: '(?i)(api_key|password|secret|token)\\s*=\\s*"[^"]{6,}"'
    message: Hardcoded credential
  - id: presentation-imports-data
    severity: medium
    from: "**/presentation/**"
    to: "**/data/**"
    message: Layer violation
  - id: hygiene-todo
    severity: low
    type: regex
    pattern: '(?i)\\b(TODO|FIXME)\\b'
    message: Unresolved TODO
"""


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        target = root / "internal" / "presentation" / "checkout.ts"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(CHECKOUT, encoding="utf-8")
        result = run_scan_directory(root, RULES)

    if result.status != "violations":
        print("FAIL: expected violations, got", result.status, result.error)
        print("meta:", result.meta)
        return 1

    ids = {str(f.get("id")) for f in result.findings}
    expected = {"hardcoded-credential", "presentation-imports-data", "hygiene-todo"}
    missing = expected - ids
    if missing:
        print("FAIL: missing rule ids:", missing)
        for f in result.findings:
            print(" ", f)
        return 1

    by_file = [f for f in result.findings if "checkout.ts" in str(f.get("file"))]
    if len(by_file) < 3:
        print("FAIL: expected at least 3 findings on checkout.ts, got", by_file)
        return 1

    print("PASS:", len(result.findings), "findings", result.meta.get("python_findings_count"))
    for f in sorted(result.findings, key=lambda x: (x.get("file"), x.get("line"))):
        print(
            f"  {f.get('id')} {f.get('file')}:{f.get('line')} — {f.get('message')}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())