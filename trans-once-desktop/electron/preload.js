// 暴露给渲染进程的桌面环境信息（保持最小面；contextIsolation 默认开启）。
const {contextBridge} = require('electron');

contextBridge.exposeInMainWorld('transonceDesktop', {
  isDesktop: true,
  platform: process.platform,
});
