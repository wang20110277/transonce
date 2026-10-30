// 暴露给渲染进程的桌面环境信息（保持最小面；contextIsolation 默认开启）。
const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('transonceDesktop', {
  isDesktop: true,
  platform: process.platform,
  // app:// 页面无法注册 OAuth 重定向，由主进程走 RFC 8252 本机回环登录。
  // 返回 {token, user}；失败/超时/取消 reject Error（message 可直接展示）。
  oauthLogin: (provider) => ipcRenderer.invoke('oauth-login', provider),
});
