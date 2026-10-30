// TransOnce 桌面客户端主进程。
// 思路：前端零改动 —— 通过自定义 app:// 协议加载 trans-once-web-ui 的
// 构建产物（dist/），并把 /api、/asr 请求在主进程内代理到本地后端，
// 对页面来说一切请求仍是同源相对路径。
const {app, BrowserWindow, Menu, ipcMain, net, protocol, shell} = require('electron');
const {spawn} = require('node:child_process');
const http = require('node:http');
const {pathToFileURL} = require('node:url');
const fs = require('node:fs');
const path = require('node:path');

const DEV = process.argv.includes('--dev');
const SMOKE = process.argv.includes('--smoke');
// --screenshot=/path/to.png：加载完成后截图并退出（冒烟/留证用）。
const SCREENSHOT = (process.argv.find((a) => a.startsWith('--screenshot=')) || '').slice(13) || '';
const AUTOSTART = process.argv.includes('--autostart') || process.env.TRANSONCE_AUTOSTART === '1';

const BACKEND = process.env.TRANSONCE_BACKEND || 'http://127.0.0.1:9005';
const ASR = process.env.TRANSONCE_ASR || 'http://127.0.0.1:8001';
const DEV_URL = process.env.TRANSONCE_START_URL || 'http://localhost:3002';
// 等待后端就绪的窗口：默认 15s；开启自动拉起后端时放宽（迁移 + 种子需要时间）。
const BOOT_TIMEOUT_MS = Number(process.env.TRANSONCE_BOOT_TIMEOUT_MS || (AUTOSTART ? 90000 : 15000));

const repoRoot = path.resolve(__dirname, '..', '..');
// 开发运行直接引用仓库内的 dist/；打包后由 electron-builder 放到 resources/web-ui。
const webRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'web-ui')
  : path.join(repoRoot, 'trans-once-web-ui', 'dist');

// app:// 需在 ready 前注册为标准安全协议，fetch/相对路径才能正常工作。
protocol.registerSchemesAsPrivileged([
  {scheme: 'app', privileges: {standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true}},
]);

// 仅透传与后端相关的头，避免把 Origin/Referer/Host 之类带过去。
const PROXY_HEADERS = ['accept', 'accept-language', 'authorization', 'content-type'];

function proxyTo(target, req) {
  const url = new URL(req.url);
  const headers = {};
  for (const name of PROXY_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers[name] = value;
  }
  const init = {method: req.method, headers};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body;
    init.duplex = 'half'; // 透传请求流（JSON/上传体）必需。
  }
  return net.fetch(target + url.pathname + url.search, init);
}

function serveStatic(req) {
  const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
  const indexFile = path.join(webRoot, 'index.html');
  if (!fs.existsSync(indexFile)) {
    return page(`<h1>前端构建产物缺失</h1><p>请先执行 <code>cd trans-once-web-ui && npm run build</code>，或改用开发模式 <code>npm run dev</code>。</p>`, 500);
  }
  // 路径穿越防护 + SPA 兜底：未命中的无扩展名路径回落到 index.html。
  const candidate = rel ? path.normalize(path.join(webRoot, rel)) : indexFile;
  if (candidate !== webRoot && !candidate.startsWith(webRoot + path.sep)) {
    return new Response('forbidden', {status: 403});
  }
  let file = candidate;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(file)) return new Response('not found', {status: 404});
    file = indexFile;
  }
  return net.fetch(pathToFileURL(file).toString());
}

function page(body, status = 200) {
  return new Response(`<!doctype html><meta charset="utf-8"><title>TransOnce</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#18181b;color:#e4e4e7;
font:14px/1.7 -apple-system,"PingFang SC",sans-serif}code{background:#27272a;padding:1px 6px;border-radius:4px}
.spin{width:28px;height:28px;margin:0 auto 16px;border:3px solid #3f3f46;border-top-color:#e4e4e7;border-radius:50%;
animation:r 1s linear infinite}@keyframes r{to{transform:rotate(360deg)}}</style>
${body}`, {status, headers: {'content-type': 'text/html; charset=utf-8'}});
}

const LOADING_PAGE = page(`<div style="text-align:center"><div class="spin"></div>
<p>正在连接 TransOnce 后端<br><code>${BACKEND}</code></p></div>`);

// 后端未就绪时的引导页：自动轮询健康检查，恢复后跳回应用。
const ERROR_PAGE = page(`<div style="text-align:center">
<h1 style="font-size:18px;margin:0 0 8px">无法连接后端</h1>
<p>请确认后端已启动：<code>cd trans-once && ./start.sh</code><br>目标地址：<code>${BACKEND}</code></p>
<p style="color:#a1a1aa;font-size:12px">连接恢复后将自动进入应用…</p>
<script>
const tick = async () => {
  try { const s = await (await fetch('/__desktop/health')).json(); if (s.ok) location.replace('/'); } catch {}
};
setInterval(tick, 2000); tick();
</script></div>`);

async function backendUp() {
  try {
    return (await net.fetch(`${BACKEND}/api/health`)).ok;
  } catch {
    return false;
  }
}

// 可选：启动时拉起仓库内的后端脚本（本机 conda 环境方式，见 trans-once/start.sh）。
function autostartBackend() {
  const script = path.join(repoRoot, 'trans-once', 'start.sh');
  if (!fs.existsSync(script)) return;
  spawn('/bin/bash', [script], {detached: true, stdio: 'ignore', cwd: path.dirname(script)}).unref();
}

function handleApp(req) {
  const p = decodeURIComponent(new URL(req.url).pathname);
  if (p === '/__desktop/loading') return LOADING_PAGE;
  if (p === '/__desktop/error') return ERROR_PAGE;
  if (p === '/__desktop/health') {
    return backendUp().then((ok) => new Response(JSON.stringify({ok}), {headers: {'content-type': 'application/json'}}));
  }
  if (p === '/api' || p.startsWith('/api/')) return proxyTo(BACKEND, req);
  if (p === '/asr' || p.startsWith('/asr/')) return proxyTo(ASR, req);
  return serveStatic(req);
}

let win = null;

function openExternal(url) {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
}

function isAllowedOrigin(url) {
  return url.startsWith('app://') || url.startsWith(DEV_URL);
}

// --- OAuth 本机回环登录（RFC 8252）-----------------------------------------
// app:// 页面无法注册重定向 URI：主进程在 127.0.0.1 随机端口起一次性监听，
// 用系统浏览器打开授权页，身份服务带着 code+state 跳回本机端口，主进程换取
// 平台会话后回传渲染进程。后端 /start|callback 接受任意 http(s) 回调并签进
// state，无需为此改造。

const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

function loopbackPage(title, detail) {
  return page(`<div style="text-align:center"><div style="font-size:40px">✅</div>
<h2 style="font-size:18px;margin:12px 0 8px">${title}</h2>
<p style="color:#a1a1aa;font-size:13px">${detail}</p></div>`);
}

async function apiJson(pathname, body) {
  const res = await net.fetch(BACKEND + pathname, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `后端请求失败（${res.status}）`);
  return data;
}

function waitForLoopbackCode(server, deadline) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('登录超时或已取消，请重试'));
      server.close();
    }, deadline - Date.now());
    server.once('request', (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error_description') || url.searchParams.get('error');
      clearTimeout(timer);
      res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
      res.end(error ? loopbackPage('未完成登录', '可关闭本页回到 TransOnce 重新发起。')
                    : loopbackPage('登录成功', '请回到 TransOnce 应用，正在自动进入…'));
      server.close();
      if (error) reject(new Error(`登录失败：${error}`));
      else if (code && state) resolve({code, state});
      else reject(new Error('身份服务未返回授权码，请重试'));
    });
  });
}

async function oauthLogin(provider) {
  if (provider !== 'microsoft' && provider !== 'oidc') {
    throw new Error('未知的登录方式');
  }
  const server = http.createServer(); // 请求处理挂在 waitForLoopbackCode 的 once('request')
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const waiting = waitForLoopbackCode(server, Date.now() + OAUTH_TIMEOUT_MS);
  try {
    const {url} = await apiJson(`/api/auth/${provider}/start`, {redirectUri});
    await shell.openExternal(url);
    const {code, state} = await waiting;
    return await apiJson(`/api/auth/${provider}/callback`, {code, state});
  } catch (err) {
    server.close();
    throw err instanceof Error ? err : new Error(String(err));
  }
}

ipcMain.handle('oauth-login', (_event, provider) => oauthLogin(provider));

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#18181b',
    title: 'TransOnce',
    show: !SMOKE, // 冒烟模式静默运行，不弹窗。
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {preload: path.join(__dirname, 'preload.js')},
  });
  win.once('ready-to-show', () => win.show());
  // 外部链接交给系统浏览器打开，页面自身只在 app:// / 开发服务器内导航。
  win.webContents.setWindowOpenHandler(({url}) => {
    openExternal(url);
    return {action: 'deny'};
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedOrigin(url)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  return win;
}

// 冒烟验证：应用页面加载后，在页面内走一次真实登录（验证 app:// 静态资源 + /api 代理），
// 结果以 JSON 打到 stdout，退出码 0/1。
function smokeCheck() {
  win.webContents.once('did-finish-load', async () => {
    try {
      const result = await win.webContents.executeJavaScript(`(async () => {
        await new Promise((r) => setTimeout(r, 1000)); // 等 React 挂载
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({email: 'admin@transonce.local', password: 'admin123'}),
        });
        return {loginStatus: res.status, mounted: !!document.getElementById('root')?.childElementCount, title: document.title};
      })()`);
      console.log(JSON.stringify(result));
      app.exit(result.loginStatus === 200 && result.mounted ? 0 : 1);
    } catch (err) {
      console.error('smoke failed:', err);
      app.exit(1);
    }
  });
  win.loadURL('app://local/');
}

async function boot() {
  protocol.handle('app', handleApp);
  createWindow();
  // 验证模式 --screenshot=/path/to.png：应用页渲染后截图留证并自动退出。
  if (SCREENSHOT) {
    win.webContents.on('did-finish-load', async () => {
      const url = win.webContents.getURL();
      if (url.includes('__desktop') || !(url.startsWith('app://local/') || url.startsWith(DEV_URL))) return;
      await new Promise((resolve) => setTimeout(resolve, 1500)); // 等 React 渲染稳定
      try {
        fs.writeFileSync(SCREENSHOT, (await win.webContents.capturePage()).toPNG());
        console.log('screenshot saved:', SCREENSHOT);
      } catch (err) {
        console.error('screenshot failed:', err);
      }
      app.exit(0);
    });
  }
  if (DEV) return win.loadURL(DEV_URL);

  await win.loadURL('app://local/__desktop/loading');
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let healthy = await backendUp();
  if (!healthy && AUTOSTART) autostartBackend();
  while (!healthy && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    healthy = await backendUp();
  }
  if (SMOKE) return smokeCheck();
  return win.loadURL(healthy ? 'app://local/' : 'app://local/__desktop/error');
}

function setupMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{role: 'appMenu'}] : []),
      {role: 'editMenu'},
      {role: 'viewMenu'},
      {role: 'windowMenu'},
    ])
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    setupMenu();
    return boot();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) boot();
  });
}
