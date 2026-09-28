# I1 分层记忆 + 先审后存（A10/A11） — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | 原有单层 `.pilotrules` 注入钩子（rulesText）；A10=Claude/opencode 分层记忆+就近注入+@path；A11=Augment/Cursor 先审后存+引用校验 |
| ② 先测 | `tests/i1-memory.test.ts` 13 用例（分层 3/@引用 3/校验 2/格式 1/记忆 4）先红 |
| ③ 落盘 | `rules/index.ts`：resolveRuleLayers（global `~/.wllm/rules.md` → project `.pilotrules` 等 → local 就近 rules.md，带 baseDir）、expandRuleRefs（行首 `@path` 展开、缺失→占位）、validateRuleRefs（A11 缺失列出）、formatLayersForPrompt（分层标题+展开）；`memory.ts`：stageMemory（approved:false **不落盘**）→ commitMemory（**approved=false 拒写**）→ loadMemories（坏行跳过）→ formatMemoriesForPrompt；QueryEngine 构造预载规则层+记忆，buildSystemPrompt 注入 memoryText；REPL `/remember`（展示→promptUser 确认→入库，无参查看） |
| ④ 审查 | RuleLayer 携带 baseDir 修 @引用解析基准；HOME env 可注入测试 |
| ⑤ 回归 | tsc 0 错 / vitest 189 绿 / shellcheck 过 / bash -n 过 / unittest 31 绿 |
| ⑥ 验收 | 全部通过 |
