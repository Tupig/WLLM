# N4 会话恢复与分叉（A5） — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | B4：pilot REPL 每轮新建 engine **历史全部丢失**（重大缺陷）；A5 来源 resume/fork 分叉语义 |
| ② 先测 | `tests/n4-session.test.ts` 10 用例（save/load 4/list 2/fork 4）先红 |
| ③ 落盘 | `src/session.ts`：saveSessionMessages/loadSessionMessages（损坏容错 null）/listSessions（倒序+预览）/forkMessages（**剔除尾部悬挂 tool_use**，纯文本 assistant 保留）；QueryEngine 加 `initialMessages` 续接 + `getSessionMessages()` + SDKMessage `session` 事件（query 尾部回传终态）；REPL 持 history、每轮自动存盘 `.wllm/sessions/<id>.json`，新命令 `/sessions` `/resume <id>` `/fork <id> <条数>` |
| ④ 审查 | 修复 fork 规则矛盾（仅剔 tool_use 悬挂）；list 排序测试加 10ms 间隔避免同毫秒乱序 |
| ⑤ 回归 | tsc 0 错 / vitest 176 绿 / shellcheck 过 / bash -n 过 / unittest 31 绿 |
| ⑥ 验收 | 全部通过（多轮历史跨 REPL 轮次延续由 initialMessages 保证） |
