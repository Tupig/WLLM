---
name: git-workflow
description: issue-first 提交闭环：建 issue、测试先行、commit 关联 fix #N、CI 绿后关闭
---

# Git 工作流：issue-first 闭环

## 核心循环（本仓纪律）

1. **先建 issue**：无 issue 不动代码。`gh issue create --title "..." --body "..."`
   - body 写：现象 / 影响面 / 方案 / 测试先行条目
2. **测试先行**：先写红测试，再实现转绿
3. **三连回归**：`npx tsc --noEmit` → `npx vitest run` → `npm run build`
4. **提交关联**：`git commit -m "... fix #N"`（commit message 自动关闭 issue）
5. **盯 CI**：
   ```bash
   RUN=$(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')
   gh run watch "$RUN" --exit-status
   gh run list --limit 1 --json conclusion --jq '.[0].conclusion'
   ```
6. **CI 绿后 close issue**（若 `fix #N` 已自动关，跳过）

## 提交纪律

- 一次提交只做一件事；标题祈使句 + 正文列改动点
- 分支：`fix/123-desc` 或 `feat/123-desc`，PR 标题带 issue 号
- 不提交：密钥、`node_modules`、运行时产物（`.tupigcode/` 已 ignore）
- 禁止：force push、改历史、跳过 CI 的操作

## 回滚决策

- 单文件误改 → `/rewind code <id>` 或 `git checkout -- <file>`
- 一轮全错 → `/rewind all`（三档：chat/code/all）
- 已提交的错误 → `git revert <sha>`（不改历史）
