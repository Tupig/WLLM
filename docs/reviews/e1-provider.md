# E1 provider 抽象 — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | 现有 api.ts 三态（mock/openai/anthropic）；B1 opencode/B2 codex 多协议配置模式；发现 `base + "/v1/..."` 双 v1 拼接缺陷 |
| ② 先测 | `tests/e1-provider.test.ts` 15 用例先红（14 failed 确认） |
| ③ 落盘 | `resolveProvider()` 显式优先级（PILOT_MOCK > PILOT_PROVIDER > OpenAI env > Anthropic env）；`chatUrl()` 归一（裸 host/尾斜杠/已含 v1/网关子路径）；`parseOpenAISSE()` 抽纯生成器导出，可测；`createClient` 改走 resolveProvider |
| ④ 审查 | 测试转义缺陷修正（`\"`→`\\\"`）；无 process.exit 泄漏进纯函数 |
| ⑤ 回归 | tsc 0 错 / vitest 16 绿 / shellcheck -S warning 过 / bash -n 过 / pytest 31 绿 |
| ⑥ 验收 | 全部通过。key 仍全程 env（git 零密钥已核） |

**覆盖**：全协议兼容（OpenAI 兼容网关任意 baseURL、Anthropic 原生、Mock）、优先级、SSE tool_calls 分片/id 兜底/并行分流/坏行容错。
**未做（归 E9/E2）**：模型默认值与 timeout 属 E2；路由分流属 E9。
