#!/usr/bin/env python3
"""Quick test for PR diff line mapping."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from github_diff import right_side_lines_from_patch

PATCH = """@@ -0,0 +1,14 @@
+/**
+ * Intentionally broken for RuleCloud PR demo — do not merge.
+ */
+
+import { listUserIds } from "../data/users";
+
+const API_KEY = "demo_hardcoded_secret_123";
+
+export function checkoutDraft(): string {
+  // TODO: replace with real billing integration
+"""

def main() -> int:
    lines = right_side_lines_from_patch(PATCH)
    for need in (5, 8, 11):
        if need not in lines:
            print("FAIL: expected line", need, "in diff map", sorted(lines))
            return 1
    print("PASS: diff lines", sorted(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())