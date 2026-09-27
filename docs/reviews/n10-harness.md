# N10 本地 harness（A20 XML 工具注入） — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | ABSORPTION A20（Continue/Kimi 无原生 tool call 也能跑 agent 的 XML 注入）；本地 14B/8B 原生 tool call 不稳是刚需 |
| ② 先测 | `tests/n10-harness.test.ts` 13 用例（解析 6 + 构造 2 + 模式判定 5）先红（import 失败） |
| ③ 落盘 | `src/harness.ts`：`parseXmlToolCalls`（多块/坏 JSON 标记/缺 name 跳过/空白归一）、`buildXmlToolSection`（工具说明+schema 注入 system prompt）、`resolveHarness`（off/xml/native + auto：openai→xml、anthropic→native、mock→native）；QueryEngine 集成：流结束无原生工具时从 fullText 解析 XML 合成 toolBuffers 走原执行链 |
| ④ 审查 | 连带修复原生路径 bug：JSON 解析失败时 assistant 消息缺 tool_use block → 下轮协议必炸，已补 push |
| ⑤ 回归 | tsc 0 错 / vitest 43 绿 / shellcheck 过 / bash -n 过 / pytest 31 绿 |
| ⑥ 验收 | 全部通过 |

**开关**：`PILOT_HARNESS=xml|off`，默认 auto（本地 OpenAI 协议→xml，云端 Anthropic→native）。
