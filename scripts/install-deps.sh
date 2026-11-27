#!/usr/bin/env bash
# Install backend deps into ./venv — do not use system pip (often broken on macOS).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PYTHON="${PYTHON:-python3}"
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "error: $PYTHON not found" >&2
  exit 1
fi

if [[ ! -d venv ]]; then
  echo "Creating venv..."
  "$PYTHON" -m venv venv
fi

# noqa: venv activation
source venv/bin/activate

python -m pip install -U pip
python -m pip install -r requirements.txt

echo "Done. Activate with: source venv/bin/activate"