#!/usr/bin/env bash
# TransOnce backend — fixed development port 9005.
# Runs in the dedicated conda env `transonce` (python 3.12 + requirements.txt).
set -euo pipefail
cd "$(dirname "$0")"
exec /usr/local/Caskroom/miniconda/base/envs/transonce/bin/python -m uvicorn main:app \
  --host 0.0.0.0 --port 9005 --log-level info
