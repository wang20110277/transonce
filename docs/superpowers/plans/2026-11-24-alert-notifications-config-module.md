# 告警通知与配置模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让监控告警和手工录入的问题能推送到钉钉 / 企业微信 / 飞书群，并在侧边栏新增「配置」分组放置环境配置和告警配置。

**Architecture:** 后端新增两个模块。`notifiers.py` 是纯函数（渲染消息体、加签、发送、掩码），不碰数据库；`alert_notify.py` 负责筛选通道、并行发送、写推送记录，路由和监控检查都调用它。数据层用迁移 `0010` 新增通道表和推送记录表，并给 `alerts`、`environments` 加列。前端新增告警配置页，扩展告警中心和环境配置页，通道数据随工作区一起加载。

**Tech Stack:** Python 3.12 + FastAPI + psycopg2 + Alembic（只用标准库，不新增依赖）；React 19 + TypeScript + Tailwind 4 + lucide-react。

**Spec:** `docs/superpowers/specs/2026-11-24-alert-notifications-config-module-design.md`

## 执行记录（2026-11-24，与下文的出入）

这份计划已在分支 `feat/alert-notifications` 上执行完，执行中对照设计文档做了下面这些更正。代码以仓库为准，检查项数以脚本输出为准，这里只记录和下文的出入。

- 任务 2：`mask_webhook` 的兜底分支改成返回完整的五元组（地址既没有查询串也没有路径时原样返回）；离线检查补了用例。
- 任务 3：`notifiers.send` 改成用 `_platform_error` 统一判断平台应答，4xx 应答里的错误码和原因也写进推送记录；`_describe` 和通道的修改、删除语句补上了 `tenant_id`。步骤 4 的先失败实际是 `13/28`，不是 `13/41`（夹具建不出来时有 13 条检查被跳过）。通道接口是六个，不是五个。
- 任务 4、5、6：告警状态的更新、监控检查里的三条语句、环境的更新和删除语句都补上了 `tenant_id` 条件。
- 任务 8 步骤 12 的等待条件应只看侧边栏（`aside nav`），原来的条件在页面停在告警配置视图时会超时。
- 任务 10 步骤 6：来源选「手工录入」后是两条卡片，不是一条（还有一条冒烟夹具）。
- 整体审查之后的一次统一修复：关联了监控的手工问题不再参与监控告警的去重和自动解决；重发时显式传空的 `channelIds` 返回 400；Webhook 地址拒绝空白和控制字符；另有若干收尾和新增的检查。
- `CLAUDE.md` 里两处测试说明的更新没有随计划执行，等用户确认后应用。

## Global Constraints

- 后端风格：4 空格缩进、类型注解、请求体用 `body: dict = Body(...)`（仓库里没有 Pydantic 模型）、psycopg2 原生 SQL。每个业务查询都带 `tenant_id`；路由先 `load_tenant_context(...)` 再做事；敏感操作用 `log_activity` 写审计；密钥和地址只返回掩码。
- 前端风格：2 空格缩进、函数组件 + hooks、Tailwind 类名。`@/` 指向前端根目录（shadcn 基础组件），业务组件用相对路径。界面文案和注释用中文。
- 前端没有安装 `@types/react`：给自定义组件传 `key` 时，必须在它的 props 类型里声明 `key?: string`（仓库里的 `Pill` 就是这么做的），否则 `npm run lint` 报错。
- 这个版本的 Tailwind 不生成 `rtl` / `ltr` 类。
- 后端和迁移统一用解释器 `/usr/local/Caskroom/miniconda/base/envs/transonce/bin/python`。
- 改了后端代码必须重启后端才生效（它不带 `--reload`）。
- 冒烟测试可以只跑告警这一节：`SMOKE_ONLY=alerts python3 trans-once/tests/smoke.py`。
- Bash 工具是 bash 3.2：不要用 `sleep` 和数组，等待用 `perl -e 'select(undef,undef,undef,0.5)'`。一个命令保持简单，不要嵌套 `$(...)` 或在命令行里写 heredoc，太复杂的命令会被工具直接拒绝；复杂的操作先写成脚本文件再执行。
- 前端没有单元测试框架，`npm run lint` 只做类型检查，而且仓库里没有 `@types/react`，所以类型检查对组件的属性几乎不设防。界面改动必须在浏览器里按任务里写好的步骤核对。
- 每个任务结束提交一次，只 `git add` 该任务列出的文件。提交信息格式是 `<type>: <中文简述>`，直接提交到当前分支。
- 不提交 `.env`、`logs/`、`dist/`、`node_modules/`。
- 冒烟和浏览器核对都会连到本机开发库的后端（:9005）。冒烟新增的夹具都放在「冒烟测试租户」里。
- 仓库根目录是 `/Users/lindaw/Documents/transonce`，下文路径都相对它。

## 开始之前

- [ ] **Step 1: 确认工作区干净**

运行：`git status --short`

预期：没有输出。如果 `trans-once-web-ui/src/views/Dashboard.tsx` 仍是未提交的「∞ 形闭环」改动，先请用户决定：单独提交为 `ui: 工作台研发交付闭环改为 ∞ 形双排`，还是先搁置。任务 10 也要改这个文件，带着未提交的改动开始会把它混进别的提交。

- [ ] **Step 2: 创建重启后端的辅助脚本（计划专用，不入库）**

先执行 `mkdir -p /tmp/transonce-plan/ui`，再创建 `/tmp/transonce-plan/restart-backend.sh`：

```bash
#!/bin/bash
# 重启本机开发后端（:9005）。只在本机开发环境使用。
# agent 运行时会把 ANTHROPIC_* / CLAUDE* 变量带进环境，启动后端前要去掉，
# 否则会遮蔽 trans-once/.env 里的同名配置。
set -u
REPO=/Users/lindaw/Documents/transonce
PY=/usr/local/Caskroom/miniconda/base/envs/transonce/bin/python
OLD=$(lsof -nP -ti tcp:9005 -sTCP:LISTEN)
if [ -n "$OLD" ]; then kill $OLD; fi
for _ in 1 2 3 4 5 6 7 8 9 10; do
  lsof -nP -ti tcp:9005 -sTCP:LISTEN >/dev/null 2>&1 || break
  perl -e 'select(undef,undef,undef,0.3)'
done
REPO="$REPO" PY="$PY" python3 - <<'PYEOF'
import os, subprocess
env = {k: v for k, v in os.environ.items() if not k.startswith(("ANTHROPIC_", "CLAUDE"))}
repo = os.environ["REPO"]
os.makedirs(repo + "/trans-once/logs", exist_ok=True)
log = open(repo + "/trans-once/logs/transonce.log", "ab")
subprocess.Popen(
    [os.environ["PY"], "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "9005", "--log-level", "info"],
    cwd=repo + "/trans-once", env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
    start_new_session=True,
)
PYEOF
for _ in $(seq 1 40); do
  if curl -sf http://127.0.0.1:9005/api/health >/dev/null 2>&1; then
    echo "backend up: $(curl -s http://127.0.0.1:9005/api/health)"
    exit 0
  fi
  perl -e 'select(undef,undef,undef,0.5)'
done
echo "backend failed to start; see trans-once/logs/transonce.log"
exit 1
```

运行 `bash /tmp/transonce-plan/restart-backend.sh`，预期输出 `backend up: {"ok":true,...}`（这个脚本会先停掉 :9005 上已有的后端进程，再启动一个新的；后端本来没在运行时也可以直接用它启动）。

确认数据库的当前版本：

```bash
(cd trans-once && /usr/local/Caskroom/miniconda/base/envs/transonce/bin/python -m alembic current)
```

预期：输出里有 `0009 (head)`。如果显示的是 `0010`，说明迁移已经执行过，先停下来告诉用户，不要继续。

---

### Task 1: 迁移 0010 与权限 `alert.channel.manage`

**Files:**
- Modify: `trans-once/tests/smoke.py`（新增一节冒烟检查，以及只跑这一节的开关）
- Create: `trans-once/migrations/versions/0010_alert_channels.py`
- Modify: `trans-once/config.py`（权限目录和 DevOps 预设角色）

**Interfaces:**
- Consumes: 无（第一个任务）。
- Produces: 表 `alert_channels`、`alert_deliveries`；列 `alerts.source`、`alerts.notified_user_ids`、`alerts.environment_id`、`environments.os_type`；权限 `alert.channel.manage`；smoke.py 里的 `section_alert_notifications(tenant_id, admin, product_token, dev_token)`、`_summary()`，以及环境变量开关 `SMOKE_ONLY=alerts`。后续任务都往 `section_alert_notifications` 的末尾追加检查。

- [ ] **Step 1: 写会失败的检查**

在 `trans-once/tests/smoke.py` 里做四处改动。

第一处，导入区按字母序加入 `hashlib` 和 `hmac`：

```python
import base64
import hashlib
import hmac
import json
```

第二处，常量区 `JOIN_PASSWORD = ...` 之后加入：

```python
# 告警通知一节的夹具：只有告警中心权限的账号，以及假群机器人用的加签密钥。
ALERT_EMAIL = os.getenv("ALERT_EMAIL", "smoke-alert@transonce.local")
ALERT_PASSWORD = os.getenv("ALERT_PASSWORD", "smoke-pass-123")
BOT_SECRET = "SECsmokesecret"
ISSUE_TITLE = "冒烟：手工录入的问题"
PROBE_NAME = "冒烟失败探针"
```

第三处，在 `def main() -> int:` 之前加入两个函数：

```python
def _summary() -> int:
    total = passed + len(failed)
    print(f"\n{'─' * 48}\n{passed}/{total} checks passed")
    if failed:
        print("Failed checks:")
        for name in failed:
            print(f"  - {name}")
        return 1
    print("All smoke checks passed ✓\n")
    return 0


def section_alert_notifications(tenant_id: str, admin: dict, product_token: str, dev_token: str) -> None:
    """Alert channels (钉钉 / 企业微信 / 飞书), the delivery log, manual issues
    and the monitor → group push. Fixtures are created once and reused."""
    print("\n[alert channels & notifications]")
    admin_token = admin["token"]
    base = f"/api/tenants/{tenant_id}"

    _, catalog = call("GET", "/api/permissions", token=admin_token, expect=None)
    items = catalog.get("items") if isinstance(catalog, dict) else (catalog or [])
    check("permission catalog lists alert.channel.manage",
          any(i.get("id") == "alert.channel.manage" for i in items or []))
    _, roles = call("GET", f"{base}/roles", token=admin_token, expect=None)
    devops = next((r for r in (roles or []) if r.get("name") == "DevOps 工程师"), None)
    check("DevOps preset role gained alert.channel.manage",
          bool(devops) and "alert.channel.manage" in (devops.get("permissions") or []))
```

第四处，改 `main()`：

在 `check("product cannot manage environments", "environments" not in perms)` 之后加入：

```python
    # 只跑告警通知一节（改动相关代码后的快速回归），仍然先完成启动和夹具准备。
    if os.getenv("SMOKE_ONLY") == "alerts":
        section_alert_notifications(tenant_id, admin, product_token, dev_token)
        return _summary()
```

在 `[monitoring]` 一节末尾（`check("monitor check returns status", ...)` 那行）之后加入一个空行和：

```python
    section_alert_notifications(tenant_id, admin, product_token, dev_token)
```

把 `main()` 末尾从 `    total = passed + len(failed)` 到 `    return 0` 的整段替换成：

```python
    return _summary()
```

- [ ] **Step 2: 运行，确认检查失败**

运行：`SMOKE_ONLY=alerts python3 trans-once/tests/smoke.py`

预期：退出码 1，结尾输出如下。前面的健康检查和夹具准备（11 条）照常通过，新增的两条都失败，说明它们确实在检验还没实现的东西。只跑这一节时，这 11 条基础检查始终会计入总数。

```
[alert channels & notifications]
  ✗ permission catalog lists alert.channel.manage
  ✗ DevOps preset role gained alert.channel.manage

────────────────────────────────────────────────
11/13 checks passed
```

- [ ] **Step 3: 写迁移**

创建 `trans-once/migrations/versions/0010_alert_channels.py`：

```python
"""alerts: notification channels, delivery log and manual issues; environments: os_type

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-24
"""
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

# 已有租户保留自己的角色：只把新权限追加给对应的系统预设角色（做法同 0004）。
ROLE_PERM_APPENDS = [("DevOps 工程师", ["alert.channel.manage"])]


def upgrade() -> None:
    op.execute(
        """CREATE TABLE alert_channels (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            provider TEXT NOT NULL,
            webhook_enc TEXT NOT NULL,
            secret_enc TEXT,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            events JSONB NOT NULL DEFAULT '{"monitor": true, "manual": true, "status": false}',
            created_by UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )"""
    )
    op.execute("CREATE INDEX idx_alert_channels_tenant_created ON alert_channels (tenant_id, created_at)")
    op.execute(
        """CREATE TABLE alert_deliveries (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            alert_id UUID REFERENCES alerts(id) ON DELETE CASCADE,
            channel_id UUID REFERENCES alert_channels(id) ON DELETE SET NULL,
            channel_name TEXT NOT NULL,
            provider TEXT NOT NULL,
            event TEXT NOT NULL,
            status TEXT NOT NULL,
            http_status INT,
            error TEXT,
            duration_ms INT,
            created_by UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )"""
    )
    op.execute("CREATE INDEX idx_alert_deliveries_alert ON alert_deliveries (alert_id)")
    op.execute("CREATE INDEX idx_alert_deliveries_tenant_created ON alert_deliveries (tenant_id, created_at DESC)")
    op.execute("ALTER TABLE alerts ADD COLUMN source TEXT NOT NULL DEFAULT 'monitor'")
    op.execute("ALTER TABLE alerts ADD COLUMN notified_user_ids UUID[] NOT NULL DEFAULT '{}'")
    op.execute(
        "ALTER TABLE alerts ADD COLUMN environment_id UUID REFERENCES environments(id) ON DELETE SET NULL"
    )
    op.execute("ALTER TABLE environments ADD COLUMN os_type TEXT NOT NULL DEFAULT 'linux'")
    for name, perms in ROLE_PERM_APPENDS:
        joined = ", ".join(f'"{p}"' for p in perms)
        op.execute(
            f"UPDATE roles SET permissions = permissions || '[{joined}]'::jsonb"
            f" WHERE is_system AND name = '{name}'"
        )


def downgrade() -> None:
    op.execute("ALTER TABLE environments DROP COLUMN IF EXISTS os_type")
    op.execute("ALTER TABLE alerts DROP COLUMN IF EXISTS environment_id")
    op.execute("ALTER TABLE alerts DROP COLUMN IF EXISTS notified_user_ids")
    op.execute("ALTER TABLE alerts DROP COLUMN IF EXISTS source")
    op.execute("DROP TABLE IF EXISTS alert_deliveries")
    op.execute("DROP TABLE IF EXISTS alert_channels")
```

- [ ] **Step 4: 加权限**

在 `trans-once/config.py` 的 `PERMISSIONS` 列表里，`repo.approve` 那一行之后加入：

```python
    {"id": "alert.channel.manage", "label": "告警通道配置", "group": "敏感操作"},
```

同一个文件里，`ROLE_PRESETS` 中「DevOps 工程师」的 `permissions` 末尾（`"repo.approve",` 之后）加入：

```python
            "alert.channel.manage",
```

- [ ] **Step 5: 执行迁移、重启后端、确认检查通过**

```bash
(cd trans-once && /usr/local/Caskroom/miniconda/base/envs/transonce/bin/python -m alembic upgrade head)
(cd trans-once && /usr/local/Caskroom/miniconda/base/envs/transonce/bin/python -m alembic current)
bash /tmp/transonce-plan/restart-backend.sh
SMOKE_ONLY=alerts python3 trans-once/tests/smoke.py
```

预期：`alembic` 输出 `Running upgrade 0009 -> 0010`，`current` 显示 `0010 (head)`；后端健康检查通过；冒烟输出 `13/13 checks passed` 和 `All smoke checks passed ✓`。

- [ ] **Step 6: 提交**

```bash
git add trans-once/migrations/versions/0010_alert_channels.py trans-once/config.py trans-once/tests/smoke.py
git commit -m "feat: 迁移 0010 与告警通道权限——通道表、推送记录、告警与环境新列，alert.channel.manage 授权 DevOps 角色"
```


### Task 2: `notifiers.py` 的纯函数部分

**Files:**
- Create: `trans-once/tests/notifiers_flow.py`（离线检查，不联网、不连数据库）
- Create: `trans-once/notifiers.py`

**Interfaces:**
- Consumes: 无。
- Produces（都在 `notifiers` 模块里，供任务 3 到任务 6 使用）:
  - 常量 `PROVIDERS: tuple = ("dingtalk", "wecom", "feishu")`、`EVENTS: tuple = ("monitor", "manual", "status")`、`SEVERITIES: tuple = ("info", "warning", "critical")`、`DEFAULT_EVENTS: dict`
  - `dingtalk_sign(timestamp_ms: int, secret: str) -> str`
  - `feishu_sign(timestamp_s: int, secret: str) -> str`
  - `sanitize_error(text: str, *secrets: str | None) -> str`
  - `mask_webhook(url: str | None) -> str | None`
  - `compose(event: str, *, tenant: str, title: str, severity: str = "", origin: str = "", environment: str = "", notified: list[str] | None = None, created_at=None, detail: str = "", status: str = "") -> tuple[str, list[str]]`
  - `render(provider: str, webhook: str, secret: str | None, headline: str, lines: list[str]) -> tuple[str, bytes]`

- [ ] **Step 1: 写会失败的检查**

创建 `trans-once/tests/notifiers_flow.py`：

```python
"""Offline checks for `notifiers` — no network, no database.

Covers what a wrong implementation would break silently in production: the
DingTalk / Feishu signature algorithms (compared with values derived from the
platforms' documented sample code, not generated by the code under test), the
per-provider payload shapes, credential masking and message composition.

Usage: python3 trans-once/tests/notifiers_flow.py
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import notifiers  # noqa: E402

passed = 0
failed: list[str] = []

DINGTALK_URL = "https://oapi.dingtalk.com/robot/send?access_token=t"
WECOM_URL = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k"
FEISHU_URL = "https://open.feishu.cn/open-apis/bot/v2/hook/t"
# 参考值由各平台官方文档给出的算法独立算出，不是用 notifiers 生成的。
DINGTALK_SIGN = "aZLLrriXgn05YbwaGR7knYsLeJADjr9NwLaNNKpxh4g%3D"  # timestamp 1700000000000, secret SECtest
FEISHU_SIGN = "OrBzY1Y01Gq+HgJsl+7OfWcMVwc7YocohQm5iiZwjhU="  # timestamp 1700000000, secret feishu-secret


def check(name: str, condition: bool, detail: str = "") -> None:
    global passed
    if condition:
        passed += 1
        print(f"  ✓ {name}")
    else:
        failed.append(name)
        print(f"  ✗ {name}{(' — ' + detail) if detail else ''}")


def main() -> int:
    print("\n[notifiers: signatures]")
    got = notifiers.dingtalk_sign(1700000000000, "SECtest")
    check("dingtalk sign matches the reference", got == DINGTALK_SIGN, got)
    got = notifiers.feishu_sign(1700000000, "feishu-secret")
    check("feishu sign matches the reference", got == FEISHU_SIGN, got)
    check("a different secret yields a different sign",
          notifiers.dingtalk_sign(1700000000000, "SECother") != DINGTALK_SIGN)

    print("\n[notifiers: payloads]")
    with patch("notifiers.time.time", return_value=1700000000.0):
        url, body = notifiers.render(
            "dingtalk", DINGTALK_URL, "SECtest", "【TransOnce 告警】测试消息", ["租户：冒烟"],
        )
    payload = json.loads(body)
    check("dingtalk appends timestamp and sign to the url",
          "timestamp=1700000000000" in url and f"sign={DINGTALK_SIGN}" in url, url)
    check("dingtalk body is markdown with title and text",
          payload["msgtype"] == "markdown" and payload["markdown"]["title"] == "【TransOnce 告警】测试消息"
          and "租户：冒烟" in payload["markdown"]["text"])
    url, _ = notifiers.render("dingtalk", DINGTALK_URL, None, "标题", ["一"])
    check("dingtalk without a secret sends no sign parameters", url == DINGTALK_URL, url)
    _, body = notifiers.render("wecom", WECOM_URL, None, "标题", ["详情：" + "长" * 5000])
    payload = json.loads(body)
    check("wecom body stays under 4096 bytes", len(body) <= 4096, str(len(body)))
    check("wecom body is markdown content",
          payload["msgtype"] == "markdown" and payload["markdown"]["content"].startswith("### 标题\n"),
          payload["markdown"]["content"][:40])
    url, _ = notifiers.render("wecom", WECOM_URL, None, "标题", ["一"])
    check("wecom url is sent unchanged", url == WECOM_URL, url)
    with patch("notifiers.time.time", return_value=1700000000.0):
        url, body = notifiers.render("feishu", FEISHU_URL, "feishu-secret", "标题", ["一", "二"])
    payload = json.loads(body)
    post = payload["content"]["post"]["zh_cn"]
    check("feishu body carries timestamp and sign",
          payload["timestamp"] == "1700000000" and payload["sign"] == FEISHU_SIGN)
    check("feishu body is rich text with one paragraph per line",
          payload["msg_type"] == "post" and post["title"] == "标题"
          and post["content"] == [[{"tag": "text", "text": "一"}], [{"tag": "text", "text": "二"}]])
    check("feishu url is sent unchanged", url == FEISHU_URL, url)
    try:
        notifiers.render("slack", "https://x.test", None, "标题", [])
        check("unknown provider is rejected", False, "no exception")
    except ValueError:
        check("unknown provider is rejected", True)

    print("\n[notifiers: masking]")
    cases = [
        ("https://oapi.dingtalk.com/robot/send?access_token=abcdef123456",
         "https://oapi.dingtalk.com/robot/send?••••••3456"),
        ("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=693a91f6-7xxx",
         "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?••••••7xxx"),
        ("https://open.feishu.cn/open-apis/bot/v2/hook/abcd9f3e",
         "https://open.feishu.cn/open-apis/bot/v2/hook/••••••9f3e"),
        ("https://x.test/hook/ab", "https://x.test/hook/••••••"),
    ]
    for raw, want in cases:
        got = notifiers.mask_webhook(raw)
        check(f"webhook masked: …{raw[-14:]}", got == want, got)
    check("empty webhook masks to None",
          notifiers.mask_webhook(None) is None and notifiers.mask_webhook("") is None)

    print("\n[notifiers: message composition]")
    created = datetime(2026, 11, 24, 8, 5, tzinfo=timezone.utc)
    headline, lines = notifiers.compose(
        "manual", tenant="冒烟租户", title="支付超时", severity="critical", origin="张三 录入",
        environment="生产环境", notified=["李四", "王五"], created_at=created, detail="x" * 1500,
    )
    check("manual headline uses the 问题 prefix", headline == "【TransOnce 问题】支付超时", headline)
    check("body lists tenant, severity, origin, environment and names",
          lines[:5] == ["租户：冒烟租户", "级别：严重", "来源：张三 录入", "环境：生产环境", "通知：李四、王五"],
          str(lines[:5]))
    check("time is rendered in the server's local timezone",
          re.fullmatch(r"时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}", lines[5]) is not None, lines[5])
    check("long detail is cut and flagged",
          lines[-1] == "详情：" + "x" * 1000 + "（已截断）", f"{len(lines[-1])} chars")
    check("status headline names the new state",
          notifiers.compose("status", tenant="t", title="监控异常：支付", status="resolved")[0]
          == "【TransOnce 告警】监控异常：支付：已解决")
    check("monitor headline keeps the keyword 告警",
          notifiers.compose("monitor", tenant="t", title="监控异常：支付")[0]
          == "【TransOnce 告警】监控异常：支付")
    check("optional lines are omitted when empty",
          notifiers.compose("monitor", tenant="t", title="x")[1] == ["租户：t"])

    print("\n[notifiers: error text]")
    text = notifiers.sanitize_error(
        "failed calling https://x.test/hook?k=secret-token with SECabc",
        "https://x.test/hook?k=secret-token", "SECabc",
    )
    check("sanitize_error strips the webhook and the secret",
          "secret-token" not in text and "SECabc" not in text, text)
    check("sanitize_error caps the length", len(notifiers.sanitize_error("e" * 1000)) == 300)

    total = passed + len(failed)
    print(f"\n{passed}/{total} checks passed")
    if failed:
        print("Failed checks:")
        for name in failed:
            print(f"  - {name}")
        return 1
    print("All notifiers checks passed ✓\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: 运行，确认检查失败**

运行：`python3 trans-once/tests/notifiers_flow.py`

预期：退出码 1，最后一行是 `ModuleNotFoundError: No module named 'notifiers'`。

- [ ] **Step 3: 写实现**

创建 `trans-once/notifiers.py`：

```python
"""Alert channel messaging: render one notification for each IM platform,
sign it and POST it to the group robot's webhook.

This module knows nothing about the platform: no database, no config. Callers
pass plain (already decrypted) values and get a result dict back. Choosing
which channels to talk to and logging the outcome live in `alert_notify.py`.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from urllib.parse import urlsplit, urlunsplit

PROVIDERS = ("dingtalk", "wecom", "feishu")
EVENTS = ("monitor", "manual", "status")
SEVERITIES = ("info", "warning", "critical")
DEFAULT_EVENTS = {"monitor": True, "manual": True, "status": False}
# 企业微信 markdown 上限 4096 字节，飞书请求体上限 20KB；统一按最严的那家截断并留出余量。
MAX_BODY_TEXT_BYTES = 3800
MAX_DETAIL_CHARS = 1000
MAX_ERROR_CHARS = 300
SEND_TIMEOUT_SECONDS = 5
MASK = "••••••"
BRAND = "TransOnce"

SEVERITY_LABELS = {"info": "提示", "warning": "警告", "critical": "严重"}
STATUS_LABELS = {"open": "未处理", "acknowledged": "已确认", "resolved": "已解决"}


def _hmac_b64(key: bytes, message: bytes) -> str:
    return base64.b64encode(hmac.new(key, message, hashlib.sha256).digest()).decode()


def dingtalk_sign(timestamp_ms: int, secret: str) -> str:
    """钉钉加签：以 secret 为密钥，对「毫秒时间戳 + 换行 + secret」做 HMAC-SHA256，
    结果 Base64 后再做 URL 编码，拼到 Webhook 地址的 timestamp / sign 参数上。"""
    text = f"{timestamp_ms}\n{secret}"
    return urllib.parse.quote_plus(_hmac_b64(secret.encode(), text.encode()))


def feishu_sign(timestamp_s: int, secret: str) -> str:
    """飞书签名校验：以「秒时间戳 + 换行 + secret」为密钥，对空串做 HMAC-SHA256，
    结果 Base64 后放在请求体的 timestamp / sign 字段里。"""
    return _hmac_b64(f"{timestamp_s}\n{secret}".encode(), b"")


def sanitize_error(text: str, *secrets: str | None) -> str:
    """去掉错误信息里可能出现的地址和密钥，并限制长度。"""
    out = text
    for secret in secrets:
        if secret:
            out = out.replace(secret, MASK)
    return out[:MAX_ERROR_CHARS]


def truncate_utf8(text: str, limit: int) -> str:
    """按 UTF-8 字节数截断，不会切坏多字节字符；末尾的省略号占 3 字节。"""
    if len(text.encode()) <= limit:
        return text
    out = bytearray()
    for ch in text:
        raw = ch.encode()
        if len(out) + len(raw) > limit - 3:
            break
        out += raw
    return out.decode() + "…"


def mask_webhook(url: str | None) -> str | None:
    """保留协议、主机和路径，把凭证部分换成掩码加末 4 位。

    凭证是查询串（钉钉、企业微信）或最后一段路径（飞书）。凭证不超过 4 个字符时只留掩码。
    """
    if not url:
        return None
    parts = urlsplit(url)
    if parts.query:
        tail = parts.query[-4:] if len(parts.query) > 4 else ""
        return urlunsplit((parts.scheme, parts.netloc, parts.path, MASK + tail, ""))
    segments = parts.path.rstrip("/").split("/")
    if len(segments) > 1:
        last = segments[-1]
        tail = last[-4:] if len(last) > 4 else ""
        masked = "/".join(segments[:-1] + [MASK + tail])
        return urlunsplit((parts.scheme, parts.netloc, masked, "", ""))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, MASK))


def compose(event: str, *, tenant: str, title: str, severity: str = "", origin: str = "",
            environment: str = "", notified: list[str] | None = None,
            created_at=None, detail: str = "", status: str = "") -> tuple[str, list[str]]:
    """生成一条消息的标题和正文行。标题固定带「TransOnce」，方便在平台上配关键词校验。"""
    if event == "manual":
        headline = f"【{BRAND} 问题】{title}"
    elif event == "status":
        headline = f"【{BRAND} 告警】{title}：{STATUS_LABELS.get(status, status)}"
    else:
        headline = f"【{BRAND} 告警】{title}"
    lines = [f"租户：{tenant}"]
    if severity:
        lines.append(f"级别：{SEVERITY_LABELS.get(severity, severity)}")
    if origin:
        lines.append(f"来源：{origin}")
    if environment:
        lines.append(f"环境：{environment}")
    if notified:
        lines.append(f"通知：{'、'.join(notified)}")
    if created_at is not None:
        lines.append(f"时间：{created_at.astimezone().strftime('%Y-%m-%d %H:%M')}")
    if detail:
        cut = detail if len(detail) <= MAX_DETAIL_CHARS else detail[:MAX_DETAIL_CHARS] + "（已截断）"
        lines.append(f"详情：{cut}")
    return headline, lines


def render(provider: str, webhook: str, secret: str | None, headline: str,
           lines: list[str]) -> tuple[str, bytes]:
    """返回 (请求地址, 请求体)。钉钉的签名拼在地址上，飞书的签名放在请求体里。"""
    if provider == "dingtalk":
        url = webhook
        if secret:
            timestamp = int(time.time() * 1000)
            joiner = "&" if urlsplit(webhook).query else "?"
            url = f"{webhook}{joiner}timestamp={timestamp}&sign={dingtalk_sign(timestamp, secret)}"
        text = truncate_utf8(f"### {headline}\n\n" + "  \n".join(lines), MAX_BODY_TEXT_BYTES)
        body = {"msgtype": "markdown", "markdown": {"title": headline, "text": text}}
        return url, json.dumps(body, ensure_ascii=False).encode()
    if provider == "wecom":
        content = truncate_utf8(f"### {headline}\n" + "\n".join(lines), MAX_BODY_TEXT_BYTES)
        body = {"msgtype": "markdown", "markdown": {"content": content}}
        return webhook, json.dumps(body, ensure_ascii=False).encode()
    if provider == "feishu":
        body = {
            "msg_type": "post",
            "content": {"post": {"zh_cn": {
                "title": headline,
                "content": [[{"tag": "text", "text": line}] for line in lines],
            }}},
        }
        if secret:
            timestamp = int(time.time())
            body["timestamp"] = str(timestamp)
            body["sign"] = feishu_sign(timestamp, secret)
        return webhook, json.dumps(body, ensure_ascii=False).encode()
    raise ValueError(f"unknown alert channel provider: {provider}")
```

- [ ] **Step 4: 运行，确认检查通过**

运行：`python3 trans-once/tests/notifiers_flow.py`

预期：退出码 0，输出 `27/27 checks passed` 和 `All notifiers checks passed ✓`。

- [ ] **Step 5: 提交**

```bash
git add trans-once/notifiers.py trans-once/tests/notifiers_flow.py
git commit -m "feat: notifiers 模块——钉钉/企业微信/飞书消息渲染、加签、掩码与离线测试"
```


### Task 3: 发送、推送编排与告警通道接口

**Files:**
- Modify: `trans-once/tests/notifiers_flow.py`（增加 `send` 的离线检查）
- Modify: `trans-once/notifiers.py`（增加 `send`）
- Create: `trans-once/alert_notify.py`
- Modify: `trans-once/serializers.py`（增加 `alert_channel`、`alert_delivery`）
- Modify: `trans-once/routers/devops.py`（通道的六个接口）
- Modify: `trans-once/tests/smoke.py`（假群机器人、夹具和本任务的检查）

**Interfaces:**
- Consumes: 任务 1 的表和权限；任务 2 的 `notifiers.render`、`sanitize_error`、`compose`、常量。
- Produces:
  - `notifiers.send(provider: str, webhook: str, secret: str | None, headline: str, lines: list[str]) -> dict`，返回 `{"status": "sent" | "failed", "httpStatus": int | None, "error": str | None, "durationMs": int}`，永不抛异常。
  - `alert_notify.notified_names(value) -> dict[str, str]`（`users.id` 到姓名的映射）和 `alert_notify.to_user_ids(value) -> list[str]`（把 UUID[] 列的值统一成字符串列表；psycopg2 默认把它取成数组字面量字符串）。
  - `alert_notify.notify(tenant_id: str, event: str, alert: dict, actor_id: str | None = None, channel_ids: list[str] | None = None) -> list[dict]`，返回新建的 `alert_deliveries` 行，永不抛异常。`alert` 只需要含 `id`。
  - `alert_notify.send_test(tenant_id: str, channel: dict, actor_id: str | None) -> dict`，返回一条 `event = "test"` 的推送记录行。
  - `serializers.alert_channel(r: dict) -> dict`、`serializers.alert_delivery(r: dict) -> dict`。
  - 接口：`GET/POST /alert-channels`、`PATCH/DELETE /alert-channels/{id}`、`POST /alert-channels/{id}/test`、`GET /alert-channels/deliveries`。
  - smoke.py 里的 `_FakeBotHandler`、`_start_fake_bot() -> str`、`ensure_alert_viewer(tenant_id, admin_token) -> str`。
  - devops.py 里的 `_uuid_list(values, label: str) -> list[str]`（任务 4 会用到）。

- [ ] **Step 1: 给离线检查加上 `send` 的部分**

在 `trans-once/tests/notifiers_flow.py` 的导入区加入：

```python
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
```

在 `    total = passed + len(failed)` 之前插入：

```python
    print("\n[notifiers: send]")
    seen: list[tuple[str, bytes]] = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args) -> None:
            pass

        def do_POST(self) -> None:  # noqa: N802 - http.server API
            seen.append((self.path, self.rfile.read(int(self.headers.get("content-length", 0)))))
            if self.path.startswith("/http500"):
                self.send_response(500)
                self.end_headers()
                return
            payload = ({"errcode": 310000, "errmsg": "keywords not in content"}
                       if self.path.startswith("/fail") else {"errcode": 0, "errmsg": "ok"})
            data = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    bot = f"http://127.0.0.1:{server.server_port}"

    send = getattr(notifiers, "send", None)
    if send is None:
        check("notifiers.send exists", False, "module has no attribute send")
    else:
        res = send("dingtalk", f"{bot}/ok?access_token=tok", None, "标题", ["一"])
        check("2xx with errcode 0 is sent",
              res["status"] == "sent" and res["httpStatus"] == 200 and res["error"] is None
              and isinstance(res["durationMs"], int), str(res))
        res = send("dingtalk", f"{bot}/fail?access_token=tok", None, "标题", ["一"])
        check("a platform error code becomes a failed delivery",
              res["status"] == "failed" and "310000" in res["error"]
              and "keywords not in content" in res["error"], str(res))
        res = send("wecom", f"{bot}/http500", None, "标题", ["一"])
        check("http 5xx is a failure",
              res["status"] == "failed" and res["httpStatus"] == 500 and res["error"] == "HTTP 500", str(res))
        res = send("feishu", "http://127.0.0.1:9/hook/secret-token", "SEChidden", "标题", ["一"])
        check("an unreachable robot is a failure that does not leak credentials",
              res["status"] == "failed" and "secret-token" not in (res["error"] or "")
              and "SEChidden" not in (res["error"] or ""), str(res))
        res = send("feishu", f"{bot}/ok", "SECs", "标题", ["一"])
        body = json.loads(seen[-1][1])
        check("feishu send puts timestamp and sign in the body",
              res["status"] == "sent" and str(body.get("timestamp", "")).isdigit() and bool(body.get("sign")))
        check("send posts a JSON body to the webhook",
              seen[0][0] == "/ok?access_token=tok" and json.loads(seen[0][1])["msgtype"] == "markdown")
    server.shutdown()
```

- [ ] **Step 2: 运行离线检查，确认新增部分失败**

运行：`python3 trans-once/tests/notifiers_flow.py`

预期：退出码 1；输出 `27/28 checks passed`，新增部分只有一行 `✗ notifiers.send exists — module has no attribute send`。

- [ ] **Step 3: 给冒烟加上假机器人、夹具和本任务的检查**

在 `trans-once/tests/smoke.py` 里做四处改动。

第一处，用下面的文档字符串替换文件开头那个（第 1 到 16 行）：

```python
"""End-to-end smoke tests against a running TransOnce API.

Usage (backend must be running on :9005):

    cd trans-once && python3 tests/smoke.py
    API_BASE=http://localhost:9005 python3 tests/smoke.py
    SMOKE_ONLY=alerts python3 tests/smoke.py   # only the alert-notification section

The suite is self-provisioning: there is no demo seed data any more, so it
creates (once, idempotently) a dedicated tenant, its member accounts and the
fixtures the checks need, and reuses them on later runs. Beyond that it stays
non-destructive: it only reads data, reveals a masked secret (which writes an
audit log), runs monitor health checks, creates/deletes one throwaway
conversation, and settles one repo access request (idempotent across re-runs).
The alert section talks to an in-process fake group robot. The profile
self-service section renames the dev account and round-trips its email/password,
restoring each value before moving on.
"""
```

第二处，在 `def _start_fake_oidc() -> str:` 这个函数之后加入：

```python
class _FakeBotHandler(BaseHTTPRequestHandler):
    """Group-robot stand-in for DingTalk / WeCom / Feishu. Records every
    request and recomputes the signature with the shared secret, so the checks
    can tell a correctly signed call from an unsigned one."""

    SECRET = "SECsmokesecret"
    requests: list[dict] = []
    lock = threading.Lock()

    def log_message(self, *args) -> None:  # keep smoke output clean
        pass

    def do_POST(self) -> None:  # noqa: N802 - http.server API
        url = urllib.parse.urlsplit(self.path)
        raw = self.rfile.read(int(self.headers.get("content-length", 0))).decode(errors="replace")
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            body = {}
        query = urllib.parse.parse_qs(url.query)
        timestamp = (query.get("timestamp") or [body.get("timestamp", "")])[0]
        sign = (query.get("sign") or [body.get("sign", "")])[0]
        # 算法照各平台文档：钉钉以密钥为 key 对 "timestamp + 换行 + 密钥" 签名，
        # 飞书以 "timestamp + 换行 + 密钥" 为 key 对空串签名。
        if url.path.startswith("/dingtalk"):
            key, text = self.SECRET.encode(), f"{timestamp}\n{self.SECRET}".encode()
        else:
            key, text = f"{timestamp}\n{self.SECRET}".encode(), b""
        expected = base64.b64encode(hmac.new(key, text, hashlib.sha256).digest()).decode()
        with self.lock:
            self.requests.append(
                {"path": url.path, "body": body, "signed": bool(timestamp) and sign == expected}
            )
        if url.path.startswith("/feishu"):
            payload = {"code": 0, "msg": "success", "data": {}}
        elif url.path.startswith("/fail"):
            payload = {"errcode": 310000, "errmsg": "keywords not in content"}
        else:
            payload = {"errcode": 0, "errmsg": "ok"}
        data = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def _start_fake_bot() -> str:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _FakeBotHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{server.server_port}"
```

第三处，在 `def section_alert_notifications(` 之前加入：

```python
def ensure_alert_viewer(tenant_id: str, admin_token: str) -> str:
    """A member whose custom role only has `alerts`: may enter issues, may not
    manage channels. Created once, like the other fixture accounts."""
    token = _ensure_user(ALERT_EMAIL, "冒烟告警", ALERT_PASSWORD)
    _, roles = call("GET", f"/api/tenants/{tenant_id}/roles", token=admin_token)
    role = next((r for r in roles if r["name"] == "冒烟告警查看"), None)
    if role is None:
        _, role = call(
            "POST", f"/api/tenants/{tenant_id}/roles",
            {"name": "冒烟告警查看", "description": "冒烟夹具：只有告警中心权限", "permissions": ["alerts"]},
            token=admin_token,
        )
    _, members = call("GET", f"/api/tenants/{tenant_id}/members", token=admin_token)
    if not any(m.get("email") == ALERT_EMAIL for m in members):
        status, out = call(
            "POST", f"/api/tenants/{tenant_id}/members", {"email": ALERT_EMAIL, "roleId": role["id"]},
            token=admin_token, expect=None,
        )
        if status not in (200, 409):
            raise AssertionError(f"add member {ALERT_EMAIL} -> {status}: {out}")
    return token
```

第四处，在 `section_alert_notifications` 的最后一行检查之后追加：

```python

    # --- 通道夹具与读写接口 ---
    def ensure_channel(name: str, provider: str, path: str, secret: str | None, events: dict) -> dict | None:
        """第一次创建通道；之后每轮把地址指到本轮启动的假机器人上。"""
        _, channels = call("GET", f"{base}/alert-channels", token=admin_token, expect=None)
        found = next((c for c in (channels or []) if isinstance(c, dict) and c.get("name") == name), None)
        body = {"name": name, "provider": provider, "webhook": f"{bot}{path}", "events": events}
        if secret:
            body["secret"] = secret
        if found:
            status, row = call("PATCH", f"{base}/alert-channels/{found['id']}", body, token=admin_token, expect=None)
        else:
            status, row = call("POST", f"{base}/alert-channels", body, token=admin_token, expect=None)
        return row if status == 200 and isinstance(row, dict) else None

    bot = _start_fake_bot()
    _FakeBotHandler.requests.clear()
    ding = ensure_channel("冒烟钉钉通道", "dingtalk", "/dingtalk?access_token=smoke-token", BOT_SECRET,
                          {"monitor": True, "manual": True, "status": False})
    wecom = ensure_channel("冒烟企微通道", "wecom", "/wecom?key=smoke-key", None,
                           {"monitor": True, "manual": True, "status": True})
    feishu = ensure_channel("冒烟飞书通道", "feishu", "/feishu/hook-token-9f3e", BOT_SECRET,
                            {"monitor": True, "manual": True, "status": True})
    failing = ensure_channel("冒烟失败通道", "dingtalk", "/fail", None,
                             {"monitor": False, "manual": False, "status": False})
    check("alert channel fixtures upserted",
          all(isinstance(c, dict) and c.get("id") for c in (ding, wecom, feishu, failing)))

    _, channels = call("GET", f"{base}/alert-channels", token=admin_token, expect=None)
    channels = channels if isinstance(channels, list) else []
    check("channel list never returns plaintext webhook or secret",
          bool(channels) and all("webhook" not in c and "secret" not in c for c in channels))
    check("webhook is masked to host plus last four characters",
          bool(ding) and ding.get("webhookMasked") == f"{bot}/dingtalk?••••••oken",
          str((ding or {}).get("webhookMasked")))
    check("feishu path token is masked",
          bool(feishu) and feishu.get("webhookMasked") == f"{bot}/feishu/••••••9f3e",
          str((feishu or {}).get("webhookMasked")))
    check("signing secret is stored encrypted and returned masked",
          bool(ding) and ding.get("hasSecret") is True
          and str(ding.get("secretMasked") or "").startswith("••••••"),
          str((ding or {}).get("secretMasked")))
    check("wecom channel has no secret", bool(wecom) and wecom.get("hasSecret") is False)

    def post_channel(body: dict) -> int:
        status, _ = call("POST", f"{base}/alert-channels", body, token=admin_token, expect=None)
        return status

    check("unknown provider rejected",
          post_channel({"name": "x", "provider": "slack", "webhook": f"{bot}/dingtalk"}) == 400)
    check("non-http webhook rejected",
          post_channel({"name": "x", "provider": "dingtalk", "webhook": "ftp://robot.example/send"}) == 400)
    check("cloud metadata webhook rejected",
          post_channel({"name": "x", "provider": "dingtalk",
                        "webhook": "http://metadata.google.internal/computeMetadata/v1/"}) == 400)
    check("wecom rejects a signing secret",
          post_channel({"name": "x", "provider": "wecom", "webhook": f"{bot}/wecom", "secret": "s"}) == 400)
    check("missing webhook rejected", post_channel({"name": "x", "provider": "dingtalk"}) == 400)

    alert_token = ensure_alert_viewer(tenant_id, admin_token)
    status, _ = call("GET", f"{base}/alert-channels", token=product_token, expect=None)
    check("member without alerts cannot list channels", status == 403, f"status {status}")
    status, mine = call("GET", f"{base}/alert-channels", token=alert_token, expect=None)
    check("alerts-only member can read channels (masked)",
          status == 200 and isinstance(mine, list) and all("webhook" not in c for c in mine),
          f"status {status}")
    status, _ = call("POST", f"{base}/alert-channels", {"name": "x", "provider": "dingtalk", "webhook": f"{bot}/dingtalk"},
                     token=alert_token, expect=None)
    check("alerts-only member cannot create channels", status == 403, f"status {status}")
    status, _ = call("GET", f"{base}/alert-channels/deliveries", token=alert_token, expect=None)
    check("alerts-only member cannot list all deliveries", status == 403, f"status {status}")
    if ding:
        status, _ = call("POST", f"{base}/alert-channels/{ding['id']}/test", {}, token=alert_token, expect=None)
        check("alerts-only member cannot send test messages", status == 403, f"status {status}")
        status, _ = call("PATCH", f"{base}/alert-channels/{ding['id']}", {"name": "x"}, token=alert_token, expect=None)
        check("alerts-only member cannot update channels", status == 403, f"status {status}")
        status, _ = call("DELETE", f"{base}/alert-channels/{ding['id']}", token=alert_token, expect=None)
        check("alerts-only member cannot delete channels", status == 403, f"status {status}")

    # --- 测试消息与推送记录 ---
    def last_request() -> dict:
        return _FakeBotHandler.requests[-1] if _FakeBotHandler.requests else {}

    if ding and wecom and feishu and failing:
        _FakeBotHandler.requests.clear()
        _, res = call("POST", f"{base}/alert-channels/{ding['id']}/test", {}, token=admin_token, expect=None)
        req = last_request()
        check("test message reaches the dingtalk robot as signed markdown",
              isinstance(res, dict) and res.get("status") == "sent" and res.get("event") == "test"
              and req.get("path") == "/dingtalk" and req.get("signed") is True
              and req.get("body", {}).get("msgtype") == "markdown"
              and req.get("body", {}).get("markdown", {}).get("title") == "【TransOnce 告警】测试消息",
              f"{str(res)[:120]} {str(req)[:160]}")
        _, res = call("POST", f"{base}/alert-channels/{wecom['id']}/test", {}, token=admin_token, expect=None)
        body = last_request().get("body", {})
        content = body.get("markdown", {}).get("content", "")
        check("test message reaches the wecom robot as markdown under 4096 bytes",
              isinstance(res, dict) and res.get("status") == "sent" and body.get("msgtype") == "markdown"
              and 0 < len(content.encode()) <= 4096, str(res)[:120])
        _, res = call("POST", f"{base}/alert-channels/{feishu['id']}/test", {}, token=admin_token, expect=None)
        req = last_request()
        post = req.get("body", {}).get("content", {}).get("post", {}).get("zh_cn", {})
        check("test message reaches the feishu robot as signed rich text",
              isinstance(res, dict) and res.get("status") == "sent" and req.get("signed") is True
              and req.get("body", {}).get("msg_type") == "post"
              and post.get("title") == "【TransOnce 告警】测试消息",
              f"{str(res)[:120]} {str(req)[:160]}")
        _, res = call("POST", f"{base}/alert-channels/{failing['id']}/test", {}, token=admin_token, expect=None)
        check("a platform error is recorded as a failed delivery",
              isinstance(res, dict) and res.get("status") == "failed" and "310000" in str(res.get("error")),
              str(res)[:160])
        _, log = call("GET", f"{base}/alert-channels/deliveries", token=admin_token, expect=None)
        check("delivery log lists the test messages",
              isinstance(log, list) and sum(1 for d in log if d.get("event") == "test") >= 4)

        # --- 修改通道：留空保留，空串清除 ---
        call("PATCH", f"{base}/alert-channels/{ding['id']}", {"name": "冒烟钉钉通道"}, token=admin_token, expect=None)
        _, one = call("GET", f"{base}/alert-channels", token=admin_token, expect=None)
        after = next((c for c in (one or []) if c.get("id") == ding["id"]), {})
        check("omitted webhook and secret are kept",
              after.get("hasSecret") is True and after.get("webhookMasked") == ding.get("webhookMasked"),
              str(after)[:160])
        call("PATCH", f"{base}/alert-channels/{ding['id']}", {"secret": ""}, token=admin_token, expect=None)
        _, one = call("GET", f"{base}/alert-channels", token=admin_token, expect=None)
        after = next((c for c in (one or []) if c.get("id") == ding["id"]), {})
        check("empty secret clears the stored one", after.get("hasSecret") is False)
        call("PATCH", f"{base}/alert-channels/{ding['id']}", {"secret": BOT_SECRET}, token=admin_token, expect=None)
        _, one = call("GET", f"{base}/alert-channels", token=admin_token, expect=None)
        after = next((c for c in (one or []) if c.get("id") == ding["id"]), {})
        check("a new secret replaces the cleared one", after.get("hasSecret") is True)
        status, _ = call("DELETE", f"{base}/alert-channels/{failing['id']}", token=admin_token, expect=None)
        check("channel can be deleted", status == 200, f"status {status}")
        _, log = call("GET", f"{base}/alert-channels/deliveries", token=admin_token, expect=None)
        check("delivery history survives channel deletion",
              isinstance(log, list) and any(d.get("channelName") == "冒烟失败通道" and d.get("channelId") is None
                                            for d in log))
```

- [ ] **Step 4: 运行冒烟，确认新增检查失败**

运行：`SMOKE_ONLY=alerts python3 trans-once/tests/smoke.py`

预期：退出码 1，输出 `13/41 checks passed`。基础检查 11 条和任务 1 的 2 条通过，新增的 28 条全部是 `✗`。不应该出现 Python 异常堆栈。

- [ ] **Step 5: 实现 `send`**

在 `trans-once/notifiers.py` 末尾追加：

```python


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Webhook 必须自己应答，不跟随跳转到别处。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def send(provider: str, webhook: str, secret: str | None, headline: str,
         lines: list[str]) -> dict:
    """向一个机器人发一条消息。永不抛异常。

    返回 {"status": "sent" | "failed", "httpStatus": int | None,
          "error": str | None, "durationMs": int}
    """
    started = time.time()
    result = {"status": "failed", "httpStatus": None, "error": None, "durationMs": 0}
    try:
        url, body = render(provider, webhook, secret, headline, lines)
        request = urllib.request.Request(
            url, data=body, method="POST", headers={"Content-Type": "application/json"},
        )
        with _OPENER.open(request, timeout=SEND_TIMEOUT_SECONDS) as response:
            result["httpStatus"] = response.status
            payload = json.loads(response.read().decode(errors="replace") or "{}")
        # 飞书看 code，钉钉和企业微信看 errcode。
        code = payload.get("code", 0) if provider == "feishu" else payload.get("errcode", 0)
        if response.status == 200 and code == 0:
            result["status"] = "sent"
        else:
            reason = payload.get("msg") or payload.get("errmsg") or ""
            result["error"] = sanitize_error(f"{code} {reason}".strip(), webhook, secret)
    except urllib.error.HTTPError as exc:
        result["httpStatus"] = exc.code
        result["error"] = f"HTTP {exc.code}"
    except Exception as exc:  # 超时、连不上、响应不是 JSON
        result["error"] = sanitize_error(f"{type(exc).__name__}: {exc}", webhook, secret)
    result["durationMs"] = int((time.time() - started) * 1000)
    return result
```

- [ ] **Step 6: 写推送编排**

创建 `trans-once/alert_notify.py`：

```python
"""Deliver one alert event to the tenant's alert channels.

`notifiers.py` only knows how to talk to a single robot. This module decides
which robots to talk to (enabled and subscribed to the event), talks to them in
parallel and records every attempt in `alert_deliveries`. Both the routes and
`orchestration.check_monitor` call it, so it lives outside `routers/`.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import db
import notifiers
from security import decrypt_secret

log = logging.getLogger("transonce")
MAX_WORKERS = 8


def to_user_ids(value) -> list[str]:
    """把 `alerts.notified_user_ids` 统一成字符串列表。

    这一列是 UUID[]，psycopg2 默认把它取成数组字面量字符串（例如 '{a,b}'，空数组是 '{}'），
    直接迭代会得到一个个字符。
    """
    if not value:
        return []
    if isinstance(value, str):
        return [part for part in value.strip("{}").split(",") if part]
    return [str(v) for v in value]


def notified_names(value) -> dict[str, str]:
    """users.id → 姓名，一次查询。`value` 是 `notified_user_ids` 列的值。"""
    ids = to_user_ids(value)
    if not ids:
        return {}
    rows = db.fetch_all("SELECT id, name FROM users WHERE id = ANY(%s::uuid[])", (ids,))
    return {str(r["id"]): r["name"] for r in rows}


def _describe(alert_id: str) -> dict:
    """消息里要写的全部内容，按告警 id 一次关联查询取齐。"""
    row = db.fetch_one(
        """SELECT al.*, m.name AS monitor_name, e.name AS environment_name,
                  cb.name AS created_by_name, t.name AS tenant_name
           FROM alerts al
           LEFT JOIN monitors m ON m.id=al.monitor_id
           LEFT JOIN environments e ON e.id=al.environment_id
           LEFT JOIN users cb ON cb.id=al.created_by
           JOIN tenants t ON t.id=al.tenant_id
           WHERE al.id=%s""",
        (alert_id,),
    )
    ids = to_user_ids(row.get("notified_user_ids"))
    names = notified_names(ids)
    if row.get("source") == "manual":
        origin = f"{row.get('created_by_name') or '成员'} 录入"
    else:
        name = row.get("monitor_name")
        origin = f"监控「{name}」检查失败" if name else "监控检查失败"
    return {
        "tenant": row["tenant_name"],
        "title": row["title"],
        "severity": row.get("severity"),
        "origin": origin,
        "environment": row.get("environment_name"),
        "notified": [names[i] for i in ids if i in names],
        "created_at": row.get("created_at"),
        "detail": row.get("detail"),
        "status": row.get("status"),
    }


def notify(tenant_id: str, event: str, alert: dict, actor_id: str | None = None,
           channel_ids: list[str] | None = None) -> list[dict]:
    """把 `event` 推给符合条件的通道，并写推送记录。永不抛异常：群机器人出问题不能让产生告警的请求失败。

    返回新建的 `alert_deliveries` 行。`channel_ids` 只能缩小范围。
    """
    try:
        channels = db.fetch_all(
            "SELECT * FROM alert_channels WHERE tenant_id=%s AND enabled ORDER BY created_at", (tenant_id,),
        )
        wanted = {str(c) for c in channel_ids or []}
        targets = [
            c for c in channels
            if (c.get("events") or {}).get(event) and (not wanted or str(c["id"]) in wanted)
        ]
        if not targets:
            return []
        headline, lines = notifiers.compose(event, **_describe(str(alert["id"])))

        def deliver(index: int) -> dict:
            channel = targets[index]
            try:
                return notifiers.send(
                    channel["provider"], decrypt_secret(channel["webhook_enc"]) or "",
                    decrypt_secret(channel["secret_enc"]), headline, lines,
                )
            except Exception as exc:  # 解密失败等：记为失败，不影响其它通道
                return {"status": "failed", "httpStatus": None,
                        "error": notifiers.sanitize_error(f"{type(exc).__name__}: {exc}"), "durationMs": 0}

        with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(targets))) as pool:
            results = list(pool.map(deliver, range(len(targets))))

        rows = []
        for channel, result in zip(targets, results):
            rows.append(db.execute_returning(
                """INSERT INTO alert_deliveries
                   (tenant_id, alert_id, channel_id, channel_name, provider, event, status,
                    http_status, error, duration_ms, created_by)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
                (
                    tenant_id, alert["id"], channel["id"], channel["name"], channel["provider"], event,
                    result["status"], result["httpStatus"], result["error"], result["durationMs"], actor_id,
                ),
            ))
        return rows
    except Exception:
        log.exception("alert notification failed: tenant=%s event=%s alert=%s",
                      tenant_id, event, alert.get("id"))
        return []


def send_test(tenant_id: str, channel: dict, actor_id: str | None) -> dict:
    """用这个通道发一条固定的测试消息并记入推送记录。通道停用时也可以发。"""
    tenant = db.fetch_one("SELECT name FROM tenants WHERE id=%s", (tenant_id,))
    headline, lines = notifiers.compose(
        "monitor", tenant=tenant["name"], title="测试消息", origin=f"告警通道「{channel['name']}」",
        created_at=datetime.now(timezone.utc),
    )
    lines.append("收到这条消息说明配置正确。")
    result = notifiers.send(
        channel["provider"], decrypt_secret(channel["webhook_enc"]) or "",
        decrypt_secret(channel["secret_enc"]), headline, lines,
    )
    return db.execute_returning(
        """INSERT INTO alert_deliveries
           (tenant_id, alert_id, channel_id, channel_name, provider, event, status,
            http_status, error, duration_ms, created_by)
           VALUES (%s, NULL, %s, %s, %s, 'test', %s, %s, %s, %s, %s) RETURNING *""",
        (
            tenant_id, channel["id"], channel["name"], channel["provider"], result["status"],
            result["httpStatus"], result["error"], result["durationMs"], actor_id,
        ),
    )
```

- [ ] **Step 7: 加序列化函数**

在 `trans-once/serializers.py` 顶部的 `from config import EXECUTION_MODE` 之前加入 `import notifiers`，并在文件末尾追加：

```python


def alert_channel(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r["tenant_id"]),
        "name": r["name"],
        "provider": r["provider"],
        "enabled": bool(r["enabled"]),
        "events": r.get("events") or {},
        "webhookMasked": notifiers.mask_webhook(decrypt_secret(r.get("webhook_enc"))),
        "hasSecret": bool(r.get("secret_enc")),
        "secretMasked": mask_secret(decrypt_secret(r.get("secret_enc"))),
        "createdAt": _iso(r.get("created_at")),
        "updatedAt": _iso(r.get("updated_at")),
    }


def alert_delivery(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "alertId": _s(r.get("alert_id")),
        "channelId": _s(r.get("channel_id")),
        "channelName": r["channel_name"],
        "provider": r["provider"],
        "event": r["event"],
        "status": r["status"],
        "httpStatus": r.get("http_status"),
        "error": r.get("error"),
        "durationMs": r.get("duration_ms"),
        "createdAt": _iso(r.get("created_at")),
    }
```

- [ ] **Step 8: 加通道接口**

在 `trans-once/routers/devops.py` 顶部的导入区，把 `import db` 到 `from security import ...` 这几行改成：

```python
import alert_notify
import db
import net_guard
import notifiers
import orchestration
import serializers
import urllib.parse
import uuid
from deps import get_current_user, load_tenant_context, log_activity
from security import decrypt_secret, encrypt_secret
```

在 `# --- alerts ---` 这行注释之前插入：

```python
# --- alert channels ------------------------------------------------------

def _channel_or_404(tenant_id: str, channel_id: str) -> dict:
    row = db.fetch_one(
        "SELECT * FROM alert_channels WHERE id=%s AND tenant_id=%s", (channel_id, tenant_id)
    )
    if not row:
        raise HTTPException(404, "告警通道不存在")
    return row


def _uuid_list(values, label: str) -> list[str]:
    """校验每一项都是合法的 UUID 字符串，去重并保持传入顺序。"""
    out: list[str] = []
    for value in values or []:
        try:
            out.append(str(uuid.UUID(str(value))))
        except (ValueError, AttributeError, TypeError):
            raise HTTPException(400, f"{label}里有无效的 ID") from None
    return list(dict.fromkeys(out))


def _channel_fields(body: dict, current: dict | None) -> dict:
    """校验新建 / 修改通道的请求体，返回要写入的列。`current` 为 None 表示新建。"""
    base = current or {}
    name = (body.get("name") or base.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "请输入通道名称")
    if len(name) > 50:
        raise HTTPException(400, "通道名称不超过 50 个字")
    provider = body.get("provider") or base.get("provider")
    if provider not in notifiers.PROVIDERS:
        raise HTTPException(400, "不支持的平台，仅支持钉钉、企业微信、飞书")
    fields: dict = {"name": name, "provider": provider}
    webhook = (body.get("webhook") or "").strip()
    if webhook:
        # 内网地址放行（企业微信、飞书有私有化网关）：把地址自己的主机名放进白名单。
        host = (urllib.parse.urlsplit(webhook).hostname or "").strip("[]").lower()
        try:
            fields["webhook_enc"] = encrypt_secret(net_guard.validate_url(webhook, {host}))
        except net_guard.UnsafeTarget as e:
            raise HTTPException(400, f"Webhook 地址不被允许：{e}") from e
    elif current is None:
        raise HTTPException(400, "请输入 Webhook 地址")
    # 密钥三态：不传保留，空串清除，非空替换。
    if body.get("secret") is not None:
        secret = str(body["secret"]).strip()
        if secret and provider == "wecom":
            raise HTTPException(400, "企业微信群机器人不支持签名，无需填写密钥")
        fields["secret_enc"] = encrypt_secret(secret)
    if "enabled" in body:
        fields["enabled"] = bool(body.get("enabled"))
    if "events" in body:
        events = body.get("events")
        if not isinstance(events, dict) or set(events) - set(notifiers.EVENTS):
            raise HTTPException(400, "events 只能包含 monitor、manual、status")
        fields["events"] = {
            **notifiers.DEFAULT_EVENTS, **(base.get("events") or {}),
            **{key: bool(value) for key, value in events.items()},
        }
    return fields


@router.get("/alert-channels")
def list_alert_channels(tenant_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id)
    # 只读接口：有告警中心权限即可（录入问题的弹窗要知道有没有可用通道）。
    if not (ctx.has("alerts") or ctx.has("alert.channel.manage")):
        raise HTTPException(403, "缺少权限: alerts")
    rows = db.fetch_all(
        "SELECT * FROM alert_channels WHERE tenant_id=%s ORDER BY created_at", (tenant_id,)
    )
    return [serializers.alert_channel(r) for r in rows]


@router.post("/alert-channels")
def create_alert_channel(tenant_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "alert.channel.manage")
    fields = _channel_fields(body, None)
    row = db.execute_returning(
        """INSERT INTO alert_channels
           (tenant_id, name, provider, webhook_enc, secret_enc, enabled, events, created_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (
            tenant_id, fields["name"], fields["provider"], fields["webhook_enc"],
            fields.get("secret_enc"), fields.get("enabled", True),
            Json(fields.get("events") or notifiers.DEFAULT_EVENTS), user["id"],
        ),
    )
    log_activity(ctx, "alert.channel.created",
                 {"channelId": row["id"], "name": row["name"], "provider": row["provider"]})
    return serializers.alert_channel(row)


@router.patch("/alert-channels/{channel_id}")
def update_alert_channel(tenant_id: str, channel_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "alert.channel.manage")
    channel = _channel_or_404(tenant_id, channel_id)
    fields = _channel_fields(body, channel)
    labels = {"name": "name", "provider": "provider", "webhook_enc": "webhook", "secret_enc": "secret",
              "enabled": "enabled", "events": "events"}
    changed = [
        labels[column] for column in fields
        if fields[column] != (channel.get("events") or {} if column == "events" else channel.get(column))
    ]
    assignments = ", ".join(f"{column}=%s" for column in fields) + ", updated_at=now()"
    values = [Json(fields[column]) if column == "events" else fields[column] for column in fields]
    row = db.execute_returning(
        f"UPDATE alert_channels SET {assignments} WHERE id=%s RETURNING *", (*values, channel_id)
    )
    log_activity(ctx, "alert.channel.updated",
                 {"channelId": channel_id, "name": row["name"], "fields": changed})
    return serializers.alert_channel(row)


@router.delete("/alert-channels/{channel_id}")
def delete_alert_channel(tenant_id: str, channel_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "alert.channel.manage")
    channel = _channel_or_404(tenant_id, channel_id)
    db.execute("DELETE FROM alert_channels WHERE id=%s", (channel_id,))
    log_activity(ctx, "alert.channel.deleted", {"name": channel["name"], "provider": channel["provider"]})
    return {"ok": True}


@router.post("/alert-channels/{channel_id}/test")
def test_alert_channel(tenant_id: str, channel_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "alert.channel.manage")
    channel = _channel_or_404(tenant_id, channel_id)
    row = alert_notify.send_test(tenant_id, channel, user["id"])
    log_activity(ctx, "alert.channel.tested",
                 {"channelId": channel_id, "name": channel["name"], "status": row["status"]})
    return serializers.alert_delivery(row)


@router.get("/alert-channels/deliveries")
def list_alert_deliveries(
    tenant_id: str,
    channelId: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=200),
    user: dict = Depends(get_current_user),
):
    load_tenant_context(user, tenant_id, "alert.channel.manage")
    sql = "SELECT * FROM alert_deliveries WHERE tenant_id=%s"
    args: list = [tenant_id]
    if channelId:
        sql += " AND channel_id=%s"
        args.append(channelId)
    sql += " ORDER BY created_at DESC LIMIT %s"
    args.append(limit)
    return [serializers.alert_delivery(r) for r in db.fetch_all(sql, tuple(args))]


```

注意最后保留两个空行，和文件里其它分段保持一致。

- [ ] **Step 9: 重启后端，确认检查通过**

```bash
python3 trans-once/tests/notifiers_flow.py
bash /tmp/transonce-plan/restart-backend.sh
SMOKE_ONLY=alerts python3 trans-once/tests/smoke.py
```

预期：离线检查 `33/33 checks passed`；后端健康检查通过；冒烟输出 `41/41 checks passed`。

- [ ] **Step 10: 提交**

```bash
git add trans-once/notifiers.py trans-once/alert_notify.py trans-once/serializers.py trans-once/routers/devops.py trans-once/tests/notifiers_flow.py trans-once/tests/smoke.py
git commit -m "feat: 告警通道接口与同步推送——通道增删改查、测试消息、推送记录"
```


### Task 4: 手工录入问题、重发与状态变化推送

**Files:**
- Modify: `trans-once/tests/smoke.py`（在 `section_alert_notifications` 末尾追加检查）
- Modify: `trans-once/serializers.py`（`alert` 增加来源、环境、录入人）
- Modify: `trans-once/routers/devops.py`（重写 `# --- alerts ---` 一节）

**Interfaces:**
- Consumes: 任务 3 的 `alert_notify.notify(tenant_id, event, alert, actor_id, channel_ids)`、`alert_notify.to_user_ids`、`serializers.alert_delivery`，devops.py 里已有的 `_env_or_404`、`_monitor_or_404`、`_uuid_list`，以及 smoke.py 这一节里已有的 `base`、`admin_token`、`product_token`、`alert_token`、`_FakeBotHandler`。
- Produces:
  - `GET /alerts` 的每条告警新增 `source`（`monitor` / `manual`）、`environmentId`、`environmentName`、`createdById`、`createdByName`、`notifiedUsers`（`[{id, name}]`）、`deliveries`（这条告警的推送记录，时间倒序，最多 10 条）。
  - `POST /alerts`：请求体 `{title, severity?, detail?, environmentId?, monitorId?, notifiedUserIds?: string[], push?: boolean}`，返回带 `deliveries` 的告警。
  - `POST /alerts/{id}/resend`：请求体 `{channelIds?: string[]}`，返回 `{"deliveries": [...]}`。
  - `PATCH /alerts/{id}`：返回告警本身，外加 `deliveries`（推送历史）和 `pushed`（本次请求新产生的推送，状态没变时是 `[]`）。
  - 审计事件 `alert.created`（`alertId`、`severity`、`notifiedUserIds`、`pushed` 即本次推送的通道数）和 `alert.resent`（`alertId`、`count`）。
  - devops.py 里的 `_alert_select_row(tenant_id, alert_id) -> dict` 和 `_alert_item(tenant_id, alert_id) -> dict`。
  - smoke.py 这一节里新增 `notified`、`test_env`、`paths_since()`、`alerts_listed()`。任务 5、6 的检查会用到 `test_env` 和 `paths_since()`。

- [ ] **Step 1: 写会失败的检查**

在 `trans-once/tests/smoke.py` 的 `section_alert_notifications` 末尾（`check("delivery history survives channel deletion", ...)` 那条检查之后）追加：

```python

    # --- 手工录入问题 ---
    _, members = call("GET", f"{base}/members", token=admin_token)
    notified = {m["userId"]: m["name"] for m in members if m.get("email") in (PRODUCT_EMAIL, DEV_EMAIL)}
    _, envs = call("GET", f"{base}/environments", token=admin_token)
    test_env = next((e for e in envs if e["name"] == "冒烟测试环境"), envs[0])
    ding_id, wecom_id, feishu_id = ((c or {}).get("id") for c in (ding, wecom, feishu))

    def paths_since() -> list[str]:
        """自上次清空以来假机器人收到的请求，按平台名（地址的第一段）排序。通道是并行发送的。"""
        return sorted(r["path"].split("/")[1] for r in _FakeBotHandler.requests)

    def mentions(names: list[str]) -> bool:
        """自上次清空以来的请求里，是否有一条消息同时写了这些姓名。"""
        return any(
            all(name in json.dumps(r["body"], ensure_ascii=False) for name in names)
            for r in _FakeBotHandler.requests
        )

    def alerts_listed() -> list[dict]:
        _, out = call("GET", f"{base}/alerts?limit=500", token=admin_token, expect=None)
        return out if isinstance(out, list) else []

    def post_issue(body: dict, token: str | None = None) -> int:
        status, _ = call("POST", f"{base}/alerts", body, token=token or admin_token, expect=None)
        return status

    issue_body = {
        "title": ISSUE_TITLE, "severity": "warning", "detail": "冒烟：支付回调偶发超时，需要排查。",
        "notifiedUserIds": list(notified), "environmentId": test_env["id"],
    }
    check("manual issue rejects a user who is not an active member",
          post_issue({**issue_body, "notifiedUserIds": [str(uuid.uuid4())]}) == 400)
    check("manual issue rejects a blank title", post_issue({**issue_body, "title": "   "}) == 400)
    check("manual issue rejects an unknown severity",
          post_issue({**issue_body, "severity": "blocker"}) == 400)
    check("manual issue rejects an environment of another tenant",
          post_issue({**issue_body, "environmentId": str(uuid.uuid4())}) == 404)
    check("member without alerts cannot enter issues", post_issue(issue_body, product_token) == 403)
    check("alerts-only member may enter issues (stopped by validation, not permission)",
          post_issue({**issue_body, "title": ""}, alert_token) == 400)

    # 夹具只建一次。之后每轮按标题找到它，先重新打开，再继续下面的检查。
    issue = next((a for a in alerts_listed() if a.get("title") == ISSUE_TITLE and a.get("source") == "manual"), None)
    first_time = issue is None
    if first_time:
        _FakeBotHandler.requests.clear()
        _, issue = call("POST", f"{base}/alerts", issue_body, token=admin_token, expect=None)
        check("entering an issue pushes it once to every channel subscribed to manual issues",
              paths_since() == ["dingtalk", "feishu", "wecom"], str(paths_since()))
        check("the pushed message names the people to notify", mentions(list(notified.values())))
    issue_id = issue.get("id") if isinstance(issue, dict) else None
    if issue_id and not first_time:
        call("PATCH", f"{base}/alerts/{issue_id}", {"status": "open"}, token=admin_token, expect=None)

    row = next((a for a in alerts_listed() if a.get("id") == issue_id), {})
    check("manual issue appears in the list as an open issue with source manual",
          bool(row) and row.get("source") == "manual" and row.get("status") == "open", str(row)[:160])
    check("manual issue records who entered it and who is notified",
          bool(row) and row.get("createdByName") == admin["user"]["name"]
          and {u.get("id"): u.get("name") for u in row.get("notifiedUsers") or []} == notified,
          str(row)[:200])
    check("manual issue carries its environment and no monitor",
          bool(row) and row.get("environmentId") == test_env["id"]
          and row.get("environmentName") == test_env["name"] and not row.get("monitorId"),
          str(row)[:160])
    history = row.get("deliveries") or []
    check("alert list carries the alert's delivery history",
          bool(history) and all(d.get("alertId") == issue_id for d in history), str(history)[:160])

    def resend(body: dict | None = None, token: str | None = None):
        return call("POST", f"{base}/alerts/{issue_id}/resend", body if body is not None else {},
                    token=token or admin_token, expect=None)

    _FakeBotHandler.requests.clear()
    _, res = resend()
    rows = res.get("deliveries") if isinstance(res, dict) else None
    check("resend pushes again to every channel subscribed to manual issues",
          paths_since() == ["dingtalk", "feishu", "wecom"]
          and isinstance(rows, list) and len(rows) == 3
          and all(d.get("event") == "manual" and d.get("status") == "sent" for d in rows),
          f"{paths_since()} {str(res)[:160]}")
    check("the resent message names the people to notify", mentions(list(notified.values())))
    row = next((a for a in alerts_listed() if a.get("id") == issue_id), {})
    check("resends are recorded in the alert's history",
          sum(d.get("event") == "manual" for d in row.get("deliveries") or []) >= 3,
          str(row.get("deliveries"))[:160])

    call("PATCH", f"{base}/alert-channels/{wecom_id}", {"enabled": False}, token=admin_token, expect=None)
    _FakeBotHandler.requests.clear()
    resend({"channelIds": [wecom_id, feishu_id]})
    check("resend keeps only the channels that are enabled and subscribed",
          paths_since() == ["feishu"], str(paths_since()))
    call("PATCH", f"{base}/alert-channels/{wecom_id}", {"enabled": True}, token=admin_token, expect=None)
    status, _ = resend({"channelIds": [str(uuid.uuid4())]})
    check("resend rejects a channel that belongs to another tenant", status == 400, f"status {status}")
    status, _ = resend(token=product_token)
    check("member without alerts cannot resend", status == 403, f"status {status}")

    def set_status(next_status: str) -> dict:
        _, out = call("PATCH", f"{base}/alerts/{issue_id}", {"status": next_status},
                      token=admin_token, expect=None)
        return out if isinstance(out, dict) else {}

    _FakeBotHandler.requests.clear()
    out = set_status("resolved")
    pushed = out.get("pushed") or []
    check("resolving pushes the status change to the channels subscribed to it",
          paths_since() == ["feishu", "wecom"] and len(pushed) == 2
          and all(d.get("event") == "status" and d.get("status") == "sent" for d in pushed),
          f"{paths_since()} {str(out)[:160]}")
    check("status response returns the alert with its delivery history",
          out.get("status") == "resolved" and isinstance(out.get("deliveries"), list)
          and len(out["deliveries"]) >= len(pushed), str(out)[:160])
    out = set_status("resolved")
    check("an unchanged status pushes nothing", out.get("pushed") == [], str(out.get("pushed")))
    _FakeBotHandler.requests.clear()
    out = set_status("open")
    check("reopening pushes the status change",
          paths_since() == ["feishu", "wecom"] and len(out.get("pushed") or []) == 2, str(out)[:160])
    set_status("resolved")  # 每轮结束留在「已解决」，不影响未处理告警数
```

- [ ] **Step 2: 运行，确认新增检查失败**

运行：`SMOKE_ONLY=alerts python3 trans-once/tests/smoke.py`

预期：退出码 1，输出 `41/63 checks passed`。原有 41 条通过，新增的 22 条全部是 `✗`，不应该出现 Python 异常堆栈。

- [ ] **Step 3: 扩展 `serializers.alert`**

在 `trans-once/serializers.py` 里，把 `def alert(r: dict) -> dict:` 这个函数整段替换成：

```python
def alert(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r.get("tenant_id")),
        "source": r.get("source") or "monitor",
        "monitorId": _s(r.get("monitor_id")),
        "monitorName": r.get("monitor_name"),
        "environmentId": _s(r.get("environment_id")),
        "environmentName": r.get("environment_name"),
        "deploymentId": _s(r.get("deployment_id")),
        "createdById": _s(r.get("created_by")),
        "createdByName": r.get("created_by_name"),
        "severity": r.get("severity"),
        "title": r["title"],
        "detail": r.get("detail"),
        "status": r.get("status"),
        "createdAt": _iso(r.get("created_at")),
        "acknowledgedAt": _iso(r.get("acknowledged_at")),
        "resolvedAt": _iso(r.get("resolved_at")),
    }
```

- [ ] **Step 4: 重写告警接口**

在 `trans-once/routers/devops.py` 里，把 `# --- alerts ---` 这行注释起直到文件末尾的全部内容替换成：

```python
# --- alerts --------------------------------------------------------------

# 列表和单条查询共用：带上监控名、环境名和录入人姓名。
_ALERT_SELECT = """SELECT al.*, m.name AS monitor_name, e.name AS environment_name,
                          cb.name AS created_by_name
                   FROM alerts al
                   LEFT JOIN monitors m ON m.id=al.monitor_id
                   LEFT JOIN environments e ON e.id=al.environment_id
                   LEFT JOIN users cb ON cb.id=al.created_by"""
_DELIVERIES_PER_ALERT = 10


def _alert_select_row(tenant_id: str, alert_id: str) -> dict:
    try:
        key = str(uuid.UUID(str(alert_id)))
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(404, "告警不存在") from None
    row = db.fetch_one(_ALERT_SELECT + " WHERE al.tenant_id=%s AND al.id=%s", (tenant_id, key))
    if not row:
        raise HTTPException(404, "告警不存在")
    return row


def _alert_page(tenant_id: str, rows: list[dict]) -> list[dict]:
    """把告警行变成接口返回：补上被通知人姓名和推送记录，各用一次批量查询，不逐条查。"""
    if not rows:
        return []
    # 被通知人这一列是 UUID[]，psycopg2 取出来是数组字面量字符串，先用 to_user_ids 统一成列表。
    ids_by_alert = {str(r["id"]): alert_notify.to_user_ids(r.get("notified_user_ids")) for r in rows}
    names = alert_notify.notified_names([u for ids in ids_by_alert.values() for u in ids])
    history: dict[str, list[dict]] = {}
    for delivery in db.fetch_all(
        "SELECT * FROM alert_deliveries WHERE tenant_id=%s AND alert_id = ANY(%s::uuid[]) ORDER BY created_at DESC",
        (tenant_id, [str(r["id"]) for r in rows]),
    ):
        bucket = history.setdefault(str(delivery["alert_id"]), [])
        if len(bucket) < _DELIVERIES_PER_ALERT:
            bucket.append(delivery)
    items = []
    for r in rows:
        item = serializers.alert(r)
        item["notifiedUsers"] = [
            {"id": u, "name": names[u]} for u in ids_by_alert[str(r["id"])] if u in names
        ]
        item["deliveries"] = [serializers.alert_delivery(d) for d in history.get(str(r["id"]), [])]
        items.append(item)
    return items


def _alert_item(tenant_id: str, alert_id: str) -> dict:
    return _alert_page(tenant_id, [_alert_select_row(tenant_id, alert_id)])[0]


def _active_member_ids(tenant_id: str, user_ids) -> list[str]:
    """通知人员：每一项都必须是本租户状态为 active 的成员。"""
    ids = _uuid_list(user_ids, "通知人员")
    if not ids:
        return []
    rows = db.fetch_all(
        "SELECT user_id FROM tenant_members WHERE tenant_id=%s AND status='active' AND user_id = ANY(%s::uuid[])",
        (tenant_id, ids),
    )
    if {str(r["user_id"]) for r in rows} != set(ids):
        raise HTTPException(400, "通知人员里有人不是本租户的在用成员")
    return ids


@router.get("/alerts")
def list_alerts(
    tenant_id: str,
    status: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(get_current_user),
):
    load_tenant_context(user, tenant_id, "alerts")
    sql = _ALERT_SELECT + " WHERE al.tenant_id=%s"
    args: list = [tenant_id]
    if status:
        sql += " AND al.status=%s"
        args.append(status)
    sql += " ORDER BY al.created_at DESC LIMIT %s OFFSET %s"
    args += [limit, offset]
    return _alert_page(tenant_id, db.fetch_all(sql, tuple(args)))


@router.post("/alerts")
def create_alert(tenant_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "alerts")
    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(400, "请输入问题标题")
    if len(title) > 200:
        raise HTTPException(400, "标题不超过 200 个字")
    severity = body.get("severity") or "warning"
    if severity not in notifiers.SEVERITIES:
        raise HTTPException(400, "级别仅支持 info、warning、critical")
    detail = (body.get("detail") or "").strip()
    if len(detail) > 4000:
        raise HTTPException(400, "详细说明不超过 4000 个字")
    environment_id = None
    if body.get("environmentId"):
        environment_id = _env_or_404(tenant_id, body["environmentId"])["id"]
    monitor_id = None
    if body.get("monitorId"):
        monitor = _monitor_or_404(tenant_id, body["monitorId"])
        monitor_id = monitor["id"]
        environment_id = environment_id or monitor.get("environment_id")
    notified = _active_member_ids(tenant_id, body.get("notifiedUserIds"))
    row = db.execute_returning(
        """INSERT INTO alerts
           (tenant_id, monitor_id, environment_id, severity, title, detail,
            source, created_by, notified_user_ids)
           VALUES (%s, %s, %s, %s, %s, %s, 'manual', %s, %s::uuid[]) RETURNING *""",
        (tenant_id, monitor_id, environment_id, severity, title, detail or None, user["id"], notified),
    )
    pushed = []
    if body.get("push") is not False:
        pushed = alert_notify.notify(tenant_id, "manual", row, actor_id=user["id"])
    log_activity(ctx, "alert.created", {
        "alertId": row["id"], "severity": severity, "notifiedUserIds": notified, "pushed": len(pushed),
    })
    return _alert_item(tenant_id, row["id"])


@router.post("/alerts/{alert_id}/resend")
def resend_alert(
    tenant_id: str, alert_id: str, body: dict = Body(default={}), user: dict = Depends(get_current_user),
):
    ctx = load_tenant_context(user, tenant_id, "alerts")
    alert = _alert_select_row(tenant_id, alert_id)
    wanted = None
    if body.get("channelIds"):
        # channelIds 只能缩小范围：必须都是本租户的通道。
        wanted = _uuid_list(body["channelIds"], "通道")
        owned = db.fetch_all(
            "SELECT id FROM alert_channels WHERE tenant_id=%s AND id = ANY(%s::uuid[])", (tenant_id, wanted)
        )
        if {str(c["id"]) for c in owned} != set(wanted):
            raise HTTPException(400, "只能重发到本租户的告警通道")
    deliveries = alert_notify.notify(
        tenant_id, "manual" if alert.get("source") == "manual" else "monitor", alert,
        actor_id=user["id"], channel_ids=wanted,
    )
    log_activity(ctx, "alert.resent", {"alertId": alert["id"], "count": len(deliveries)})
    return {"deliveries": [serializers.alert_delivery(d) for d in deliveries]}


@router.patch("/alerts/{alert_id}")
def update_alert(tenant_id: str, alert_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "alerts")
    alert = _alert_select_row(tenant_id, alert_id)
    status = body.get("status")
    if status not in ("open", "acknowledged", "resolved"):
        raise HTTPException(400, "无效的告警状态")
    ack_by = user["id"] if status == "acknowledged" else alert.get("acknowledged_by")
    ack_at = datetime.now(timezone.utc) if status == "acknowledged" else alert.get("acknowledged_at")
    row = db.execute_returning(
        """UPDATE alerts SET status=%s, acknowledged_by=%s, acknowledged_at=%s,
           resolved_at=CASE WHEN %s='resolved' THEN now() ELSE NULL END
           WHERE id=%s RETURNING *""",
        (status, ack_by, ack_at, status, alert["id"]),
    )
    log_activity(ctx, "alert.updated", {"alertId": alert["id"], "status": status})
    pushed = []
    if status != alert.get("status"):
        pushed = alert_notify.notify(tenant_id, "status", row, actor_id=user["id"])
    return {**_alert_item(tenant_id, alert["id"]), "pushed": [serializers.alert_delivery(d) for d in pushed]}
```

- [ ] **Step 5: 重启后端，确认检查通过**

```bash
bash /tmp/transonce-plan/restart-backend.sh
SMOKE_ONLY=alerts python3 trans-once/tests/smoke.py
SMOKE_ONLY=alerts python3 trans-once/tests/smoke.py
```

预期：后端健康检查通过；第一遍冒烟输出 `63/63 checks passed`，第二遍输出 `61/61 checks passed`，结尾都是 `All smoke checks passed ✓`。

说明：`entering an issue pushes…` 和 `the pushed message names…` 两条只在夹具第一次建立的那一轮执行（上一步还没有录入接口，建不了夹具），所以第二遍少 2 条。

- [ ] **Step 6: 提交**

```bash
git add trans-once/routers/devops.py trans-once/serializers.py trans-once/tests/smoke.py
git commit -m "feat: 告警中心支持手工录入问题——选人通知、重发、状态变化推送，列表带推送记录"
```


### Task 5: 监控告警联动

**Files:**
- Modify: `trans-once/tests/smoke.py`（在 `section_alert_notifications` 末尾追加检查）
- Modify: `trans-once/orchestration.py`（`check_monitor` 推送新告警和自动解决；文件顶部的导入）

**Interfaces:**
- Consumes: 任务 3 的 `alert_notify.notify`；任务 4 的 `paths_since()`、`test_env`、常量 `PROBE_NAME`。
- Produces: `check_monitor(ctx, monitor) -> dict`（签名不变）。监控检查失败且新写入告警时推送 `monitor` 事件；监控恢复、自动解决告警时，每条被解决的告警推送一次 `status` 事件。新告警带上监控关联的 `environment_id`。冒烟夹具「冒烟失败探针」（一个监控，指向本机关闭端口）。

- [ ] **Step 1: 写会失败的检查**

在 `trans-once/tests/smoke.py` 的 `section_alert_notifications` 末尾（任务 4 追加的那段之后，`set_status("resolved")  # 每轮结束…` 这行之后）追加：

```python

    # --- 监控告警联动 ---
    _, monitors = call("GET", f"{base}/monitors", token=admin_token)
    probe = next((m for m in monitors if m["name"] == PROBE_NAME), None)
    if probe is None:
        _, probe = call(
            "POST", f"{base}/monitors",
            {"name": PROBE_NAME, "url": "http://127.0.0.1:9/health", "environmentId": test_env["id"]},
            token=admin_token, expect=None,
        )
    probe_id = probe.get("id") if isinstance(probe, dict) else None
    # 上一轮中途失败会留下未处理的探针告警，或指向失效地址的探针：先让它恢复，把它们自动解决。
    call("PATCH", f"{base}/monitors/{probe_id}", {"url": f"{API}/api/health"}, token=admin_token, expect=None)
    call("POST", f"{base}/monitors/{probe_id}/check", {}, token=admin_token, expect=None)
    call("PATCH", f"{base}/monitors/{probe_id}", {"url": "http://127.0.0.1:9/health"}, token=admin_token, expect=None)

    _FakeBotHandler.requests.clear()
    _, checked = call("POST", f"{base}/monitors/{probe_id}/check", {}, token=admin_token, expect=None)
    check("probe monitor reports down",
          isinstance(checked, dict) and checked.get("status") == "down", str(checked)[:120])
    open_probe = [a for a in alerts_listed() if a.get("monitorId") == probe_id and a.get("status") == "open"]
    check("a failed check creates exactly one new alert", len(open_probe) == 1, str(len(open_probe)))
    alert = open_probe[0] if open_probe else {}
    check("monitor alert reports source monitor and the monitor's environment",
          alert.get("source") == "monitor" and alert.get("monitorName") == PROBE_NAME
          and alert.get("environmentId") == test_env["id"]
          and alert.get("environmentName") == test_env["name"]
          and alert.get("createdByName") is None, str(alert)[:200])
    check("a new monitor alert is pushed once to every channel subscribed to monitor alerts",
          paths_since() == ["dingtalk", "feishu", "wecom"], str(paths_since()))
    check("the monitor alert lists its deliveries",
          [d.get("event") for d in alert.get("deliveries") or []].count("monitor") >= 3
          and all(d.get("status") == "sent" for d in alert.get("deliveries") or []),
          str(alert.get("deliveries"))[:160])

    call("PATCH", f"{base}/monitors/{probe_id}", {"url": f"{API}/api/health"}, token=admin_token, expect=None)
    _FakeBotHandler.requests.clear()
    _, checked = call("POST", f"{base}/monitors/{probe_id}/check", {}, token=admin_token, expect=None)
    check("probe monitor recovers",
          isinstance(checked, dict) and checked.get("status") == "up", str(checked)[:120])
    check("a recovered monitor pushes the status change",
          paths_since() == ["feishu", "wecom"], str(paths_since()))
    check("a recovered monitor resolves its open alerts",
          not any(a.get("monitorId") == probe_id and a.get("status") == "open" for a in alerts_listed()))
    call("PATCH", f"{base}/monitors/{probe_id}", {"url": "http://127.0.0.1:9/health"}, token=admin_token, expect=None)
```

- [ ] **Step 2: 运行，确认新增检查失败**

运行：`SMOKE_ONLY=alerts python3 trans-once/tests/smoke.py`

预期：退出码 1，输出 `65/69 checks passed`。新增的 8 条里有 4 条会通过（`probe monitor reports down`、`a failed check creates exactly one new alert`、`probe monitor recovers`、`a recovered monitor resolves its open alerts`，它们检验的是原有行为），另外 4 条是 `✗`。不应该出现 Python 异常堆栈。

说明：这一步会在「冒烟测试租户」里建好「冒烟失败探针」这个监控。

- [ ] **Step 3: 让监控检查推送告警**

在 `trans-once/orchestration.py` 顶部的导入区，把 `import agents` 到 `from security import decrypt_secret` 这几行改成：

```python
import agents
import alert_notify
import db
import net_guard
import serializers
from deps import TenantContext, log_activity
from security import decrypt_secret
```

在同一个文件里，把 `def check_monitor(ctx: TenantContext, monitor: dict) -> dict:` 这个函数整段替换成：

```python
def check_monitor(ctx: TenantContext, monitor: dict) -> dict:
    url = monitor["url"]
    if not url.startswith("http"):
        url = "http://" + url
    t0 = time.time()
    status = "down"
    latency = None
    error = None
    try:
        envs = db.fetch_all(
            "SELECT base_url, ip FROM environments WHERE tenant_id=%s", (ctx.tenant["id"],)
        )
        url = net_guard.validate_url(url, net_guard.targets_from_environments(envs))
        req = urllib.request.Request(url, method=monitor.get("method") or "GET")
        with _SAFE_OPENER.open(req, timeout=5) as resp:
            latency = int((time.time() - t0) * 1000)
            resp.read(8192)
            status = "up" if resp.status == (monitor.get("expected_status") or 200) else "down"
            if status == "down":
                error = f"HTTP {resp.status}"
    except net_guard.UnsafeTarget as e:
        error = f"目标被安全策略拒绝：{e}"
        latency = int((time.time() - t0) * 1000)
    except Exception as e:
        error = str(e)[:400]
        latency = int((time.time() - t0) * 1000)
    row = db.execute_returning(
        """UPDATE monitors SET status=%s, last_checked_at=now(), last_latency_ms=%s, last_error=%s
           WHERE id=%s RETURNING *""",
        (status, latency, error, monitor["id"]),
    )
    new_alert = None
    recovered: list[dict] = []
    if status == "down":
        open_alert = db.fetch_one(
            "SELECT * FROM alerts WHERE monitor_id=%s AND status='open'", (monitor["id"],)
        )
        if not open_alert:
            # 把监控关联的环境带到告警上，列表里一次关联就能显示环境名称。
            new_alert = db.execute_returning(
                """INSERT INTO alerts (tenant_id, monitor_id, environment_id, severity, title, detail)
                   VALUES (%s, %s, %s, 'critical', %s, %s) RETURNING *""",
                (
                    ctx.tenant["id"], monitor["id"], monitor.get("environment_id"),
                    f"监控异常：{monitor['name']}",
                    f"{url} 检查失败：{error}",
                ),
            )
    else:
        recovered = db.fetch_all(
            "UPDATE alerts SET status='resolved', resolved_at=now() "
            "WHERE monitor_id=%s AND status='open' RETURNING *",
            (monitor["id"],),
        )
    log_activity(ctx, "monitor.checked", {"monitorId": monitor["id"], "status": status, "latencyMs": latency}, "agent", "运维 Agent", tenant_id=ctx.tenant["id"])
    # 群机器人出问题不能让监控检查失败：notify 自己兜住全部异常。
    if new_alert:
        alert_notify.notify(ctx.tenant["id"], "monitor", new_alert, actor_id=ctx.user["id"])
    for alert in recovered:
        alert_notify.notify(ctx.tenant["id"], "status", alert, actor_id=ctx.user["id"])
    return serializers.monitor(row)
```

- [ ] **Step 4: 重启后端，确认检查通过**

```bash
bash /tmp/transonce-plan/restart-backend.sh
SMOKE_ONLY=alerts python3 trans-once/tests/smoke.py
```

预期：后端健康检查通过；冒烟输出 `69/69 checks passed` 和 `All smoke checks passed ✓`。

说明：每轮都会新产生一条监控告警，并在本轮内自动解决，所以已解决的告警每轮多一条，不留未处理告警。

- [ ] **Step 5: 提交**

```bash
git add trans-once/orchestration.py trans-once/tests/smoke.py
git commit -m "feat: 监控告警联动推送——新告警和自动解决推送到群，告警带上监控关联的环境"
```


### Task 6: 环境的操作系统字段

**Files:**
- Modify: `trans-once/tests/smoke.py`（在 `section_alert_notifications` 末尾追加检查）
- Modify: `trans-once/routers/devops.py`（环境的新建和修改接口校验并保存 `osType`）
- Modify: `trans-once/serializers.py`（`environment` 返回 `osType`）

**Interfaces:**
- Consumes: 任务 1 迁移加的列 `environments.os_type`。
- Produces: `POST/PATCH /environments` 接受可选的 `osType`（`linux` / `windows`，缺省 `linux`，其他值返回 400）；环境接口的返回里新增 `osType`。devops.py 里的常量 `OS_TYPES = ("linux", "windows")`。

- [ ] **Step 1: 写会失败的检查**

在 `trans-once/tests/smoke.py` 的 `section_alert_notifications` 末尾（任务 5 追加的那段之后）追加：

```python

    # --- 环境的操作系统 ---
    throwaway_name = "冒烟系统类型校验"

    def envs_now() -> list[dict]:
        _, out = call("GET", f"{base}/environments", token=admin_token, expect=None)
        return out if isinstance(out, list) else []

    for leftover in [e for e in envs_now() if e["name"].startswith(throwaway_name)]:
        call("DELETE", f"{base}/environments/{leftover['id']}", token=admin_token, expect=None)  # 上一轮中途失败留下的
    status, created = call("POST", f"{base}/environments", {"name": throwaway_name},
                           token=admin_token, expect=None)
    check("a new environment defaults to linux",
          status == 200 and isinstance(created, dict) and created.get("osType") == "linux", str(created)[:120])
    throwaway_id = created.get("id") if isinstance(created, dict) else None
    status, bad = call("POST", f"{base}/environments", {"name": f"{throwaway_name}（非法值）", "osType": "mac"},
                       token=admin_token, expect=None)
    check("creating an environment rejects an unknown operating system", status == 400, f"status {status}")
    if status == 200:  # 校验还没生效时（先写检查的那一步），别把它留在库里
        call("DELETE", f"{base}/environments/{bad['id']}", token=admin_token, expect=None)
    status, _ = call("PATCH", f"{base}/environments/{throwaway_id}", {"osType": "mac"},
                     token=admin_token, expect=None)
    check("updating an environment rejects an unknown operating system", status == 400, f"status {status}")
    status, _ = call("PATCH", f"{base}/environments/{throwaway_id}", {"osType": "windows"},
                     token=admin_token, expect=None)
    check("operating system can be switched to windows",
          status == 200 and next(
              (e.get("osType") for e in envs_now() if e.get("id") == throwaway_id), None) == "windows")
    status, _ = call("DELETE", f"{base}/environments/{throwaway_id}", token=admin_token, expect=None)
    check("throwaway environment removed",
          status == 200 and not any(e.get("id") == throwaway_id for e in envs_now()))
```

- [ ] **Step 2: 运行，确认新增检查失败**

运行：`SMOKE_ONLY=alerts python3 trans-once/tests/smoke.py`

预期：退出码 1，输出 `70/74 checks passed`。新增的 5 条里 `throwaway environment removed` 会通过（它只确认清理），其余 4 条是 `✗`。

- [ ] **Step 3: 校验并保存 `osType`**

在 `trans-once/routers/devops.py` 里，把 `# --- environments ---` 这行注释替换成：

```python
OS_TYPES = ("linux", "windows")

# --- environments --------------------------------------------------------
```

把 `create_environment` 这个函数（连同它上面的 `@router.post("/environments")`）整段替换成：

```python
@router.post("/environments")
def create_environment(tenant_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "env.manage")
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "请输入环境名称")
    os_type = body.get("osType") or "linux"
    if os_type not in OS_TYPES:
        raise HTTPException(400, "操作系统仅支持 Linux 或 Windows")
    row = db.execute_returning(
        """INSERT INTO environments
           (tenant_id, name, kind, base_url, ip, username, password_enc, config, managed_by, os_type)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (
            tenant_id, name, body.get("kind") or "test", body.get("baseUrl"), body.get("ip"),
            body.get("username"), encrypt_secret(body.get("password")),
            Json(body.get("config") or {}), user["id"], os_type,
        ),
    )
    log_activity(ctx, "environment.created", {"name": name, "kind": row["kind"]})
    return serializers.environment(row)
```

把 `update_environment` 这个函数（连同它上面的 `@router.patch("/environments/{environment_id}")`）整段替换成：

```python
@router.patch("/environments/{environment_id}")
def update_environment(tenant_id: str, environment_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "env.manage")
    env = _env_or_404(tenant_id, environment_id)
    os_type = body.get("osType") or env.get("os_type") or "linux"
    if os_type not in OS_TYPES:
        raise HTTPException(400, "操作系统仅支持 Linux 或 Windows")
    password_enc = encrypt_secret(body["password"]) if body.get("password") else env.get("password_enc")
    row = db.execute_returning(
        """UPDATE environments
           SET name=%s, kind=%s, base_url=%s, ip=%s, username=%s, password_enc=%s, config=%s, os_type=%s
           WHERE id=%s RETURNING *""",
        (
            body.get("name") or env["name"], body.get("kind", env["kind"]),
            body.get("baseUrl", env.get("base_url")), body.get("ip", env.get("ip")),
            body.get("username", env.get("username")), password_enc,
            Json(body.get("config") if body.get("config") is not None else env.get("config") or {}),
            os_type, environment_id,
        ),
    )
    log_activity(ctx, "environment.updated", {"name": row["name"]})
    return serializers.environment(row)
```

- [ ] **Step 4: 序列化 `osType`**

在 `trans-once/serializers.py` 里，把 `def environment(r: dict, reveal: bool = False) -> dict:` 这个函数整段替换成：

```python
def environment(r: dict, reveal: bool = False) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r["tenant_id"]),
        "name": r["name"],
        "kind": r["kind"],
        "osType": r.get("os_type") or "linux",
        "baseUrl": r.get("base_url"),
        "ip": r.get("ip"),
        "username": r.get("username"),
        "passwordMasked": mask_secret(decrypt_secret(r.get("password_enc"))),
        "hasPassword": bool(r.get("password_enc")),
        "password": None if not reveal else "__SERVER_SIDE_ONLY__",
        "config": r.get("config") or {},
        "createdAt": _iso(r.get("created_at")),
    }
```

- [ ] **Step 5: 重启后端，确认检查通过**

```bash
bash /tmp/transonce-plan/restart-backend.sh
SMOKE_ONLY=alerts python3 trans-once/tests/smoke.py
```

预期：后端健康检查通过；冒烟输出 `74/74 checks passed` 和 `All smoke checks passed ✓`（其中的 `throwaway environment removed` 说明临时环境已删除）。

- [ ] **Step 6: 提交**

```bash
git add trans-once/routers/devops.py trans-once/serializers.py trans-once/tests/smoke.py
git commit -m "feat: 环境增加操作系统——Linux / Windows，缺省 Linux，非法值返回 400"
```



### Task 7: 前端数据层

**Files:**
- Modify: `trans-once-web-ui/src/types.ts`（告警通道、推送记录、告警和环境的新字段）
- Modify: `trans-once-web-ui/src/services/api.ts`（通道和录入问题的接口客户端）
- Modify: `trans-once-web-ui/src/lib/store.ts`（工作区状态带上通道列表）

这个任务没有可见的界面变化，验证方式是类型检查和生产构建通过；数据是否真的取到，由任务 8、10 的浏览器核对确认。

**Interfaces:**
- Consumes: 任务 3、4、6 的接口。
- Produces:
  - 类型 `AlertChannelEvent`、`AlertChannel`、`AlertChannelInput`、`AlertDelivery`；`Alert` 增加 `source`、`environmentId`、`environmentName`、`createdById`、`createdByName`、`notifiedUsers`、`deliveries`；`Environment` 增加 `osType`。
  - `api.alerts.create(tid, body) -> Promise<Alert>`，`body` 是 `{title, severity?, detail?, environmentId?, monitorId?, notifiedUserIds?, push?}`。
  - `api.alerts.resend(tid, aid, channelIds?) -> Promise<{deliveries: AlertDelivery[]}>`；`api.alerts.update` 的返回多了 `pushed: AlertDelivery[]`。
  - `api.alertChannels.list / create / update / remove / test / deliveries(tid, channelId?, limit = 20)`。
  - 工作区状态 `alertChannels: AlertChannel[]`，用 `useWorkspace((s) => s.alertChannels)` 读取。

- [ ] **Step 1: 加类型**

在 `trans-once-web-ui/src/types.ts` 里做两处改动。

第一处，把 `export type Alert = {` 到它对应的 `};` 这一段（在 `Monitor` 类型之后、`Dashboard` 类型之前）整段替换成：

```ts
export type AlertChannelEvent = "monitor" | "manual" | "status";

// 一个告警通道对应一个群机器人。地址和密钥只写不读，接口只返回掩码。
export type AlertChannel = {
  id: string;
  name: string;
  provider: "dingtalk" | "wecom" | "feishu";
  enabled: boolean;
  events: Partial<Record<AlertChannelEvent, boolean>>;
  webhookMasked?: string | null;
  hasSecret?: boolean;
  secretMasked?: string | null;
  createdAt: string;
  updatedAt?: string | null;
};

// 新建或编辑通道时提交的字段。webhook 留空表示不修改；
// 密钥三态：不传保留，空串清除，非空替换。
export type AlertChannelInput = {
  name: string;
  provider: AlertChannel["provider"];
  webhook?: string;
  secret?: string;
  enabled?: boolean;
  events?: Partial<Record<AlertChannelEvent, boolean>>;
};

// 一条推送记录：某个通道为某个事件发送一次的结果。
export type AlertDelivery = {
  id: string;
  alertId?: string | null;
  channelId?: string | null;
  channelName: string;
  provider: AlertChannel["provider"];
  event: AlertChannelEvent | "test";
  status: "sent" | "failed";
  httpStatus?: number | null;
  error?: string | null;
  durationMs?: number | null;
  createdAt: string;
};

export type Alert = {
  id: string;
  tenantId?: string;
  source?: "monitor" | "manual";
  monitorId?: string | null;
  monitorName?: string | null;
  environmentId?: string | null;
  environmentName?: string | null;
  deploymentId?: string | null;
  createdById?: string | null;
  createdByName?: string | null;
  notifiedUsers?: { id: string; name: string }[];
  deliveries?: AlertDelivery[];
  severity: "info" | "warning" | "critical";
  title: string;
  detail?: string | null;
  status: "open" | "acknowledged" | "resolved";
  createdAt: string;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
};
```

第二处，在 `export type Environment` 里，把 `  kind: "dev" | "test" | "staging" | "production";` 这一行之后（它和 `baseUrl` 之间）加入：

```ts
  osType?: "linux" | "windows";
```

- [ ] **Step 2: 加接口客户端**

在 `trans-once-web-ui/src/services/api.ts` 里做两处改动。

第一处，把文件顶部类型导入里的这一行 `  RepoAccessRequest, RepoAccessRole,` 改成：

```ts
  RepoAccessRequest, RepoAccessRole, AlertChannel, AlertChannelInput, AlertDelivery,
```

第二处，把 `  alerts: {` 到它的 `},` 这一段（在 `monitors` 之后）整段替换成：

```ts
  alerts: {
    list: (tid: string) => get<Alert[]>(`${T(tid)}/alerts`),
    update: (tid: string, aid: string, status: Alert["status"]) =>
      patch<Alert & { pushed: AlertDelivery[] }>(`${T(tid)}/alerts/${aid}`, { status }),
    create: (tid: string, body: {
      title: string; severity?: Alert["severity"]; detail?: string;
      environmentId?: string; monitorId?: string; notifiedUserIds?: string[]; push?: boolean;
    }) => post<Alert>(`${T(tid)}/alerts`, body),
    // channelIds 只能缩小范围；不传表示推给所有符合条件（启用且已订阅）的通道。
    resend: (tid: string, aid: string, channelIds?: string[]) =>
      post<{ deliveries: AlertDelivery[] }>(`${T(tid)}/alerts/${aid}/resend`, channelIds ? { channelIds } : {}),
  },

  alertChannels: {
    list: (tid: string) => get<AlertChannel[]>(`${T(tid)}/alert-channels`),
    create: (tid: string, body: AlertChannelInput) => post<AlertChannel>(`${T(tid)}/alert-channels`, body),
    update: (tid: string, cid: string, body: Partial<AlertChannelInput>) =>
      patch<AlertChannel>(`${T(tid)}/alert-channels/${cid}`, body),
    remove: (tid: string, cid: string) => del<{ ok: true }>(`${T(tid)}/alert-channels/${cid}`),
    test: (tid: string, cid: string) => post<AlertDelivery>(`${T(tid)}/alert-channels/${cid}/test`),
    deliveries: (tid: string, channelId?: string, limit = 20) =>
      get<AlertDelivery[]>(
        `${T(tid)}/alert-channels/deliveries?limit=${limit}${channelId ? `&channelId=${encodeURIComponent(channelId)}` : ""}`,
      ),
  },
```

- [ ] **Step 3: 工作区状态带上通道**

在 `trans-once-web-ui/src/lib/store.ts` 里做四处改动。

第一处，把文件顶部类型导入里的这一行 `  TenantDetail, GitlabConnection, GitRepo, RepoAccessRequest,` 改成：

```ts
  TenantDetail, GitlabConnection, GitRepo, RepoAccessRequest, AlertChannel,
```

第二处，在 `WorkspaceState` 类型里，把 `  alerts: Alert[];` 这一行之后加入：

```ts
  alertChannels: AlertChannel[];
```

第三处，在 `initial` 里，把 `  alerts: [],` 这一行之后加入：

```ts
  alertChannels: [],
```

第四处，把 `export async function loadWorkspace(` 到 `  return inflight;\n}` 这个函数整段替换成：

```ts
export async function loadWorkspace(tenantId: string, force = false): Promise<void> {
  if (!force && state.tenantId === tenantId && !state.error && state.detail) return;
  if (inflight && state.tenantId === tenantId) return inflight;
  set({ tenantId, loading: true, error: null });
  inflight = (async () => {
    const [
      detail, dashboard, projects, meetings, requirements, tasks, testRuns,
      artifacts, connections, repos, myRepoRequests, repoRequests,
      pipelines, pipelineRuns, deployments, environments, monitors,
      alerts, alertChannels, agentRuns, activity,
    ] = await Promise.all([
      safe(api.tenants.detail(tenantId), null),
      safe(api.tenants.dashboard(tenantId), null),
      safe(api.projects.list(tenantId), []),
      safe(api.meetings.list(tenantId), []),
      safe(api.requirements.list(tenantId), []),
      safe(api.tasks.list(tenantId), []),
      safe(api.testRuns.list(tenantId), []),
      safe(api.artifacts.list(tenantId), []),
      safe(api.coderepos.connections(tenantId), []),
      safe(api.coderepos.repos(tenantId), []),
      safe(api.coderepos.myRequests(tenantId), []),
      safe(api.coderepos.requests(tenantId), []),
      safe(api.pipelines.list(tenantId), []),
      safe(api.pipelines.runs(tenantId), []),
      safe(api.deployments.list(tenantId), []),
      safe(api.environments.list(tenantId), []),
      safe(api.monitors.list(tenantId), []),
      safe(api.alerts.list(tenantId), []),
      // 没有 alerts 或 alert.channel.manage 权限的成员拿到 403，这里落成空数组。
      safe(api.alertChannels.list(tenantId), []),
      safe(api.agentRuns.list(tenantId, 50), []),
      safe(api.tenants.activity(tenantId, 60), []),
    ]);
    set({
      tenantId, loading: false,
      detail, dashboard, projects, meetings, requirements, tasks, testRuns,
      artifacts, connections, repos, myRepoRequests, repoRequests,
      pipelines, pipelineRuns, deployments, environments, monitors,
      alerts, alertChannels, agentRuns, activity,
      error: detail ? null : "加载工作空间失败或没有访问权限",
    });
    inflight = null;
  })();
  return inflight;
}
```

- [ ] **Step 4: 类型检查和构建**

```bash
cd trans-once-web-ui && npm run lint
```

```bash
cd trans-once-web-ui && npm run build
```

预期：两条命令都以退出码 0 结束，`build` 输出里有 `✓ built in`。

- [ ] **Step 5: 提交**

```bash
git add trans-once-web-ui/src/types.ts trans-once-web-ui/src/services/api.ts trans-once-web-ui/src/lib/store.ts
git commit -m "ui: 前端数据层——告警通道、推送记录与录入问题的类型、接口客户端和工作区状态"
```


### Task 8: 告警配置页与侧边栏「配置」分组

**Files:**
- Modify: `trans-once-web-ui/src/components/common.tsx`（开关组件移到这里；新增标签；`Select` 支持 `id`）
- Modify: `trans-once-web-ui/src/components/PlatformSettings.tsx`（改用公共的开关组件）
- Create: `trans-once-web-ui/src/views/AlertSettings.tsx`
- Modify: `trans-once-web-ui/src/App.tsx`（侧边栏分组和页面路由）

**Interfaces:**
- Consumes: 任务 7 的类型、`api.alertChannels`、`useWorkspace((s) => s.alertChannels)`。
- Produces:
  - `common.tsx` 新增导出：`Toggle({checked, onChange, disabled?, ariaLabel?})`、`SwitchRow({title, description, checked, onChange, disabled?})`、`alertProviderLabel`、`alertEventLabel`；`Select` 多一个可选的 `id`；`statusLabel` 多 `sent`、`linux`、`windows`；`statusTone("sent")` 是 `green`。
  - 视图标识 `alert-settings`（侧边栏「配置」分组，权限 `alert.channel.manage`）。
  - 页面上的定位标识（任务 10 和浏览器核对会用到）：通道卡片上的开关 `aria-label="启用通道 {名称}"`，按钮 `aria-label` 分别是 `发送测试消息到 {名称}`、`编辑通道 {名称}`、`删除通道 {名称}`；弹窗里输入框的 `id` 是 `channel-name`、`channel-provider`、`channel-webhook`、`channel-secret`、`event-monitor`、`event-manual`、`event-status`。

- [ ] **Step 1: 公共组件**

在 `trans-once-web-ui/src/components/common.tsx` 里做四处改动。

第一处，在 `statusTone` 里，把 `    case "resolved":` 这一行之后加入：

```ts
    case "sent":
```

第二处，在 `statusLabel` 里，把 `  resolved: "已解决",` 这一行之后加入：

```ts
  sent: "成功",
```

第三处，在 `statusLabel` 的末尾，把 `  production: "生产",` 这一行之后加入：

```ts
  linux: "Linux",
  windows: "Windows",
```

第四处，把 `export function Select(` 到它的右花括号 `}` 这个函数整段替换成：

```tsx
export function Select({
  value,
  onChange,
  children,
  className = "",
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-9 rounded-md border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring ${className}`}
    >
      {children}
    </select>
  );
}
```

然后在文件末尾追加：

```tsx

// 开关。原先只定义在 PlatformSettings 里，告警配置页也要用，移到公共模块。
export function Toggle({
  checked, onChange, disabled, ariaLabel,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; ariaLabel?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`w-10 h-6 rounded-full transition-colors shrink-0 relative ${checked ? "bg-primary" : "bg-muted-foreground/30"} ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      {/* 手柄用 bg-background：暗色主题下 --primary 接近纯白，白手柄会隐没在轨道里。
          left-0 必须显式声明：absolute 元素缺 left 时取静态位置，按钮内容居中会把
          手柄横向顶出去 ~20px，两种状态都大半漂在胶囊外，看起来像没有手柄。 */}
      <span className={`absolute left-0 top-0.5 w-5 h-5 rounded-full bg-background shadow transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </button>
  );
}

export function SwitchRow({
  title, description, checked, onChange, disabled,
}: { title: string; description: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border bg-background/50 px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export const alertProviderLabel: Record<string, string> = { dingtalk: "钉钉", wecom: "企业微信", feishu: "飞书" };
export const alertEventLabel: Record<string, string> = {
  monitor: "监控告警", manual: "手工问题", status: "状态变化", test: "测试消息",
};
```

- [ ] **Step 2: 平台登录设置改用公共开关**

在 `trans-once-web-ui/src/components/PlatformSettings.tsx` 里做两处改动。

第一处，把 `import { Modal } from "./common";` 改成：

```ts
import { Modal, SwitchRow } from "./common";
```

第二处，删掉本文件里的 `Toggle` 和 `SwitchRow` 两个函数：从 `function Toggle(` 这一行起，到 `SwitchRow` 函数的右花括号 `}` 为止（含中间的注释，到 `function LockedHint` 之前的空行为止）。删掉后，文件顶部那段以「平台登录设置（仅超级管理员）」开头的注释下面，紧跟着的就是 `function LockedHint`。

- [ ] **Step 3: 告警配置页**

创建 `trans-once-web-ui/src/views/AlertSettings.tsx`：

```tsx
import { useEffect, useState } from "react";
import { BellRing, CheckCircle2, KeyRound, Loader2, Pencil, Plus, RefreshCw, Send, Trash2, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Modal, PageHeader, EmptyState, Pill, Select, SwitchRow, Toggle, formatDate,
  alertEventLabel, alertProviderLabel,
} from "../components/common";
import { api } from "../services/api";
import { useSession } from "../lib/session";
import { refreshWorkspace, useWorkspace } from "../lib/store";
import type { AlertChannel, AlertChannelEvent, AlertChannelInput, AlertDelivery } from "../types";

const EVENTS: AlertChannelEvent[] = ["monitor", "manual", "status"];

// 各平台机器人地址的样子，用作输入框的占位；signs 表示这个平台支持加签。
const PROVIDERS: { id: AlertChannel["provider"]; webhookHint: string; secretHint: string; signs: boolean }[] = [
  {
    id: "dingtalk",
    webhookHint: "https://oapi.dingtalk.com/robot/send?access_token=…",
    secretHint: "以 SEC 开头，机器人安全设置选「加签」时显示",
    signs: true,
  },
  {
    id: "wecom",
    webhookHint: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…",
    secretHint: "",
    signs: false,
  },
  {
    id: "feishu",
    webhookHint: "https://open.feishu.cn/open-apis/bot/v2/hook/…",
    secretHint: "机器人安全设置选「签名校验」时显示",
    signs: true,
  },
];

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function AlertSettings() {
  const tenant = useSession((s) => s.currentTenant)!;
  const channels = useWorkspace((s) => s.alertChannels);
  const [editing, setEditing] = useState<AlertChannel | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<Record<string, AlertDelivery>>({});
  const [deliveries, setDeliveries] = useState<AlertDelivery[]>([]);
  const tid = tenant.tenant.id;

  // 最近推送。切换团队后重新取；取不到就留空，不影响通道卡片。
  useEffect(() => {
    let alive = true;
    api.alertChannels.deliveries(tid)
      .then((rows) => { if (alive) setDeliveries(rows); })
      .catch(() => { if (alive) setDeliveries([]); });
    return () => { alive = false; };
  }, [tid]);

  const run = async (key: string | null, action: () => Promise<void>) => {
    if (key) setBusy(key);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      if (key) setBusy(null);
    }
  };

  const reloadDeliveries = () =>
    api.alertChannels.deliveries(tid).then(setDeliveries).catch(() => undefined);

  const toggle = (channel: AlertChannel, enabled: boolean) =>
    run(null, async () => {
      await api.alertChannels.update(tid, channel.id, { enabled });
      await refreshWorkspace();
    });

  const sendTest = (channel: AlertChannel) =>
    run(channel.id, async () => {
      const result = await api.alertChannels.test(tid, channel.id);
      setTested((t) => ({ ...t, [channel.id]: result }));
      await reloadDeliveries();
    });

  const remove = (channel: AlertChannel) =>
    run(channel.id, async () => {
      if (!confirm(`删除通道「${channel.name}」？这个群将不再收到推送，历史推送记录会保留。`)) return;
      await api.alertChannels.remove(tid, channel.id);
      await refreshWorkspace();
      await reloadDeliveries();
    });

  const closeModal = async () => {
    setCreating(false);
    setEditing(null);
    await refreshWorkspace();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="告警配置"
        description="配置钉钉 / 企业微信 / 飞书群机器人，监控告警和录入的问题会自动推送到对应的群。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => refreshWorkspace()}><RefreshCw className="w-4 h-4 mr-2" /> 刷新</Button>
            <Button size="sm" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" /> 新建通道</Button>
          </>
        }
      />

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</div>}

      {!channels.length ? (
        <EmptyState icon={BellRing} title="还没有配置告警通道" description="添加一个群机器人地址，监控告警和录入的问题就会推送到群里。" action={
          <Button size="sm" className="mt-2" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" /> 新建通道</Button>
        } />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {channels.map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              latest={deliveries.find((d) => d.channelId === channel.id)}
              tested={tested[channel.id]}
              busy={busy === channel.id}
              onToggle={(enabled) => toggle(channel, enabled)}
              onEdit={() => setEditing(channel)}
              onTest={() => sendTest(channel)}
              onRemove={() => remove(channel)}
            />
          ))}
        </div>
      )}

      <section>
        <h3 className="text-sm font-semibold mb-2">最近推送</h3>
        <Card className="divide-y">
          {deliveries.length ? deliveries.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-xs">
              <span className="text-muted-foreground w-28 shrink-0">{formatDate(d.createdAt)}</span>
              <span className="font-medium">{d.channelName}{d.channelId ? "" : "（通道已删除）"}</span>
              <Pill tone="blue">{alertProviderLabel[d.provider] ?? d.provider}</Pill>
              <Pill tone="gray">{alertEventLabel[d.event] ?? d.event}</Pill>
              <Pill tone={d.status === "sent" ? "green" : "rose"}>{d.status === "sent" ? "成功" : "失败"}</Pill>
              {d.error && <span className="text-muted-foreground break-all basis-60 flex-1">{d.error}</span>}
            </div>
          )) : (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">还没有推送记录。保存通道后可以发一条测试消息。</p>
          )}
        </Card>
      </section>

      {(creating || editing) && (
        <ChannelModal channel={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={closeModal} />
      )}
    </div>
  );
}

function ChannelCard({
  key, channel, latest, tested, busy, onToggle, onEdit, onTest, onRemove,
}: {
  key?: string;
  channel: AlertChannel;
  latest?: AlertDelivery;
  tested?: AlertDelivery;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onTest: () => void;
  onRemove: () => void;
}) {
  const signs = channel.provider !== "wecom";
  const result = tested ?? latest;
  return (
    <Card className="p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-blue-500/10 text-blue-600">
            <BellRing className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold flex flex-wrap items-center gap-2">
              {channel.name}
              <Pill tone="blue">{alertProviderLabel[channel.provider] ?? channel.provider}</Pill>
              {!channel.enabled && <Pill tone="gray">已停用</Pill>}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1 font-mono break-all">{channel.webhookMasked}</p>
            <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
              <KeyRound className="w-3 h-3 shrink-0" />
              <span className="break-all">
                {signs
                  ? (channel.hasSecret ? `已加签 ${channel.secretMasked ?? ""}` : "未加签，请在机器人的安全设置里配置关键词")
                  : "企业微信群机器人不需要密钥"}
              </span>
            </p>
          </div>
        </div>
        <Toggle checked={channel.enabled} onChange={onToggle} ariaLabel={`启用通道 ${channel.name}`} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {EVENTS.map((event) => (
          <Pill key={event} tone={channel.events?.[event] ? "green" : "gray"}>{alertEventLabel[event]}</Pill>
        ))}
      </div>

      {result && (tested ? (
        <p className={`text-xs rounded-md px-2.5 py-1.5 break-all ${result.status === "sent" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/10 text-rose-700 dark:text-rose-300"}`}>
          {result.status === "sent"
            ? "测试消息已送达，请到群里确认。"
            : `测试消息发送失败：${result.error ?? `HTTP ${result.httpStatus ?? "-"}`}`}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          {result.status === "sent"
            ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            : <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />}
          <span className="min-w-0 break-all">
            最近推送：{alertEventLabel[result.event] ?? result.event} · {result.status === "sent" ? "已送达" : "失败"} · {formatDate(result.createdAt)}
            {result.error && `（${result.error}）`}
          </span>
        </p>
      ))}

      <div className="flex flex-wrap gap-1.5 border-t pt-3 mt-auto">
        <Button size="sm" variant="outline" onClick={onTest} disabled={busy} aria-label={`发送测试消息到 ${channel.name}`}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} 测试消息
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`编辑通道 ${channel.name}`}><Pencil className="w-3.5 h-3.5" /> 编辑</Button>
        <Button size="sm" variant="ghost" className="text-destructive" onClick={onRemove} aria-label={`删除通道 ${channel.name}`}><Trash2 className="w-3.5 h-3.5" /> 删除</Button>
      </div>
    </Card>
  );
}

function ChannelModal({ channel, onClose, onSaved }: {
  channel: AlertChannel | null; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const tenant = useSession((s) => s.currentTenant)!;
  const [form, setForm] = useState({
    name: channel?.name ?? "",
    provider: (channel?.provider ?? "dingtalk") as AlertChannel["provider"],
    webhook: "",
    secret: "",
    enabled: channel?.enabled ?? true,
    monitor: channel?.events?.monitor ?? true,
    manual: channel?.events?.manual ?? true,
    status: channel?.events?.status ?? false,
  });
  // 编辑时点「清除已保存的密钥」就提交空串；之后在密钥框里输入新值会取消清除。
  const [clearSecret, setClearSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = PROVIDERS.find((p) => p.id === form.provider) ?? PROVIDERS[0];
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const secret = provider.signs ? form.secret.trim() : "";
      const body: AlertChannelInput = {
        name: form.name.trim(),
        provider: form.provider,
        events: { monitor: form.monitor, manual: form.manual, status: form.status },
        ...(channel ? { enabled: form.enabled } : {}),
        // 密钥三态：点了「清除」提交空串；填了新值提交新值；都不占就不提交，后端保留原值。
        ...(clearSecret ? { secret: "" } : secret ? { secret } : {}),
        ...(form.webhook.trim() ? { webhook: form.webhook.trim() } : {}),
      };
      if (channel) await api.alertChannels.update(tenant.tenant.id, channel.id, body);
      else await api.alertChannels.create(tenant.tenant.id, body);
      await onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={channel ? `编辑通道：${channel.name}` : "新建通道"} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="channel-name" className="text-sm font-medium">通道名称</label>
            <Input id="channel-name" value={form.name} onChange={(e) => set("name", e.target.value)} className="mt-1.5 h-10" placeholder="例如：运维告警群" maxLength={50} />
          </div>
          <div>
            <label htmlFor="channel-provider" className="text-sm font-medium">平台</label>
            <Select id="channel-provider" value={form.provider} onChange={(v) => set("provider", v as AlertChannel["provider"])} className="mt-1.5 w-full h-10">
              {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{alertProviderLabel[p.id]}</option>)}
            </Select>
          </div>
        </div>
        <div>
          <label htmlFor="channel-webhook" className="text-sm font-medium">
            Webhook 地址 {channel && <span className="text-muted-foreground font-normal">（留空表示不修改）</span>}
          </label>
          <Input
            id="channel-webhook"
            type="password"
            value={form.webhook}
            onChange={(e) => set("webhook", e.target.value)}
            className="mt-1.5 h-10 font-mono"
            placeholder={channel?.webhookMasked ?? provider.webhookHint}
            autoComplete="off"
          />
        </div>
        {provider.signs && (
          <div>
            <label htmlFor="channel-secret" className="text-sm font-medium">
              加签密钥 <span className="text-muted-foreground font-normal">（可选）</span>
            </label>
            <Input
              id="channel-secret"
              type="password"
              value={form.secret}
              onChange={(e) => { set("secret", e.target.value); setClearSecret(false); }}
              className="mt-1.5 h-10 font-mono"
              placeholder={channel?.hasSecret && !clearSecret ? `${channel.secretMasked ?? "••••••"}（留空保持不变）` : provider.secretHint}
              autoComplete="off"
            />
            {channel?.hasSecret && !clearSecret && (
              <Button variant="ghost" size="xs" className="mt-1 text-destructive" onClick={() => { set("secret", ""); setClearSecret(true); }}>
                清除已保存的密钥
              </Button>
            )}
          </div>
        )}
        {channel && (
          <SwitchRow
            title="启用"
            description="停用后不再向这个群推送。地址和密钥都会保留，测试消息仍然可以发送。"
            checked={form.enabled}
            onChange={(v) => set("enabled", v)}
          />
        )}
        <fieldset className="rounded-lg border bg-background/50 px-3.5 py-3 space-y-2">
          <legend className="px-1 text-sm font-medium">推送事件</legend>
          <label className="flex items-center gap-2 text-sm">
            <input id="event-monitor" type="checkbox" checked={form.monitor} onChange={(e) => set("monitor", e.target.checked)} />
            监控告警<span className="text-muted-foreground text-xs">监控检查失败，产生新告警</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input id="event-manual" type="checkbox" checked={form.manual} onChange={(e) => set("manual", e.target.checked)} />
            手工问题<span className="text-muted-foreground text-xs">在告警中心里录入的问题</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input id="event-status" type="checkbox" checked={form.status} onChange={(e) => set("status", e.target.checked)} />
            状态变化<span className="text-muted-foreground text-xs">确认、解决、重新打开，或监控恢复</span>
          </label>
        </fieldset>
        <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1.5">
          <p><span className="text-foreground font-medium">获取地址：</span>在群里打开「群设置 → 群机器人 → 自定义机器人」，添加后复制 Webhook 地址。</p>
          <p><span className="text-foreground font-medium">关键词校验：</span>消息标题都以「TransOnce」开头，在钉钉、飞书的安全设置里把关键词设为 TransOnce 即可。</p>
          <p><span className="text-foreground font-medium">频率限制：</span>钉钉、企业微信每个机器人每分钟 20 条（钉钉超限后会被限流 10 分钟），飞书每分钟 100 条、每秒 5 条。</p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={save} disabled={busy || !form.name.trim()}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "保存"}</Button>
        </div>
      </div>
    </Modal>
  );
}
```

注意两点。`ChannelCard` 的 props 里要声明 `key?: string`：仓库没有安装 `@types/react`，自定义组件不声明就通不过类型检查（和 `Pill` 的做法一样）。输入框都写了 `id`，和 `<label htmlFor>` 关联，浏览器核对靠这些 `id` 定位。

- [ ] **Step 4: 侧边栏和路由**

在 `trans-once-web-ui/src/App.tsx` 里做六处改动。

第一处，把 `lucide-react` 导入里的 `Bell, Bot, Users, LogOut, GitBranch,` 改成 `Bell, BellRing, Bot, Users, LogOut, GitBranch,`。

第二处，在 `import { Alerts } from "./views/Alerts";` 之后加入一行：

```ts
import { AlertSettings } from "./views/AlertSettings";
```

第三处，把 `type ViewId =` 的定义（到 `| "monitoring" | "alerts" | "agents" | "team";` 为止）替换成：

```ts
type ViewId =
  | "dashboard" | "projects" | "meetings" | "requirements" | "development"
  | "testing" | "repos" | "artifacts" | "pipelines" | "deployment" | "environments"
  | "monitoring" | "alerts" | "alert-settings" | "agents" | "team";
```

第四处，把 `NAV` 里 `group: "运维"` 那一项（从 `  {` 到它的 `  },`）替换成下面两项：

```tsx
  {
    group: "运维",
    items: [
      { id: "monitoring", label: "运维监控", icon: Activity, perm: "monitoring" },
      { id: "alerts", label: "告警中心", icon: Bell, perm: "alerts" },
    ],
  },
  {
    group: "配置",
    items: [
      { id: "environments", label: "环境配置", icon: Server, perm: "environments" },
      { id: "alert-settings", label: "告警配置", icon: BellRing, perm: "alert.channel.manage" },
    ],
  },
```

第五处，在 `TITLES` 里，把 `  deployment: "部署管理", environments: "环境配置", monitoring: "运维监控", alerts: "告警中心",` 这一行之后加入：

```ts
  "alert-settings": "告警配置",
```

第六处，在 `render` 函数的 `switch` 里，把 `      case "alerts": return <Alerts />;` 这一行之后加入：

```tsx
      case "alert-settings": return <AlertSettings />;
```

- [ ] **Step 5: 类型检查和构建**

```bash
cd trans-once-web-ui && npm run lint
```

```bash
cd trans-once-web-ui && npm run build
```

预期：两条命令都以退出码 0 结束。

- [ ] **Step 6: 创建浏览器核对用的辅助脚本（不入库）**

后面的界面核对都靠这几个放在 `/tmp` 下的文件。

创建 `/tmp/transonce-plan/ui.sh`：

```bash
#!/bin/bash
# 浏览器核对的辅助脚本（计划专用，不入库）。
#   bash ui.sh open              打开 :3002，未登录时用超管账号登录
#   bash ui.sh tenant            切到「冒烟测试租户」（冒烟夹具所在的租户）并刷新
#   bash ui.sh nav 告警配置       点击侧边栏的菜单项
#   bash ui.sh eval 检查.js       在页面里执行脚本，打印它返回的 JSON
#   bash ui.sh shot 名称 宽度     按宽度截图到 /tmp/transonce-plan/shots/名称.png
#   bash ui.sh bot start|stop    启动 / 停止假群机器人（127.0.0.1:9901）
#   bash ui.sh close             关闭浏览器
set -u
S="agent-browser --session transonce-plan"
ROOT=/tmp/transonce-plan
UI=http://127.0.0.1:3002
mkdir -p "$ROOT/shots"
case "$1" in
  open)
    $S set viewport 1440 900 >/dev/null
    $S open "$UI"/ >/dev/null 2>&1
    $S wait --load networkidle >/dev/null 2>&1
    if $S snapshot -c | grep -q "登 录"; then
      $S find placeholder "name@example.com" fill "admin@transonce.local" >/dev/null
      $S find placeholder "至少 6 位" fill "admin123" >/dev/null
      $S find role button click --name "登 录" >/dev/null
      $S wait --load networkidle >/dev/null 2>&1
    fi
    ;;
  tenant)
    $S eval --stdin < "$ROOT/ui/tenant.js" >/dev/null
    $S reload >/dev/null 2>&1
    $S wait --load networkidle >/dev/null 2>&1
    ;;
  nav)
    $S find role button click --name "$2" >/dev/null
    $S wait --load networkidle >/dev/null 2>&1
    ;;
  eval) $S eval --stdin < "$2" ;;
  shot)
    $S set viewport "$3" 900 >/dev/null
    perl -e 'select(undef,undef,undef,0.8)'   # 等侧边栏的位移动画结束
    # 自动化浏览器里的动画帧被节流，弹窗的入场动画会停在半透明，截图前直接置为完成状态。
    $S eval "document.querySelectorAll('.fixed.inset-0 .rounded-xl').forEach((el) => { el.style.opacity = '1'; el.style.transform = 'none'; })" >/dev/null
    $S screenshot "$ROOT/shots/$2.png" >/dev/null
    $S set viewport 1440 900 >/dev/null
    echo "$ROOT/shots/$2.png"
    ;;
  bot)
    if [ "$2" = "start" ]; then
      # 和 restart-backend.sh 一样用独立会话启动，命令结束后进程继续运行。
      python3 - <<'PYEOF'
import subprocess
log = open("/tmp/transonce-plan/fake-bot.log", "ab")
subprocess.Popen(["python3", "/tmp/transonce-plan/ui/fake-bot.py"], stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
PYEOF
      perl -e 'select(undef,undef,undef,0.8)'
      curl -s -X POST http://127.0.0.1:9901/ping; echo
    else
      pkill -f "transonce-plan/ui/fake-bot.py"
    fi
    ;;
  close) $S close >/dev/null 2>&1 ;;
esac
```

创建 `/tmp/transonce-plan/ui/tenant.js`：

```js
(async () => {
  const res = await fetch("/api/tenants", { headers: { Authorization: "Bearer " + localStorage.getItem("transonce.token") } });
  const data = await res.json();
  const hit = data.items.find((i) => i.tenant.slug === "smoke");
  if (hit) localStorage.setItem("transonce.tenant", hit.tenant.id);
  return JSON.stringify({ found: Boolean(hit), name: hit ? hit.tenant.name : null });
})()
```

创建 `/tmp/transonce-plan/ui/fake-bot.py`：

```python
"""浏览器核对用的假群机器人（计划专用，不入库）。

/fail 开头的地址返回钉钉的失败码，其余地址返回成功。只监听本机 9901 端口。
"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass

    def do_POST(self) -> None:  # noqa: N802 - http.server API
        self.rfile.read(int(self.headers.get("content-length", 0)))
        if self.path.startswith("/fail"):
            payload = {"errcode": 310000, "errmsg": "keywords not in content"}
        else:
            payload = {"errcode": 0, "errmsg": "ok"}
        data = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


ThreadingHTTPServer(("127.0.0.1", 9901), Handler).serve_forever()
```

创建 `/tmp/transonce-plan/ui/nav.js`（列出侧边栏的分组和菜单项）：

```js
(() => {
  const groups = [...document.querySelectorAll("aside nav > div")].map((g) => ({
    name: g.querySelector("p")?.textContent.trim(),
    items: [...g.querySelectorAll("button")].map((b) => b.querySelector("span")?.textContent.trim()),
  }));
  return JSON.stringify({
    tenant: document.querySelector("aside button p")?.textContent.trim(),
    title: document.querySelector("header h1")?.textContent.trim(),
    groups,
  });
})()
```

创建 `/tmp/transonce-plan/ui/channels.js`（列出告警配置页上的通道卡片）：

```js
(() => {
  const main = document.querySelector("main");
  const cards = [...main.querySelectorAll("[data-slot=card]")].filter((c) => c.querySelector("[role=switch]"));
  const text = main.innerText;
  return JSON.stringify({
    title: document.querySelector("header h1")?.textContent.trim(),
    channels: cards.map((c) => ({
      name: c.querySelector("p.font-semibold")?.childNodes[0]?.textContent.trim(),
      masked: c.querySelector("p.font-mono")?.textContent.trim(),
      enabled: c.querySelector("[role=switch]")?.getAttribute("aria-checked"),
      subscribed: [...c.querySelectorAll("span.rounded-full")].filter((p) => p.className.includes("emerald")).map((p) => p.textContent.trim()),
      actions: [...c.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label")),
    })),
    leaksSecret: text.includes("access_token=smoke-token") || text.includes("SECsmokesecret"),
    hasRecent: text.includes("最近推送"),
  });
})()
```

- [ ] **Step 7: 启动开发服务器和假机器人**

```bash
(cd trans-once-web-ui && npm run dev > /tmp/transonce-plan/vite.log 2>&1 &)
```

```bash
perl -e 'select(undef,undef,undef,4)'; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3002/
```

预期：输出 `200`。

```bash
bash /tmp/transonce-plan/ui.sh bot start
```

预期：输出 `{"errcode": 0, "errmsg": "ok"}`。

- [ ] **Step 8: 核对侧边栏**

```bash
bash /tmp/transonce-plan/ui.sh open
bash /tmp/transonce-plan/ui.sh tenant
bash /tmp/transonce-plan/ui.sh eval /tmp/transonce-plan/ui/nav.js
```

预期：返回的 JSON 里 `tenant` 是 `冒烟测试租户`，`groups` 依次是：

| 分组 | 菜单项 |
|---|---|
| 总览 | 工作台 |
| 研发 | 项目管理、会议纪要、需求管理、研发管理、测试管理 |
| 交付 | 代码管理、持续集成、制品管理、部署管理 |
| 运维 | 运维监控、告警中心 |
| 配置 | 环境配置、告警配置 |
| 协作 | 智能体、团队管理 |

- [ ] **Step 9: 核对告警配置页**

```bash
bash /tmp/transonce-plan/ui.sh nav 告警配置
bash /tmp/transonce-plan/ui.sh eval /tmp/transonce-plan/ui/channels.js
```

预期：`title` 是 `告警配置`；`channels` 有冒烟留下的三个通道：

| name | enabled | subscribed |
|---|---|---|
| 冒烟钉钉通道 | `"true"` | 监控告警、手工问题 |
| 冒烟企微通道 | `"true"` | 监控告警、手工问题、状态变化 |
| 冒烟飞书通道 | `"true"` | 监控告警、手工问题、状态变化 |

另外每个通道的 `masked` 里都有 `••••••`，`actions` 依次是 `启用通道 {名称}`、`发送测试消息到 {名称}`、`编辑通道 {名称}`、`删除通道 {名称}`；`leaksSecret` 是 `false`；`hasRecent` 是 `true`。

- [ ] **Step 10: 核对新建、测试消息、编辑**

下面的命令里 `S` 是浏览器会话，每个 Bash 调用里都要先定义一次。按钮都用 `find role button` 加名字来点（`find text` 匹配不了带图标的按钮）。

```bash
S="agent-browser --session transonce-plan"
$S find role button click --name "新建通道" --exact
$S wait --text "Webhook 地址"
$S fill "#channel-name" "浏览器核对通道"
$S fill "#channel-webhook" "http://127.0.0.1:9901/fail"
$S fill "#channel-secret" "SECui"
$S check "#event-status"
$S find role button click --name "保存" --exact
$S wait --fn "!document.querySelector('#channel-name')"
$S wait --text "浏览器核对通道"
```

预期：两条等待都成功（弹窗关闭，页面上出现了「浏览器核对通道」的卡片）。

```bash
S="agent-browser --session transonce-plan"
$S find role button click --name "发送测试消息到 浏览器核对通道"
$S wait --text "测试消息发送失败：310000 keywords not in content"
```

预期：等待成功。假机器人在 `/fail` 上返回失败码，卡片上显示了原因。

```bash
S="agent-browser --session transonce-plan"
$S find role button click --name "编辑通道 浏览器核对通道"
$S wait --text "Webhook 地址"
$S get value "#channel-name"
$S get attr "#channel-webhook" placeholder
$S get attr "#channel-secret" placeholder
```

预期：依次输出 `浏览器核对通道`、`http://127.0.0.1:9901/••••••`、`••••••ui（留空保持不变）`（编辑框里不显示明文，只显示掩码）。

```bash
S="agent-browser --session transonce-plan"
$S fill "#channel-webhook" "http://127.0.0.1:9901/dingtalk"
$S find role button click --name "保存" --exact
$S wait --fn "!document.querySelector('#channel-name')"
$S find role button click --name "发送测试消息到 浏览器核对通道"
$S wait --text "测试消息已送达，请到群里确认。"
```

预期：两条等待都成功。地址改对以后，同一个通道发送成功；密钥留空所以保持不变。

- [ ] **Step 11: 核对启用开关、清除密钥、删除**

```bash
S="agent-browser --session transonce-plan"
$S find role switch click --name "启用通道 浏览器核对通道"
$S wait --fn "document.querySelector(\"button[aria-label='启用通道 浏览器核对通道']\").getAttribute('aria-checked') === 'false'"
$S reload
```

```bash
bash /tmp/transonce-plan/ui.sh nav 告警配置
S="agent-browser --session transonce-plan"
$S is checked "button[aria-label='启用通道 浏览器核对通道']"
```

预期：输出 `false`，刷新后停用状态还在（已经写进了数据库）。

```bash
S="agent-browser --session transonce-plan"
$S find role button click --name "发送测试消息到 浏览器核对通道"
$S wait --text "测试消息已送达，请到群里确认。"
$S find role switch click --name "启用通道 浏览器核对通道"
$S wait --fn "document.querySelector(\"button[aria-label='启用通道 浏览器核对通道']\").getAttribute('aria-checked') === 'true'"
$S is checked "button[aria-label='启用通道 浏览器核对通道']"
```

预期：停用的通道也能收到测试消息；等待成功，最后输出 `true`。

```bash
S="agent-browser --session transonce-plan"
$S find role button click --name "编辑通道 浏览器核对通道"
$S wait --text "Webhook 地址"
$S find role button click --name "清除已保存的密钥"
$S find role button click --name "保存" --exact
$S wait --fn "!document.querySelector('#channel-name')"
$S wait --text "未加签，请在机器人的安全设置里配置关键词"
```

预期：等待成功。清除密钥后卡片上的「已加签」变成了「未加签」。

```bash
S="agent-browser --session transonce-plan"
$S find role button click --name "删除通道 浏览器核对通道"
$S dialog accept
$S wait --fn "!document.querySelector(\"button[aria-label='编辑通道 浏览器核对通道']\")"
$S wait --text "浏览器核对通道（通道已删除）"
```

预期：两条等待都成功。卡片没了，「最近推送」里保留了它的记录并标了「通道已删除」。

- [ ] **Step 12: 核对没有权限的成员看不到入口**

下面的脚本只改浏览器内存里的当前租户权限，不改后端数据；刷新后恢复。

创建 `/tmp/transonce-plan/ui/noperm.js`：

```js
(async () => {
  // 必须拿应用自己加载的那份模块（热更新后地址带 ?t= 参数，否则会得到一份全新的空状态）。
  const url = performance.getEntriesByType("resource").map((r) => r.name).find((n) => n.includes("/src/lib/session.ts"));
  const s = await import(url);
  const t = s.getSession().currentTenant;
  s.selectTenant({ ...t, isTenantAdmin: false, isSuperAdmin: false, permissions: ["dashboard", "alerts", "environments"] });
  return "switched";
})()
```

```bash
S="agent-browser --session transonce-plan"
$S eval --stdin < /tmp/transonce-plan/ui/noperm.js
$S wait --fn "!document.querySelector('aside nav').innerText.includes('告警配置')"
bash /tmp/transonce-plan/ui.sh eval /tmp/transonce-plan/ui/nav.js
$S reload
```

预期：返回的 JSON 里 `groups` 只剩三项：总览（工作台）、运维（告警中心）、配置（环境配置）。有 `alerts` 没有 `alert.channel.manage` 的成员看不到「告警配置」。

- [ ] **Step 13: 看宽屏和窄屏的截图**

```bash
bash /tmp/transonce-plan/ui.sh nav 告警配置
bash /tmp/transonce-plan/ui.sh shot task8-alert-settings 1440
bash /tmp/transonce-plan/ui.sh shot task8-alert-settings-narrow 390
```

用读文件的工具打开这两张图。预期：通道卡片两列排布，窄屏变成一列，地址掩码和按钮没有被裁切。

```bash
bash /tmp/transonce-plan/ui.sh bot stop
```

- [ ] **Step 14: 提交**

```bash
git add trans-once-web-ui/src/components/common.tsx trans-once-web-ui/src/components/PlatformSettings.tsx trans-once-web-ui/src/views/AlertSettings.tsx trans-once-web-ui/src/App.tsx
git commit -m "ui: 告警配置页与侧边栏「配置」分组——通道增删改、启用开关、测试消息、最近推送"
```


### Task 9: 环境配置页的操作系统

**Files:**
- Modify: `trans-once-web-ui/src/views/Environments.tsx`（整文件替换）

**Interfaces:**
- Consumes: 任务 6 的 `osType`；任务 8 的 `Select`（支持 `id`）和 `statusLabel` 里的 `linux` / `windows`。
- Produces: 页面上的筛选下拉 `#env-os-filter`（值 `all` / `linux` / `windows`）；编辑弹窗里的 `#env-os`；编辑按钮 `aria-label="编辑环境 {名称}"`；环境卡片标题旁的操作系统标识。

- [ ] **Step 1: 改页面**

用下面的内容整体替换 `trans-once-web-ui/src/views/Environments.tsx`。相对原来的文件改了这些地方：安全约定下方多一行按操作系统筛选的下拉；卡片标题旁多一个操作系统标识；筛选后没有结果时给出空状态；编辑弹窗的第一行变成「环境名称 / 环境类型 / 操作系统」三栏，保存时带上 `osType`；编辑按钮加了 `aria-label`。

```tsx
import { useState } from "react";
import {
  Server, Plus, Pencil, Trash2, Eye, EyeOff, Loader2, ShieldAlert, KeyRound,
  Copy, Globe, RefreshCw, Lock,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, EmptyState, Pill, Select, Textarea, formatDate, statusLabel } from "../components/common";
import { Modal } from "../components/TeamSelect";
import { api } from "../services/api";
import { can, useSession } from "../lib/session";
import { refreshWorkspace, useWorkspace } from "../lib/store";
import type { Environment } from "../types";

export function Environments() {
  const tenant = useSession((s) => s.currentTenant)!;
  const environments = useWorkspace((s) => s.environments);
  const [editing, setEditing] = useState<Environment | null>(null);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [osFilter, setOsFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tid = tenant.tenant.id;
  const manage = can("env.manage");
  const canRead = can("secret.read");
  const osOf = (env: Environment) => env.osType ?? "linux";
  const shown = osFilter === "all" ? environments : environments.filter((e) => osOf(e) === osFilter);

  const reveal = async (env: Environment) => {
    setBusy(env.id);
    setError(null);
    try {
      const res = await api.environments.reveal(tid, env.id);
      setRevealed((r) => ({ ...r, [env.id]: res.password ?? "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (env: Environment) => {
    if (!confirm(`删除环境「${env.name}」？关联的监控与部署记录不会自动删除。`)) return;
    try {
      await api.environments.remove(tid, env.id);
      await refreshWorkspace();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="环境配置"
        description="环境 IP、账号和密码由人工维护并加密存储。Agent 永远读取不到明文密钥；查看密钥需要单独权限并会记录审计日志。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => refreshWorkspace()}><RefreshCw className="w-4 h-4 mr-2" /> 刷新</Button>
            {manage && <Button size="sm" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" /> 新建环境</Button>}
          </>
        }
      />

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</div>}

      <div className="rounded-lg border bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900 p-3 flex gap-2 text-xs text-amber-800 dark:text-amber-300">
        <ShieldAlert className="w-4 h-4 shrink-0" />
        <p>安全约定：环境凭证以 AES/HMAC 密钥加密落库；接口默认只返回掩码（••••••XX）。生产部署、查看密钥、修改环境均需要独立的敏感操作权限。</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>操作系统</span>
        <Select id="env-os-filter" value={osFilter} onChange={setOsFilter}>
          <option value="all">全部</option>
          <option value="linux">Linux</option>
          <option value="windows">Windows</option>
        </Select>
      </div>

      {!environments.length ? (
        <EmptyState icon={Server} title="还没有配置环境" description={manage ? "创建开发/测试/生产环境，供流水线部署与健康监控使用。" : "请联系租户管理员配置环境。"} action={
          manage ? <Button size="sm" className="mt-2" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" /> 新建环境</Button> : undefined
        } />
      ) : !shown.length ? (
        <EmptyState icon={Server} title={`没有 ${statusLabel[osFilter]} 环境`} description="把筛选改回「全部」可以查看所有环境。" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {shown.map((env) => (
            <Card key={env.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${env.kind === "production" ? "bg-rose-500/10 text-rose-600" : env.kind === "test" ? "bg-emerald-500/10 text-emerald-600" : "bg-blue-500/10 text-blue-600"}`}>
                    <Server className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-semibold flex items-center gap-2">{env.name}
                      <Pill tone={env.kind === "production" ? "rose" : env.kind === "test" ? "green" : "blue"}>{env.kind}</Pill>
                      <Pill tone="gray">{statusLabel[osOf(env)]}</Pill>
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">创建于 {formatDate(env.createdAt)}</p>
                  </div>
                </div>
                {manage && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`编辑环境 ${env.name}`} onClick={() => setEditing(env)}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => remove(env)}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground text-xs w-16">访问地址</span>
                  {env.baseUrl ? <a href={env.baseUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline text-xs truncate">{env.baseUrl}</a> : <span className="text-xs text-muted-foreground">未配置</span>}
                </div>
                <div className="flex items-center gap-2">
                  <Server className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground text-xs w-16">主机 IP</span>
                  <span className="text-xs font-mono">{env.ip || "未配置"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground text-xs w-16">账号</span>
                  <span className="text-xs font-mono">{env.username || "未配置"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <KeyRound className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground text-xs w-16">密码</span>
                  {revealed[env.id] !== undefined ? (
                    <span className="text-xs font-mono flex items-center gap-1">
                      {revealed[env.id] || "未设置"}
                      {revealed[env.id] && (
                        <button className="text-muted-foreground hover:text-foreground" onClick={() => navigator.clipboard?.writeText(revealed[env.id])}><Copy className="w-3 h-3" /></button>
                      )}
                      <button className="text-muted-foreground hover:text-foreground" onClick={() => setRevealed((r) => { const n = { ...r }; delete n[env.id]; return n; })}><EyeOff className="w-3 h-3" /></button>
                    </span>
                  ) : (
                    <span className="text-xs font-mono flex items-center gap-1.5">
                      {env.passwordMasked || "未设置"}
                      {canRead && env.hasPassword && (
                        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={busy === env.id} onClick={() => reveal(env)} title="查看密钥（会记录审计日志）">
                          {busy === env.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                        </Button>
                      )}
                    </span>
                  )}
                </div>
              </div>

              {env.config && Object.keys(env.config).length > 0 && (
                <div className="mt-3 pt-3 border-t flex flex-wrap gap-1.5">
                  {Object.entries(env.config).map(([k, v]) => (
                    <Pill key={k} tone="gray">{k}: {String(v)}</Pill>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <EnvironmentModal env={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={async () => { setCreating(false); setEditing(null); await refreshWorkspace(); }} />
      )}
    </div>
  );
}

function EnvironmentModal({ env, onClose, onSaved }: { env: Environment | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const tenant = useSession((s) => s.currentTenant)!;
  const [form, setForm] = useState({
    name: env?.name ?? "",
    kind: env?.kind ?? "test",
    osType: env?.osType ?? "linux",
    baseUrl: env?.baseUrl ?? "",
    ip: env?.ip ?? "",
    username: env?.username ?? "",
    password: "",
    note: (env?.config?.note as string) ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: form.name,
        kind: form.kind,
        osType: form.osType,
        baseUrl: form.baseUrl || null,
        ip: form.ip || null,
        username: form.username || null,
        password: form.password || undefined,
        config: form.note ? { note: form.note } : {},
      };
      if (env) await api.environments.update(tenant.tenant.id, env.id, body);
      else await api.environments.create(tenant.tenant.id, body);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={env ? `编辑环境：${env.name}` : "新建环境"} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-sm font-medium">环境名称</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" placeholder="例如：预发环境" />
          </div>
          <div>
            <label className="text-sm font-medium">环境类型</label>
            <Select value={form.kind} onChange={(v) => setForm({ ...form, kind: v as Environment["kind"] })} className="mt-1.5 w-full h-10">
              <option value="dev">开发</option>
              <option value="test">测试</option>
              <option value="staging">预发</option>
              <option value="production">生产</option>
            </Select>
          </div>
          <div>
            <label htmlFor="env-os" className="text-sm font-medium">操作系统</label>
            <Select id="env-os" value={form.osType} onChange={(v) => setForm({ ...form, osType: v as "linux" | "windows" })} className="mt-1.5 w-full h-10">
              <option value="linux">Linux</option>
              <option value="windows">Windows</option>
            </Select>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium">访问地址</label>
          <Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} className="mt-1.5" placeholder="https://app.example.com 或健康检查 URL" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">主机 IP</label>
            <Input value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} className="mt-1.5" placeholder="10.0.0.12" />
          </div>
          <div>
            <label className="text-sm font-medium">账号</label>
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="mt-1.5" placeholder="deploy" />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium">密码 {env && <span className="text-muted-foreground font-normal">（留空表示不修改）</span>}</label>
          <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-1.5" placeholder={env ? "••••••（保持不变）" : "加密存储，接口只返回掩码"} />
        </div>
        <div>
          <label className="text-sm font-medium">备注</label>
          <Textarea value={form.note} onChange={(v) => setForm({ ...form, note: v })} rows={2} placeholder="用途、负责人、维护窗口等" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={save} disabled={busy || !form.name.trim()}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "保存"}</Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: 类型检查和构建**

```bash
cd trans-once-web-ui && npm run lint
```

```bash
cd trans-once-web-ui && npm run build
```

预期：两条命令都以退出码 0 结束。

- [ ] **Step 3: 核对筛选**

开发服务器和浏览器会话沿用任务 8 的（如果已经停了，按任务 8 的 Step 7、Step 8 重新启动并登录）。创建 `/tmp/transonce-plan/ui/envs.js`（列出环境卡片）：

```js
(() => {
  const main = document.querySelector("main");
  const cards = [...main.querySelectorAll("[data-slot=card]")].filter((c) => c.querySelector("p.font-semibold"));
  return JSON.stringify({
    title: document.querySelector("header h1")?.textContent.trim(),
    filter: document.querySelector("#env-os-filter")?.value,
    empty: cards.length ? null : (main.innerText.split("\n").find((l) => l.startsWith("没有")) ?? null),
    envs: cards.map((c) => ({
      name: c.querySelector("p.font-semibold")?.childNodes[0]?.textContent.trim(),
      pills: [...c.querySelectorAll("p.font-semibold span.rounded-full")].map((p) => p.textContent.trim()),
      edit: c.querySelector("button[aria-label^='编辑环境']")?.getAttribute("aria-label"),
    })),
  });
})()
```

```bash
bash /tmp/transonce-plan/ui.sh nav 环境配置
bash /tmp/transonce-plan/ui.sh eval /tmp/transonce-plan/ui/envs.js
```

预期：`title` 是 `环境配置`，`filter` 是 `all`，`envs` 有两项：冒烟测试环境（`pills` 是 `["test","Linux"]`）和冒烟生产环境（`pills` 是 `["production","Linux"]`），`edit` 分别是 `编辑环境 冒烟测试环境`、`编辑环境 冒烟生产环境`。

```bash
S="agent-browser --session transonce-plan"
$S select "#env-os-filter" windows
bash /tmp/transonce-plan/ui.sh eval /tmp/transonce-plan/ui/envs.js
```

预期：`filter` 是 `windows`，`empty` 是 `没有 Windows 环境`，`envs` 是空数组。

```bash
S="agent-browser --session transonce-plan"
$S select "#env-os-filter" linux
bash /tmp/transonce-plan/ui.sh eval /tmp/transonce-plan/ui/envs.js
$S select "#env-os-filter" all
```

预期：选 Linux 时 `envs` 仍是上面两项；最后把筛选改回「全部」。

- [ ] **Step 4: 核对修改操作系统**

```bash
S="agent-browser --session transonce-plan"
$S find role button click --name "编辑环境 冒烟测试环境"
$S wait "#env-os"
$S get value "#env-os"
$S select "#env-os" windows
$S find role button click --name "保存" --exact
$S wait --fn "[...document.querySelectorAll('main p.font-semibold span.rounded-full')].some((p) => p.textContent.trim() === 'Windows')"
bash /tmp/transonce-plan/ui.sh eval /tmp/transonce-plan/ui/envs.js
```

预期：`get value` 输出 `linux`（已有环境缺省是 Linux）；保存后等待成功；冒烟测试环境的 `pills` 变成 `["test","Windows"]`。

```bash
S="agent-browser --session transonce-plan"
$S find role button click --name "编辑环境 冒烟测试环境"
$S wait "#env-os"
$S select "#env-os" linux
$S find role button click --name "保存" --exact
$S wait --fn "[...document.querySelectorAll('main p.font-semibold span.rounded-full')].every((p) => p.textContent.trim() !== 'Windows')"
bash /tmp/transonce-plan/ui.sh eval /tmp/transonce-plan/ui/envs.js
```

预期：等待成功，冒烟测试环境的 `pills` 回到 `["test","Linux"]`。

- [ ] **Step 5: 看宽屏和窄屏的截图**

```bash
bash /tmp/transonce-plan/ui.sh shot task9-environments 1440
```

```bash
bash /tmp/transonce-plan/ui.sh shot task9-environments-narrow 390
```

用读文件的工具打开这两张图。预期：筛选下拉在安全约定下方；卡片标题旁有 Linux 标识；窄屏一列排布。

- [ ] **Step 6: 提交**

```bash
git add trans-once-web-ui/src/views/Environments.tsx
git commit -m "ui: 环境配置增加操作系统——表单下拉、卡片标识与筛选"
```


### Task 10: 告警中心的录入问题、筛选与重发

**Files:**
- Modify: `trans-once-web-ui/src/views/Alerts.tsx`（整文件替换）
- Modify: `trans-once-web-ui/src/views/Dashboard.tsx`（`activityLabels` 补上新的审计事件）

**Interfaces:**
- Consumes: 任务 4 的 `POST /alerts`、`POST /alerts/{id}/resend` 和列表里的新字段；任务 7 的 `api.alerts.create` / `resend`、`Alert` 的新字段；任务 8 的 `alertProviderLabel`。
- Produces（页面上的定位标识）: 页头按钮「录入问题」；弹窗里的 `#issue-title`、`#issue-severity`、`#issue-environment`、`#issue-monitor`、`#issue-push`，成员按钮的 `aria-label` 是 `通知 {姓名}`；筛选下拉 `#alert-source`（值 `all` / `monitor` / `manual`）和复选框 `#alerts-mine`；卡片上「重发」按钮的 `aria-label` 是 `重发告警 {标题}`。

- [ ] **Step 1: 重写告警中心页**

用下面的内容整体替换 `trans-once-web-ui/src/views/Alerts.tsx`。相对原来的文件改了这些地方：页头多了「录入问题」按钮和结果提示；筛选多了「来源」和「只看通知了我的」；卡片多了来源标识、录入人或监控、关联环境、通知人员和每个通道最近一次的推送结果；多了「重发」按钮；新增录入问题的弹窗组件 `IssueModal`。

```tsx
import { useMemo, useState } from "react";
import {
  Bell, BellRing, CheckCircle2, ShieldAlert, Loader2, RefreshCw, Clock,
  MonitorCheck, Bot, Plus, Send, Server, User, UserPlus, XCircle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PageHeader, EmptyState, StatCard, StatusPill, Pill, Select, Textarea, formatDate, timeAgo, statusLabel,
  alertProviderLabel,
} from "../components/common";
import { Modal } from "../components/common";
import { api } from "../services/api";
import { useSession } from "../lib/session";
import { askAgent, refreshWorkspace, useWorkspace } from "../lib/store";
import type { Alert, AlertDelivery } from "../types";

// 推送记录按时间倒序，每个通道只留最近一条，卡片上显示「每个通道的推送结果」。
function latestPerChannel(deliveries: AlertDelivery[]): AlertDelivery[] {
  const seen = new Set<string>();
  const out: AlertDelivery[] = [];
  for (const d of deliveries ?? []) {
    const key = d.channelId ?? d.channelName;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

export function Alerts() {
  const tenant = useSession((s) => s.currentTenant)!;
  const user = useSession((s) => s.user);
  const alerts = useWorkspace((s) => s.alerts);
  const detail = useWorkspace((s) => s.detail);
  const channels = useWorkspace((s) => s.alertChannels);
  const [status, setStatus] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [source, setSource] = useState("all");
  const [mine, setMine] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const tid = tenant.tenant.id;
  const myId = user?.id;

  const filtered = useMemo(() => alerts.filter((a) => {
    if (status !== "all" && a.status !== status) return false;
    if (severity !== "all" && a.severity !== severity) return false;
    if (source !== "all" && (a.source ?? "monitor") !== source) return false;
    if (mine && !(a.notifiedUsers ?? []).some((u) => u.id === myId)) return false;
    return true;
  }), [alerts, status, severity, source, mine, myId]);

  const update = async (id: string, next: "acknowledged" | "resolved" | "open") => {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      await api.alerts.update(tid, id, next);
      await refreshWorkspace();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const resend = async (a: Alert) => {
    const key = `resend-${a.id}`;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await api.alerts.resend(tid, a.id);
      await refreshWorkspace();
      const total = res.deliveries.length;
      const sent = res.deliveries.filter((d) => d.status === "sent").length;
      setNotice(
        total === 0
          ? "没有符合条件（启用且已订阅）的通道，这次没有推送。可以到「告警配置」里检查通道。"
          : sent === total
            ? `已重新推送到 ${sent} 个群。`
            : `重新推送：${sent} 个群成功，${total - sent} 个失败，原因见卡片。`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // 录入成功后的提示：按实际的推送结果说话。
  const saved = async (created: Alert, push: boolean) => {
    const deliveries = created.deliveries ?? [];
    const sent = deliveries.filter((d) => d.status === "sent").length;
    setCreating(false);
    await refreshWorkspace();
    setNotice(
      !push || deliveries.length === 0
        ? "问题已录入，未推送到群。"
        : sent === 0
          ? "问题已录入，但推送到群失败，原因见卡片，可以在卡片上重发。"
          : `问题已录入，已推送到 ${sent} 个群${sent < deliveries.length ? `，${deliveries.length - sent} 个失败，可以在卡片上重发` : ""}。`,
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="告警中心"
        description="监控失败会生成告警，也可以手工录入问题并通知相关成员；确认与解决动作会记录处理人和时间，形成运维闭环。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => refreshWorkspace()}><RefreshCw className="w-4 h-4 mr-2" /> 刷新</Button>
            <Button size="sm" onClick={() => { setNotice(null); setError(null); setCreating(true); }}><Plus className="w-4 h-4 mr-2" /> 录入问题</Button>
          </>
        }
      />

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</div>}
      {notice && <div className="text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 rounded-lg px-4 py-2">{notice}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Bell} label="全部告警" value={alerts.length} tone="blue" />
        <StatCard icon={BellRing} label="未处理" value={alerts.filter((a) => a.status === "open").length} tone={alerts.some((a) => a.status === "open") ? "amber" : "default"} />
        <StatCard icon={Clock} label="已确认" value={alerts.filter((a) => a.status === "acknowledged").length} tone="violet" />
        <StatCard icon={CheckCircle2} label="已解决" value={alerts.filter((a) => a.status === "resolved").length} tone="emerald" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onChange={setStatus}>
          <option value="all">全部状态</option>
          <option value="open">未处理</option>
          <option value="acknowledged">已确认</option>
          <option value="resolved">已解决</option>
        </Select>
        <Select value={severity} onChange={setSeverity}>
          <option value="all">全部级别</option>
          <option value="critical">严重</option>
          <option value="warning">警告</option>
          <option value="info">提示</option>
        </Select>
        <Select id="alert-source" value={source} onChange={setSource}>
          <option value="all">全部来源</option>
          <option value="monitor">监控告警</option>
          <option value="manual">手工录入</option>
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input id="alerts-mine" type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> 只看通知了我的
        </label>
      </div>

      {!filtered.length ? (
        <EmptyState
          icon={Bell}
          title={alerts.length ? "没有匹配的告警" : "暂无告警"}
          description={alerts.length ? "调整筛选条件试试。" : "所有监控运行正常。监控失败时告警会自动出现在这里，也可以点「录入问题」手工记录。"}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((a) => {
            const latest = latestPerChannel(a.deliveries);
            const notified = a.notifiedUsers ?? [];
            return (
              <Card key={a.id} className={`p-4 ${a.status === "open" ? "border-l-4 border-l-amber-400" : a.status === "resolved" ? "opacity-70" : ""}`}>
                <div className="flex flex-wrap items-start gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${a.severity === "critical" ? "bg-rose-500/10 text-rose-600" : a.severity === "warning" ? "bg-amber-500/10 text-amber-600" : "bg-blue-500/10 text-blue-600"}`}>
                    <ShieldAlert className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-[200px]">
                    <p className="text-sm font-semibold flex flex-wrap items-center gap-2">
                      {a.title}
                      <Pill tone={a.severity === "critical" ? "rose" : a.severity === "warning" ? "amber" : "blue"}>{statusLabel[a.severity] ?? a.severity}</Pill>
                      <StatusPill status={a.status} />
                      <Pill tone={a.source === "manual" ? "violet" : "gray"}>{a.source === "manual" ? "手工录入" : "监控告警"}</Pill>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{a.detail || "无详细说明"}</p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-[11px] text-muted-foreground">
                      {a.source === "manual" ? (
                        <span className="flex items-center gap-1"><User className="w-3 h-3" />{a.createdByName ?? "成员"} 录入</span>
                      ) : (
                        <span className="flex items-center gap-1"><MonitorCheck className="w-3 h-3" />{a.monitorName ?? "未知监控"}</span>
                      )}
                      {a.environmentName && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-1"><Server className="w-3 h-3" />{a.environmentName}</span>
                        </>
                      )}
                      {notified.length > 0 && (
                        <>
                          <span>·</span>
                          <span className="flex flex-wrap items-center gap-1">
                            <UserPlus className="w-3 h-3" />通知：{notified.map((u) => u.name).join("、")}
                            {notified.some((u) => u.id === myId) && <Pill tone="amber">含我</Pill>}
                          </span>
                        </>
                      )}
                      <span>·</span>
                      <span>{formatDate(a.createdAt)}（{timeAgo(a.createdAt)}）</span>
                      {a.resolvedAt && <><span>·</span><span>解决于 {formatDate(a.resolvedAt)}</span></>}
                    </div>
                    {latest.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {latest.map((d) => (
                          <span
                            key={d.id}
                            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] break-all ${d.status === "sent" ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300" : "border-rose-500/30 text-rose-700 dark:text-rose-300"}`}
                          >
                            {d.status === "sent" ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : <XCircle className="w-3 h-3 shrink-0" />}
                            {alertProviderLabel[d.provider] ?? d.provider} · {d.channelName}{d.channelId ? "" : "（通道已删除）"}
                            {d.status === "sent" ? "" : `：${d.error ?? "失败"}`}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {a.status === "open" && (
                      <Button size="sm" variant="outline" disabled={busy === a.id} onClick={() => update(a.id, "acknowledged")}>
                        {busy === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "确认"}
                      </Button>
                    )}
                    {a.status !== "resolved" && (
                      <Button size="sm" disabled={busy === a.id} onClick={() => update(a.id, "resolved")}>
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> 解决
                      </Button>
                    )}
                    {a.status !== "open" && (
                      <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => update(a.id, "open")}>重新打开</Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === `resend-${a.id}`}
                      onClick={() => resend(a)}
                      aria-label={`重发告警 ${a.title}`}
                    >
                      {busy === `resend-${a.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} 重发
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => askAgent("汇总当前告警，按影响面排序并给出处置步骤")}>
          <Bot className="w-4 h-4 mr-2" /> 让 Agent 汇总告警
        </Button>
      </div>

      {creating && (
        <IssueModal
          onClose={() => setCreating(false)}
          onSaved={saved}
          members={(detail?.members ?? []).filter((m) => m.status === "active" && m.userId)}
          canPush={channels.some((c) => c.enabled && c.events?.manual)}
        />
      )}
    </div>
  );
}

function IssueModal({
  members, canPush, onClose, onSaved,
}: {
  members: { userId: string; name: string }[];
  // 没有任何启用中的通道订阅「手工问题」时，推送选项置灰。
  canPush: boolean;
  onClose: () => void;
  onSaved: (created: Alert, push: boolean) => Promise<void>;
}) {
  const tenant = useSession((s) => s.currentTenant)!;
  const environments = useWorkspace((s) => s.environments);
  const monitors = useWorkspace((s) => s.monitors);
  const [form, setForm] = useState({
    title: "",
    severity: "warning",
    environmentId: "",
    monitorId: "",
    detail: "",
    notified: [] as string[],
    push: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggleMember = (id: string) =>
    setForm((f) => ({ ...f, notified: f.notified.includes(id) ? f.notified.filter((x) => x !== id) : [...f.notified, id] }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const push = canPush && form.push;
      const created = await api.alerts.create(tenant.tenant.id, {
        title: form.title.trim(),
        severity: form.severity as Alert["severity"],
        detail: form.detail.trim() || undefined,
        environmentId: form.environmentId || undefined,
        monitorId: form.monitorId || undefined,
        notifiedUserIds: form.notified,
        push,
      });
      await onSaved(created, push);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="录入问题" onClose={onClose} wide>
      <div className="space-y-3">
        <div>
          <label htmlFor="issue-title" className="text-sm font-medium">标题</label>
          <Input id="issue-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1.5 h-10" placeholder="一句话说明出了什么问题" maxLength={200} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="issue-severity" className="text-sm font-medium">级别</label>
            <Select id="issue-severity" value={form.severity} onChange={(v) => setForm({ ...form, severity: v })} className="mt-1.5 w-full h-10">
              <option value="info">提示</option>
              <option value="warning">警告</option>
              <option value="critical">严重</option>
            </Select>
          </div>
          <div>
            <label htmlFor="issue-environment" className="text-sm font-medium">关联环境</label>
            <Select id="issue-environment" value={form.environmentId} onChange={(v) => setForm({ ...form, environmentId: v })} className="mt-1.5 w-full h-10">
              <option value="">不关联</option>
              {environments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </div>
          <div>
            <label htmlFor="issue-monitor" className="text-sm font-medium">关联监控</label>
            <Select
              id="issue-monitor"
              value={form.monitorId}
              onChange={(v) => {
                const monitor = monitors.find((m) => m.id === v);
                // 监控关联了环境就一并带上，之后仍然可以改。
                setForm((f) => ({ ...f, monitorId: v, environmentId: f.environmentId || monitor?.environmentId || "" }));
              }}
              className="mt-1.5 w-full h-10"
            >
              <option value="">不关联</option>
              {monitors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </div>
        </div>
        <label className="block text-sm font-medium">
          详细说明
          <Textarea value={form.detail} onChange={(v) => setForm({ ...form, detail: v })} rows={3} placeholder="现象、影响范围、已经做过的排查" className="mt-1.5" />
        </label>
        <div>
          <p className="text-sm font-medium">
            通知人员 <span className="text-muted-foreground font-normal">（可多选。被通知的人可以用「只看通知了我的」找到这条问题）</span>
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {members.map((m) => {
              const on = form.notified.includes(m.userId);
              return (
                <button
                  key={m.userId}
                  type="button"
                  aria-pressed={on}
                  aria-label={`通知 ${m.name}`}
                  onClick={() => toggleMember(m.userId)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            id="issue-push"
            type="checkbox"
            className="mt-0.5"
            checked={canPush && form.push}
            disabled={!canPush}
            onChange={(e) => setForm({ ...form, push: e.target.checked })}
          />
          <span>
            同时推送到群
            {!canPush && <span className="block text-xs text-muted-foreground">没有启用中的通道订阅「手工问题」，保存后只会出现在告警中心。</span>}
          </span>
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={save} disabled={busy || !form.title.trim()}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "录入"}</Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: 工作台时间线补标签**

在 `trans-once-web-ui/src/views/Dashboard.tsx` 的 `activityLabels` 里，把 `  "alert.updated": "处理了告警",` 这一行之后加入：

```ts
  "alert.created": "录入了问题",
  "alert.resent": "重发了告警",
  "alert.channel.created": "创建了告警通道",
  "alert.channel.updated": "更新了告警通道",
  "alert.channel.deleted": "删除了告警通道",
  "alert.channel.tested": "发送了告警测试消息",
```

- [ ] **Step 3: 类型检查和构建**

```bash
cd trans-once-web-ui && npm run lint
```

```bash
cd trans-once-web-ui && npm run build
```

预期：两条命令都以退出码 0 结束。

- [ ] **Step 4: 准备浏览器核对**

开发服务器和浏览器会话沿用任务 9 的。创建 `/tmp/transonce-plan/ui/alerts.js`（列出告警卡片）：

```js
(() => {
  const main = document.querySelector("main");
  const cards = [...main.querySelectorAll("[data-slot=card]")].filter((c) => c.querySelector("p.text-sm.font-semibold"));
  return JSON.stringify({
    title: document.querySelector("header h1")?.textContent.trim(),
    notice: main.innerText.split("\n").find((l) => /^(问题已录入|重新推送|没有符合条件)/.test(l)) ?? null,
    empty: cards.length ? null : (main.innerText.split("\n").find((l) => l.startsWith("没有匹配")) ?? null),
    cards: cards.map((c) => ({
      title: c.querySelector("p.text-sm.font-semibold")?.childNodes[0]?.textContent.trim(),
      pills: [...c.querySelectorAll("p.text-sm.font-semibold span.rounded-full")].map((p) => p.textContent.trim()),
      meta: c.querySelector("div.text-\\[11px\\]")?.textContent.replace(/\s+/g, " ").trim(),
      deliveries: [...c.querySelectorAll("span.rounded-md")].map((s) => s.textContent.trim()),
      resend: c.querySelector("button[aria-label^='重发告警']")?.getAttribute("aria-label"),
    })),
  });
})()
```

创建 `/tmp/transonce-plan/ui/activity.js`（看工作台时间线上有没有新标签）：

```js
(() => {
  const text = document.querySelector("main").innerText;
  return JSON.stringify({
    labels: ["录入了问题", "重发了告警", "创建了告警通道", "更新了告警通道", "删除了告警通道", "发送了告警测试消息"]
      .filter((k) => text.includes(k)),
    raw: /\balert\.[a-z.]+/.test(text),
  });
})()
```

启动假机器人，并通过界面建一个指向它的通道（任务 8 结束时已经把上一个核对通道删掉了）：

```bash
bash /tmp/transonce-plan/ui.sh bot start
bash /tmp/transonce-plan/ui.sh nav 告警配置
S="agent-browser --session transonce-plan"
$S find role button click --name "新建通道" --exact
$S wait "#channel-webhook"
$S fill "#channel-name" "浏览器核对通道"
$S fill "#channel-webhook" "http://127.0.0.1:9901/dingtalk"
$S find role button click --name "保存" --exact
$S wait --fn "!document.querySelector('#channel-webhook')"
```

预期：假机器人返回 `{"errcode": 0, "errmsg": "ok"}`；保存后弹窗关闭。新通道默认订阅「监控告警」和「手工问题」。

- [ ] **Step 5: 核对录入问题**

```bash
bash /tmp/transonce-plan/ui.sh nav 告警中心
S="agent-browser --session transonce-plan"
$S find role button click --name "录入问题" --exact
$S wait "#issue-title"
$S is enabled "#issue-push"
$S is checked "#issue-push"
```

预期：两条 `is` 都输出 `true`。冒烟租户里有启用中、订阅了「手工问题」的通道，所以「同时推送到群」可以勾选，默认勾选。

```bash
S="agent-browser --session transonce-plan"
$S fill "#issue-title" "浏览器核对：手工录入"
$S select "#issue-environment" "冒烟测试环境"
$S find role button click --name "通知 超级管理员" --exact
$S find role button click --name "通知 冒烟产品" --exact
bash /tmp/transonce-plan/ui.sh shot task10-issue-modal 1440
S="agent-browser --session transonce-plan"
$S find role button click --name "录入" --exact
$S wait --text "问题已录入，已推送到 1 个群，3 个失败，可以在卡片上重发。"
```

预期：等待成功，页头下方出现这条绿色的结果提示。「超级管理员」是当前登录的超管在冒烟租户里的姓名；如果这台开发库里超管改过姓名，换成实际的姓名。提示里是 1 个成功、3 个失败：新建的通道指向假机器人所以成功，冒烟留下的三个通道指向上一轮冒烟启动的假机器人（已经退出）所以失败，正好看到「部分失败」的提示。

```bash
bash /tmp/transonce-plan/ui.sh eval /tmp/transonce-plan/ui/alerts.js
```

预期：`notice` 是上面那条提示；`cards[0]` 是：

- `title`：`浏览器核对：手工录入`
- `pills`：`["警告","未处理","手工录入"]`
- `meta`：以 `超级管理员 录入·冒烟测试环境·通知：超级管理员、冒烟产品含我·` 开头，后面是时间
- `deliveries`：四项，第一项是 `钉钉 · 浏览器核对通道`，其余三项（冒烟飞书通道、冒烟企微通道、冒烟钉钉通道）以连接失败的原因结尾（macOS 上是 `URLError: <urlopen error [Errno 61] Connection refused>`）
- `resend`：`重发告警 浏览器核对：手工录入`

用读文件的工具打开 `/tmp/transonce-plan/shots/task10-issue-modal.png`，看一眼录入问题的弹窗。

- [ ] **Step 6: 核对筛选**

```bash
S="agent-browser --session transonce-plan"
$S select "#alert-source" "手工录入"
bash /tmp/transonce-plan/ui.sh eval /tmp/transonce-plan/ui/alerts.js
```

预期：`cards` 里只剩手工录入的卡片（除了新录入的这条，还有冒烟夹具「冒烟：手工录入的问题」），没有监控告警卡片。

```bash
S="agent-browser --session transonce-plan"
$S select "#alert-source" "全部来源"
$S check "#alerts-mine"
bash /tmp/transonce-plan/ui.sh eval /tmp/transonce-plan/ui/alerts.js
$S uncheck "#alerts-mine"
```

预期：勾上「只看通知了我的」后 `cards` 只剩这一条（通知人员里有当前登录的超管）。

- [ ] **Step 7: 核对重发和解决**

```bash
S="agent-browser --session transonce-plan"
$S find role button click --name "重发告警 浏览器核对：手工录入"
$S wait --text "重新推送：1 个群成功，3 个失败，原因见卡片。"
$S find role button click --name "解决" --exact
$S wait --fn "document.querySelector('main [data-slot=card] p.text-sm.font-semibold')?.textContent.includes('已解决')"
```

预期：两条等待都成功。重发后的提示同样是 1 个成功、3 个失败；解决后第一条卡片的标识变成「已解决」。

- [ ] **Step 8: 核对没有可用通道时的录入弹窗**

下面的命令在浏览器里把通道列表的响应临时替换成空数组（只影响这个浏览器标签页，不改后端数据），用来看「没有通道」时的表现。

```bash
S="agent-browser --session transonce-plan"
$S network route "**/alert-channels" --body "[]"
$S reload
```

```bash
bash /tmp/transonce-plan/ui.sh nav 告警中心
S="agent-browser --session transonce-plan"
$S find role button click --name "录入问题" --exact
$S wait "#issue-title"
$S is enabled "#issue-push"
$S is checked "#issue-push"
$S wait --text "没有启用中的通道订阅「手工问题」，保存后只会出现在告警中心。"
bash /tmp/transonce-plan/ui.sh shot task10-issue-nochannel 1440
$S network unroute "**/alert-channels"
$S reload
```

预期：两条 `is` 都输出 `false`（选项置灰、未勾选），提示文字出现。最后取消替换并刷新，恢复真实数据。

- [ ] **Step 9: 看告警中心的截图，清理核对用的通道**

```bash
bash /tmp/transonce-plan/ui.sh nav 告警中心
bash /tmp/transonce-plan/ui.sh shot task10-alerts 1440
```

```bash
bash /tmp/transonce-plan/ui.sh shot task10-alerts-narrow 390
```

用读文件的工具打开这两张图。预期：卡片上来源、级别、状态标识在一行；下一行是录入人、环境、通知人员和「含我」；再下面是每个通道的推送结果，失败的原因直接跟在通道名后面；窄屏下这些都自动换行，操作按钮没有被裁切。

```bash
bash /tmp/transonce-plan/ui.sh nav 告警配置
S="agent-browser --session transonce-plan"
$S find role button click --name "删除通道 浏览器核对通道"
$S dialog accept
$S wait --fn "!document.querySelector(\"button[aria-label='编辑通道 浏览器核对通道']\")"
bash /tmp/transonce-plan/ui.sh bot stop
```

预期：等待成功（核对用的通道已删除），假机器人停掉。

- [ ] **Step 10: 核对工作台时间线**

```bash
bash /tmp/transonce-plan/ui.sh nav 工作台
bash /tmp/transonce-plan/ui.sh eval /tmp/transonce-plan/ui/activity.js
```

预期：`labels` 至少包含 `录入了问题`、`重发了告警`、`创建了告警通道`、`删除了告警通道`（时间线只显示最近 60 条，其余几个不一定在范围内）；`raw` 是 `false`，也就是没有露出 `alert.…` 这样的原始事件名。

- [ ] **Step 11: 收尾**

```bash
kill $(lsof -nP -ti tcp:3002 -sTCP:LISTEN)
```

```bash
bash /tmp/transonce-plan/ui.sh close
lsof -nP -iTCP:3002 -sTCP:LISTEN | wc -l
```

预期：输出 `0`。开发服务器停掉了（它占着固定的 3002 端口，不停会影响你自己启动），浏览器会话关闭。

- [ ] **Step 12: 提交**

```bash
git add trans-once-web-ui/src/views/Alerts.tsx trans-once-web-ui/src/views/Dashboard.tsx
git commit -m "ui: 告警中心支持录入问题——选人通知、来源与「通知了我的」筛选、推送结果与重发"
```



### Task 11: 文档与最终验证

**Files:**
- Modify: `README.md`（功能列表、目录说明、权限、测试、接口表）
- Modify: `TRANS.md`（测试命令、后端模块、迁移链）
- Modify: `CLAUDE.md`（测试方式）

**Interfaces:**
- Consumes: 任务 1 到 10 的全部成果。
- Produces: 无代码变化。

- [ ] **Step 1: 跑全部检查**

```bash
python3 trans-once/tests/notifiers_flow.py
```

```bash
python3 trans-once/tests/microsoft_flow.py
```

预期：前者输出 `33/33 checks passed` 和 `All notifiers checks passed ✓`；后者以成功状态结束。

```bash
python3 trans-once/tests/smoke.py
```

```bash
python3 trans-once/tests/smoke.py
```

预期：两遍都以 `All smoke checks passed ✓` 结尾，输出 `156/156 checks passed`（原有的 93 项加告警一节的 63 项）。

说明两点。第一，完整冒烟里的「会议提取预览」要调用真实的模型。如果它因为模型返回的内容不是 JSON 而失败（`需求提取失败: Agent 未返回可解析的 JSON`），和这次改动无关：重跑一遍，并在汇报里说明。第二，如果第二遍输出的数字不是 `156`，说明原有的检查项数和文档里写的 93 对不上。以实际数字为准，把下一步文档里的 `156` 换成它，并在汇报里说明。

- [ ] **Step 2: 前端类型检查和构建**

```bash
cd trans-once-web-ui && npm run lint
```

```bash
cd trans-once-web-ui && npm run build
```

预期：两条命令都以退出码 0 结束。

- [ ] **Step 3: 更新 README**

在 `README.md` 里做十一处改动：把一行（或一段）原文替换成下面的新文字，或者在它之后加入新的一行。

第一处，功能列表里「租户级 RBAC」这一行，把括号里的 `监控维护、代码库管理/审批` 改成 `监控维护、告警通道配置、代码库管理/审批`。

第二处，在「完整交付链」这一行（以 `- **完整交付链**：` 开头）之后加入一行：

```markdown
- **告警通知**：在「配置 → 告警配置」里添加钉钉 / 企业微信 / 飞书群机器人通道，监控告警、手工录入的问题和状态变化自动推送到群；推送记录可查、失败可重发。有告警中心权限的成员可以录入问题并指定要通知的人。环境配置可以标注操作系统（Linux / Windows）。
```

第三处，目录说明里 `  src/views/              # 工作台、项目、需求、代码管理、制品、流水线、环境、监控、告警、智能体` 这一行，把结尾的 `监控、告警、智能体` 改成 `监控、告警、告警配置、智能体`。

第四处，目录说明里 `  net_guard.py            # 监控 URL 出站校验（防内网探测）` 这一行之后加入两行：

```markdown
  notifiers.py            # 告警消息：钉钉 / 企业微信 / 飞书的消息体、加签、发送（不碰数据库）
  alert_notify.py         # 告警推送：筛选通道、并行发送、写推送记录
```

第五处，目录说明里这一行：

```markdown
  migrations/versions/    # 0001 初始链路 … 0009 微软登录（多租户 + RBAC + Agent + 平台表）
```

改成：

```markdown
  migrations/versions/    # 0001 初始链路 … 0010 告警通知（多租户 + RBAC + Agent + 平台表 + 告警通道）
```

第六处，目录说明里 `  tests/microsoft_flow.py # 微软登录回调离线测试` 这一行之后加入一行：

```markdown
  tests/notifiers_flow.py # 告警消息（签名 / 消息体 / 掩码 / 发送）离线测试
```

第七处，「权限模型」里「敏感操作」这一行的结尾 `` `repo.approve`（审批代码库权限） `` 改成 `` `repo.approve`（审批代码库权限）、`alert.channel.manage`（告警通道配置） ``。

第八处，「验证」一节的代码块里，`python3 trans-once/tests/microsoft_flow.py` 这一行之后加入：

```bash

# 告警消息离线测试（不联网、不连数据库）
python3 trans-once/tests/notifiers_flow.py
```

第九处，「验证」一节里以 `` `trans-once/tests/smoke.py` 覆盖健康检查 `` 开头的那句话，整句（到 `且不会创建或删除业务实体。` 为止）替换成：

```markdown
`trans-once/tests/smoke.py` 覆盖健康检查、登录、租户成员关系、未知租户拒绝、工作台统计、原型 JSON 有效性、角色权限边界、环境密钥掩码/查看、生产部署闸门、监控检查、告警通道与群推送（钉钉 / 企业微信 / 飞书，内置假机器人）、手工录入问题与重发、监控告警联动、环境操作系统、Agent 对话、会议提取预览与权限目录、个人设置自助、登录方式配置开关、微软登录 URL 构建与通用 OIDC 全链路（内置迷你 IdP：发现→授权→回调→自动注册），共 156 项检查。冒烟脚本会一次性创建并重复使用自己需要的夹具（冒烟租户、账号、环境、告警通道等），除此之外只读；只跑告警一节用 `SMOKE_ONLY=alerts python3 trans-once/tests/smoke.py`。
```

第十处，「主要 API」的表格里，`| 监控/告警 |` 这一行替换成下面两行：

```markdown
| 监控/告警 | `/monitors`、`/monitors/{id}/check`、`/monitors/check-all`、`/alerts`、`POST /alerts`（录入问题）、`PATCH /alerts/{id}`、`POST /alerts/{id}/resend`（重发） |
| 告警通道 | `GET/POST /alert-channels`、`PATCH/DELETE /alert-channels/{id}`、`POST /alert-channels/{id}/test`、`GET /alert-channels/deliveries`（地址和密钥只返回掩码） |
```

第十一处，「当前阶段」的「已完成」一行里，把 `监控告警、审计时间线、` 改成 `监控告警、告警通知（钉钉 / 企业微信 / 飞书群机器人）、审计时间线、`。

- [ ] **Step 4: 更新 TRANS.md**

在 `TRANS.md` 里做三处改动。

第一处，`## Commands` 的代码块里，「测试」这三行替换成：

```bash
# 测试（冒烟需后端已启动并完成种子）
python3 trans-once/tests/smoke.py          # 端到端冒烟，156 项检查（SMOKE_ONLY=alerts 只跑告警一节）
python3 trans-once/tests/microsoft_flow.py # 微软登录回调离线测试
python3 trans-once/tests/notifiers_flow.py # 告警消息离线测试（签名 / 消息体 / 掩码 / 发送）
```

第二处，`## Architecture` 里以 `` `trans-once/` 后端：`` 开头的那一行，把结尾的这句 `` `oidc_client.py`、`platform_settings.py`、`net_guard.py` 为外部集成。 `` 改成 `` `oidc_client.py`、`platform_settings.py`、`net_guard.py` 为外部集成；`notifiers.py`（告警消息渲染、加签、发送）和 `alert_notify.py`（筛选通道、并行推送、写推送记录）负责告警通知。``

第三处，同一节里 `` `trans-once/migrations/versions/`：`0001` 初始链路 → `0009` 微软登录； `` 改成 `` `trans-once/migrations/versions/`：`0001` 初始链路 → `0010` 告警通知； ``。

- [ ] **Step 5: 更新 CLAUDE.md**

在 `CLAUDE.md` 的「测试方式」里做两处改动。

第一处，`python3 trans-once/tests/smoke.py` 这一条（从 `  - `python3 trans-once/tests/smoke.py`` 到 `可对开发库安全执行。`）替换成：

```markdown
  - `python3 trans-once/tests/smoke.py` — 需先启动后端（:9005）并完成种子；156 项检查。脚本会一次性创建并重复使用自己需要的夹具（冒烟租户、账号、环境、告警通道等），除此之外只读，可对开发库安全执行；`SMOKE_ONLY=alerts` 只跑告警一节。
```

第二处，在 `python3 trans-once/tests/microsoft_flow.py` 这一条之后加入一条：

```markdown
  - `python3 trans-once/tests/notifiers_flow.py` — 离线（不联网、不连数据库）运行：告警消息的签名、消息体、掩码和发送。
```

- [ ] **Step 6: 提交**

```bash
git add README.md TRANS.md CLAUDE.md
git commit -m "docs: 更新 README、TRANS.md 与 CLAUDE.md——告警通知、配置分组、迁移 0010 与冒烟项数"
```


## 最终核对

对照设计文档第 7.4 节的验收标准逐条确认，把结果写进汇报。

| 验收标准 | 依据 |
|---|---|
| 1. 新建钉钉通道并发送测试消息，卡片显示成功 | 任务 8 Step 10：假机器人先返回失败码再返回成功，卡片上先后显示失败原因和「测试消息已送达」。真实群里收到消息需要用自己的机器人地址手工确认一次 |
| 2. 监控失败后新告警出现在告警中心，卡片显示推送到哪些通道 | 冒烟 `a new monitor alert is pushed once to every channel subscribed to monitor alerts`；任务 10 Step 5 的 `deliveries` |
| 3. 录入问题并选择成员，「只看通知了我的」能找到，消息里有姓名 | 冒烟 `the pushed message names the people to notify`；任务 10 Step 5、Step 6 |
| 4. 通道地址配错时告警仍然创建成功、卡片显示失败原因，修正后重发成功 | 冒烟 `resend pushes again to every channel subscribed to manual issues`；任务 8 Step 10；任务 10 Step 5 的混合结果 |
| 5. 没有 `alert.channel.manage` 的成员看不到入口，直接调用返回 403 | 冒烟 `alerts-only member cannot create channels` 等 6 条；任务 8 Step 12 |
| 6. 环境卡片显示操作系统，可以按操作系统筛选 | 冒烟 `operating system can be switched to windows`；任务 9 Step 3、Step 4 |
| 7. 冒烟全部通过，`npm run lint`、`npm run build` 通过 | 任务 11 Step 1、Step 2 |

最后运行：

```bash
git status --short
```

```bash
git log --oneline -12
```

预期：`git status --short` 没有输出（工作区干净）；`git log` 里是任务 1 到 11 的提交加上开始之前的那次工作台提交（如果选择了单独提交）。
