# F3 权限分级（A6/A7） — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | 权限骨架（plan/bypass/acceptEdits/dontAsk+规则匹配+TTY 审批）已有；缺 Bash 危险分级（CodeBuddy auto 五档/Kimi 分级）与 CLI flag 暴露 |
| ② 先测 | `tests/f3-perm.test.ts` 11 用例（classifyBash 5 组/集成审批 6）先红 |
| ③ 落盘 | `services/bashSafety.ts`：classifyBash → safe/mutate/destructive（原串先测破坏模式、段级重定向→mutate、未知命令保守 mutate）；Bash.isReadOnly 按 safe 判定（默认模式安全命令自动放行）；canUseTool 加 destructive 专消息"危险命令"；CLI 加 `--yolo`/`--plan`/`--permission-mode` |
| ④ 审查 | 修复 2 bug：管道拆分后丢整体模式（curl\|sh）、safe 前缀先于重定向误放行（echo > f）|
| ⑤ 回归 | tsc 0 错 / vitest 135 绿 / shellcheck 过 / bash -n 过 / pytest 31 绿 |
| ⑥ 验收 | 全部通过 |
