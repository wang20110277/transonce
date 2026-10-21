"""Agent runtime: drive real coding agents (claude / opencode) as subprocesses,
with a deterministic mock fallback so the platform always works offline.
"""
import json
import os
import re
import shutil
import subprocess

import mock_agent
from config import AGENT_FALLBACK_MOCK, AGENT_PROVIDER, AGENT_TIMEOUT_MS

JSON_ONLY = "只输出 JSON，不要任何解释、前后缀或 markdown 代码块。"

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


def run_agent_text(system_prompt: str, user_prompt: str, provider: str | None = None) -> str:
    p = get_provider(provider)
    if p == "mock":
        return mock_agent.chat_reply(user_prompt)
    combined = f"{system_prompt}\n\n{JSON_ONLY}\n\n===\n\n{user_prompt}"
    args = ["run", combined] if p == "opencode" else ["--print", combined, "--output-format", "text"]
    timeout = AGENT_TIMEOUT_MS / 1000
    proc = subprocess.run([p] + args, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(f"agent ({p}) exited {proc.returncode}: {proc.stderr[:800]}")
    return proc.stdout


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


def _run_json(system: str, user: str, provider: str | None):
    p = get_provider(provider)
    if p == "mock":
        return None
    try:
        parsed = parse_agent_json(run_agent_text(system, user, p))
        return parsed
    except Exception:
        if AGENT_FALLBACK_MOCK:
            return None
        raise


def _prompt(role: str, extra: str = "") -> str:
    return ROLE_PROMPTS.get(role, ROLE_PROMPTS["assistant"]) + ("\n" + extra if extra else "")


# --- pipeline stages -----------------------------------------------------

def extract_requirements(title: str, notes: str, provider: str | None = None) -> list:
    system = _prompt(
        "extractor",
        "识别每个独立的产品需求。为每个需求生成 title、description、priority(low/medium/high)、"
        "acceptanceCriteria(数组)。忽略过程性讨论。输出 JSON 数组 [{...}]。",
    )
    result = _run_json(system, f"会议标题：{title}\n\n会议纪要：\n{notes}", provider)
    if isinstance(result, list) and result:
        return result
    return mock_agent.extract_requirements(title, notes)


def design_requirement(
    title: str, description: str, acceptance_criteria: list, provider: str | None = None
) -> dict:
    ac = "\n".join(f"- {c}" for c in acceptance_criteria) or "-（无）"
    system = _prompt(
        "designer",
        "输出单个 JSON 对象 {prototype:{summary,pages:[{name,purpose,components[]}],flows:[...]},"
        "architecture:{style,components:[{name,responsibility,tech}],dataModel:[{table,fields[]}],"
        "apis:[{method,path,purpose}],deployment,risks:[...],diagram}}。diagram 使用 mermaid flowchart。",
    )
    result = _run_json(system, f"需求标题：{title}\n描述：{description or '（无）'}\n验收标准：\n{ac}", provider)
    if isinstance(result, dict) and result.get("architecture"):
        return result
    return mock_agent.design_requirement(title, description, acceptance_criteria)


def breakdown_requirement(
    title: str, description: str, acceptance_criteria: list, provider: str | None = None
) -> list:
    ac = "\n".join(f"- {c}" for c in acceptance_criteria) or "-（无）"
    system = _prompt(
        "breakdown",
        "每个任务可在数小时内完成并独立验收；覆盖前端/后端/数据/测试/DevOps。"
        "每项含 title、description、estimate、acceptanceCriteria(数组)、"
        "suggestedAssignee(human|agent)。输出 JSON 数组 [{...}]。",
    )
    result = _run_json(system, f"需求标题：{title}\n描述：{description or '（无）'}\n验收标准：\n{ac}", provider)
    if isinstance(result, list) and result:
        return result
    return mock_agent.breakdown_requirement(title, description, acceptance_criteria)


def generate_code(
    title: str, description: str, tasks: list | None = None, provider: str | None = None
) -> dict:
    system = _prompt(
        "coder",
        "输出单个 JSON 对象 {artifactName,version,files:[{path,content}],summary}。"
        "至少包含入口文件、单元测试、Dockerfile 与 CI 工作流；代码必须完整可运行。",
    )
    task_titles = "\n".join(f"- {t.get('title', '')}" for t in (tasks or []))
    result = _run_json(system, f"需求：{title}\n描述：{description or ''}\n任务：\n{task_titles}", provider)
    if isinstance(result, dict) and result.get("files"):
        return result
    return mock_agent.generate_code(title, description, tasks or [])


def generate_test_cases(
    title: str, description: str, acceptance_criteria: list, provider: str | None = None
) -> list:
    ac = "\n".join(f"- {c}" for c in acceptance_criteria) or "-（无）"
    system = _prompt(
        "tester",
        "覆盖 unit/integration/e2e 三层；优先覆盖验收标准与边界、异常、越权。"
        "每个用例含 title、type(unit|integration|e2e)、steps(数组)、expectedResult。输出 JSON 数组。",
    )
    result = _run_json(system, f"需求标题：{title}\n描述：{description or ''}\n验收标准：\n{ac}", provider)
    if isinstance(result, list) and result:
        return result
    return mock_agent.generate_test_cases(title, description, acceptance_criteria)


def generate_deployment_plan(title: str, description: str, provider: str | None = None) -> dict:
    system = _prompt(
        "deployer",
        "stages 覆盖依赖安装→静态检查→构建→测试→制品→部署，每步给出可执行 command；"
        "environments 为目标环境数组；notes 为环境变量、密钥与回滚注意事项。输出单个 JSON 对象。",
    )
    result = _run_json(system, f"需求/制品：{title}\n描述：{description or ''}", provider)
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
        )
        return text.strip()[:4000]
    except Exception as e:
        if AGENT_FALLBACK_MOCK:
            return mock_agent.chat_reply(message) + f"\n\n（Agent 运行时不可用，已回退：{str(e)[:120]}）"
        raise
