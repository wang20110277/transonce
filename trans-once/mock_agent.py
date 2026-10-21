"""Deterministic offline agent outputs.

Used when no coding-agent CLI is available (or AGENT_PROVIDER=mock). The
outputs follow exactly the same contracts as the Claude/opencode prompts so
the platform remains fully demoable and testable without network access.
"""
import hashlib
import re


def _sentences(text: str) -> list[str]:
    parts = re.split(r"[\n。；;.!?！？]+", text or "")
    return [p.strip(" -•\t0123456789.、）)（(") for p in parts if len(p.strip()) > 8]


def extract_requirements(title: str, notes: str) -> list:
    sents = _sentences(notes)
    picked: list[str] = []
    for s in sents:
        if any(k in s for k in ("需要", "要求", "支持", "实现", "完成", "必须", "应该", "目标", "功能")):
            picked.append(s)
        if len(picked) >= 5:
            break
    if not picked:
        picked = sents[:3] or [f"实现「{title}」的核心业务闭环"]

    out = []
    for i, s in enumerate(picked, 1):
        topic = re.sub(r"^(我们|需要|要求|应该|必须|要|请)", "", s).strip()
        topic = topic[:38] or f"{title} 子需求 {i}"
        priority = "high" if i == 1 else "medium" if i <= 3 else "low"
        out.append(
            {
                "title": topic,
                "description": s,
                "priority": priority,
                "acceptanceCriteria": [
                    f"{topic} 在 Web 端可用并有明确的用户入口",
                    f"{topic} 的关键路径有自动化测试覆盖",
                    f"{topic} 的结果可在平台内被追踪与审计",
                ],
            }
        )
    return out


def design_requirement(title: str, description: str, acceptance_criteria: list) -> dict:
    ac = acceptance_criteria or []
    prototype = {
        "summary": f"围绕「{title}」的高保真页面骨架与交互流程。",
        "pages": [
            {
                "name": "列表 / 工作台",
                "purpose": "集中展示条目、筛选、批量操作与 Agent 运行状态",
                "components": ["筛选栏", "数据表格", "状态徽章", "Agent 操作菜单", "空状态引导"],
            },
            {
                "name": "详情 / 编辑",
                "purpose": "承载主流程、验收标准、评论与 Agent 对话",
                "components": ["标题区", "验收标准清单", "双栏表单", "Agent 侧栏", "操作日志"],
            },
            {
                "name": "结果 / 预览",
                "purpose": "展示生成结果、变更 diff 与人工确认闸门",
                "components": ["结果摘要", "Diff 视图", "确认/驳回", "导出"],
            },
        ],
        "flows": [
            "用户从工作台进入 → 选择条目 → 在 Agent 侧栏描述目标",
            "Agent 执行并将结构化结果写入 → 人工在预览页确认",
            "确认后进入下一阶段，失败可回滚并保留运行日志",
        ],
        "acceptance": ac,
    }
    architecture = {
        "style": "模块化单体 + 可插拔 Agent 运行时（后续可拆微服务）",
        "components": [
            {"name": "Web 前端", "responsibility": "交互、权限感知渲染、Agent 对话", "tech": "React 19 + Vite + Tailwind + shadcn"},
            {"name": "API 服务", "responsibility": "租户隔离、RBAC、领域编排", "tech": "FastAPI + psycopg2"},
            {"name": "Agent 运行时", "responsibility": "驱动 Claude Code / opencode，结构化产出", "tech": "子进程 + JSON 契约 + mock 回退"},
            {"name": "数据层", "responsibility": "多租户数据、审计与运行记录", "tech": "PostgreSQL + Alembic"},
            {"name": "CI/CD 与运维", "responsibility": "流水线、制品、部署、监控告警", "tech": "Pipeline 执行器 + 制品库 + HTTP 探针"},
        ],
        "dataModel": [
            {"table": "requirements", "fields": ["id", "tenant_id", "title", "status", "acceptance_criteria", "architecture"]},
            {"table": "dev_tasks", "fields": ["id", "requirement_id", "assignee_kind", "status", "agent_run_id"]},
            {"table": "artifacts", "fields": ["id", "requirement_id", "version", "checksum", "status"]},
            {"table": "deployments", "fields": ["id", "artifact_id", "environment_id", "status", "url"]},
        ],
        "apis": [
            {"method": "GET", "path": "/api/tenants/{id}/requirements", "purpose": "租户内需求列表"},
            {"method": "POST", "path": "/api/tenants/{id}/requirements/{rid}/design", "purpose": "生成原型与架构"},
            {"method": "POST", "path": "/api/tenants/{id}/requirements/{rid}/autopilot", "purpose": "全链路 Agent 编排"},
            {"method": "POST", "path": "/api/tenants/{id}/monitors/{mid}/check", "purpose": "监控探针"},
        ],
        "deployment": "容器化部署；测试/生产环境由人工录入 IP、账号与密钥，Agent 只引用环境 ID。",
        "risks": [
            "Agent 产出需要人工在发布闸门确认",
            "环境密钥只在服务端解密，前端仅展示掩码",
        ],
        "diagram": (
            "flowchart LR\n"
            "  UI[Web 前端] --> API[FastAPI API]\n"
            "  API --> RBAC[租户与 RBAC]\n"
            "  API --> ORCH[Agent 编排器]\n"
            "  ORCH --> RT[Agent 运行时]\n"
            "  ORCH --> DB[(PostgreSQL)]\n"
            "  ORCH --> CICD[CI/CD]\n"
            "  CICD --> ART[制品库]\n"
            "  ART --> DEP[部署]\n"
            "  DEP --> MON[监控告警]"
        ),
    }
    return {"prototype": prototype, "architecture": architecture}


def breakdown_requirement(title: str, description: str, acceptance_criteria: list) -> list:
    return [
        {
            "title": f"梳理「{title}」验收标准与边界",
            "description": "与需求方确认范围、异常路径与验收口径，形成可测试的清单。",
            "estimate": "2h",
            "acceptanceCriteria": ["验收标准逐条可测试", "边界与异常场景已记录"],
            "suggestedAssignee": "human",
        },
        {
            "title": "前端页面与交互实现",
            "description": "实现列表、详情与结果预览页面，接入权限与 Agent 操作入口。",
            "estimate": "1d",
            "acceptanceCriteria": ["页面在桌面与移动端可用", "权限不足时隐藏敏感操作"],
            "suggestedAssignee": "agent",
        },
        {
            "title": "后端 API 与租户隔离",
            "description": "实现 CRUD 与状态流转接口，所有查询强制带 tenant_id。",
            "estimate": "1d",
            "acceptanceCriteria": ["越权访问返回 403", "接口有参数校验"],
            "suggestedAssignee": "agent",
        },
        {
            "title": "数据模型与迁移",
            "description": "补齐表结构、索引与回滚迁移。",
            "estimate": "4h",
            "acceptanceCriteria": ["alembic upgrade/downgrade 可逆", "关键查询有索引"],
            "suggestedAssignee": "agent",
        },
        {
            "title": "自动化测试",
            "description": "覆盖核心路径、权限边界与 Agent 失败回退。",
            "estimate": "6h",
            "acceptanceCriteria": ["核心接口测试通过", "前端 tsc 无错误"],
            "suggestedAssignee": "agent",
        },
        {
            "title": "CI/CD 与部署验证",
            "description": "配置构建、测试、制品与测试环境部署流水线。",
            "estimate": "4h",
            "acceptanceCriteria": ["流水线可重复执行", "制品版本可追溯", "测试环境健康检查通过"],
            "suggestedAssignee": "agent",
        },
    ]


def generate_code(title: str, description: str, tasks: list) -> dict:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", title).strip("-").lower()[:32] or "feature"
    readme = f"# {title}\n\n{description or '由 TransOnce Agent 生成的实现骨架。'}\n"
    main_py = f'''"""{title} — generated by TransOnce agent."""

FEATURE = "{slug}"


def health() -> dict:
    return {{"feature": FEATURE, "ok": True}}


def handle(payload: dict) -> dict:
    """Minimal handler contract; replace with the domain implementation."""
    return {{"feature": FEATURE, "echo": payload, "ok": True}}
'''
    test_py = f'''from main import handle, health


def test_health():
    assert health()["ok"] is True


def test_handle_roundtrip():
    assert handle({{"value": 1}})["echo"] == {{"value": 1}}
'''
    dockerfile = "FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nCMD [\"python\", \"-c\", \"from main import health; print(health())\"]\n"
    ci = """name: ci
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: {python-version: '3.12'}
      - run: pip install pytest && pytest -q
      - run: docker build -t feature:${{ github.sha }} .
"""
    files = [
        {"path": "README.md", "content": readme},
        {"path": "main.py", "content": main_py},
        {"path": "test_main.py", "content": test_py},
        {"path": "Dockerfile", "content": dockerfile},
        {"path": ".github/workflows/ci.yml", "content": ci},
    ]
    version = "v0.1.0"
    checksum = hashlib.sha256("".join(f["content"] for f in files).encode()).hexdigest()[:16]
    return {
        "artifactName": f"{slug}-bundle",
        "version": version,
        "checksum": checksum,
        "files": files,
        "summary": f"生成 {len(files)} 个文件，包含入口、单测、Dockerfile 与 CI 工作流。",
        "tasks": [t.get("title") for t in tasks],
    }


def generate_test_cases(title: str, description: str, acceptance_criteria: list) -> list:
    ac = acceptance_criteria or [f"{title} 主流程可用"]
    cases = []
    for i, c in enumerate(ac[:4], 1):
        cases.append(
            {
                "title": f"验收 {i}: {c[:40]}",
                "type": "e2e" if i % 3 == 0 else "integration" if i % 2 == 0 else "unit",
                "steps": ["准备租户与有效成员", f"执行：{c[:60]}", "校验数据库与 API 返回"],
                "expectedResult": c,
            }
        )
    cases.append(
        {
            "title": "越权访问被拒绝",
            "type": "integration",
            "steps": ["使用其他租户成员令牌", "请求本租户资源"],
            "expectedResult": "返回 403，且不泄露数据",
        }
    )
    cases.append(
        {
            "title": "Agent 失败时回退",
            "type": "unit",
            "steps": ["模拟 provider 超时", "触发编排"],
            "expectedResult": "运行被标记 failed 并写入可读错误",
        }
    )
    return cases


def generate_deployment_plan(title: str, description: str) -> dict:
    return {
        "stages": [
            {"name": "安装依赖", "command": "python -m venv .venv && .venv/bin/pip install -r requirements.txt"},
            {"name": "静态检查", "command": "npm run lint && ruff check ."},
            {"name": "构建", "command": "npm run build"},
            {"name": "测试", "command": "pytest -q"},
            {"name": "构建制品", "command": "docker build -t app:$VERSION ."},
            {"name": "部署", "command": "deploy --env $ENVIRONMENT --artifact app:$VERSION"},
        ],
        "environments": ["test", "production"],
        "notes": "生产发布需要 deploy.production 权限；环境 IP/账号/密码由人工在环境配置中维护，Agent 仅按环境 ID 引用。",
    }


def chat_reply(message: str, context: str = "") -> str:
    return (
        "我是你的专属研发 Agent。已收到：" + message.strip()[:120] + "\n\n"
        "我可以端到端推进：会议纪要 → 需求 → 原型/架构 → 任务拆解 → 编码 → 测试 → CI/CD → 制品下发 → 部署 → 监控告警。\n"
        "你可以直接说「把这条需求全流程跑一遍」「为需求生成原型和架构」「构建并部署到测试环境」。"
        "涉及生产发布、环境 IP/密码、成员权限的操作会由人工确认或由管理员维护。"
    )
