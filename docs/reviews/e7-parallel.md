# E7 并发/流式 — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | 流式 SSE 已通（E1）；工具执行原为纯串行，parallel.ts 旧代码未接入且 executeSingle 漏 ask 分支 |
| ② 先测 | `tests/e7-parallel.test.ts` 7 用例（顺序保持/限流峰值/空/异常 fast-fail/连续 safe 分批/全 unsafe/空分批）先红（import 失败） |
| ③ 落盘 | `mapWithConcurrency`（保序限流）+ `partitionRuns`（连续只读合并、写隔断）；QueryEngine 执行段手术重构：抽 `runToolBuffer` 方法（permission→ask→hook→schema→doom→timeout→record 全链保留，`parallel` 参数控 streaming 锁）、调度层按只读批 `mapWithConcurrency(4)` 并行、坏 JSON 不入执行队列（第一循环已回喂） |
| ④ 审查 | 方法体残留声明冲突与坏 JSON 双回喂问题已修；ask 权限只出现在串行路径（只读批 permission 恒 allow，无并发交互风险） |
| ⑤ 回归 | tsc 0 错 / vitest 74 绿 / shellcheck 过 / bash -n 过 / pytest 31 绿 |
| ⑥ 验收 | 全部通过 |

**并发度**：4（本地单模型场景已足够）。
