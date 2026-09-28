# N7 TodoWrite 任务清单（A16） — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | A16=Claude Code TodoWrite：规划多步任务全量替换清单、每步状态流转、注入系统提示可见进度 |
| ② 先测 | `tests/n7-todo.test.ts` 6 用例（schema 3/状态语义 1/渲染 2）先红 |
| ③ 落盘 | `tools/todo.ts`：TodoWriteInput（zod：content 非空、status/priority 枚举、≤50 项）、applyTodoWrite（全量替换+updatedAt）、renderTodoState（`[x]/[~]/[ ]`+优先级+进度 `n/m`）、TodoWriteTool（isReadOnly=true → plan 模式可用，call 写 appStore）；AppState 加 todoState；buildSystemPrompt stateText 合并渲染；加入默认工具集（**10→11**，E5 断言同步更新） |
| ④ 审查 | todoState 可 undefined 兼容（?? null）|
| ⑤ 回归 | tsc 0 错 / vitest 221 绿 / shellcheck 过 / bash -n 过 / unittest 31 绿 |
| ⑥ 验收 | 全部通过 |
