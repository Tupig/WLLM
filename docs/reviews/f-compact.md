# F1/F2 上下文压缩强化（A13/A14） — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | opencode 阈值梯子分级压缩+压缩熔断+隐藏摘要 agent；Claude Code 压缩非破坏性+keep_first+结果预算；现有 compact 已有 5 阶段但单阈值 0.85 一次性、autoCompact 写死 haiku、无熔断无预算 |
| ② 先测 | `tests/f-compact.test.ts` 13 用例（梯子 5/分级压缩 3/熔断 2/快照 1/预算 2）先红 |
| ③ 落盘 | `pickStrategy`（60/70/85/95% 四级+消息数>100 强制）；`compactByLadder`（分级选 micro/snip/collapse/force）；`recordResult`+`isCircuitOpen`（压缩不降反升→熔断，后续直接返回原消息）；`compactToBudget`（迭代压到预算内，上限 5 次，兜底 budgetReduction）；`getLastOriginal` 非破坏性快照；autoCompact 摘要模型改用传入 model（本地可作隐藏摘要 agent）；QueryEngine 触发口径 0.85→**0.6**（LADDER_MICRO），接入梯子+recordResult+熔断感知 |
| ④ 审查 | 熔断比较改用 before/after 同度量估算（修复传参不一致）；switch 补 default 消 TS2366 |
| ⑤ 回归 | tsc 0 错 / vitest 124 绿 / shellcheck 过 / bash -n 过 / pytest 31 绿 |
| ⑥ 验收 | 全部通过 |
