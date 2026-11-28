#!/usr/bin/env bash
# TransOnce backend — fixed development port 9005.
# Runs in the dedicated conda env `transonce` (python 3.12 + requirements.txt);
# falls back to `python3` when the env is unavailable.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p logs
CONDA_PY="$(conda info --base 2>/dev/null)/envs/transonce/bin/python"
[ -x "$CONDA_PY" ] || CONDA_PY="$(command -v python3)"
nohup "$CONDA_PY" -m uvicorn main:app \
  --host 0.0.0.0 --port 9005 --log-level info >> logs/transonce.log 2>&1 &
echo "Transonce 后端已后台启动 (pid $!) ,日志:logs/transonce.log)"
