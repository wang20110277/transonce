// pm2 进程配置:目前只托管前端(vite dev :3002)。
// 后端由 trans-once/start.sh 用 conda 环境 transonce 启动(:9005),不经 pm2。
// 用 .cjs:本目录 package.json 是 "type": "module",.js 会被 pm2 当 ESM 加载成空配置。
module.exports = {
  apps: [
    {
      name: "transonce-web",
      cwd: __dirname,
      script: "npm",
      args: "run dev",
      time: true,
    },
  ],
};
