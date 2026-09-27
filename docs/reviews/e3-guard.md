# E3 卡死修复（BUG-1 + A21） — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | 主循环本身有 maxTurns/空结果 break 保护；真凶三处：doom loop 无检测（同动作无限重试模型路径）、`tool.call` 无整体超时（工具阻塞=卡死）、非 TTY 下 `promptUser` 等 stdin 挂 30s/次；旧疑点 api.ts id 拼接已由 E1 `parseOpenAISSE` 兜底覆盖 |
| ② 先测 | `tests/e3-guard.test.ts`（doom 4 例 + withTimeout 3 例）+ `tests/e3-e2e.test.ts`（mock 端到端 20s 限时 + 非 TTY <2s 拒绝）先红（9 failed） |
| ③ 落盘 | `createDoomDetector(3)` 连续同签名 3 次回喂中断错误；`withTimeout` 包裹工具执行（TOOL_TIMEOUT_MS=30s）+ catch 回喂；`promptUser` 非 TTY 立即 false；事件形状修正为 `{type:"tool_use"}` |
| ④ 审查 | doom 分支正确释放 streaming 锁；超时异常不冒泡主循环 |
| ⑤ 回归 | tsc 0 错 / vitest 30 绿 / shellcheck 过 / bash -n 过 / pytest 31 绿 |
| ⑥ 验收 | 全部通过 |

**未做（记录边界）**：Anthropic SDK 流整体超时（本地走 OpenAI 已有 1800s Abort；云端 SDK 自带重试）。
