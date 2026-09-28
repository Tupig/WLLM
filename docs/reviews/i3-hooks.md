# I3 Hooks 退出码语义 + fail-closed（A9） — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | hooks/system.ts 已有事件体系与 PreToolUse 阻断链路，但 shell hook 只读 stdout JSON；**超时/崩溃 finish({})=放行（fail-open，A9 反模式）**；无退出码语义、无配置文件加载 |
| ② 先测 | `tests/i3-hooks.test.ts` 15 用例（interpretShellExit 7/实跑 4/配置 4…含 PreToolUse 匹配）先红 |
| ③ 落盘 | `interpretShellExit`：**0=放行**（stdout JSON 可带 block/replacement）、**2=阻断**（stderr 作回喂消息，Claude Code 语义）、其他非零/超时/spawn 失败=**fail-closed 阻断**（`PILOT_HOOKS_FAIL_OPEN=1` 可放开）；triggerShellHook 接入（close/超时/error 三路径全走语义判定）；`loadShellHooks` 读 `.wllm/hooks.json`（或 `PILOT_HOOKS_FILE`）坏容错；QueryEngine 构造注册，PreToolUse 既有阻断链路自动生效 |
| ④ 审查 | 修复参数语义（failOpen 默认 false 即 fail-closed 生效）|
| ⑤ 回归 | tsc 0 错 / vitest 204 绿 / shellcheck 过 / bash -n 过 / unittest 31 绿 |
| ⑥ 验收 | 全部通过 |

配置示例（`.wllm/hooks.json`）：
```json
[{ "event": "PreToolUse", "matcher": { "tool_name": "Bash" }, "command": "..." }]
```
