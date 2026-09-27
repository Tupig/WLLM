# 重型开源 Coding Agent 调研：OpenHands / Cline / Roo Code

调研方式：websearch + webfetch 检索官方文档与 GitHub README（2025–2026 版本），文档级结论。检索不到的项标注"未获取"。

---

## 一、OpenHands（All-Hands-AI/OpenHands）

**架构与形态**
- 前后端分离：SPA 前端经 HTTP/WS 连后端；后端核心为 EventStream、Storage、Runtime 接口、LLM Providers（docs.openhands.dev/backend）。
- 关键类：LLM（LiteLLM 封装）、Agent（产出 Action）、AgentController（驱动主循环）、State、EventStream、Runtime、Session（单个 EventStream + AgentController + Runtime，对应一个任务）、ConversationManager（会话列表与路由）。
- EventStream 是所有组件通信的中枢：Agent→Controller→EventStream→Runtime，Runtime 执行后把 Observation 写回流，前端也向流发布事件；Event 分为 Action（请求）与 Observation（环境信息）。
- Runtime 为客户端-服务器架构：基于用户镜像构建 OH runtime 镜像 → 容器内启动 ActionExecutionServer（内含 BashSession、Jupyter 插件、BrowserEnv）→ 后端经 REST 发 Action、收 Observation。

**工具与动作空间**
- 论文（arXiv 2407.16741）与文档给出的动作空间以"编程语言"为核心：CmdRunAction（bash）、IPythonRunCellAction（交互式 Python）、文件读/写/编辑动作、BrowseURLAction / BrowseInteractiveAction（网页浏览）、MessageAction、AgentDelegateAction（子 agent 委托）。
- 对应 Observation：CmdOutputObservation、FileRead/FileEditObservation、BrowserOutputObservation、AgentDelegateObservation 等；文档后端类图标注 Bash Session / Jupyter Plugin / BrowserEnv 三个执行端。
- 内置浏览器用于 agent 访问网页；Key Features 页说明早期浏览器面板为非交互式。

**权限审批沙箱**
- 三层机制：Confirmation Mode（高风险动作前暂停，状态置 WAITING_FOR_CONFIRMATION）+ Security Analyzer（评估风险，SDK 提供 LLM 分析器）+ Confirmation Policy（AlwaysConfirm / NeverConfirm，可随时 set_confirmation_policy 切换，reject_pending_actions 拒绝并继续循环）。
- 沙箱 provider 三选一：Docker（默认，隔离，推荐）、Process（无容器隔离，不安全但快）、Remote（托管部署）。挂载走 SANDBOX_VOLUMES（host:container[:rw|ro]），默认工作区 /workspace。

**上下文压缩**
- Condenser 系统（SDK：context/condenser/）：CondenserBase 抽象 + RollingCondenser 阈值触发 + LLMSummarizingCondenser（默认）+ NoOpCondenser + PipelineCondenser（串联多级压缩）。
- 流程：事件数超阈值（max_size 默认 120，keep_first 默认 4 条原文保留）→ 中段交给 LLM 摘要 → 生成 Condensation 事件（含 forgotten_event_ids）写回历史 → 下一步 View.from_events 过滤被遗忘事件并插入摘要。
- 触发分软硬：软触发（阈值/资源超限）失败可跳到下一步重试；硬触发（显式请求、上下文窗口异常）走 hard_context_reset 全量摘要。摘要可用更便宜的模型。

**扩展机制**
- Plugin 打包 skills / hooks / MCP / agents / commands，目录结构兼容 Claude Code 插件（同时认 `.plugin/` 与 `.claude-plugin/`）；hooks 支持 PreToolUse、PostToolUse、SessionStart/End、Stop 等。
- Skills 支持关键词触发（KeywordTrigger），AGENTS.md / CLAUDE.md / GEMINI.md 自动加载为常驻上下文。
- 公共扩展注册表 github.com/OpenHands/extensions（skills/plugins/marketplaces，发布 @openhands/extensions 包）。
- MCP 支持 SSE / Streamable HTTP / stdio 三种传输，配置可走 UI、config.toml、~/.openhands/mcp.json；Tool System 带 ToolRegistry（name→factory 动态实例化）与 ToolAnnotations（MCP 语义 readOnly/destructive/idempotent）。

**记忆会话**
- Session 持有一条 EventStream，ConversationManager 维护活跃会话并路由请求；app_server/event 模块负责事件持久化、查询与实时流。
- 事件溯源模型支持确定性重放（SDK 论文描述 event-sourced state model with deterministic replay）。

**特色功能**
- EventStream 事件溯源统一一切交互，Action/Observation 配对且可重放。
- AgentDelegateAction 多 agent 委托（父/子控制器共享同一 EventStream，按起点隔离事件）。
- Plugin + Skill + 注册表的完整扩展生态。

---

## 二、Cline（cline/cline）

**架构与形态**
- 同一 agent core 覆盖 VS Code 扩展、JetBrains 插件、CLI、SDK：plan/act、MCP、checkpoints、rules、skills、provider 配置跨端一致（apps/cli/README）。
- CLI 形态：交互 TUI（含 plan/act 切换、slash 命令、文件 @ 提及、实时工具审批）、one-shot、`--json` NDJSON、`--yolo`、`--zen` 后台守护；另有 `--acp` ACP 协议模式、`--compaction agentic|basic|off`。
- 新运行时 ClineCore 内置工具收敛为 bash / editor / read_files / apply_patch / search / fetch_web / ask_question（旧文档中的 XML 风格工具名已标 legacy）。

**工具与动作空间**
- 系统提示工具目录（src/core/prompts/system-prompt/tools）：read_file、write_to_file、replace_in_file、apply_patch、execute_command、list_files、search_files、list_code_definition_names、browser_action、web_fetch、web_search、use_mcp_tool、access_mcp_resource、load_mcp_documentation、new_task、subagent、use_skill、focus_chain、ask_followup_question、attempt_completion、plan_mode_respond / act_mode_respond。
- PLAN 模式下 execute_command 只允许非破坏性使用。

**权限审批沙箱**
- Plan/Act 双模式：Plan 只读（读代码、搜索、讨论、出计划，不能改文件/执行命令）；Act 继承 Plan 全部上下文再落地。按任务规模给出 Act-only / Plan→Act / `/deep-planning` 三档建议。
- Auto Approve 按工具逐项评估，9 类权限：读项目文件、读全部文件、编辑项目文件、编辑全部文件、执行安全命令、执行全部命令、使用浏览器、MCP、通知。"全部"类必须先开基础开关。
- 命令安全不由固定白名单决定，而是模型给每条命令打 `requires_approval` 标志；YOLO 模式则全部放行（文件、命令、浏览器、MCP、模式切换）。
- Checkpoints：每次改文件/跑命令做项目快照，可 Compare 看 diff，恢复分三档——Restore Files / Restore Task Only / Restore Files & Task；官方定位是"让 auto-approve 变得可行"的事后安全网。默认开启。无容器沙箱（在宿主执行）。

**上下文压缩**
- Auto Compact：默认常开，约 80% 上下文用量时自动做 LLM 全量摘要替换历史；旧实现是规则截断；非 Claude 系模型回退为规则截断。CLI 可选 agentic/basic/off。
- Context Manager 兜底截断：保留原始任务描述、最近工具执行与结果、当前代码状态与活跃错误，先删冗余历史与已完成的过期工具输出。
- Focus Chain（默认开）：自动生成并维护 todo 清单，压缩后仍可见关键进度。

**扩展机制**
- MCP（stdio/远程、MCP Marketplace、健康监控、逐工具 auto-approve 规则）、Hooks、Skills、Rules（.clinerules）、Workflows、slash 命令、`.clineignore`（官方称可把起始上下文从 200k+ 降到 50k 以内）。

**记忆会话**
- Task 为单位：独立 ID 与存储目录，每条消息后保存对话历史与 clineMessages，文件状态靠 checkpoint 关联；恢复时注入 `[TASK RESUMPTION] ... please reassess` 提示。
- `/newtask`（蒸馏关键决策开新任务）、`/smol`（同任务内压缩）；Memory Bank 为 markdown 分层记忆法（projectbrief/productContext/activeContext/progress 等，配合 .clinerules 指令加载）。

**特色功能**
- Plan/Act 双模式 + Checkpoints 事后回滚 + Auto Approve 分级审批的组合；Focus Chain 跨压缩保持进度；subagent / background edit / worktrees。

---

## 三、Roo Code（RooCodeInc/Roo-Code）

> 现状：README 免责声明称扩展已于 2026-05-15 关停，官方指向社区 fork ZooCode 与上游 Cline；仓库与文档仍公开可读。

**架构与形态**
- VS Code 扩展（Cline fork），pnpm monorepo（packages / webview-ui / apps/docs），Apache-2.0。

**工具与动作空间**
- 工具分组（Tool Use Overview）：Read（read_file、list_files、search_files、codebase_search、read_command_output）；Edit（apply_diff、apply_patch、edit、edit_file、search_replace、write_to_file）；Command（execute_command、run_slash_command）；Image（generate_image）；MCP（use_mcp_tool、access_mcp_resource）。
- Always Available：ask_followup_question、attempt_completion、switch_mode、new_task、skill——不受模式工具组限制。

**权限审批沙箱**
- 每次工具调用都要显式批准：界面给 Save/Reject + auto-approve 选项；写操作以 diff 视图呈现，用户可先改再批准（write_to_file / apply_diff 皆然）。
- Auto-Approve 是"权限矩阵 + 总开关"：读文件、编辑文件、执行白名单命令、用浏览器四类（各标风险等级），Enabled 总闸 + All/None 批量；工作区外读写要额外 flag；写后还有 write-delay 延迟。
- 双重审批：MCP 工具必须同时满足全局"Always approve MCP tools"与该工具自身的"Always allow"才放行（资源访问只看全局开关）；命令侧靠前缀白名单（默认 git log / git diff / git show）。沙箱在宿主 VS Code 终端执行，无容器。

**上下文压缩**
- Intelligent Context Condensing 默认开启：阈值滑块（如 80%）触发，用单独 LLM 调用做摘要；token 计数默认预留 30% 窗口（20% 输出 + 10% 缓冲），历史可用 70%。
- 实现为"非破坏性替换"（src/core/condense）：旧消息打 `condenseParent` 标记存而不用，追加 `isSummary` 摘要消息，`getEffectiveApiHistory()` 只发摘要之后的历史；因此 Checkpoints 回卷仍可用原始消息。
- 摘要时保留 `<command>` 块与折叠文件上下文（tree-sitter 抽取文件签名重新注入），压缩后仍能定位代码。

**扩展机制**
- 自定义模式：全局 `settings/custom_modes.yaml` 或项目 `.roomodes`（YAML/JSON），可让 agent 自己生成；字段含 slug、name、description、instructions、工具组权限、edit 组文件类型限制；可覆盖内置模式、导入导出、Marketplace 一键安装。
- 其余：MCP、`.rooignore`（工具路径校验）、`.roorules` 与 custom instructions、skills、sticky models。

**记忆会话**
- 任务历史按 task 持久化，可从历史恢复；模式与所选模型跨会话记忆（sticky model + mode persistence）。Memory Bank 属社区项目（roo-code-memory-bank），非内置。

**特色功能**
- apply_diff：以 `:start_line:` 行号提示 + 归一化字符串 Levenshtein 模糊匹配，在 BUFFER_LINES 上下文窗口内"由中间向两端"定位替换块；含 confidence 阈值、.rooignore 校验、按文件统计 consecutiveMistakeCountForApplyDiff 防反复失败；先出 diff 视图审批再落盘。
- 模式体系：Code（全工具）、Architect（read+mcp+仅 markdown 的受限 edit）、Ask（只 read+mcp，不改文件）、Debug（全工具 + 反思/加日志/修复前确认的定制指令）、Orchestrator（Boomerang，无直接工具，只用 new_task 派发）；每模式可绑不同模型并自动切换。

---

## 四、对 WLLM 的吸收建议（WLLM = 本地 Qwen 驱动的 TS coding agent）

**高**
1. **模式化收窄动作空间**（Roo）：按 architect/code/ask/debug 切换工具组与文件类型白名单，本地小模型能力参差，用模式硬约束比靠 prompt 更可靠；顺带吸收"每模式绑定模型"。
2. **plan/act 双模式 + 分级审批 + checkpoints**（Cline）：Plan 只读、Act 落地，命令按模型标记 requires_approval 分安全/需审批，改动用 git 快照事后回滚——本地无 CI 时这是最低成本的安全网。
3. **上下文压缩为一等公民**（OpenHands Condenser + Roo 非破坏性摘要）：keep_first 保系统提示与首条任务、中段 LLM 摘要、软硬双触发、压缩后保留 todo；务必非破坏性（打标记 + 单独摘要消息），便于回卷与调试。Qwen 上下文有限，这是刚需。
4. **apply_diff 模糊匹配**（Roo）：行号提示 + Levenshtein + 上下文窗口 + 连续错误计数，明显提升小模型编辑成功率，且比整文件重写省 token。

**中**
1. **统一 Action/Observation 事件流**（OpenHands）：单一事件日志贯穿 UI、工具、模型，天然支持审计、流式渲染与重放；TS 实现成本可控，建议做成轻量事件总线而非完整溯源系统。
2. **双重审批**（Roo MCP 模式）：全局开关 + 单项白名单两级，WLLM 接 MCP 时照搬，避免一次全放行。
3. **可选 Docker 沙箱**（OpenHands）：默认本机执行 + 可选容器（挂载、只读卷）两档，别做成默认强依赖。
4. **自定义模式即配置文件**（Roo `.roomodes`/YAML）与 **插件打包 skills+hooks+MCP**（OpenHands）：都是 TS 友好的声明式扩展，适合作为 WLLM 扩展规范蓝本。

**低**
1. OpenHands 常驻 Docker/Remote runtime 与 V0→V1 迁移中的双术语（runtime vs sandbox）——本地单机场景成本高，只取其接口形状。
2. Cline Memory Bank 等纯 markdown 记忆方法论——可作为文档建议，不必内置实现。
3. Roo 的 generate_image、Marketplace、Cline 的 YOLO 全放行——与本地安全诉求相悖或非核心。
