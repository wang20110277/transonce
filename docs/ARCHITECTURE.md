# TransOnce — Architecture

> 多租户、Agent 编排的一站式软件研发交付平台。目标是把会议、需求、设计与编码、测试、CI/CD、发布和运维串成一条可追溯的链路，让每位成员和自己的专属 Agent 在租户内协作。

本文描述当前已实现的架构，而不是早期规划。参考项目 `aidevops/multica`（Agent 协作）、`baixone`（多租户/RBAC/CI-CD）、`meetily`（会议入口）只作为模式来源，不进入运行时依赖。

---

## 1. 系统上下文

```text
┌──────────────┐        HTTPS / JSON        ┌──────────────────────────┐
│  React SPA   │  ───────────────────────▶  │  FastAPI (trans-once/)       │
│ Vite :3002   │  ◀───────────────────────  │  :9005                   │
└──────────────┘      /api (Vite proxy)     └────────────┬─────────────┘
                                                         │ psycopg2
                                            ┌────────────▼─────────────┐
                                            │ PostgreSQL               │
                                            │ database: transonce      │
                                            └────────────┬─────────────┘
                                                         │ subprocess
                                            ┌────────────▼─────────────┐
                                            │ Agent runtime            │
                                            │ mock / claude / opencode │
                                            └──────────────────────────┘
```

- 前端不直连数据库，所有读写经过 `/api`。
- 后端无 ORM，使用 `psycopg2` 参数化 SQL；迁移由 Alembic 管理。
- Agent 运行时是可选的外部 CLI；默认 `mock`，保证离线可演示。

---

## 2. 多租户与身份

### 2.1 实体

| 表 | 作用 |
|---|---|
| `users` | 全局用户（邮箱唯一，`is_super_admin` 标记平台管理员） |
| `tenants` | 租户，`slug` 唯一，`join_policy` 控制加入方式 |
| `roles` | 租户内角色，`permissions` 为该角色的权限 id 数组 |
| `tenant_members` | 用户与租户的关系，含 `role_id`、`is_tenant_admin`、`status` |
| `tenant_join_requests` | 用户申请加入租户的记录，状态 `pending/approved/rejected` |
| `agents` | 个人 Agent，按 `(tenant_id, owner_user_id)` 唯一 |

### 2.2 加入与隔离

- 用户注册后进入「团队选择」：可查看自己已加入的租户、搜索公开租户、提交加入申请，或直接创建新租户（创建者成为租户管理员）。
- 租户管理员可以直接添加成员（生成临时密码）或审批/拒绝加入申请。
- 超级管理员可以查看和管理所有租户；普通用户只能看到自己 `active` 的成员关系。
- 所有业务表都带 `tenant_id`，后端每个租户内路由先调用 `load_tenant_context`，非成员直接 403。

### 2.3 两个门禁

后端 `deps.load_tenant_context(user, tenant_id, permission?)` 是唯一入口：

1. 检查 Bearer Token → 用户；
2. 检查租户存在且未归档；
3. 检查成员关系为 `active`（超级管理员除外）；
4. 装载角色权限；
5. 若传入 `permission`，执行 `ctx.require(permission)`。

前端菜单过滤只是体验层，不能替代后端校验。

---

## 3. RBAC 权限模型

权限定义在 `trans-once/config.py`，分为「菜单」与「敏感操作」：

```text
菜单: dashboard projects meetings requirements design development testing
      artifacts pipelines deployment environments monitoring alerts agents team

敏感操作: member.manage role.manage agent.manage env.manage
          secret.read deploy.production monitor.manage
```

内置角色预设（租户管理员、产品负责人、研发工程师、测试工程师、DevOps 工程师、观察者）在创建租户/种子数据时写入 `roles`。租户管理员可以创建自定义角色并勾选权限。

关键规则：

- 租户管理员 / 超级管理员在租户内拥有全部权限。
- 普通成员只能访问角色包含的菜单；`App.tsx` 的导航、工作台快捷入口和操作按钮按权限显示。
- 敏感操作单独校验：
  - 环境创建/修改/删除：`env.manage`
  - 查看环境明文密码：`secret.read`（写审计日志）
  - 生产环境发布：`deploy.production`
  - 成员/角色/Agent/监控维护：对应 `.manage` 权限

---

## 4. 数据模型

### 4.1 迁移

- `0001_initial_schema.py`：会议、需求、研发任务、测试运行、部署、活动流。
- `0002_platform.py`：用户、租户、角色、成员、加入申请、Agent、会话、消息、项目、系统、代码库、环境、Agent 运行、制品、流水线、流水线运行、监控、告警。

### 4.2 交付链核心表

```text
meetings ──extract──▶ requirements ──design──▶ requirements.prototype / architecture
                           │
                           ├──breakdown──▶ dev_tasks ──run──▶ agent_runs
                           ├──code────────▶ artifacts (content: files JSON)
                           └──test────────▶ test_runs ──▶ test_cases
artifacts ──release──▶ deployments ──check──▶ monitors ──fail──▶ alerts
pipelines ──run──▶ pipeline_runs (stages + log)
```

字段约定：

- `requirements.prototype` 是 **TEXT**，内容为 JSON 字符串（前端 `JSON.parse`）。
- `requirements.architecture` 是 **JSONB**（`style/components/dataModel/apis/risks/diagram`）。
- `artifacts.content` 是 JSON 字符串，形如 `[{ "path": "...", "content": "..." }]`。
- `environments.password_enc` 只存密文；`password_masked` 由序列化层计算，接口不返回明文。
- `activity_events` 记录 `actor_kind`（human/agent/system）、类型、payload 与时间，用于工作台时间线。

### 4.3 状态流转

| 对象 | 状态 |
|---|---|
| 需求 | `draft → designing → completed`（`designStatus`: `pending/designed`） |
| 任务 | `queued → assigned → running → reviewing → done / failed` |
| 测试 | `pending → running → passed / failed` |
| 流水线运行 | `running → succeeded / failed` |
| 部署 | `pending → success / failed` |
| 监控 | `unknown → up / down` |
| 告警 | `open → acknowledged → resolved` |

---

## 5. Agent 架构

### 5.1 个人 Agent

- 用户首次进入租户或首次对话时，`orchestration.ensure_personal_agent` 自动创建：
  - 名称：`{用户昵称} 的研发 Agent`
  - Provider 默认 `auto`（跟随平台 `AGENT_PROVIDER`）
  - 系统提示词声明：以用户权限工作、不读取密钥、生产发布需人工确认
  - 工具清单：会议、需求、设计、任务、代码、测试、流水线、部署、监控
- Agent 只能以所属用户身份操作；`TenantContext` 由当前请求用户构建。

### 5.2 Provider 解析

`agents.get_provider(agent)`：

```text
agent.provider = auto      → 使用平台 AGENT_PROVIDER
agent.provider = mock      → 内置 mock
agent.provider = claude    → 子进程 claude --print
agent.provider = opencode  → 子进程 opencode run
```

- 调用带超时（`AGENT_TIMEOUT_MS`）。
- 失败且 `AGENT_FALLBACK_MOCK=true` 时回退 mock，并记录运行事件。
- 每次 Agent 动作写入 `agent_runs`：输入、输出、状态、事件、耗时、错误。

### 5.3 聊天意图路由

`orchestration.handle_chat` 将自然语言分类为：

```text
extract / design / breakdown / code / test / pipeline / deploy / monitor / autopilot / none
```

命中动作时执行真实数据库变更（不是仅返回文本），并把 `actionResult` 随助手消息返回；前端在消息下方标注「已执行」。不命中动作时返回建议性回复。

### 5.4 一键研发闭环（autopilot）

`autopilot(ctx, requirement, environment)`：

1. 设计原型与架构；
2. 拆解任务并分配；
3. 生成代码制品；
4. 生成并执行测试；
5. 创建并运行流水线；
6. 部署到指定环境（默认测试环境）；
7. 创建/更新监控并执行健康检查。

每一步返回 `{stage, ok, detail}`；任一步失败会记录在结果中，前端展示步骤条。

---

## 6. API 设计

所有租户接口前缀：`/api/tenants/{tenant_id}`。

| 路由文件 | 责任 |
|---|---|
| `auth.py` | 注册、登录、`/auth/me`（返回用户 + 完整成员关系摘要） |
| `tenants.py` | 租户列表/发现/创建、详情、成员、角色、加入申请、Agent 配置、活动、工作台 |
| `projects.py` | 项目 → 系统 → 代码库 |
| `pipeline.py` | 会议、需求、设计/拆解/编码/测试/autopilot、任务、测试运行、Agent 运行 |
| `devops.py` | 环境与密钥、制品与发布、流水线、部署、监控、告警 |
| `agentchat.py` | 会话、消息、`POST /chat` 快捷对话 |

约定：

- 错误使用 `HTTPException`，前端 `api.ts` 统一抛出 `Error(detail)`。
- 列表接口直接返回数组；工作台/租户列表返回带统计的对象。
- 时间统一 ISO 8601（UTC）。
- 密码字段永不返回；密钥只返回掩码，`reveal` 单独授权。

---

## 7. 前端架构

### 7.1 状态

- `lib/session.ts`：`useSession`
  - 用户、成员关系、当前租户、`can(permission)`、`isAdmin()`
  - 启动时 `/auth/me`；`normalize()` 兼容后端不同版本的权限字段位置
  - 本地保存最后一个租户 id
- `lib/store.ts`：`useWorkspace`
  - 租户级并行加载：dashboard、detail、projects、meetings、requirements、tasks、testRuns、artifacts、pipelines、pipelineRuns、deployments、environments、monitors、alerts、agentRuns、activity
  - `refreshWorkspace()` 在每次变更后刷新
  - `askAgent(prompt, context)` 派发 `transonce:chat` 事件，打开浮动 Agent 控制台

### 7.2 页面

| 视图 | 说明 |
|---|---|
| Dashboard | 交付闭环统计、进行中需求、未处理告警、最近活动、Agent/环境摘要 |
| Projects | 项目卡片、系统与代码库增删 |
| Meetings | 会议列表、原始纪要、提取预览、勾选采纳 |
| Requirements | 需求列表/详情、原型、架构、验收标准、设计/拆解/编码/测试/autopilot |
| Development | 六列任务看板、任务执行、Agent 运行记录 |
| Testing | 通过率统计、按需求生成并执行测试、用例展开 |
| Artifacts | 制品列表、文件内容预览、发布（生产不可选时给出权限提示） |
| Pipelines | 流水线定义、运行、阶段时间线与日志 |
| Environments | 环境卡片、掩码密码、按权限查看明文、增删改 |
| Monitoring | 健康检查、延迟、期望状态、全部检查 |
| Alerts | 严重级别/状态筛选、确认/解决/重开 |
| My Agent | 个人 Agent 配置、工具、权限、快捷指令、运行记录 |
| Team Management | 成员、加入申请、角色权限、Agent 管理 |

### 7.3 路由与门禁

`App.tsx` 没有引入 React Router，使用 `view` 状态切换页面：

1. 启动加载 → 未登录显示 `Login`
2. 已登录但无租户 → `TeamSelect`
3. 有租户 → 加载工作区，按权限生成侧边栏
4. 当前 view 无权限 → 显示无权限占位并引导返回工作台

移动端侧边栏抽屉、主题切换（`dark` class + localStorage）均由 `App.tsx` 管理。

---

## 8. 安全设计

| 风险 | 措施 |
|---|---|
| 密码泄露 | PBKDF2-HMAC-SHA256（200k 次）+ 随机盐，数据库不存明文 |
| Token 伪造 | HMAC-SHA256 签名，含 `iat/exp`，默认 7 天 |
| 跨租户访问 | 每个路由强制 `load_tenant_context`，业务查询附加 `tenant_id` |
| 菜单绕过 | 后端对敏感操作单独 `require(permission)` |
| 环境密钥泄露 | 密钥流加密落库；列表仅掩码；`reveal` 需 `secret.read` 且审计 |
| 生产误发布 | `deploy.production` 门禁；前端不展示无权限的生产环境 |
| Agent 越权 | Agent 动作复用当前用户 `TenantContext`，无独立超级权限 |
| 审计 | `activity_events` + `agent_runs` 记录人/Agent 的关键动作 |

生产部署前建议替换：`SECRET_KEY`、数据库密码、环境密钥加密（KMS/Vault）、HTTPS、令牌刷新/撤销、CORS 白名单、速率限制。

---

## 9. 本地与测试

```bash
# 迁移
cd trans-once && python3 -m alembic upgrade head

# 后端
python3 -m uvicorn main:app --app-dir trans-once --port 9005 --reload

# 前端
cd trans-once-web-ui && npm run dev

# 冒烟测试（39 项）
python3 trans-once/tests/smoke.py

# 前端质量门禁
cd trans-once-web-ui && npm run lint && npm run build
```

数据库名固定为 **`transonce`**。`trans-once/.env` 由 `dotenv` 加载；Alembic 的 `env.py` 同样加载 `.env`，并对连接串中的 `%` 做转义。

---

## 10. 已知边界与后续方向

- Agent CLI 调用是阻塞式子进程；长任务应改为队列 + WebSocket 流式事件。
- 制品内容存于数据库 JSON，后续应迁移到对象存储并保留校验和与签名。
- 流水线当前为平台内模拟/编排执行，尚未真正驱动外部 Git/CI 系统。
- 生产发布是「权限闸门 + 人工操作」，尚未实现双人审批/变更窗口。
- 监控为拉取式 HTTP 健康检查，后续可接入 Prometheus/Alertmanager。
- 缺少租户归档、配额、账单与细粒度审计查询页面。
