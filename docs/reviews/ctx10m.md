# 上下文压缩支持 10M — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 现状 | MAX_CONTEXT_TOKENS 硬编码 30_000；梯子/预算均按小窗口设计（预算迭代固定 5 次、消息数阈值固定 100） |
| ② 先测 | `tests/ctx10m.test.ts` 14 用例（env 解析 5/自适应迭代 4/大窗口消息阈值 3/预算 2）先红 |
| ③ 落盘 | `resolveMaxContextTokens()`：env `PILOT_MAX_CONTEXT_TOKENS` 可配，默认 30_000，合法区间 [30k, **10_000_000**]（超限 clamp、非法回退）；`MAX_CONTEXT_TOKENS` 改为启动时解析（QueryEngine 等既有引用零改动生效）；`adaptiveIterations(est,max)`：≤2M 窗口 5 次、按窗口线性放大、CAP=50，compactToBudget 第 4 参可选默认自适应；`pickStrategy` 消息数阈值 max(100, maxTokens/1000)（10M 窗口放宽到 1 万条），缺省行为完全兼容 |
| ④ 审查 | CAP 单源挪 constants；30k 残留仅剩超时类无关项 |
| ⑤ 回归 | tsc 0 错 / vitest 159 绿 / shellcheck 过 / bash -n 过 / unittest 31 绿 |
| ⑥ 验收 | 全部通过 |

用法：`PILOT_MAX_CONTEXT_TOKENS=10000000 pilot`
