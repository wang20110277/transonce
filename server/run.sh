#!/usr/bin/env bash
# TransOnce backend — fixed development port 9005.
set -euo pipefail
cd "$(dirname "$0")/.."
exec .venv/bin/uvicorn main:app --app-dir server --host 0.0.0.0 --port 9005 --reload
