# E8 mlx 收尾（pytest/vitest 边界） — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | config.env（1800s/14b）与 E2 constants 一致；WebSearch 后端=DuckDuckGo HTML（无需 key，A19 可用）；`git show baseline` diff 证实文件 31 用例自始未变（A5 记 33 有误）；`bin/llm chat --max-time 300` 与 1800 不一致；§6 遗留表多处状态过期 |
| ② 测试 | pytest 31 收集=通过（边界：python 测试归 pytest，TS 归 vitest，四连已含双方） |
| ③ 落盘 | `bin/llm` max-time→1800；INVENTORY §5 修正（31+分布 12/4/7/3/5）；§6 遗留表全部更新为已修/待 H1 |
| ④ 审查 | 与 baseline 逐 `def test_` diff 零差异，排除"丢用例"误判 |
| ⑤ 回归 | tsc 0 错 / vitest 74 绿 / shellcheck 过 / bash -n 过 / pytest 31 绿 |
| ⑥ 验收 | 全部通过 |
