# E2 本地模型参数 — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | constants 三处与本地决议不符（claude-sonnet 默认 / 200k 窗口 / 60s 超时）；PILOT_MODEL 逻辑散落 index.ts 三处 |
| ② 先测 | `tests/e2-config.test.ts` 5 用例先红（5 failed） |
| ③ 落盘 | `DEFAULT_MODEL=14b`、`MAX_CONTEXT_TOKENS=30_000`、`API_FETCH_TIMEOUT_MS=1_800_000`；抽 `resolveModel()` 统一三处调用 |
| ④ 审查 | 注释按规范不添加；AppState/QueryEngine 仍读 DEFAULT_MODEL 自动生效 |
| ⑤ 回归 | tsc 0 错 / vitest 21 绿 / shellcheck 过 |
| ⑥ 验收 | 全部通过 |

**边界**：8b 分流策略归 E9 路由；30k 的阈值梯子/熔断归 F1。
