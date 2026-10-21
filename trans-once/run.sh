#!/usr/bin/env bash
# TransOnce backend — fixed development port 9005.
# Uses the local python3 (project .venv intentionally ignored even if on PATH).
set -euo pipefail
cd "$(dirname "$0")/.."
PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '/\.venv/bin$' | paste -sd: -)"
exec python3 -m uvicorn main:app --app-dir trans-once --host 0.0.0.0 --port 9005 --reload
