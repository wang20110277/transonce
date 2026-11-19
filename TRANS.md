# TRANS.md — TransOnce 项目背景与工作规则

## Project overview

TransOnce 是一站式、多租户、Agent 编排的软件研发交付平台：把「会议纪要 → 需求 → 原型/架构 → 任务 → 编码 → 测试 → 制品 → CI/CD → 部署 → 监控告警」串成可追溯链路，人类成员与各自的专属 Agent 在同一租户内协作。后端为 Python 3.12 + FastAPI + PostgreSQL（库名 `transonce`，Alembic 迁移），前端为 Vite 6 + React 19 + TypeScript + Tailwind 4，另有 Electron 桌面壳。Agent 默认经 ACP 协议驱动本地 `transcode` CLI（可选 `claude` / `opencode`）。

## Commands

```bash
# 后端依赖与数据库
pip3 install -r trans-once/requirements.txt
createdb transonce
cp trans-once/.env.example trans-once/.env      # 改 DATABASE_URL / AGENT_PROVIDER / SECRET_KEY
(cd trans-once && python3 -m alembic upgrade head)

# 后端启动（固定 :9005；start.sh 用 conda 环境 transonce 后台启动，日志 trans-once/logs/）
./trans-once/start.sh
# 或前台：python3 -m uvicorn main:app --app-dir trans-once --port 9005 --reload

# 前端（固定 :3002，strictPort；/api→:9005，/asr→:8001）
cd trans-once-web-ui && npm install && npm run dev
npm run lint        # tsc --noEmit（类型检查）
npm run build       # vite build → dist/

# 测试（需后端已启动并完成种子）
python3 trans-once/tests/smoke.py          # 端到端冒烟，93 项检查
python3 trans-once/tests/microsoft_flow.py # 微软登录回调离线测试

# 桌面客户端（可选）
cd trans-once-desktop && npm install && npm start   # dev / smoke / dist（electron-builder --mac）
```

## Architecture

- `trans-once/` 后端：`main.py` 装配 FastAPI（lifespan 内做 stale run 恢复 + `seed.py` 幂等建超管）；`config.py` 环境变量与权限目录；`deps.py` 提供 `get_current_user` / `load_tenant_context(user, tenant_id, permission)` / `log_activity`；`security.py` 密码哈希、令牌、字段加密；`orchestration.py` Agent 动作与部署闸门；`agents.py` + `acp_agent.py` 运行时分发；`gitlab_client.py`、`microsoft_client.py`、`oidc_client.py`、`platform_settings.py`、`net_guard.py` 为外部集成。
- `trans-once/routers/`：`auth`（`/api/auth`）、`tenants`（`/api`，含成员/角色/加入申请/Agent/工作台）、`projects`、`pipeline`、`devops`、`coderepos`、`agentchat`（均 `/api/tenants/{tenant_id}`）、`agent_runtime`（`/api/agent-runtime`）。
- `trans-once/migrations/versions/`：`0001` 初始链路 → `0009` 微软登录；新增表/列必须写迁移，启动时检查版本。
- `trans-once-web-ui/` 前端：`src/App.tsx` 登录/租户门禁与权限菜单；`src/views/` 页面；`src/components/` 业务组件；`src/lib/session.ts`（认证/权限）、`store.ts`（租户工作区数据）、`agentModels.ts`；`src/services/api.ts` 唯一 API 客户端；`components/ui/` 为 shadcn 基础组件（alias `@` → 前端根目录）。
- `trans-once-desktop/electron/main.js`：`app://` 协议加载 `dist/`，主进程代理 `/api`、`/asr`，前端零改动。
- `docs/ARCHITECTURE.md` 架构与数据模型；`docs/superpowers/{plans,specs}` 设计文档。

## Conventions

- 命名：Python 用 `snake_case`（模块/函数）、表与列 `snake_case` 复数；前端组件 `PascalCase.tsx`，工具模块 `camelCase.ts`；权限串为 `domain.action`（如 `deploy.production`、`repo.approve`）。
- 数据隔离：所有业务查询必须带 `tenant_id`；路由内先 `load_tenant_context(...)` 校验权限，不靠前端隐藏菜单；敏感操作写 `activity_events`；密钥/令牌只返回掩码。
- 代码风格：后端 4 空格、类型注解 + `dict` 行数据（psycopg2 直连，无 ORM 模型层）；前端 2 空格、函数组件 + hooks、Tailwind 类名、`@/` 别名导入；注释与 UI 文案用中文。
- 提交信息：`<type>: <中文简述>`，type 取 `feat` / `fix` / `ui` / `refactor` / `chore` / `docs`（可组合如 `docs+test:`），简述后可用 `——` 补充细节。
- 变更后至少跑 `npm run lint` 与相关测试；不提交 `.env`、`logs/`、`dist/`、`node_modules/`。
