# E4 OOM→云端回退链 — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | 本地故障形态：ECONNREFUSED/5xx/fetch failed/OOM crash；E1 已有双 provider 基础；回退≠路由（E4 运行时 failover，E9 任务前 routing） |
| ② 先测 | `tests/e4-failover.test.ts` 13 用例（infra 分类 4 + 兜底配置 4 + 切换行为 5）先红（import 失败） |
| ③ 落盘 | `src/providers/failover.ts`：`isInfraError`（模式表：连接/5xx/OOM/hangup，业务错 401/400/max_tokens 不回退）、`resolveFallback`（off 开关/双向对称/openai 优先级与 E1 一致）、`streamWithFailover`（infra 故障才切换+onFallback 回调）；QueryEngine 构造算 fallback client、executeTurn 包裹主流、回退时黄字提示+轨迹记录 |
| ④ 审查 | 测试与 E1 优先级矛盾处修正（anthropic 当前须显式 PILOT_PROVIDER）；mock client 不配 fallback 无害 |
| ⑤ 回归 | tsc 0 错 / vitest 55 绿 / shellcheck 过 / bash -n 过 / pytest 31 绿 |
| ⑥ 验收 | 全部通过 |

**开关**：`PILOT_FAILOVER=off` 可禁用；无云端凭据时自然无兜底。
