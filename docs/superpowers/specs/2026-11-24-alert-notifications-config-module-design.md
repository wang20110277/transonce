# 告警通知与配置模块 — 设计

- **日期：** 2026-11-24
- **状态：** 已确认
- **范围：** 侧边栏新增「配置」分组（环境配置 + 告警配置）；告警配置对接钉钉 / 企业微信 / 飞书群机器人并自动推送；告警中心支持手工录入问题并通知指定成员；环境配置增加操作系统字段。

## 1. 目标

**现状**

- 告警只能由监控检查失败自动产生（级别固定为严重）。用户在告警中心除了改状态（确认 / 解决 / 重新打开）之外做不了别的，没有办法主动提一个问题。
- 仓库里没有任何通知机制：没有站内通知，没有邮件，没有对接任何 IM。
- 成员只有邮箱一个联系方式，没有值班人、负责人这类归属数据；环境和监控只记录了创建人。
- 环境只记录名称、类型、访问地址、IP、账号密码，没有操作系统字段。所有部署阶段都是模拟执行，不连接目标机器。

**目标**

1. 监控告警能自动推送到钉钉 / 企业微信 / 飞书群，推送结果在平台里可查、失败可重发。
2. 有告警中心权限的成员可以手工录入问题并指定要通知的人：被通知的人站内能看到，消息也推送到群。
3. 侧边栏新增「配置」分组，集中放置环境配置和告警配置；环境可以标注为 Linux 或 Windows。

## 2. 已确认的决策

| 决策 | 选择 |
|---|---|
| 「通知对应的人员」如何确定 | 录入问题时手工勾选成员，可多选。不做自动推导 |
| 通知如何到达 | 站内指派（告警中心可见、可筛选）+ 推送到已配置的群。消息里写被通知人的姓名，不做 @ |
| 环境配置的改动幅度 | 页面移到「配置」分组，新增操作系统字段。不加远程连接配置，不做远程执行 |
| 推送的后端方案 | 租户级通道表 + 事件发生时同步推送 + 推送记录。不引入后台线程和队列 |
| 告警配置的归属 | 租户级，每个租户配置自己的群机器人 |

## 3. 数据模型（迁移 `0010`）

```sql
CREATE TABLE alert_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,                 -- dingtalk | wecom | feishu
    webhook_enc TEXT NOT NULL,              -- 加密后的 Webhook 地址
    secret_enc TEXT,                        -- 加密后的加签密钥，仅钉钉 / 飞书使用
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    events JSONB NOT NULL DEFAULT '{"monitor": true, "manual": true, "status": false}',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_alert_channels_tenant_created ON alert_channels (tenant_id, created_at);

CREATE TABLE alert_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_id UUID REFERENCES alerts(id) ON DELETE CASCADE,            -- 测试消息为空
    channel_id UUID REFERENCES alert_channels(id) ON DELETE SET NULL,
    channel_name TEXT NOT NULL,             -- 冗余保存，通道删除后记录仍可读
    provider TEXT NOT NULL,
    event TEXT NOT NULL,                    -- monitor | manual | status | test
    status TEXT NOT NULL,                   -- sent | failed
    http_status INT,
    error TEXT,
    duration_ms INT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_alert_deliveries_alert ON alert_deliveries (alert_id);
CREATE INDEX idx_alert_deliveries_tenant_created ON alert_deliveries (tenant_id, created_at DESC);

ALTER TABLE alerts
    ADD COLUMN source TEXT NOT NULL DEFAULT 'monitor',                -- monitor | manual
    ADD COLUMN notified_user_ids UUID[] NOT NULL DEFAULT '{}',        -- users.id
    ADD COLUMN environment_id UUID REFERENCES environments(id) ON DELETE SET NULL;

ALTER TABLE environments
    ADD COLUMN os_type TEXT NOT NULL DEFAULT 'linux';                 -- linux | windows
```

**说明**

- `alert_channels.events` 的三个键对应三类事件：`monitor` 监控告警、`manual` 手工问题、`status` 状态变化。
- 存量告警的 `source` 全部是 `monitor`，存量环境的 `os_type` 全部按 `linux` 处理，用户可以在页面上修改。
- 监控产生的告警在写入时把监控关联的环境一并带到 `alerts.environment_id`，这样无论哪种来源都只需要一次关联就能显示环境名称。
- `downgrade` 删除两个新表和四个新列。

## 4. 权限

| 权限 | 用途 | 默认拥有者 |
|---|---|---|
| `alert.channel.manage`（新增，归入「敏感操作」，标签为「告警通道配置」） | 新建、修改、删除告警通道；发测试消息；查看全部推送记录；控制侧边栏「告警配置」入口 | 租户管理员、DevOps 工程师 |
| `alerts`（已有） | 查看告警中心；录入问题；重发；查看通道的只读信息 | 租户管理员、DevOps 工程师 |

- 迁移里沿用 `0004` 的做法，把 `alert.channel.manage` 追加给系统预设角色「DevOps 工程师」。租户管理员拥有全部权限，无需处理。其他角色由管理员在角色编辑器里自行勾选。
- 默认只有 DevOps 工程师和租户管理员有 `alerts`。其他角色要录入问题，需要管理员给该角色勾上「告警中心」。
- `GET /alert-channels` 是只读接口，`alerts` 和 `alert.channel.manage` 任一即可访问。原因：录入问题的弹窗需要知道「有没有启用中的通道订阅了手工问题」，而只有 `alerts` 权限的成员也要能录入。

## 5. 后端

### 5.1 模块划分

- 新增 `trans-once/notifiers.py`，只负责三件事：把一条告警渲染成各家机器人的消息体、加签并发送、返回结果。它不直接写数据库。
- 新增 `trans-once/alert_notify.py`，负责筛选通道（启用且订阅了该事件）、并行调用 `notifiers`、写 `alert_deliveries`。路由和 `orchestration.check_monitor` 都调用它，因此它不能放在 `routers/devops.py` 里（`devops.py` 已经引用了 `orchestration`，反向引用会循环导入）。这个函数保证不抛异常。
- 通道和告警的路由放在现有的 `trans-once/routers/devops.py`（告警和环境都在这里）。
- 环境的 `os_type` 在现有的环境路由里处理，不新增接口。

### 5.2 接口

全部位于 `/api/tenants/{tenant_id}` 下。

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/alert-channels` | `alerts` 或 `alert.channel.manage` | 通道列表，地址和密钥只返回掩码 |
| POST | `/alert-channels` | `alert.channel.manage` | 新建通道 |
| PATCH | `/alert-channels/{id}` | `alert.channel.manage` | 修改通道 |
| DELETE | `/alert-channels/{id}` | `alert.channel.manage` | 删除通道，历史推送记录保留 |
| POST | `/alert-channels/{id}/test` | `alert.channel.manage` | 发送一条测试消息，返回本次结果 |
| GET | `/alert-channels/deliveries` | `alert.channel.manage` | 最近的推送记录，可用 `channelId` 筛选，默认 20 条 |
| POST | `/alerts` | `alerts` | 录入问题 |
| POST | `/alerts/{id}/resend` | `alerts` | 重发 |

**通道的字段与校验**

- `name`：必填，不超过 50 个字。
- `provider`：`dingtalk`、`wecom`、`feishu` 三选一，其他值返回 400。
- `webhook`：必填。保存时用 `net_guard.validate_url(webhook, {主机名})` 校验：只允许 http / https，拒绝带用户名密码的地址、云元数据地址和链路本地地址。内网地址放行，因为企业微信、飞书存在私有化部署的网关。修改时不传或传空串表示保留原值。
- `secret`：可选。企业微信不支持签名，传入时返回 400。修改时三态：不传表示保留，传空串表示清除，传非空值表示替换。
- `enabled`：默认 `true`。
- `events`：三个布尔值，缺省为 `{monitor: true, manual: true, status: false}`。修改时与现有值合并。
- 返回字段：`id`、`tenantId`、`name`、`provider`、`enabled`、`events`、`webhookMasked`、`hasSecret`、`secretMasked`、`createdAt`、`updatedAt`。
- `webhookMasked` 保留协议、主机和路径，把凭证部分替换成 `••••••` 加末 4 位。凭证部分指查询串（钉钉、企业微信）或最后一段路径（飞书）。
- 不提供查看明文的接口。要更换地址或密钥，直接重新粘贴。

**录入问题：`POST /alerts`**

请求体：

| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | 是 | 不超过 200 个字 |
| `severity` | 否 | `info` / `warning` / `critical`，默认 `warning` |
| `detail` | 否 | 不超过 4000 个字 |
| `environmentId` | 否 | 必须属于本租户 |
| `monitorId` | 否 | 必须属于本租户 |
| `notifiedUserIds` | 否 | `users.id` 数组，每一项都必须是本租户状态为 `active` 的成员，否则返回 400 |
| `push` | 否 | 是否推送到群，默认 `true` |

流程：校验 → 写入告警（`source = manual`，`created_by` 为当前用户；填了 `monitorId` 时把监控关联的环境一并带上）→ 写审计 `alert.created` → 有通道订阅「手工问题」就推送 → 返回告警和本次推送结果。

没有任何可用通道时跳过推送，返回空的 `deliveries`，由页面提示「未推送到群」。

**重发：`POST /alerts/{id}/resend`**

- 请求体可以带 `channelIds` 来缩小范围。它只能缩小、不能扩大：这些通道必须属于本租户（否则返回 400），并且仍然必须是启用的、订阅了该告警来源事件（监控告警或手工问题）的通道，不满足的 ID 会被忽略。不传则推给所有满足条件的通道。
- 返回本次的推送结果。

**现有接口的扩展**

- `GET /alerts`：每条告警新增 `source`、`environmentId`、`environmentName`、`createdById`、`createdByName`、`notifiedUsers`（`[{id, name}]`）、`deliveries`（该告警的推送记录，时间倒序，最多 10 条）。推送记录和被通知人姓名各用一次批量查询取回，不逐条查询。
- `PATCH /alerts/{id}`：契约不变。当状态确实发生变化时，额外触发一次「状态变化」推送。返回里带两个字段：`deliveries` 是这条告警的推送历史，`pushed` 是本次请求新产生的推送（状态没变时为空数组）。

### 5.3 推送流程

监控新告警、录入问题、状态变化、重发都走同一个函数。

1. 取出本租户启用的、且订阅了该事件的通道。没有则直接返回。
2. 多个通道并行发送，每个通道 5 秒超时，整体最多多等 5 秒左右。HTTP 调用在线程池里进行，线程数与通道数相同；数据库读写只在请求线程里做。
3. 每个通道写一条 `alert_deliveries`：成功或失败、HTTP 状态、平台返回的错误信息、耗时。
4. 单个通道的任何异常都被捕获并记为失败。推送出错绝不影响告警本身，接口不会因为群机器人故障而失败。

**触发点**

| 事件 | 触发时机 | 消息标题 |
|---|---|---|
| `monitor` | `check_monitor` 发现监控检查失败且新写入了一条告警 | `【TransOnce 告警】监控异常：{监控名}` |
| `manual` | 录入问题且 `push` 为真 | `【TransOnce 问题】{标题}` |
| `status` | 告警状态被确认、解决、重新打开，或监控恢复后自动解决。状态没有实际变化时不触发 | `【TransOnce 告警】{标题}：{新状态}` |
| `test` | 点击「发送测试消息」。无论通道是否启用都可以发送 | `【TransOnce 告警】测试消息` |

对应的代码改动：`check_monitor` 里写入告警的语句改用 `RETURNING` 拿到新告警；自动解决的那条 `UPDATE` 同样改用 `RETURNING` 拿到被解决的告警。

### 5.4 三家机器人的对接

| | 钉钉 | 企业微信 | 飞书 |
|---|---|---|---|
| 接口 | 自定义机器人 Webhook | 群机器人 Webhook | 自定义机器人 Webhook |
| 加签 | 可选。以毫秒时间戳和换行、密钥拼成待签串，用密钥做 HMAC-SHA256，结果 Base64 后 URL 编码，作为 `timestamp` 和 `sign` 两个参数拼到地址上 | 无 | 可选。以「秒时间戳 + 换行 + 密钥」为密钥，对空串做 HMAC-SHA256，结果 Base64。`timestamp` 和 `sign` 放在请求体里 |
| 消息类型 | markdown：`markdown.title` + `markdown.text` | markdown：`markdown.content`，不超过 4096 字节 | 富文本：`content.post.zh_cn`，带 `title` 和若干段落。请求体不超过 20KB |
| 成功判定 | HTTP 200 且 `errcode` 为 0 | HTTP 200 且 `errcode` 为 0 | HTTP 200 且 `code` 为 0 |
| 频率限制 | 每机器人 20 条/分钟，超限后限流 10 分钟 | 每机器人 20 条/分钟 | 每机器人 100 次/分钟、5 次/秒 |

失败时把平台的错误码和错误信息（例如钉钉的 `310000`、飞书的 `19024`）写进推送记录，方便对照官方文档排查。

### 5.5 消息内容

标题固定以「【TransOnce 告警】」或「【TransOnce 问题】」开头。这样在钉钉、飞书上选择「关键词」安全设置时，把 `TransOnce` 设为关键词即可通过校验。

正文每项一行：

- 租户：{租户名称}
- 级别：严重 / 警告 / 提示
- 来源：监控告警写「监控「{监控名}」检查失败」；手工问题写「{录入人姓名} 录入」
- 环境：{环境名称}（有关联时才出现）
- 通知：{被通知人姓名，顿号分隔}（有人时才出现）
- 时间：告警产生时间，按服务器本地时区显示
- 详情：告警详情，超过 1000 个字截断并标注「（已截断）」

渲染后再按各平台的字节上限截断一次。测试消息的正文说明它来自哪个租户的哪个通道。

### 5.6 安全

- 地址和密钥用现有的 `encrypt_secret` 加密落库，只在发送的那一刻解密。
- 错误信息里不包含地址和密钥。记录异常时先把地址字符串替换掉，再截断到 300 个字。
- 审计事件只记通道名称、平台和改动了哪些字段，不记地址和密钥的值。
- 所有查询都带 `tenant_id`。

### 5.7 审计事件

| 事件类型 | 载荷 |
|---|---|
| `alert.channel.created` | `channelId`、`name`、`provider` |
| `alert.channel.updated` | `channelId`、`name`、`fields`（改动的字段名列表） |
| `alert.channel.deleted` | `name`、`provider` |
| `alert.channel.tested` | `channelId`、`name`、`status` |
| `alert.created` | `alertId`、`severity`、`notifiedUserIds`、`pushed` |
| `alert.resent` | `alertId`、`count` |
| `alert.updated`（已有） | 不变 |

## 6. 前端

### 6.1 侧边栏（`App.tsx`）

- 新增分组「配置」，位于「运维」之后、「协作」之前，包含两个入口：环境配置（从「运维」分组移入）、告警配置（新增，视图标识 `alert-settings`，权限 `alert.channel.manage`）。
- 「运维」分组保留运维监控和告警中心。

### 6.2 告警配置页（新文件 `views/AlertSettings.tsx`）

- 页头：标题「告警配置」，说明「配置钉钉 / 企业微信 / 飞书群机器人，监控告警和录入的问题会自动推送到对应的群」，右侧「新建通道」按钮。
- 每个通道一张卡片：平台标识（钉钉 / 企业微信 / 飞书）、名称、启用开关（直接在卡片上切换）、地址掩码、是否已配密钥、订阅的事件、最近一次推送的结果，以及「编辑」「发送测试消息」「删除」三个操作。删除前二次确认。
- 新建和编辑用弹窗，字段与 5.2 一致。地址和密钥是密码输入框，编辑时显示掩码作为占位，留空表示不修改。清除已保存的密钥通过一个单独的「清除密钥」按钮完成。
- 弹窗里有三段提示：到哪里获取地址（群设置 → 群机器人 → 自定义机器人）、关键词怎么设、各平台的频率限制。
- 「发送测试消息」在保存之后可用。结果直接显示在对应的卡片上。
- 页面底部是「最近推送」列表：时间、通道、事件、结果、失败原因。
- 空状态引导用户新建第一个通道。
- 启用开关复用平台登录设置里的开关，把它从 `PlatformSettings.tsx` 提取到 `components/common.tsx`。

### 6.3 环境配置页（`views/Environments.tsx`）

- 表单新增「操作系统」下拉：Linux / Windows，默认 Linux。
- 环境卡片的标题旁显示操作系统标识。
- 页面顶部新增按操作系统筛选的下拉：全部 / Linux / Windows。

### 6.4 告警中心（`views/Alerts.tsx`）

- 页头新增「录入问题」按钮，打开弹窗表单：标题（必填）、级别（默认警告）、关联环境、关联监控、详细说明、通知人员、「同时推送到群」。
- 「通知人员」是多选，候选来自工作区里已有的团队成员列表，只列出状态为正常的成员，提交的是 `userId`。
- 「同时推送到群」默认勾选。没有任何启用中的通道订阅「手工问题」时置灰，并说明保存后只会出现在告警中心。
- 保存后刷新工作区，提示「问题已录入」，并根据实际结果补充「已推送到 N 个群」或「未推送到群」。
- 筛选新增「来源」（全部 / 监控告警 / 手工录入）和复选框「只看通知了我的」。
- 告警卡片新增：来源标识、录入人、关联环境、「通知：{姓名}」（包含当前用户时标出「含我」）、每个通道的推送结果和失败原因、「重发」按钮。

### 6.5 其他

- 工作台活动时间线（`views/Dashboard.tsx` 的 `activityLabels`）补上 5.7 中新增事件的中文标签。
- `services/api.ts` 新增 `alertChannels`（`list`、`create`、`update`、`remove`、`test`、`deliveries`），`alerts` 新增 `create` 和 `resend`。
- `types.ts` 新增 `AlertChannel`、`AlertDelivery`；`Alert` 增加 5.2 列出的字段；`Environment` 增加 `osType`。
- `lib/store.ts` 新增 `alertChannels`，随工作区一起加载。

## 7. 测试与验证

### 7.1 后端

按「先写检查、确认失败、再实现、确认通过」的顺序进行，检查加在 `trans-once/tests/smoke.py` 里：

- 通道增删改查；列表响应里不含明文地址和密钥；非 http / https 地址和云元数据地址被拒绝；企业微信传入密钥返回 400。
- 权限边界：没有 `alert.channel.manage` 的角色访问通道的写接口返回 403；没有 `alerts` 的角色读取通道列表返回 403。
- 与现有的假 GitLab 一样，在冒烟脚本里内置一个假的机器人服务，监听本机随机端口：
  - 钉钉、飞书的请求带正确的 `timestamp` 和 `sign`（假服务用同一密钥重算并比对）。
  - 企业微信的请求体是 markdown 类型，`content` 不超过 4096 字节。
  - 假服务返回失败码时，推送记录为失败且带有平台的错误信息。
- 录入问题：告警出现且来源为手工、通知人员正确、假机器人收到一条内容包含被通知人姓名的消息；重发后再收到一条。
- 环境的 `os_type` 传入非法值返回 400；合法值能保存并在列表里返回。

- 签名、消息体、掩码这类纯逻辑另有一个离线脚本 `trans-once/tests/notifiers_flow.py`（不联网、不连数据库），用各平台官方文档给出的算法独立算出的参考值做比对，改动后几秒内就能验证。

冒烟会创建下面这些固定夹具（一次性创建，之后复用）：

- 四个告警通道：钉钉、企业微信、飞书各一个，外加一个指向假机器人失败接口的通道，用来验证失败路径。每轮开始时把地址指到本轮启动的假机器人上；失败通道在验证完之后删除，下一轮再建。
- 一条手工录入的问题，通知两名冒烟账号。每轮结束时置为已解决，不影响未处理告警数。录入并推送的检查只在夹具第一次建立的那一轮执行，之后每轮验证的是重发和状态变化。
- 一个指向本机关闭端口的监控「冒烟失败探针」，用来触发真实的监控告警。每轮先触发一条新告警，再把探针指向健康地址让它自动恢复，所以每轮留下的是一条已解决的告警，不留未处理告警；已解决告警每轮增加一条。
- 一个只有 `alerts` 权限的自定义角色和对应账号，用来验证「能录入问题、不能管理通道」。
- 一个临时环境「冒烟系统类型校验」：每轮创建、验证操作系统的缺省值和修改，然后删除，用完不留。

只跑这一节时，连同前面的健康检查和夹具准备，稳定后共 74 项检查（告警一节本身 63 项）。

冒烟支持 `SMOKE_ONLY=alerts` 只跑这一节（仍会执行启动和夹具准备），改动相关代码后不必跑完整个套件。检查项会多于现有的 93 项，文档里的数字按实现后的实际项数更新。

### 7.2 前端

- `npm run lint` 和 `npm run build` 通过。
- 用浏览器逐项核对：侧边栏出现「配置」分组且「运维」下不再有环境配置；告警配置的新建、编辑、启用切换、发送测试消息；录入问题弹窗在有无可用通道两种状态下的表现；告警卡片上新增的信息；环境卡片的操作系统标识和筛选；宽屏和窄屏各看一遍。

### 7.3 迁移与运行中的服务

- 在开发库上执行 `alembic upgrade head`。
- 当前运行中的后端（:9005）需要重启才能加载新代码。

### 7.4 验收标准

1. 在告警配置里新建一个钉钉通道并点击「发送测试消息」，群里收到消息，卡片显示成功。
2. 监控检查失败后，新告警出现在告警中心，卡片上显示已推送到哪些通道，群里收到消息。
3. 录入问题并选择两名成员，两人在告警中心勾选「只看通知了我的」能看到这条问题，群里收到含两人姓名的消息。
4. 通道地址配错时，告警仍然创建成功，卡片显示失败原因；修正后点击「重发」成功。
5. 没有 `alert.channel.manage` 的成员看不到「告警配置」入口，直接调用写接口返回 403。
6. 环境卡片显示操作系统，可以按操作系统筛选。
7. `python3 trans-once/tests/smoke.py` 全部通过；`npm run lint`、`npm run build` 通过。

## 8. 文档

- `README.md`：接口表增加新接口；权限表增加 `alert.channel.manage`；功能列表、迁移说明（到 `0010`）、冒烟说明里的检查项数。
- `TRANS.md`：迁移链到 `0010`；后端模块列表加入 `notifiers.py` 和 `alert_notify.py`；测试命令加入离线脚本；侧边栏分组的描述。
- `CLAUDE.md`：冒烟检查项数，测试方式里加入离线脚本 `notifiers_flow.py`。同时更正「不会创建/删除业务实体」的说法——冒烟脚本自己的说明里写明会一次性创建夹具。

## 9. 已知限制

- 没有自动重试。推送失败后需要人工点击「重发」。
- 批量故障时可能触发平台限流（钉钉、企业微信每分钟 20 条），被丢弃的消息会记为失败，稍后可以重发。
- 「全部检查」时每个新告警都同步推送，最坏情况下每个告警多等 5 秒。
- 不做 @。被通知人在群里只看到自己的姓名。
- 消息里没有回到平台的链接，因为平台目前没有配置对外访问地址。
- 通道地址允许指向内网。有 `alert.channel.manage` 权限的人可以让后端向内网地址发送 POST 请求，这是为私有化网关做的取舍，也是该权限归入敏感操作的原因。
- 密钥的加密沿用现有方案（由 `SECRET_KEY` 派生密钥流异或），`security.py` 的注释里已注明这是 MVP 级别的实现。

## 10. 不在本次范围

以下事项留作后续：

- 推送失败自动重试，以及基于队列的后台推送。
- 批量告警的汇总推送。
- 在群里 @ 到人。前提是给成员补充各平台的用户标识（钉钉手机号或 userId、企业微信 userid、飞书 open_id）。
- 消息里带上回到平台的链接。前提是增加平台对外访问地址的配置。
- 环境的远程连接配置（SSH / WinRM）、连接测试，以及通过远程连接执行部署。
- 访问钉钉、企业微信、飞书时的代理配置。
- 邮件通知，以及告警中心之外的站内通知中心。
