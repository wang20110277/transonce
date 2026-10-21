"""Runtime configuration and platform constants (permissions, presets)."""
import os

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/transonce"
)
SECRET_KEY = os.getenv("SECRET_KEY", "transonce-dev-secret-change-me")
TOKEN_TTL_HOURS = int(os.getenv("TOKEN_TTL_HOURS", "168"))  # 7 days
AGENT_PROVIDER = os.getenv("AGENT_PROVIDER", "auto")  # auto | claude | opencode | mock
AGENT_TIMEOUT_MS = int(os.getenv("AGENT_TIMEOUT_MS", "180000"))
AGENT_FALLBACK_MOCK = os.getenv("AGENT_FALLBACK_MOCK", "true").lower() == "true"
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@transonce.local")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
ADMIN_NAME = os.getenv("ADMIN_NAME", "超级管理员")
SEED_DEMO = os.getenv("SEED_DEMO", "true").lower() == "true"
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
]

MENU_PERMISSIONS = [p["id"] for p in PERMISSIONS if p["group"] == "菜单"]
ALL_PERMISSIONS = [p["id"] for p in PERMISSIONS]

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
            "development", "testing", "artifacts", "agents",
        ],
    },
    {
        "name": "研发工程师",
        "description": "需求、设计、编码、测试与流水线执行",
        "permissions": [
            "dashboard", "projects", "meetings", "requirements", "design",
            "development", "testing", "artifacts", "pipelines", "agents",
        ],
    },
    {
        "name": "测试工程师",
        "description": "需求验收、测试用例与测试执行",
        "permissions": [
            "dashboard", "requirements", "design", "testing", "artifacts", "agents",
        ],
    },
    {
        "name": "DevOps 工程师",
        "description": "流水线、制品、环境、部署与监控告警",
        "permissions": [
            "dashboard", "artifacts", "pipelines", "deployment", "environments",
            "monitoring", "alerts", "agents", "env.manage", "secret.read",
            "deploy.production", "monitor.manage",
        ],
    },
    {
        "name": "只读成员",
        "description": "只读查看研发链路进展",
        "permissions": ["dashboard", "projects", "requirements", "artifacts", "agents"],
    },
]

DEFAULT_ROLE = "研发工程师"
