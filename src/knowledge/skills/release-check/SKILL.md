---
name: release-check
description: 发布/合并前检查单：三连回归、安全审计、e2e、CI 绿、文档终检
---

# 发布检查单

## 合并到 main 前（顺序执行）

1. **三连**：`npx tsc --noEmit` && `npx vitest run` && `npm run build`
2. **安全**：`npm audit`（0 high/critical；有则先修）
3. **e2e 冒烟**：`bash scripts/e2e.sh`（全链路：启动→对话→工具→退出）
4. **lint/格式**：按仓库配置（无则跳过，不临时引入）
5. **文档终检**：README 徽章数、命令示例、env 列表与实现一致
6. **CI 绿**：push 后 `gh run watch` 到 conclusion=success
7. **issue 清账**：本轮所有 `fix #N` 对应 issue 已关闭

## 发版（如有 tag 流程）

- 版本号语义：破坏性 env/命令变更 → major；新能力 → minor；修 bug → patch
- tag 前再跑一遍三连；tag 信息写变更点（面向使用者）

## 回滚预案

- 发布后发现问题：优先 revert + 新 patch，不改已发历史
- 破坏性变更必须在 README 标注迁移方式（旧变量名/旧路径 → 新的）
