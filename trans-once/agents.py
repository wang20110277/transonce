"""Agent runtime: drive real coding agents (claude / opencode) as subprocesses,
with a deterministic mock fallback so the platform always works offline.
"""
import json
import os
import re
import shutil
import signal
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone

import mock_agent
from config import (
    AGENT_AGENTIC_DISALLOWED_TOOLS,
    AGENT_AGENTIC_TIMEOUT_MS,
    AGENT_CLI_DISALLOWED_TOOLS,
    AGENT_EXECUTION_MODE,
    AGENT_FALLBACK_MOCK,
    AGENT_MAX_PROMPT_CHARS,
    AGENT_PROVIDER,
    AGENT_TIMEOUT_MS,
    AGENT_WORKDIR,
)

# Environment variables a coding CLI actually needs (auth lives in HOME/XDG).
# Crucially this excludes DATABASE_URL / SECRET_KEY / ADMIN_PASSWORD.
_AGENT_ENV_KEYS = {
    "PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TERM", "USER",
    "LOGNAME", "SHELL", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
}
_agent_cwd: str | None = None


def _child_env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k in _AGENT_ENV_KEYS}
    # Claude 别名映射（如 sonnet→GLM-5.3）是模型名而非机密，透传可让子进程
    # CLI 的模型解析与用户终端保持一致。
    env.update(
        {k: v for k, v in os.environ.items() if k.startswith("ANTHROPIC_DEFAULT_")}
    )
    return env


def resolve_cli(provider: str) -> tuple[str | None, str | None]:
    """解析本地 agent CLI 的绝对路径 → (路径, 需补充进 PATH 的目录)。

    shutil.which 只看进程 PATH，而 claude/opencode 装在 nvm 的 bin 里——
    后端可能由未加载 nvm 的环境启动（PATH 里没有它们），因此再兜底扫描
    nvm 与常见安装位置，让解析与"后端由谁启动"无关。CLI 是 node 脚本，
    兜底命中时把所在目录补进子进程 PATH，node 解释器才能被找到。
    """
    cli = {"claude": "claude", "opencode": "opencode"}.get(provider)
    if not cli:
        return None, None
    hit = shutil.which(cli)
    if hit:
        return hit, None
    candidates: list[str] = []
    nvm_root = os.path.expanduser("~/.nvm/versions/node")
    if os.path.isdir(nvm_root):
        for ver in sorted(os.listdir(nvm_root), reverse=True):
            candidates.append(os.path.join(nvm_root, ver, "bin", cli))
    candidates += [
        os.path.expanduser(f"~/.local/bin/{cli}"),
        os.path.expanduser(f"~/bin/{cli}"),
        f"/usr/local/bin/{cli}",
        f"/opt/homebrew/bin/{cli}",
    ]
    for c in candidates:
        if os.access(c, os.X_OK):
            return c, os.path.dirname(c)
    return None, None


def _agent_workdir() -> str:
    global _agent_cwd
    if _agent_cwd is None:
        _agent_cwd = AGENT_WORKDIR or tempfile.mkdtemp(prefix="transonce-agent-")
        os.makedirs(_agent_cwd, exist_ok=True)
    return _agent_cwd


JSON_ONLY = "只输出 JSON，不要任何解释、前后缀或 markdown 代码块。"

CONTRACT_RULES = """## 运行规则

- 你在一个专属于本次运行的临时工作目录中自主工作，可以读写本目录并在其中执行命令来完成任务。
- 不要离开本目录去读写其他路径；TransOnce 的数据库与密钥对你不可达，也不要尝试访问。
- 完成任务后，最终回复只包含任务要求的结果本身，不要附加解释、前后缀或多余内容。"""


def _resolve_agentic(agentic: bool | None) -> bool:
    if agentic is not None:
        return agentic
    return AGENT_EXECUTION_MODE == "agentic"


def _new_run_workdir() -> str:
    """A private workspace per agent run — the way a local agent runtime gives
    each run its own sandbox. Stays outside the platform tree so the CLI can
    never reach .env or database credentials."""
    base = AGENT_WORKDIR or os.path.join(tempfile.gettempdir(), "transonce-agent")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = os.path.join(base, f"run-{stamp}-{uuid.uuid4().hex[:8]}")
    os.makedirs(run_dir, exist_ok=True)
    return run_dir


def _write_contract(run_dir: str, system_prompt: str) -> None:
    """Drop the run contract into the workspace; CLIs pick it up from their
    cwd (Claude Code reads CLAUDE.md, opencode reads AGENTS.md)."""
    content = f"# TransOnce Agent 运行契约\n\n{system_prompt}\n\n{CONTRACT_RULES}\n"
    for name in ("CLAUDE.md", "AGENTS.md"):
        with open(os.path.join(run_dir, name), "w", encoding="utf-8") as fh:
            fh.write(content)

ROLE_PROMPTS = {
    "extractor": "你是 TransOnce 平台的「需求架构师」Agent。从会议纪要中提取结构化的产品需求。",
    "designer": "你是 TransOnce 平台的「产品与架构设计」Agent。产出原型页面结构、交互流程与技术架构。",
    "breakdown": "你是 TransOnce 平台的「任务拆解师」Agent。把需求拆解为可验收的研发任务。",
    "coder": "你是 TransOnce 平台的「编码助手」Agent。生成可运行的最小代码骨架与单测。",
    "tester": "你是 TransOnce 平台的「测试专家」Agent。设计覆盖验收标准的测试用例。",
    "deployer": "你是 TransOnce 平台的「部署专家」Agent。设计 CI/CD 流水线与部署方案。",
    "assistant": "你是 TransOnce 平台中该用户的专属研发 Agent，负责通过对话推进整个研发链路。",
}


def get_provider(requested: str | None = None) -> str:
    req = (requested or "auto").lower()
    env_provider = (AGENT_PROVIDER or "auto").lower()
    if req == "auto":
        # An explicit platform setting wins over per-agent auto detection.
        if env_provider in ("mock", "claude", "opencode"):
            req = env_provider
        else:
            req = "auto"
    if req == "mock":
        return "mock"
    if req in ("claude", "opencode"):
        if shutil.which(req):
            return req
        return "mock" if AGENT_FALLBACK_MOCK else req
    if os.getenv("AGENT_DISABLE_CLI") == "1":
        return "mock"
    for candidate in ("claude", "opencode"):
        if shutil.which(candidate):
            return candidate
    return "mock"


def run_agent_text(
    system_prompt: str,
    user_prompt: str,
    provider: str | None = None,
    agentic: bool | None = None,
    json_only: bool = True,
    model: str | None = None,
) -> str:
    p = get_provider(provider)
    if p == "mock":
        return mock_agent.chat_reply(user_prompt)
    mode = _resolve_agentic(agentic)
    header = system_prompt if not json_only else f"{system_prompt}\n\n{JSON_ONLY}"
    combined = f"{header}\n\n===\n\n{user_prompt}"
    if len(combined) > AGENT_MAX_PROMPT_CHARS:
        combined = combined[:AGENT_MAX_PROMPT_CHARS] + "\n\n[内容过长，已截断]"
    if mode:
        # Multica-style autonomous run: private workspace, contract file,
        # tool access, longer budget.
        cwd = _new_run_workdir()
        _write_contract(cwd, system_prompt)
        timeout_ms = AGENT_AGENTIC_TIMEOUT_MS
        disallowed = AGENT_AGENTIC_DISALLOWED_TOOLS
    else:
        cwd = _agent_workdir()
        timeout_ms = AGENT_TIMEOUT_MS
        disallowed = AGENT_CLI_DISALLOWED_TOOLS
    if p == "claude":
        # Prompt goes over stdin: avoids argv limits and keeps notes out of `ps`.
        args = ["--print", "--output-format", "text"]
        if model:
            args += ["--model", model]
        if disallowed:
            args += ["--disallowedTools", disallowed]
        if mode:
            # Autonomous run needs unattended tool use; containment is the
            # throwaway workspace plus the env whitelist, not permission prompts.
            args.append("--dangerously-skip-permissions")
        stdin_text: str | None = combined
    else:
        # `opencode run` takes the message as argv; length is capped above.
        args = ["run"] + (["--model", model] if model else []) + [combined]
        stdin_text = None
    timeout = timeout_ms / 1000
    bin_path, extra_dir = resolve_cli(p)
    child_env = _child_env()
    if extra_dir:
        child_env["PATH"] = extra_dir + os.pathsep + child_env.get("PATH", "")
    proc = subprocess.Popen(
        [bin_path or p] + args,
        stdin=subprocess.PIPE if stdin_text is not None else subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=cwd,
        env=child_env,
        start_new_session=True,
    )
    try:
        stdout, stderr = proc.communicate(stdin_text, timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except Exception:
            proc.kill()
        proc.communicate()
        raise RuntimeError(f"agent ({p}) timed out after {timeout:.0f}s")
    if proc.returncode != 0:
        raise RuntimeError(f"agent ({p}) exited {proc.returncode}: {(stderr or '')[:800]}")
    return stdout


def runtime_info(provider: str | None = None, model: str | None = None) -> dict:
    """Cheap snapshot for run records: which provider/model and execution mode
    a run would use right now."""
    return {
        "provider": get_provider(provider),
        "model": model or "",
        "mode": "agentic" if _resolve_agentic(None) else "text",
    }


def parse_agent_json(text: str):
    t = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", t)
    if fence:
        t = fence.group(1).strip()
    m = re.search(r"[\[{]", t)
    if not m:
        return None
    open_ch = t[m.start()]
    close_ch = "}" if open_ch == "{" else "]"
    end = t.rfind(close_ch)
    if end == -1 or end <= m.start():
        return None
    try:
        return json.loads(t[m.start(): end + 1])
    except Exception:
        return None


def _run_json(system: str, user: str, provider: str | None, model: str | None = None):
    p = get_provider(provider)
    if p == "mock":
        return None
    try:
        parsed = parse_agent_json(run_agent_text(system, user, p, model=model))
        return parsed
    except Exception:
        if AGENT_FALLBACK_MOCK:
            return None
        raise


def _prompt(role: str, extra: str = "") -> str:
    return ROLE_PROMPTS.get(role, ROLE_PROMPTS["assistant"]) + ("\n" + extra if extra else "")


# --- pipeline stages -----------------------------------------------------

def extract_requirements(title: str, notes: str, provider: str | None = None, model: str | None = None) -> list:
    system = _prompt(
        "extractor",
        "识别每个独立的产品需求。为每个需求生成 title、description、priority(low/medium/high)、"
        "acceptanceCriteria(数组)。忽略过程性讨论。输出 JSON 数组 [{...}]。",
    )
    result = _run_json(system, f"会议标题：{title}\n\n会议纪要：\n{notes}", provider, model)
    if isinstance(result, list) and result:
        return result
    return mock_agent.extract_requirements(title, notes)


def design_requirement(
    title: str, description: str, acceptance_criteria: list, provider: str | None = None,
    model: str | None = None,
) -> dict:
    ac = "\n".join(f"- {c}" for c in acceptance_criteria) or "-（无）"
    system = _prompt(
        "designer",
        "输出单个 JSON 对象 {prototype:{summary,pages:[{name,purpose,components[]}],flows:[...]},"
        "architecture:{style,components:[{name,responsibility,tech}],dataModel:[{table,fields[]}],"
        "apis:[{method,path,purpose}],deployment,risks:[...],diagram}}。diagram 使用 mermaid flowchart。",
    )
    result = _run_json(system, f"需求标题：{title}\n描述：{description or '（无）'}\n验收标准：\n{ac}", provider, model)
    if isinstance(result, dict) and result.get("architecture"):
        return result
    return mock_agent.design_requirement(title, description, acceptance_criteria)


def breakdown_requirement(
    title: str, description: str, acceptance_criteria: list, provider: str | None = None,
    model: str | None = None,
) -> list:
    ac = "\n".join(f"- {c}" for c in acceptance_criteria) or "-（无）"
    system = _prompt(
        "breakdown",
        "每个任务可在数小时内完成并独立验收；覆盖前端/后端/数据/测试/DevOps。"
        "每项含 title、description、estimate、acceptanceCriteria(数组)、"
        "suggestedAssignee(human|agent)。输出 JSON 数组 [{...}]。",
    )
    result = _run_json(system, f"需求标题：{title}\n描述：{description or '（无）'}\n验收标准：\n{ac}", provider, model)
    if isinstance(result, list) and result:
        return result
    return mock_agent.breakdown_requirement(title, description, acceptance_criteria)


def generate_code(
    title: str, description: str, tasks: list | None = None, provider: str | None = None,
    model: str | None = None,
) -> dict:
    system = _prompt(
        "coder",
        "输出单个 JSON 对象 {artifactName,version,files:[{path,content}],summary}。"
        "至少包含入口文件、单元测试、Dockerfile 与 CI 工作流；代码必须完整可运行。",
    )
    task_titles = "\n".join(f"- {t.get('title', '')}" for t in (tasks or []))
    result = _run_json(system, f"需求：{title}\n描述：{description or ''}\n任务：\n{task_titles}", provider, model)
    if isinstance(result, dict) and result.get("files"):
        return result
    return mock_agent.generate_code(title, description, tasks or [])


def generate_test_cases(
    title: str, description: str, acceptance_criteria: list, provider: str | None = None,
    model: str | None = None,
) -> list:
    ac = "\n".join(f"- {c}" for c in acceptance_criteria) or "-（无）"
    system = _prompt(
        "tester",
        "覆盖 unit/integration/e2e 三层；优先覆盖验收标准与边界、异常、越权。"
        "每个用例含 title、type(unit|integration|e2e)、steps(数组)、expectedResult。输出 JSON 数组。",
    )
    result = _run_json(system, f"需求标题：{title}\n描述：{description or ''}\n验收标准：\n{ac}", provider, model)
    if isinstance(result, list) and result:
        return result
    return mock_agent.generate_test_cases(title, description, acceptance_criteria)


def generate_deployment_plan(title: str, description: str, provider: str | None = None, model: str | None = None) -> dict:
    system = _prompt(
        "deployer",
        "stages 覆盖依赖安装→静态检查→构建→测试→制品→部署，每步给出可执行 command；"
        "environments 为目标环境数组；notes 为环境变量、密钥与回滚注意事项。输出单个 JSON 对象。",
    )
    result = _run_json(system, f"需求/制品：{title}\n描述：{description or ''}", provider, model)
    if isinstance(result, dict) and result.get("stages"):
        return result
    return mock_agent.generate_deployment_plan(title, description)


def chat_reply(
    message: str, agent: dict | None = None, history: list[dict] | None = None,
    provider: str | None = None,
) -> str:
    agent = agent or {}
    p = get_provider(provider or agent.get("provider"))
    if p == "mock":
        return mock_agent.chat_reply(message)
    system = agent.get("system_prompt") or ROLE_PROMPTS["assistant"]
    hist = "\n".join(f"{m['role']}: {m['content']}" for m in (history or [])[-8:])
    try:
        text = run_agent_text(
            system + "\n请用简洁中文回答，必要时给出可执行的下一步。",
            f"对话历史：\n{hist}\n\n用户：{message}",
            p,
            json_only=False,
            model=agent.get("model") or None,
        )
        return text.strip()[:4000]
    except Exception as e:
        if AGENT_FALLBACK_MOCK:
            return mock_agent.chat_reply(message) + f"\n\n（Agent 运行时不可用，已回退：{str(e)[:120]}）"
        raise
