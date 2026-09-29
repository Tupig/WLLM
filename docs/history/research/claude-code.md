# Claude Code 调研

来源：code.claude.com/docs（agent-loop / memory / sub-agents / hooks / permissions / sandboxing / skills / output-styles / context-window / checkpointing / sessions / worktrees / tools-reference / best-practices）、Anthropic 平台文档与 cookbooks、changelog、GitHub issue。搜索于 2026-09。未获取项已标注。

## 1. 架构：agent 循环、并行、流式

- 循环即 `while(true)`：模型产出 → 执行工具 → 结果回填 → 重复，直到无 tool_use；一次循环＝一个 turn。SDK 流出 `AssistantMessage` / `UserMessage` / `StreamEvent` / `ResultMessage`（含 cost、session_id、subtype）等 5 类消息。
- 官方源码拆解：核心在 `src/query.ts`（约 1730 行的 async generator），REPL、SDK、子代理、headless `-p` 全走同一 `query()`，用 `yield*` 组合子生成器，天然背压。
- 并行：只读工具（Read/Glob/Grep、标 readOnlyHint 的 MCP 工具）并发；改状态的 Edit/Write/Bash 串行。自定义工具默认串行。
- 流式工具执行（feature gate）：`StreamingToolExecutor` 在 `tool_use` 块还在流式到达时就开始跑工具，模型输出还没结束、第一个工具结果已在手，整体延迟下降；失败回退模型时 `discard()` 丢弃在途结果并重建执行器。
- 协议安全网：孤儿 `tool_result` 补齐、可恢复错误（prompt-too-long）先"扣留"不外抛、模型 fallback（发 tombstone 事件让 UI 撤下已显示消息）。
- 并行 API 侧：所有 tool_result 必须在同一条 user 消息里、且排在文本前，否则模型会退化成不再并行调用。

## 2. 记忆系统

- CLAUDE.md 层级（加载顺序＝上下文出现顺序，后出现＝优先级高）：managed policy → `~/.claude/rules/*` → `~/.claude/CLAUDE.md` → 祖先目录 CLAUDE.md → `./CLAUDE.md`（或 `.claude/CLAUDE.md`）→ `CLAUDE.local.md` → `.claude/rules/*` → auto memory。**拼接而非覆盖**。
- 目录遍历：从 cwd 向上走到根，再 `reverse()` 从根向下拼，越靠近 cwd 越靠后；子目录 CLAUDE.md **按需加载**（读到该子目录文件时才注入），不随启动全量加载。
- 支持 `@path` 导入外部文件；HTML 块注释注入前被剥离；单文件上限 4 MiB，超限跳过。`.claude/rules/*.md` 可用 `paths:` 做路径限定。
- auto memory（默认开）：`~/.claude/projects/<sanitized-git-root>/memory/`，`MEMORY.md` 作索引 + 每条一个主题文件；启动只读前 200 行或 25 KB，主题文件按需。同 repo 的所有 worktree 共享一份。
- `#` 快速记忆快捷键已于 **v2.0.70 移除**，现改为「直接告诉 Claude 记住」或 `/memory` 打开编辑器；`/memory` 还能列全部记忆文件、开关 auto memory、打开记忆目录；`/init` 生成/建议 CLAUDE.md；`/context` 查看实际加载了哪些记忆文件。
- 压缩后：项目根 CLAUDE.md 与 auto memory 从磁盘重注入；子目录 CLAUDE.md 和带 `paths:` 的 rules 会丢，直到再次读到匹配文件。

## 3. 子代理（原 Task 工具，v2.1.63 改名 Agent）

- 每个子代理**全新独立上下文**：看不到父会话历史、已调用 skill、已读文件；唯一通道是 Agent 工具的 prompt 字符串，故 prompt 必须自包含。例外是 **fork**：继承父完整对话/系统提示/工具，但其工具调用仍不进父上下文。
- 工具掩码：`tools` 白名单 / `disallowedTools` 黑名单（两者都写则黑名单优先）。两层过滤：固定黑名单对所有子代理生效；后台子代理（默认）再被裁剪到一个内置工具子集。deny 裸工具名＝从上下文移除。
- 内置：Explore、Plan、general-purpose；`Explore`/`Plan` 故意跳过 CLAUDE.md 与父 git status（更快更便宜）。deny `Agent(name)` 禁某类型，deny 裸 `Agent` 禁全部委派。
- 定义：`.claude/agents/*.md` / `~/.claude/agents/`，frontmatter 含 `description`（路由逻辑，必须写成触发条件）、`model`（默认 `inherit`，想省钱必须显式设）、`permissionMode`、`maxTurns`、`skills`（预加载全量）、`memory`、`isolation: worktree`、`background`、`effort`、`mcpServers`、`hooks`。
- 嵌套默认关闭（子代理拿不到 Agent 工具）；开三层深度上限，到顶自动收走工具。子代理可被 resume（结果尾部带 `agentId`）。前台子代理逐次弹权限框，后台子代理不弹、遇未授权工具自动 deny 后继续。

## 4. hooks 生命周期

- 触发粒度：每会话一次（`SessionStart`/`SessionEnd`/`Setup`）；每 turn 一次（`UserPromptSubmit`/`Stop`/`StopFailure`）；每次工具调用（`PreToolUse`/`PostToolUse`/`PostToolUseFailure`）；另有 `PostToolBatch`（一批并行工具结束、下次模型调用前）、`PermissionRequest`/`PermissionDenied`、`SubagentStart/Stop`、`PreCompact`/`PostCompact`、`Notification`、`TaskCreated/Completed`、`InstructionsLoaded`、`ConfigChange`、`CwdChanged`、`FileChanged`、`WorktreeCreate/Remove`、`TeammateIdle`、`MessageDisplay`、`Elicitation` 等。
- matcher 过滤工具名（`Edit|Write`、`mcp__.*`）、会话来源（`startup|resume|clear|compact|fork`）等；`if` 字段用权限规则语法（如 `Bash(git *)`）限定 hook 只在匹配调用上跑。
- 退出码协议：0＝无异议（**不等于批准**，正常权限流程照走）、2＝阻断（stderr 回喂给模型）；JSON 输出可给 `permissionDecision: allow/deny/ask/defer`、`additionalContext`、`updatedToolOutput`。
- 关键点：hook 跑在宿主进程、**不占上下文**；`Stop` 返回阻断错误可把"你说完了但 lint 还有 3 个错"塞回去让循环继续（带 `stopHookActive` 防重入）；`PreToolUse` 可短路执行。hook 类型：`command`/`http`/`mcp_tool`/`prompt`（LLM 判断）/`agent`。

## 5. 计划模式、/compact 与自动压缩

- Plan mode = 权限模式 `plan`（Shift+Tab 循环 default→acceptEdits→plan），只读：可读文件、跑只读命令，写操作被 `canUseTool()` 硬拦，唯一可写的是计划文件。Enter/Exit 是一对 deferred 工具，进入时存 `prePlanMode`，退出时恢复。
- 5 阶段：探索 → 写 `.claude/plan.md` → 自校验 → 呈现 → 批准/修改/拒绝。`ExitPlanMode` 带 `allowedPrompts[]`（计划中预批准的命令，执行期免弹框）与 `planWasEdited`；子代理禁止进 plan mode。
- 压缩分层（请求前管线，顺序固定）：单条工具结果预算 → history snip → microcompact → context collapse → proactive auto-compact → 请求 → 失败后 reactive compact 恢复。
- 有效窗口 = 模型窗口 − min(max_output_tokens, 20k 摘要预算)；autocompact buffer 13k、警告 buffer 20k。`/autocompact 500k`、`--autocompact`、`CLAUDE_CODE_AUTO_COMPACT_WINDOW` 三处可设。
- microcompact ≠ 小号摘要：基于时间空档清理旧 tool_result；cached microcompact 走 API `cache_edits` 服务端删除；session memory compact 在全量摘要前先试，只保留约 40k 近期消息。（细节来自源码分析与 issue，非官方文档，参数由远端 flag 控制。）
- `/compact [指令]` 可指定保留重点；压缩后重注入项见第 2 节。官方建议：任务切换用 `/clear`，带焦点 `/compact`，错了用 `/rewind` 而非继续打补丁。

## 6. 权限系统

- 三类规则 `permissions.allow / ask / deny`，求值顺序固定 **deny → ask → allow**，与具体度无关（宽 deny 会压过窄 allow）。规则格式 `Tool` 或 `Tool(specifier)`。
- Bash glob：`Bash(npm run *)`、`Bash(git * main)`、`Bash(* --version)`；`*` 可出现在任意位置且可跨参数；带空格的尾部 `*` 施加词边界（`Bash(ls *)` 匹配 `ls -la` 不匹配 `lsof`），`Bash(ls*)` 无词边界；`:*` 等价尾通配。裸工具名 deny（`Bash`）＝把工具从模型上下文里移除。
- 路径规则：`Read(~/secrets/**)`、`Edit(/src/**)`、`WebFetch(domain:example.com)`、`Agent(Explore)`、`Skill(deploy *)`。内置只读 Bash 白名单（ls/cat/grep/git 只读形式等）不可配置，只能用 ask/deny 反向覆盖。
- 权限模式：`default` / `acceptEdits` / `plan` / `auto`（独立分类器模型审查动作，进 auto 时会丢弃 `Bash(*)`、`Bash(python*)` 等宽泛 allow）/ `dontAsk` / `bypassPermissions`。deny、显式 ask 在所有模式生效。
- sandbox：OS 级隔离 Bash 及其子进程的文件系统与网络，与权限**互补**（权限管"能不能用这个工具"，sandbox 管"命令跑起来能碰什么"）。`sandbox.filesystem.allowWrite/denyWrite/denyRead/allowRead`、`allowedDomains/deniedDomains`、`strictAllowlist`、`allowUnsandboxedCommands:false`（严格模式）。默认可写范围＝cwd + 会话临时目录 + `--add-dir`。`autoAllowBashIfSandboxed: true` 时沙箱内命令免弹框（plan mode 例外）。
- 系统提示词/CLAUDE.md **不改变**权限判定——只影响模型想做什么。

## 7. skills、MCP、slash commands、output styles

- **commands 与 skills 已合并**：`.claude/commands/deploy.md` 和 `.claude/skills/deploy/SKILL.md` 都产生 `/deploy`；推荐目录式，能带附属文件与 frontmatter。
- SKILL.md = YAML frontmatter + 正文。关键字段：`description`（自动触发路由，与 `when_to_use` 合计截断 1536 字符）、`disable-model-invocation`（仅用户可 `/` 调用）、`user-invocable`（仅模型可调）、`allowed-tools` / `disallowed-tools`（仅本轮生效，下条消息清空）、`paths`（glob 限定激活）、`context: fork`（在子代理里跑）、`background`、`effort`、`shell`。
- 渐进披露：启动只载入所有 skill 的 name+description，`SKILL.md` 正文按需读；建议正文 < 500 行，参考文件**只放一层**（嵌套引用会导致模型用 `head -100` 预览而读不全）；`` !`cmd` `` 语法在注入前跑 shell 并把输出替换进上下文（可用 `disableSkillShellExecution` 关闭）。skill 列表预算默认为上下文的 1%，溢出时最久未用的描述先被截断。
- skill 正文注入后整个会话常驻，压缩后重注入但受每 skill 5,000 / 总 25,000 token 上限，最旧先丢——重要指令放文件开头。
- MCP：`claude mcp add`（stdio/http），scope 有 local（`~/.claude.json` 按项目）/ project（`.mcp.json`，入库）/ user；`/mcp` 管理、重连、enable/disable 与 OAuth；工具名 `mcp__server__tool`；输出超阈值落盘为文件并告警（`anthropic/maxResultSizeChars` 可提高，上限 50 万字符）；远端服务器有 discovery cache（延迟到首次调用才连接）。
- output styles：直接**改写 system prompt**，默认丢弃内置软件工程指令（`keep-coding-instructions: true` 可保留）；内置 Default / Proactive / Explanatory / Learning / Concise；会话启动时构建一次，改了要 `/clear` 才生效；不作用于子代理（fork 除外）。存 `.claude/output-styles/*.md` + `outputStyle` 设置。

## 8. 上下文管理 / token 预算 / 微上下文技巧

- `/context` 分类查看当前上下文占用；`/cost` 看消耗。官方 best practices 的核心约束："上下文是最需要管理的资源，越满表现越差"。
- 微技巧：CLAUDE.md 保持精简（"删掉这行会不会出错？不会就删"），领域知识放 skill 而非常驻 CLAUDE.md；任务间 `/clear`；`/compact <焦点>`；子代理吃掉大段读取；CLAUDE.md 注释可被剥离以省 token。
- tool-result 预算：聚合上限与按工具上限（issue 中观察到全局 200k、Bash 30k、Grep 20k、单条 50k 等，由远端 flag 控制）；被清的 tool_result 保留 `tool_use` 记录，模型需要时重调工具即可。
- 平台侧对应原语：`compact_20260112`（服务端压缩，可 `instructions` 替换摘要提示、`pause_after_compaction` 暂停以便续写）、`clear_tool_uses_20250919`（工具结果清理，`keep` 默认留 3 次）、`memory_20250818`。分工：压缩管全窗口、清理管可重取数据、memory 管跨会话。
- 任务级 token 预算（`+500k` / `spend 2M tokens`、`output_config.task_budget`）与上下文压力管理是两套机制，压缩后从剩余预算中扣除压缩前上下文大小。

## 9. 会话管理

- `claude --continue` 最近会话、`--resume [id]` 选择器或按名、`/resume` 会话内切换、`--from-pr`；transcript 存 `~/.claude/projects/<cwd 转义>/*.jsonl`。`--resume <id>` 现在可跨项目全局搜索（仅当唯一命中）。
- `--fork-session` / `/branch` 复制历史成新会话，原会话不动；fork 只分支对话，不分支文件系统。`/clear` 开新对话（同进程 rewind 菜单可回 `/resume (previous session)`）。
- worktree 并行：`claude --worktree <name>` 或会话中 `EnterWorktree`；默认建在 `.claude/worktrees/<name>`、新分支 `worktree-<name>`、`worktree.baseRef` 默认 `fresh`（从 origin 默认分支）。可 `EnterWorktree({path})` 在多个 worktree 间直接切换；退出时检查改动提示保留/删除；子代理 `isolation: worktree` 拿临时 worktree、无改动自动清理；`WorktreeCreate/Remove` hook 可替换 git 逻辑支持 SVN 等。
- 隔离执行：worktree 会话内会拦截把写操作导回主 checkout 的命令。transcript 随 worktree 迁移（v2.1.198+）。
- 并行的四种形态：子代理（会话内委派）、agent view（`claude agents` 后台会话面板）、agent teams（实验、默认关）、dynamic workflows（脚本化多子代理 + 交叉验证，关键词 `ultracode`）。

## 10. 特色功能

- **checkpoint / `/rewind`**：每次用户 prompt 生成一个 checkpoint，保留最近 100 个；双击 Esc（输入框空时）开菜单。动作：恢复代码+对话 / 只恢复对话 / 只恢复代码 / Summarize from here / Summarize up to here。checkpoint 随会话存，resume 后仍可 rewind。限制：只跟踪 Write/Edit/NotebookEdit，**Bash 改的文件不跟踪**；子代理编辑不跟踪（前台 fork skill 例外）；符号链接/硬链接跳过。
- **任务清单工作流**：`TodoWrite` 自 v2.1.142 起默认禁用，改为 `TaskCreate` / `TaskGet` / `TaskList` / `TaskUpdate`（`CLAUDE_CODE_ENABLE_TASKS=0` 可回退）；配套 `TaskCreated`/`TaskCompleted` hook，`TaskCompleted` 返回阻断可回滚完成状态。
- **teleport**：`/teleport`（`/tp`）把云端会话拉到本终端（取分支 + 对话），支持 Web→CLI 方向，当前 checkout 与会话 repo 不匹配时会提示；另有 `/remote-control` 让本地会话在别的设备继续。
- 其他：`/doctor`（`/checkup`）配置体检（重复项、慢 hook、未用 skill、上下文成本）；`/branch`、`/fork`；`/batch`（5–30 个 worktree 子代理各开 PR）；`&` 前缀发后台任务到 web 会话；computer use 进 CLI。
- 未获取：`/check` 独立命令的官方文档（文档/changelog 中未见，仅见 `/checkup` 别名）。

## 对 WLLM 的吸收建议

WLLM＝本地 Qwen 模型驱动、仿 Claude Code 架构的 TS agent。

| 优先级 | 建议 | 理由 |
| --- | --- | --- |
| **高** | 分层记忆：全局/项目/子目录 CLAUDE.md 向上遍历 + 拼接 + 子目录按需加载 + `@path` 导入 | 纯文件操作，零模型成本，收益立竿见影；小模型对"就近规则放最后"的顺序尤其敏感 |
| **高** | 权限三段式 deny→ask→allow + `Tool(specifier)` glob（含词边界语义） | 安全底座，实现成本低；本地小模型更容易越权，规则引擎必须在宿主侧硬执行 |
| **高** | hooks 生命周期（至少 PreToolUse / PostToolUse / Stop / PreCompact），退出码 0/2 协议 + JSON 决策 | 唯一"确定性"控制手段，且不占上下文；小模型靠 prompt 约束不可靠，靠 hook 可靠 |
| **高** | 子代理独立上下文 + 工具白名单 + 只读探索代理 | 小模型上下文更金贵（本地 8–14B），把大段读取关进子代理只回摘要，是收益最大的一条 |
| **高** | 请求前多级压缩管线：工具结果预算 → microcompact（清旧 tool_result）→ 阈值 auto-compact | 本地长会话必撞墙；先清可重取的 tool_result 再做全量摘要，成本低得多 |
| **中** | skills（SKILL.md + frontmatter + 渐进披露 + 一层引用 + 启动只载 description） | 与 slash commands 合一，显著省 token；注意描述预算与"正文 < 500 行" |
| **中** | plan mode：`prePlanMode` 存取、只读硬拦截、计划文件唯一可写、批准时带 allowedPrompts | 有效降低小模型"想错就动手"的代价 |
| **中** | checkpoint + `/rewind`（用 shadow git 快照，补上 Bash 改动不被跟踪的短板） | 比让小模型自己撤销可靠；shadow git 方案简单可抄 |
| **中** | 会话 resume/fork/worktree 并行 + `/clear` 与 `/compact` 的场景分流 | 本地无云端会话能力，但 worktree 隔离与 fork 完全可做 |
| **中** | 流式工具执行（tool_use 块到达即启动）+ 只读并发/写串行 | 本地推理慢，工具与生成重叠的延迟收益比云端更明显 |
| **低** | MCP 全量接入 | 本地场景需求弱，先做内置工具与 skill 脚本；需要外部集成时再上 stdio |
| **低** | output styles（改写 system prompt） | 有用但边际；本地小模型受 system prompt 影响大，调好默认提示更划算 |
| **低** | auto memory 自动抽取、agent teams、dynamic workflows、teleport/cloud 联动 | 依赖额外模型调用或云端，本地单机收益有限；auto memory 可后置 |

**先抄三件**：分层记忆加载顺序、hooks 确定性控制、子代理上下文隔离。
