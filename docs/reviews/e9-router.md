# E9 路由器（纯难度分流 + A23 routelog） — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | 决议：纯难度分流默认（简单本地/难云端）、显式 --model 最高优先、8b 策略（ctx≥14k 或并发>1）、hard+无云回落本地、决策入轨迹供 I4（A23）；发现 index.ts `-m` 参数从未接入 query（bug） |
| ② 先测 | `tests/e9-router.test.ts` 16 用例（启发式 3 + 分流 8 + routelog 2 组）先红（import 失败） |
| ③ 落盘 | `src/router.ts`：`estimateDifficulty`（hard/easy 模式表）、`routeTask`（显式>mock>hard+云>hard回落>easy本地策略>云端网关）、`formatRouteLog`（超长截断）；query() 集成：路由决策→`route.model/routeProvider` 切 client（cloud→anthropic、mock→mock）+ `.wllm/route.log` 追加；index.ts `-m` 接入（默认 undefined 走分流）、commander default 移除 |
| ④ 审查 | TS 重复键/重复声明修正；`.wllm/` gitignore（本地状态不入库）；显式 model 时 provider 判定与 E1 优先级一致 |
| ⑤ 回归 | tsc 0 错 / vitest 87 绿 / shellcheck 过 / bash -n 过 / pytest 31 绿；route.log 实写验证 ✓ |
| ⑥ 验收 | 全部通过 |

**注**：E4 failover（运行时故障回退）与 E9 routing（任务前选择）两层独立且叠加。
