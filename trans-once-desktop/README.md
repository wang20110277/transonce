# TransOnce 桌面客户端（Electron）

Electron 壳进程，加载 `trans-once-web-ui` 的构建产物（`dist/`），并通过自定义 `app://` 协议把 `/api`、`/asr` 请求代理到本地后端 —— **前端代码零改动**，与浏览器访问行为一致。

## 生产模式（加载构建产物）

```bash
# 1. 构建前端
cd trans-once-web-ui
npm install && npm run build

# 2. 启动后端（固定 9005 端口）
cd ../trans-once && ./start.sh

# 3. 启动桌面客户端
cd ../trans-once-desktop
npm install
npm start
```

启动时先展示连接页，后端健康检查（`GET /api/health`）通过后自动进入应用；连不上则停在引导页并每 2 秒自动重试，后端恢复后自动进入。

也可以让客户端自动拉起后端：

```bash
TRANSONCE_AUTOSTART=1 npm start    # 后端未就绪时自动执行 trans-once/start.sh
```

## 开发模式（连 Vite 开发服务器）

```bash
cd trans-once-web-ui && npm run dev   # 终端 1：http://localhost:3002
cd trans-once-desktop && npm run dev  # 终端 2：加载开发服务器，/api 走 Vite 代理
```

## 冒烟验证

后端已启动、前端已构建后：

```bash
npm run smoke
# stdout 输出 {"loginStatus":200,"mounted":true,...}，退出码 0 即通过

npx electron . --screenshot=/tmp/transonce.png
# 有头验证：窗口加载完成后截图到指定路径并自动退出
```

## 配置项（环境变量）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `TRANSONCE_BACKEND` | `http://127.0.0.1:9005` | 后端地址 |
| `TRANSONCE_ASR` | `http://127.0.0.1:8001` | ASR 服务地址（`/asr` 代理目标） |
| `TRANSONCE_AUTOSTART` | 未设置 | `1` 时后端未就绪则自动执行 `trans-once/start.sh` |
| `TRANSONCE_START_URL` | `http://localhost:3002` | 开发模式加载地址 |
| `TRANSONCE_BOOT_TIMEOUT_MS` | `15000`（自动拉起时 `90000`） | 等待后端就绪的超时 |

## 打包（macOS）

```bash
cd trans-once-web-ui && npm run build   # 产物会通过 extraResources 打进应用
cd ../trans-once-desktop && npm run dist
# 输出在 trans-once-desktop/out/（DMG）
```

## 安全约定

- `contextIsolation` 开启、`nodeIntegration` 关闭，preload 仅暴露 `window.transonceDesktop = {isDesktop, platform}`。
- 页面导航限制在 `app://`（或开发服务器）内，外部链接一律交给系统浏览器打开。
- 代理仅透传 `accept / accept-language / authorization / content-type` 请求头。
