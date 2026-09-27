# E6 系统提示本地化 — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | buildSystemPrompt 硬编码 6 件工具清单（与 E5 后 10 件不符）、逻辑全在私有方法不可测 |
| ② 先测 | `tests/e6-prompt.test.ts` 5 用例（动态全工具+description/不含已裁/原则中文/规则与 append 追加/空段不产空标题）先红（import 失败 + description 签名错） |
| ③ 落盘 | `src/prompt.ts` `renderSystemPrompt(tools, opts)` 纯函数：动态工具目录、原则列表、rules/state/append 追加、harness XML 段；QueryEngine.buildSystemPrompt 委托之 |
| ④ 审查 | Tool.description(input) 签名核实传 `{}`；作用域笔误修正 |
| ⑤ 回归 | tsc 0 错 / vitest 67 绿 / shellcheck 过 / bash -n 过 / pytest 31 绿 |
| ⑥ 验收 | 全部通过 |
