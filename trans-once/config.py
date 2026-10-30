"""Runtime configuration and platform constants (permissions, presets)."""
import os

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/transonce"
)
# SECRET_KEY / TOKEN_TTL_HOURS live in security.py (single source of truth).

# `simulated` marks pipeline/test/deploy results as not backed by a real
# executor; the UI surfaces this so a green run is never mistaken for CI.
EXECUTION_MODE = os.getenv("EXECUTION_MODE", "simulated")  # simulated | real
AGENT_PROVIDER = os.getenv("AGENT_PROVIDER", "auto")  # auto | claude | opencode | mock
AGENT_TIMEOUT_MS = int(os.getenv("AGENT_TIMEOUT_MS", "180000"))
AGENT_FALLBACK_MOCK = os.getenv("AGENT_FALLBACK_MOCK", "true").lower() == "true"
# Prompts longer than this are truncated before handing them to a CLI provider.
AGENT_MAX_PROMPT_CHARS = int(os.getenv("AGENT_MAX_PROMPT_CHARS", "120000"))
# Optional working directory for agent CLIs. Defaults to a throwaway temp dir so
# a CLI can never read the platform's own .env / database credentials.
AGENT_WORKDIR = os.getenv("AGENT_WORKDIR", "")
# Tools disabled for text-only JSON generation (claude provider).
AGENT_CLI_DISALLOWED_TOOLS = os.getenv(
    "AGENT_CLI_DISALLOWED_TOOLS",
    "Bash,Write,Edit,NotebookEdit,WebFetch,WebSearch",
)
# Multica-style execution: the CLI runs as an autonomous agent in a private
# per-run workspace (contract file + tool access + longer budget), instead of
# one-shot, tool-disabled JSON generation.
AGENT_EXECUTION_MODE = os.getenv("AGENT_EXECUTION_MODE", "text")  # text | agentic
AGENT_AGENTIC_TIMEOUT_MS = int(os.getenv("AGENT_AGENTIC_TIMEOUT_MS", "600000"))
# Tools blocked in agentic runs; empty grants full tool access, matching how a
# local agent run works. The per-run workspace and env whitelist below remain
# the containment boundary.
AGENT_AGENTIC_DISALLOWED_TOOLS = os.getenv("AGENT_AGENTIC_DISALLOWED_TOOLS", "")
# Outbound GitLab API timeout for connection tests and syncs.
GITLAB_TIMEOUT_SECONDS = int(os.getenv("GITLAB_TIMEOUT_SECONDS", "15"))
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@transonce.local")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
ADMIN_NAME = os.getenv("ADMIN_NAME", "超级管理员")
# Bootstrap the super admin from ADMIN_* above on startup (idempotent).
SEED_ADMIN = os.getenv("SEED_ADMIN", "true").lower() == "true"
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3002,http://127.0.0.1:3002,http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if o.strip()
]

# --- RBAC ---------------------------------------------------------------
# Menu permissions gate navigation/screens. Action permissions gate
# sensitive operations (members, roles, environments/secrets, prod deploys).
PERMISSIONS = [
    # menus
    {"id": "dashboard", "label": "仪表盘", "group": "菜单"},
    {"id": "projects", "label": "项目与系统", "group": "菜单"},
    {"id": "meetings", "label": "会议纪要", "group": "菜单"},
    {"id": "requirements", "label": "需求管理", "group": "菜单"},
    {"id": "design", "label": "原型与架构", "group": "菜单"},
    {"id": "development", "label": "研发管理", "group": "菜单"},
    {"id": "testing", "label": "测试管理", "group": "菜单"},
    {"id": "repos", "label": "代码管理", "group": "菜单"},
    {"id": "artifacts", "label": "制品管理", "group": "菜单"},
    {"id": "pipelines", "label": "CI/CD 流水线", "group": "菜单"},
    {"id": "deployment", "label": "部署管理", "group": "菜单"},
    {"id": "environments", "label": "环境配置", "group": "菜单"},
    {"id": "monitoring", "label": "运维监控", "group": "菜单"},
    {"id": "alerts", "label": "告警中心", "group": "菜单"},
    {"id": "agents", "label": "我的 Agent", "group": "菜单"},
    {"id": "team", "label": "团队管理", "group": "菜单"},
    # actions
    {"id": "member.manage", "label": "成员管理", "group": "敏感操作"},
    {"id": "role.manage", "label": "角色权限管理", "group": "敏感操作"},
    {"id": "agent.manage", "label": "Agent 配置管理", "group": "敏感操作"},
    {"id": "env.manage", "label": "环境配置维护（IP/密码）", "group": "敏感操作"},
    {"id": "secret.read", "label": "查看环境密钥", "group": "敏感操作"},
    {"id": "deploy.production", "label": "生产环境部署", "group": "敏感操作"},
    {"id": "monitor.manage", "label": "监控与告警维护", "group": "敏感操作"},
    {"id": "repo.manage", "label": "代码库连接管理（GitLab）", "group": "敏感操作"},
    {"id": "repo.approve", "label": "审批代码库权限", "group": "敏感操作"},
]

MENU_PERMISSIONS = [p["id"] for p in PERMISSIONS if p["group"] == "菜单"]
ALL_PERMISSIONS = [p["id"] for p in PERMISSIONS]

# Per-repo access roles mirror GitLab permission levels (guest..maintainer;
# owner stays instance-side and is not requestable through the platform).
REPO_ROLES = [
    {"id": "guest", "label": "访客", "level": 10},
    {"id": "reporter", "label": "报告者", "level": 20},
    {"id": "developer", "label": "开发者", "level": 30},
    {"id": "maintainer", "label": "管理员", "level": 40},
]
DEFAULT_REPO_ROLE = "developer"

ROLE_PRESETS = [
    {
        "name": "租户管理员",
        "description": "租户内全部权限，可管理成员、角色、环境与生产发布",
        "permissions": ALL_PERMISSIONS,
    },
    {
        "name": "产品负责人",
        "description": "会议、需求、原型架构与研发协作",
        "permissions": [
            "dashboard", "projects", "meetings", "requirements", "design",
            "development", "testing", "repos", "artifacts", "agents",
        ],
    },
    {
        "name": "研发工程师",
        "description": "需求、设计、编码、测试与流水线执行",
        "permissions": [
            "dashboard", "projects", "meetings", "requirements", "design",
            "development", "testing", "repos", "artifacts", "pipelines", "agents",
        ],
    },
    {
        "name": "测试工程师",
        "description": "需求验收、测试用例与测试执行",
        "permissions": [
            "dashboard", "requirements", "design", "testing", "repos", "artifacts", "agents",
        ],
    },
    {
        "name": "DevOps 工程师",
        "description": "流水线、制品、环境、部署与监控告警",
        "permissions": [
            "dashboard", "repos", "artifacts", "pipelines", "deployment", "environments",
            "monitoring", "alerts", "agents", "env.manage", "secret.read",
            "deploy.production", "monitor.manage", "repo.manage", "repo.approve",
        ],
    },
    {
        "name": "只读成员",
        "description": "只读查看研发链路进展",
        "permissions": ["dashboard", "projects", "requirements", "artifacts", "agents"],
    },
]

DEFAULT_ROLE = "研发工程师"
