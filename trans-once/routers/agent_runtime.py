"""本机 agent 运行时探测与模型目录：Agent 选择器的数据源。

对齐 Multica 的选择体验——运行时列表反映本机实际安装，模型候选来自
所选 CLI 自己的枚举结果；枚举不了的给说明并保留手动输入，绝不静默
接受一个不会生效的值。
"""
import os
import subprocess
import time

from fastapi import APIRouter, Depends

import agents
from deps import get_current_user

router = APIRouter(prefix="/api", tags=["agent-runtime"], dependencies=[Depends(get_current_user)])

# 发现是对本机 CLI 的一次子进程往返，目录只会在升级 CLI / 换账号 / 改
# provider 配置时变化，5 分钟内复用上次结果（对齐 Multica 的 LIVE_MODELS_STALE_TIME）。
_TTL_SECONDS = 300
_cache: dict = {"at": 0.0, "payload": None}

# claude CLI 不支持枚举模型（--model 只接受别名或完整名，见 claude --help）。
# 本机常通过 ANTHROPIC_DEFAULT_*_MODEL_NAME 把别名映射到真实模型（如 GLM-5.3），
# 优先读映射展示真实模型；读不到再退回 CLI 帮助文档保证的别名。
_CLAUDE_ALIASES = ["sonnet", "opus", "haiku", "fable"]


def _acp_installed() -> bool:
    try:
        import acp_agent

        return acp_agent.resolve_transcode_cli()[0] is not None
    except Exception:
        return False


def _installed(cli: str) -> bool:
    return agents.resolve_cli(cli)[0] is not None


def _opencode_models() -> tuple[list[dict], str | None]:
    bin_path, extra_dir = agents.resolve_cli("opencode")
    if not bin_path:
        return [], "本机未安装 opencode"
    env = dict(os.environ)
    if extra_dir:
        env["PATH"] = extra_dir + os.pathsep + env.get("PATH", "")
    try:
        proc = subprocess.run(
            [bin_path, "models"], capture_output=True, text=True, timeout=15, env=env
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        return [], f"opencode models 执行失败：{e}"
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()[:200]
        return [], f"opencode models 返回非零：{detail or proc.returncode}"
    models = []
    for line in proc.stdout.splitlines():
        mid = line.strip()
        if not mid or "/" not in mid:
            continue
        models.append({"id": mid, "provider": mid.split("/", 1)[0]})
    return models, None


def _claude_models() -> tuple[list[dict], str]:
    mapping = {
        alias: os.getenv(f"ANTHROPIC_DEFAULT_{alias.upper()}_MODEL_NAME")
        for alias in _CLAUDE_ALIASES
    }
    mapping = {a: real for a, real in mapping.items() if real}
    if not mapping:
        return (
            [{"id": a, "provider": "claude"} for a in _CLAUDE_ALIASES],
            "Claude Code 不支持枚举模型：候选为 CLI 别名，也可手动输入完整模型名。",
        )
    real_names: list[str] = []
    for real in mapping.values():
        if real not in real_names:
            real_names.append(real)
    summary = "、".join(f"{a}→{r}" for a, r in mapping.items())
    note = f"已读取本机 Claude Code 模型映射（{summary}）；留空即用默认，选真实模型名最准确。"
    return [{"id": r, "provider": "claude"} for r in real_names], note


@router.get("/agent-runtime")
def agent_runtime() -> dict:
    now = time.time()
    if _cache["payload"] is not None and now - _cache["at"] < _TTL_SECONDS:
        return _cache["payload"]
    oc_models, oc_error = (
        _opencode_models() if _installed("opencode") else ([], "本机未安装 opencode")
    )
    cl_models, cl_note = _claude_models()
    payload = {
        "providers": {
            "auto": {
                "installed": True,
                "supported": True,
                "models": [],
                "note": "自动模式跟随平台解析到的 CLI；要精确控制模型，请选定具体运行时。",
            },
            "transcode": {
                "installed": _acp_installed(),
                "supported": True,
                "models": [
                    {"id": "opus", "name": "Claude Opus"},
                    {"id": "gpt", "name": "GPT-4o"},
                    {"id": "deepseek", "name": "DeepSeek"},
                    {"id": "glm", "name": "GLM"},
                    {"id": "minimax", "name": "MiniMax"},
                    {"id": "kimi", "name": "Kimi"},
                ],
                "note": "transcode（ACP，默认）：模型经 ~/.transcode.json / TRANSCODE_MODEL 配置。",
            },
            "claude": {
                "installed": _installed("claude"),
                "supported": True,
                "models": cl_models,
                "note": cl_note,
            },
            "opencode": {
                "installed": _installed("opencode"),
                "supported": True,
                "models": oc_models,
                **({"error": oc_error} if oc_error else {}),
                "note": None if oc_error else "模型列表来自本机 opencode CLI。",
            },
        }
    }
    _cache["at"], _cache["payload"] = now, payload
    return payload
