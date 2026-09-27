# E5 工具裁剪 26→10（核心 8 + A19） — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | 现有 26 工具（文件6+Git4+Web2+文档2+重构5+分析4+包管理4）；小模型工具面越大越不稳；AGENTS 硬约定核心 8 件；ABSORPTION A19 要求保留 Web 检索与 question |
| ② 先测 | `tests/e5-tools.test.ts` 8 用例（默认集精确名单/裁掉类不在/schema 完整/名字命中/extras 含被裁且不重叠/精确启用）先红（import 失败 + 旧名 FileRead 不符） |
| ③ 落盘 | `getDefaultTools()`=Read/Write/Edit/Glob/Grep/Bash/GitStatus/GitDiff/WebSearch/Question；新增 `tools/Question.ts`（TTY 提问+选项+120s 超时，非 TTY 回喂继续）；`getExtraTools()` 16 件 + `resolveExtraTools()`（`PILOT_EXTRA_TOOLS=WebFetch,GitCommit` 精确启用）；QueryEngine 注册默认+extras |
| ④ 审查 | 工具真名核实（Read/Write/Edit 非 FileRead）；Question 隐式 any 修正 |
| ⑤ 回归 | tsc 0 错 / vitest 62 绿 / shellcheck 过 / bash -n 过 / pytest 31 绿 |
| ⑥ 验收 | 全部通过 |

**注**：buildSystemPrompt 工具列表硬编码问题归 E6；GitUndo/GitCommit 出默认后 checkout 类破坏性操作由 Bash 承担（F3 权限分级覆盖）。
