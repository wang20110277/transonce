# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@TRANS.md

TRANS.md 是本仓库的项目规则（命令 / 架构 / 约定的唯一事实来源，已通过 @ 导入）。当命令、架构或约定发生变化时，同步更新 TRANS.md，不要在本文件中复制其内容。

## 测试方式（无测试框架）

- 后端测试是独立 stdlib 脚本，直接运行，无 pytest，也没有单条用例的粒度：
  - `python3 trans-once/tests/smoke.py` — 需先启动后端（:9005）并完成种子；93 项检查，不会创建/删除业务实体，可对开发库安全执行。
  - `python3 trans-once/tests/microsoft_flow.py` — 离线（不联网）运行。
- 前端 `npm run lint` 仅是 `tsc --noEmit` 类型检查（无 ESLint）；`npm run build` 为生产构建。

## 已知坑

- README 中提到的 `docs/ARCHITECTURE.md` 并不存在；设计文档在 `docs/superpowers/{plans,specs}/`。
- `trans-once/start.sh` 自动探测 conda 环境 `transonce`（`conda info --base`），找不到时回退 `python3`。
