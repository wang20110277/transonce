// 一次性工具：用 Electron（Chromium）渲染 render-icon.html 并截取 1024×1024 图标底图。
// 用法：./node_modules/.bin/electron build/iconsrc/render-icon.js
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024, height: 1024, show: false, frame: false, resizable: false, useContentSize: true,
    // 截图必须保留透明通道：白色圆角边在 Dock 里非常显眼。
    transparent: true, backgroundColor: '#00000000',
  });
  await win.loadURL('file://' + path.join(__dirname, 'render-icon.html'));
  await new Promise((resolve) => setTimeout(resolve, 500));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'icon_1024.png'), image.toPNG());
  console.log('icon base rendered:', image.getSize());
  app.exit(0);
});
