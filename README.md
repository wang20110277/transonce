# TransOnce

一站式、多租户、Agent 编排的软件研发交付平台。把 **会议纪要 → 需求 → 原型/架构 → 任务 → 编码 → 测试 → 制品 → CI/CD → 部署 → 监控告警** 串成一条可追溯的链路，人类成员与各自的专属 Agent 在同一租户内协作。

```
会议纪要 ──提取──▶ 需求 ──设计──▶ 原型 + 架构
                    │
                    └──拆解──▶ 研发任务 ──Agent 执行──▶ 代码制品
                                                        │
        监控告警 ◀──健康检查── 部署 ◀──发布── 流水线 ◀──测试 ◀──┘
```

## 核心能力

- **多租户**：用户可搜索团队并申请加入；租户管理员可直接添加成员；超级管理员可管理所有租户。所有业务数据按 `tenant_id` 隔离。
- **租户级 RBAC**：每个租户维护自己的角色与权限，菜单权限与敏感操作权限分离（成员管理、角色管理、密钥查看、生产发布、监控维护）。
- **个人 Agent**：成员加入租户后自动获得专属 Agent，在统一对话框中以本人权限执行需求设计、拆解、编码、测试、部署与巡检。
- **人工闸门**：环境 IP/密码由人工维护并加密存储；查看明文密钥需要 `secret.read`；生产发布需要 `deploy.production`。
- **完整交付链**：会议提取、原型/架构 JSON、任务看板、Agent 运行记录、制品文件、流水线阶段与日志、部署记录、健康检查与告警。
- **可离线演示**：默认 `AGENT_PROVIDER=mock`，无需外部模型账号即可跑通全部动作；可切换 `claude` / `opencode`。

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vite 6 + React 19 + TypeScript + Tailwind 4 + shadcn/Base UI + lucide-react |
| 前端状态 | `useSyncExternalStore` 轻量 store（会话 + 租户工作区），原生 `fetch` API 客户端 |
| 后端 | Python 3.12 + FastAPI + uvicorn |
| 数据库 | PostgreSQL（库名 **`transonce`**），`psycopg2` 直连，Alembic 迁移 |
| 认证 | 标准库 PBKDF2-HMAC-SHA256 密码哈希 + HMAC-SHA256 签名令牌 |
| Agent | `mock`（内置确定性模拟）/ `claude`（Claude Code CLI）/ `opencode`（opencode CLI）子进程 |
| 加密 | 环境密码使用 `SECRET_KEY` 派生密钥流加密落库（MVP，生产建议替换 KMS/Vault） |

## 目录结构

```
trans-once-web-ui/
  components/ui/          # shadcn 基础组件（alias @ 指向 trans-once-web-ui/）
  src/App.tsx             # 登录门禁、租户门禁、权限菜单、页面路由
  src/views/              # 工作台、项目、需求、制品、流水线、环境、监控、告警、我的 Agent
  src/components/         # 登录、租户选择、团队管理、会议、研发、测试、部署、Agent 对话
  src/lib/session.ts      # 认证 / 当前租户 / 权限判断
  src/lib/store.ts        # 租户工作区数据加载与刷新、askAgent 事件
  src/services/api.ts     # 全部后端 API
trans-once/
  main.py                 # FastAPI 应用、启动时迁移检查 + 种子数据
  config.py               # 环境变量、权限目录、角色预设
  deps.py                 # 认证依赖、租户上下文、权限校验、审计日志
  orchestration.py        # Agent 动作、autopilot、部署闸门、聊天意图路由
  agents.py               # Provider 解析与 CLI 调用 / mock 回退
  mock_agent.py           # 离线确定性 Agent 产出
  routers/                # auth / tenants / projects / pipeline / devops / agentchat
  migrations/versions/    # 0001 初始链路，0002 多租户 + RBAC + Agent + 全量平台表
  seed.py                 # 幂等演示数据
  tests/smoke.py          # 端到端冒烟测试（stdlib）
docs/ARCHITECTURE.md      # 架构与数据模型说明
```

## 本地启动

### 1. 数据库

确保 PostgreSQL 可访问，并创建数据库：

```bash
createdb transonce
# 或：psql -c 'CREATE DATABASE transonce;'
```

默认连接串为 `postgresql://postgres:postgres@localhost:5432/transonce`，如需修改写入 `trans-once/.env`。

### 2. 后端

```bash
pip3 install -r trans-once/requirements.txt

cp trans-once/.env.example trans-once/.env
# 编辑 DATABASE_URL / AGENT_PROVIDER / SECRET_KEY

cd trans-once
python3 -m alembic upgrade head
cd ..

./trans-once/run.sh        # 固定监听 http://localhost:9005
```

后端端口固定在 `9005`（`trans-once/run.sh` 显式传入 `--port 9005`），前端代理也指向该端口。

启动时会自动执行 `seed.py`：创建超级管理员、演示租户「创新数智研发组」、角色、成员、项目、会议、需求、Agent、环境、制品、流水线、监控等数据。种子以租户 slug `innovatech` 幂等，重复启动不会重复插入。

### 3. 前端

```bash
cd trans-once-web-ui
npm install
npm run dev          # http://localhost:3002（固定端口，占用则启动失败）
```

Vite 固定监听 `http://localhost:3002`（`strictPort`，端口被占用时直接报错，不会漂移），并将 `/api` 代理到 `http://localhost:9005`、`/asr` 代理到 `http://localhost:8001`。

## 演示账号

| 账号 | 密码 | 身份 | 可见范围 |
|---|---|---|---|
| `admin@transonce.local` | `admin123` | 超级管理员 / 租户管理员 | 全部页面、全部租户 |
| `product@transonce.local` | `demo123` | 产品负责人 | 工作台、项目、会议、需求、研发、测试、制品、我的 Agent |
| `dev@transonce.local` | `demo123` | 研发工程师 | 在工作台/需求/测试/制品基础上增加 CI/CD，不含环境、部署、监控、告警、团队 |

也可以用注册页创建新账号，然后在「团队选择」中搜索租户并提交加入申请，由租户管理员审批。

## 权限模型

权限分为两组：

- **菜单权限**：`dashboard`、`projects`、`meetings`、`requirements`、`design`、`development`、`testing`、`artifacts`、`pipelines`、`deployment`、`environments`、`monitoring`、`alerts`、`agents`、`team`
- **敏感操作**：`member.manage`、`role.manage`、`agent.manage`、`env.manage`、`secret.read`、`deploy.production`、`monitor.manage`

执行规则：

- 租户管理员与超级管理员在租户内拥有全部权限。
- 普通成员只看到角色包含的菜单；后端每个路由通过 `load_tenant_context(user, tenant_id, permission)` 再次校验，不能靠隐藏菜单绕过。
- 环境接口只返回掩码；`POST /environments/{id}/reveal` 需要 `secret.read` 并写入审计日志。
- 发布到 `production` 环境时，`orchestration.deploy_artifact` 强制要求 `deploy.production`，否则返回 403。
- 所有写操作与 Agent 动作写入 `activity_events`，工作台按租户展示时间线。

## Agent 配置

`trans-once/.env`：

```env
AGENT_PROVIDER=mock          # mock | auto | claude | opencode
AGENT_TIMEOUT_MS=180000
AGENT_FALLBACK_MOCK=true
```

- `mock`：无需网络/账号，返回结构化原型、架构、任务、代码、测试、部署结果，适合演示与 CI。
- `claude`：调用 `claude --print`，需先在本机完成 Claude Code 登录。
- `opencode`：调用 `opencode run`，需先配置 opencode。
- `auto`：跟随 `AGENT_PROVIDER` 的显式值；Agent 级配置可选择 `auto|claude|opencode|mock`。
- 调用失败且 `AGENT_FALLBACK_MOCK=true` 时自动回退 mock，保证链路可演示。

每个租户内可查看/编辑自己的 Agent（名称、Provider、模型、提示词、工具集）。Agent 以所属用户权限执行，无法读取环境明文密钥，也无法绕过生产发布审批。

## 验证

```bash
# 后端（需服务已启动并完成种子）
python3 trans-once/tests/smoke.py

# 前端类型检查与生产构建
cd trans-once-web-ui
npm run lint
npm run build
```

`trans-once/tests/smoke.py` 覆盖健康检查、登录、租户成员关系、未知租户拒绝、工作台统计、原型 JSON 有效性、角色权限边界、环境密钥掩码/查看、生产部署闸门、监控检查、Agent 对话、会议提取预览与权限目录，共 39 项检查，且不会创建或删除业务实体。

## 主要 API

所有租户内接口前缀为 `/api/tenants/{tenant_id}`。

| 模块 | 代表接口 |
|---|---|
| 认证 | `POST /api/auth/login`、`POST /api/auth/register`、`GET /api/auth/me` |
| 租户 | `GET /api/tenants`、`GET /api/tenants/discover`、`POST /api/tenants`、`GET /api/tenants/{id}` |
| 成员/角色 | `POST /members`、`PATCH /members/{uid}`、`GET/POST /roles`、加入申请审批 |
| 会议/需求 | `/meetings`、`/meetings/{id}/extract`、`/requirements`、`/requirements/{id}/design|breakdown|code|test|autopilot` |
| 任务/测试 | `/tasks`、`/tasks/{id}/run`、`/test-runs`、`/agent-runs` |
| 制品/流水线 | `/artifacts`、`/artifacts/{id}/release`、`/pipelines`、`/pipelines/{id}/run` |
| 环境/部署 | `/environments`、`/environments/{id}/reveal`、`/deployments` |
| 监控/告警 | `/monitors`、`/monitors/{id}/check`、`/monitors/check-all`、`/alerts` |
| Agent 对话 | `/conversations`、`/conversations/{id}/messages`、`POST /chat` |

交互式文档：后端启动后访问 `http://localhost:9005/docs`。

## 当前阶段

已完成：多租户与 RBAC、个人 Agent、会议提取、需求设计与拆解、任务执行、代码/测试/制品、流水线、部署闸门、环境密钥、监控告警、审计时间线、前端全量接入真实 API。

后续可扩展：真实 Git/CI 执行器、WebSocket 流式 Agent 输出、对象存储制品包、KMS/Vault、租户级配额与账单、生产发布审批流（当前为权限闸门 + 人工操作）。
