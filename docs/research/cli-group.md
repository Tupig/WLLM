# 开源 CLI Coding Agent 调研（4 个）

> 资料来源：各项目 GitHub README 与官方文档（实搜于 2026-09）。搜不到的项标注"未获取"。

## 1. gemini-cli（google-gemini/gemini-cli）

- **架构与形态**：TypeScript monorepo，npm workspaces。`packages/cli`（React/Ink 终端 UI）↔ 本地 `packages/core`（API 编排、prompt 构建、工具执行）；另有 `packages/sdk`（可嵌入 SDK）、`a2a-server`（实验性 Agent-to-Agent）、`vscode-ide-companion`。支持交互式、headless（`-p`）与 GitHub Action。
- **工具集**：`ToolRegistry` 统一注册。内置 read/write_file、read_many_files、run_shell_command、web_fetch、google_web_search、save_memory、MCP 资源读写、plan 模式进出、`activate_skill`、`get_internal_docs`、实验性任务追踪器。
- **权限审批沙箱**：写文件/执行 shell 属 mutator，需人工确认并展示 diff 或原始命令；可选容器沙箱隔离；Policy Engine 做细粒度执行控制；Trusted Folders 限定可用项目；`.geminiignore` 排除文件。
- **上下文压缩**：`model.compressionThreshold`（默认 0.5）触发自动压缩；`/compress` 手动用摘要替换全部上下文；压缩模型可按 `chat-compression-*` 配置切换；工具级 token 预算（run_shell_command 支持摘要）；`maxSessionTurns` 限会话长度。
- **扩展机制**：MCP server；Extensions（`gemini-extension.json` 打包命令/MCP）；Agent Skills（`.gemini/skills`，`activate_skill` 加载）；hooks、custom commands、`tools.discoveryCommand` 自定义工具。
- **记忆与会话持久化**：分层 GEMINI.md（`/memory list|refresh`）+ `save_memory`；会话按项目哈希存于 `~/.gemini/tmp/<project_hash>/`，`--resume`/`/resume` 会话浏览器、手工 checkpoint（save/resume/share）、默认保留 30 天。
- **多模型支持**：仅 Gemini 系；Model routing 自动 fallback（pro→flash），内部调用 silent fallback 链；实验性本地 Gemma 路由决策。
- **特色功能**：Checkpointing（改动前写 shadow Git 仓库 `~/.gemini/history/<project_hash>`，可 `/restore` 回滚文件+对话+工具调用）；Rewind 三档回退（只回对话/只回代码/全回）并可 fork 分支；Plan Mode、Subagents、Token Caching、Telemetry。

## 2. Qwen Code（QwenLM/qwen-code）

- **架构与形态**：TypeScript monorepo，`packages/cli` + `packages/core`；多形态：交互式 `qwen`、headless `qwen -p`、IDE 插件（VS Code/JetBrains/Zed）、Desktop、`qwen serve`（HTTP+SSE 的 ACP 守护进程，多客户端共享一个 agent）、TS/Python/Java SDK、`qwen channel` IM 机器人（Telegram/钉钉/微信/飞书）。
- **工具集**：文件读写编辑、shell、搜索、web、LSP 集成、MCP、Plan Mode、Computer Use（桌面自动化）、Todo；内置 skills（/review、/batch、/loop、/bugfix）。
- **权限审批沙箱**：五档审批模式——Plan / Ask / Auto-Edit / Auto / YOLO，`Shift+Tab` 切换；Auto 模式由 LLM 分类器逐个评估工具调用（三层：工作区写入快路径 → 工具级 allow 规则 → 分类器），并对 `.qwen/`、`QWEN.md`、`AGENTS.md`、hooks、MCP 等自修改面强制再走分类器，过宽 allow 规则在 Auto 下被临时剥离；容器沙箱 `qwen -s`（挂载 workspace 与 `~/.qwen`）。
- **上下文压缩**：自动压缩阈值梯子（warn/auto/hard，原单层 70% 比例阈值），压缩 sideQuery 关闭 thinking 并限 `maxOutputTokens`，带失败熔断；`/compress` 手动，另有 `/compress-fast` 无 LLM 规则式压缩。
- **扩展机制**：MCP（`.mcp.json`）、Skills（`.qwen/skills`，Auto-Skills）、SubAgents / Agent Teams / Dynamic Workflows、Hooks、`.qwen/rules|commands|agents`、AGENTS.md 兼容。
- **记忆与会话持久化**：QWEN.md 三层（`~/.qwen/QWEN.md`、项目 QWEN.md、`.qwen/QWEN.local.md`）+ 自动记忆（`~.qwen/projects/<project>/memory/`，纯 Markdown，四类内容：用户画像/反馈/项目上下文/外部引用），`pinned/` 目录受保护，每日后台去重清理，`/dream` 手动触发；会话状态按 worktree 隔离，支持 resume。
- **多模型支持**：多协议 OpenAI / Anthropic / Gemini / Qwen，任意第三方与本地模型（Ollama/vLLM），`modelProviders` 配置、运行时切换；Agent Arena 多模型同题对打。
- **特色功能**：与 Claude Code 对齐的功能矩阵；`qwen serve` 守护进程；自我迭代（用自身 agent/模型提 issue、PR、跑测试）。

## 3. goose（block/goose，已迁至 Linux 基金会 AAIF）

- **架构与形态**：Rust 实现，CLI + 原生桌面 App（macOS/Linux/Windows）+ 可嵌入 API；会话存本地 SQLite（`{data_dir}/sessions/sessions.db`，schema v8）。
- **工具集**：一切能力走 MCP。七种 ExtensionConfig：stdio / builtin（进程内 DuplexStream）/ sse / streamablehttp / platform / frontend / inline_python（uvx 执行）。内置 Developer（shell+文件，默认启用）、Computer Controller、Memory、Todo、Skills、Summon、Top of Mind 等；`available_tools` 支持工具级白名单。
- **权限审批沙箱**：四种模式——Autonomous（默认）/ Manual Approval / Smart Approval / Chat Only，`/mode` 切换；`permission.yaml` 三级权限（AlwaysAllow/AskBefore/NeverAllow），SmartApprove 依据 MCP 工具 `readOnlyHint` 注解自动判定；CLI Provider 可透传 Claude Code 原生权限到 goose 界面。原生 OS 沙箱：未获取。
- **上下文压缩**：`DEFAULT_COMPACTION_THRESHOLD = 0.75`，超阈值自动压缩；策略为保留 system prompt + 总结中间段 + 保留最近 10 条消息。
- **扩展机制**：70+ MCP 扩展；Recipes（YAML 工作流，Jinja2 模板、参数、子 recipe、可从 GitHub/URL 运行、deeplink 分享、可进 CI）；Subagents（并行独立子实例，5 分钟超时，仅 Autonomous 模式可用）；Skills；MCP Apps（扩展在桌面端渲染交互 UI）。
- **记忆与会话持久化**：Memory 内置扩展——`remember_memory/retrieve_memories` 等工具，本地 `.goose/memory/` 与全局 `~/.config/goose/memory/` 两档，会话启动时全量注入 prompt，支持触发词；会话自动保存、AI 自动生成会话名、跨会话搜索、复制/导入/导出（JSON）、Chat Recall 扩展语义检索历史。
- **多模型支持**：15+（文档另称 30+）provider——Anthropic/OpenAI/Google/Ollama/OpenRouter/Azure/Bedrock，可经 ACP 复用 Claude/ChatGPT/Gemini 订阅。
- **特色功能**：Recipes 可移植工作流；MCP Apps；内置评估集（evals/）；面向通用任务（非仅编码）。

## 4. Open Interpreter（OpenInterpreter/open-interpreter）

- **架构与形态**：2026 起终端产品为 **Codex 的 fork**（Rust），保留 Codex 终端界面但 provider 无关；旧 Python 版（pip 安装、`interpreter` 命令、`from interpreter import interpreter`）仍在。会话存 `~/.openinterpreter/`，另有 app-server 守护进程（`interpreter app-server daemon`）。
- **工具集**：读写文件、执行命令、patch；支持 `exec` 非交互会话、MCP、skills、hooks、permissions、subagents；OS 模式（旧版）可控制浏览器与系统级操作。
- **权限审批沙箱**：默认 OS 级沙箱（macOS/Linux/Windows），读/写/网络分别受控，默认禁网，工作区外需显式审批；sandbox 模式与 approval policy 是两个独立维度，权限档案分 read-only / workspace-write / full access；旧版 safe_mode（off/ask/auto，禁自动执行 + semgrep 扫描）、Docker/E2B 隔离。
- **上下文压缩**：`/compact` 手动；接近上下文上限自动压缩，`model_auto_compact_token_limit` 可设阈值；hooks 提供 `PreCompact`/`PostCompact` 事件。
- **扩展机制**：AGENTS.md + `.agents/skills`（复用共享标准，不锁自家格式）、MCP、hooks（`SessionStart/UserPromptSubmit/PreToolUse/PermissionRequest/PostToolUse/PreCompact/PostCompact/SubagentStart/Stop`，可 deny 工具调用、注入上下文，hook 定义改动需重新信任）、plugins。
- **记忆与会话持久化**：会话本地存储，`interpreter resume --last|<ID>`、`fork`、TUI 内 `/fork` `/side`；`[history] persistence="none"` 可关闭，`max_bytes` 限体积；`/init` 生成 AGENTS.md。独立记忆机制：未获取。
- **多模型支持**：内置 OpenAI、Bedrock、Ollama、LM Studio；目录含 Anthropic/OpenRouter/DeepSeek/Moonshot/Kimi/Z.ai/Alibaba-Qwen/Groq；自定义可走 Responses / OpenAI chat / Anthropic Messages 三种 wire API。
- **特色功能**：**模型专属 harness 仿真**——为 Kimi、Qwen、DeepSeek 等开源模型分别定制 agent loop，并可把请求塑形为 Claude Code / Kimi CLI / Qwen Code / SWE-agent 等形态；面向低成本开源模型优化。

## 对 WLLM 的吸收建议

- **高优先级**
  1. **模型专属 harness 仿真（Open Interpreter）**：WLLM 本就跑本地小模型，按模型定制 agent loop 与提示形态收益最大。
  2. **三层阈值梯子 + 压缩失败熔断（Qwen Code）**：warn/auto/hard 分级比单阈值更稳，压缩 sideQuery 关 thinking、限 maxOutputTokens 也值得直接抄。
  3. **审批分级 + 自修改面强制复审（Qwen Code）**：Plan/Ask/Auto-Edit/Auto/YOLO 五档，且对配置、skills、hooks、MCP 的写入绕过 allow 规则强制再判定——防自我改写是本地 agent 的刚需。
  4. **shadow Git checkpoint 与 Rewind（gemini-cli）**：改动前快照 + 只回对话/只回代码/全回三档，比单纯 undo 可靠得多。
- **中优先级**
  5. **Recipes（goose）**：YAML + Jinja2 + 子 recipe 的可移植工作流，适合 WLLM 沉淀可复用任务模板。
  6. **Memory 两级落盘 + 会话 SQLite（goose）**：本地文件记忆 + 结构化会话库 + AI 自动命名，实现成本低、可解释性好。
  7. **Hooks 事件面（Open Interpreter）**：PreToolUse 可 deny、Pre/PostCompact 可注入恢复上下文，是最省 token 的扩展点。
  8. **自动记忆四分类与 pinned 保护（Qwen Code）**：画像/反馈/项目上下文/外部引用四类 + 不可被自动清理的 pinned 目录。
- **低优先级**
  9. **工具级 token 预算与工具输出摘要（gemini-cli）**：对 shell 输出这类大块内容按工具限预算。
  10. **MCP Apps / 内联 UI（goose）**：依赖桌面端，CLI 场景收益有限。
  11. **多形态分发（Qwen Code 的 daemon/IM 机器人）**：生态能力，非核心路径。
