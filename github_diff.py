"""Map unified diff patches to valid PR review line numbers (RIGHT side)."""

from __future__ import annotations

import re
from typing import Any

_HUNK = re.compile(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")


def right_side_lines_from_patch(patch: str | None) -> set[int]:
    """Lines in the new file that appear in the diff (context or additions)."""
    if not patch:
        return set()
    valid: set[int] = set()
    new_line = 0
    in_hunk = False
    for raw in patch.splitlines():
        if raw.startswith("@@"):
            match = _HUNK.search(raw)
            if match:
                new_line = int(match.group(1))
            in_hunk = True
            continue
        if not in_hunk:
            continue
        if raw.startswith("\\"):
            continue
        if raw.startswith("+"):
            valid.add(new_line)
            new_line += 1
        elif raw.startswith(" "):
            valid.add(new_line)
            new_line += 1
        elif raw.startswith("-"):
            continue
    return valid


def build_pr_diff_line_map(files_meta: list[dict[str, Any]]) -> dict[str, set[int]]:
    out: dict[str, set[int]] = {}
    for item in files_meta:
        path = item.get("filename")
        if not path:
            continue
        out[str(path)] = right_side_lines_from_patch(item.get("patch"))
    return out