# gpt-visual-platform TS 重写并入 gameqa — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 现状 | `archive/gpt-visual-platform/` 源码级归档（Go server + Rust agent + Python legacy，从未运行）；蓝本中 Unity 执行/Agent 端均为占位注释 |
| ② 分阶段 | 1a store `89be50e` → 1b server 30 路由 `250c8a9` → 2 builtin/worker `a74a07f` → 3a agent/unity 执行器 `925b635` → 3b airtest/gameperf/ai `9be57ad` → 4 CLI/TLS/看板 `ee3338e` → 4b scripts/Docker/e2e `7fbd286` → 5 删档（本次） |
| ③ 落盘 | `src/gameqa/` 17 模块 + `src/cli/gameqa.ts`（serve/agent）+ `src/gameqa/static/` 看板；**落地蓝本占位**：Unity batchmode 真执行（NUnit3 XML 解析、generate_and_run 生成用例）、airtest、AI 探索（视觉模型循环）、game_perf、ADB/设备清单、TLS 自签（openssl ECDSA P-256 复用）、系统服务/运维脚本 |
| ④ 审查 | 修蓝本断链 bug（repeat_minutes 落 extra；meminfo trim）；ESM 补 `.js` 后缀；`bin` 6→7；gpt-visual-platform 全仓库引用清零（.gitignore 改 `/data/`，store.ts/README 措辞改"原"） |
| ⑤ 回归 | tsc 0 错 / vitest 38 文件 **464 绿**（g1-g5 共 76 用例）/ `npm run build` + dist 冒烟（health/看板/SIGTERM）/ `./scripts/e2e.sh` 全链路通过（HTTPS 自签名 + Agent 注册领取上报 + web_check(HTTPS) + 诊断三件套 + 取消删除 + jobs.json 落盘） |
| ⑥ 验收 | archive 删除；蓝本文档移 `docs/history/gameqa/`；用法入口 `src/gameqa/README.md`；docs/DIRECTORY.md 同步 |

运行入口：`npm run build && node dist/cli/gameqa.js serve`（看板 https://localhost:9111），Agent 见 `src/gameqa/README.md` 环境变量表。
