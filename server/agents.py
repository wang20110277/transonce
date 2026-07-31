"""Agent runtime: drive real coding agents (claude / opencode) as subprocesses.

This is the multica model — managed coding agents as teammates — instead of
calling an LLM API directly. Provider is selected via AGENT_PROVIDER (claude|opencode).
"""
import json
import os
import re
import subprocess

JSON_ONLY = "只输出 JSON，不要任何解释、前后缀或 markdown 代码块。"


def get_provider() -> str:
    return "opencode" if os.getenv("AGENT_PROVIDER") == "opencode" else "claude"


def run_agent_text(system_prompt: str, user_prompt: str, provider: str | None = None) -> str:
    """Run a coding-agent CLI non-interactively; return its stdout text."""
    p = provider or get_provider()
    combined = f"{system_prompt}\n\n{JSON_ONLY}\n\n===\n\n{user_prompt}"
    cmd = "opencode" if p == "opencode" else "claude"
    args = (
        ["run", combined]
        if p == "opencode"
        else ["--print", combined, "--output-format", "text"]
    )
    timeout = int(os.getenv("AGENT_TIMEOUT_MS", "180000")) / 1000
    try:
        proc = subprocess.run(
            [cmd] + args, capture_output=True, text=True, timeout=timeout
        )
    except FileNotFoundError as e:
        raise RuntimeError(f"failed to spawn {cmd}: {e}")
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f"agent ({p}) timed out after {timeout:.0f}s")
    if proc.returncode != 0:
        raise RuntimeError(
            f"agent ({p}) exited {proc.returncode}: {proc.stderr[:800]}"
        )
    return proc.stdout


def parse_agent_json(text: str):
    """Best-effort JSON extraction from agent text (strips fences, slices to outermost)."""
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
        return json.loads(t[m.start() : end + 1])
    except Exception:
        return None


def _run_json(system_prompt: str, user_prompt: str):
    text = run_agent_text(system_prompt, user_prompt)
    parsed = parse_agent_json(text)
    if parsed is None:
        raise RuntimeError("agent did not return parseable JSON")
    return parsed


# --- the four pipeline agents ---


def extract_requirements(title: str, notes: str) -> list:
    system = (
        '你是 Transones 平台的"需求架构师"Agent。从会议纪要中提取结构化的产品需求。\n'
        "- 识别每个独立的产品需求或功能点。\n"
        "- 为每个需求生成 title、description、priority(low/medium/high)、acceptanceCriteria(数组)。\n"
        "- 忽略过程性讨论，聚焦产品决策与功能诉求。\n"
        "输出格式：JSON 数组 [{...}]。"
    )
    user = f"会议标题：{title}\n\n会议纪要：\n{notes}"
    result = _run_json(system, user)
    return result if isinstance(result, list) else []


def breakdown_requirement(
    title: str, description: str, acceptance_criteria: list
) -> list:
    ac = "\n".join(f"- {c}" for c in acceptance_criteria) or "-（无）"
    system = (
        '你是 Transones 平台的"任务拆解师"Agent。把一条产品需求拆解为可执行、可验收的研发任务。\n'
        "- 每个任务可在数小时内完成并独立验收；覆盖前端/后端/数据/测试等维度。\n"
        "- 每个任务含 title、description、estimate(如 2h)、acceptanceCriteria(数组)、suggestedAssignee(human|agent)。\n"
        "- 常规编码任务建议 agent；涉及决策/沟通/架构的建议 human。\n"
        "输出格式：JSON 数组 [{...}]。"
    )
    user = f"需求标题：{title}\n需求描述：{description or '（无）'}\n验收标准：\n{ac}"
    result = _run_json(system, user)
    return result if isinstance(result, list) else []


def generate_test_cases(
    title: str, description: str, acceptance_criteria: list
) -> list:
    ac = "\n".join(f"- {c}" for c in acceptance_criteria) or "-（无）"
    system = (
        '你是 Transones 平台的"测试专家"Agent。为一条产品需求设计测试用例。\n'
        "- 覆盖 unit/integration/e2e 三个层级；优先覆盖验收标准与边界、异常。\n"
        "- 每个用例含 title、type(unit|integration|e2e)、steps(数组)、expectedResult。\n"
        "输出格式：JSON 数组 [{...}]。"
    )
    user = f"需求标题：{title}\n需求描述：{description or '（无）'}\n验收标准：\n{ac}"
    result = _run_json(system, user)
    return result if isinstance(result, list) else []


def generate_deployment_plan(title: str, description: str) -> dict:
    system = (
        '你是 Transones 平台的"部署专家"Agent。为一个需求/制品设计 CI/CD 流水线与部署方案。\n'
        "- stages: 覆盖依赖安装→构建→测试→部署，给出每步可执行 command（npm/pnpm、Vite、Docker）。\n"
        "- environments: 目标环境数组；notes: 部署注意事项（环境变量、回滚等）。\n"
        "输出格式：单个 JSON 对象 {stages,environments,notes}。"
    )
    user = f"需求/制品标题：{title}\n描述：{description or '（无）'}"
    result = _run_json(system, user)
    return result if isinstance(result, dict) else {}
