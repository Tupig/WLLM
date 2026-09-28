# N6 子代理强化（A15） — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | ABSORPTION A15；research/claude-code §3（独立上下文/白黑名单两层掩码/嵌套默认关/`.claude/agents/*.md`）、opencode（文件即 agent、subagent 默认禁 todo）、augment（`.augment/agents/*.md` 只读 explorer） |
| ② 先测 | `tests/n6-subagent.test.ts` 29 用例先红（`src/subagent/agents` 不存在、execute 签名不符） |
| ③ 落盘 | `src/subagent/agents.ts`：`parseAgentFile`（frontmatter 门禁 description/名字正则/maxTurns 数值回退）、`loadAgents`（内置 → `~/.wllm/agents` → `.wllm/agents`，后者覆盖，超大/非法跳过）、`maskTools`（固定黑名单→白名单→黑名单优先→readOnly）、`formatAgentCatalog`（预算截断）、`resolveSubAgentModel`；`src/subagent/index.ts` 重写：注入流、独立上下文、权限 fail-closed、XML harness；`src/tools/Agent.ts`：Agent 工具（alias Task）+ 注册表懒加载；`tools.ts` 注册（默认 11→12）；`QueryEngine` 构造注入注册表；`modes` plan 模式禁 Agent/Task |
| ④ 审查 | 删测试内未用 `scriptStream`（死代码）；`setAgentRegistry` 补 workDir 以避免 Agent 工具重复 load；权限：deny/ask→is_error 回喂继续、无回调时非只读一律拒、子代理内不弹框；嵌套由固定黑名单 `Agent/Task/TodoWrite` 恒移除；agent 名正则 `^[A-Za-z0-9_-]+$` 防路径注入；无回调拒绝时 tool.call 收到恒 deny 的 canUseTool |
| ⑤ 回归 | tsc 0 错 / vitest 250 绿（24 文件）/ bash -n 过 / shellcheck 仅 info 级既有告警 / pytest 31 绿 |
| ⑥ 验收 | 见下表，全过 |

## AC

- [x] agent 文件：`.wllm/agents/*.md` + `~/.wllm/agents/`，frontmatter name/description/tools/disallowedTools/model/maxTurns/readOnly，body=系统提示；缺 description、无 frontmatter、超 50KB 一律拒绝
- [x] 内置 `explore`（只读）/`general`，项目文件可覆盖同名内置
- [x] 工具掩码：固定黑名单恒生效（防嵌套委派与 todo 污染）→ 白名单 → 黑名单优先 → readOnly 裁剪
- [x] 独立上下文：execute 只用任务描述起头，父消息（含危险指令）不泄漏，测试断言首轮 messages 长度=1
- [x] 权限 fail-closed：deny 回喂继续、ask 转 deny 不弹框、无回调时非只读拒绝、只读放行
- [x] 模型不再硬编码 `claude-sonnet-4-*`：task.model > agent.model > 父模型 > env
- [x] XML harness：`PILOT_HARNESS=xml` 时子代理注入工具说明并解析 `<tool>` 块
- [x] Agent 工具入默认集，描述注入 agent 目录；未知 agent 返回可用列表；plan 模式不可见
- [x] 四连门槛全绿
