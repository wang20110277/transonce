"""本机 agent 运行时探测与模型目录：Agent 选择器的数据源。

对齐 Multica 的选择体验——运行时列表反映本机实际安装，模型候选来自
所选 CLI 自己的枚举结果；枚举不了的给说明并保留手动输入，绝不静默
接受一个不会生效的值。
"""
import shutil
import subprocess
import time

from fastapi import APIRouter, Depends

from deps import get_current_user

router = APIRouter(prefix="/api", tags=["agent-runtime"], dependencies=[Depends(get_current_user)])

# 发现是对本机 CLI 的一次子进程往返，目录只会在升级 CLI / 换账号 / 改
# provider 配置时变化，5 分钟内复用上次结果（对齐 Multica 的 LIVE_MODELS_STALE_TIME）。
_TTL_SECONDS = 300
_cache: dict = {"at": 0.0, "payload": None}

# claude CLI 不支持枚举模型（--model 只接受别名或完整名，见 claude --help），
# 以下别名来自该帮助文档；完整模型名仍可手动输入。
_CLAUDE_ALIASES = ["sonnet", "opus", "haiku", "fable"]


def _installed(cli: str) -> bool:
    return shutil.which(cli) is not None


def _opencode_models() -> tuple[list[dict], str | None]:
    try:
        proc = subprocess.run(
            ["opencode", "models"], capture_output=True, text=True, timeout=15
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


@router.get("/agent-runtime")
def agent_runtime() -> dict:
    now = time.time()
    if _cache["payload"] is not None and now - _cache["at"] < _TTL_SECONDS:
        return _cache["payload"]
    oc_models, oc_error = (
        _opencode_models() if _installed("opencode") else ([], "本机未安装 opencode")
    )
    payload = {
        "providers": {
            "auto": {
                "installed": True,
                "supported": True,
                "models": [],
                "note": "自动模式跟随平台解析到的 CLI；要精确控制模型，请选定具体运行时。",
            },
            "mock": {
                "installed": True,
                "supported": False,
                "models": [],
                "note": "Mock 不使用模型，留空即可。",
            },
            "claude": {
                "installed": _installed("claude"),
                "supported": True,
                "models": [{"id": a, "provider": "claude"} for a in _CLAUDE_ALIASES],
                "note": "Claude Code 不支持枚举模型：候选为 CLI 别名，也可手动输入完整模型名。",
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
