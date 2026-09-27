# 调研：小型 / 特色 coding agent（Amp · Zed · Continue · Void · Plandex · Forge）

> 方式：websearch（2025/2026 关键词）+ 官方文档抓取。只挖特色功能，未实搜到的标注"未获取"。

## 1. Amp（Sourcegraph）

**形态**：闭源商业产品；CLI + 编辑器扩展 + Web + macOS/iOS 客户端 + TS/Python SDK，同一批 thread 跨端同步。

**特色**：

- **专用 sub-agent 架构**：Finder（小而快的模型 + 精简工具集做代码搜索）、Oracle（GPT-5 中档推理，深挖 bug/架构）、Librarian（查第三方库最新源码与文档）、Kraken（写 codemod 做百文件级重构）。每个 sub-agent 有独立模型、工具集、system prompt，只回传结论以隔离 context。
- **不做模型选择器**：顶层仅 Smart / Rush 两档（能力 vs 速度），把选择权收进架构。
- **SDK 可编程**：`execute()` 返回 system/assistant/result 结构化流；`executor` 可选 `local | orb | runner`；`mode`/`effort` 分档；MCP 配置随调用注入。
- **Orbs**：每个 thread 一台云端机器，合盖继续跑，可并行开多个，支持 Linear issue / CI 失败 / 定时事件唤醒，团队可共处同一 orb。
- **Thread 治理**：保存、分享、fork、handoff（把上下文打包到新 thread）、thread 引用（用另一个模型摘录）。
- CLI：`amp -x` 单发执行、管道输入、`AGENT.md`、命令白名单与 `amp.tools.disable`。

## 2. Zed Agent（ACP）

**形态**：开源 Rust 编辑器；自有 in-process agent + 通过协议接入的外部 agent 面板，另有 Terminal Threads（终端跑 CLI/TUI）。

**特色**：

- **ACP（Agent Client Protocol）**：Apache-2.0 开放标准，JSON-RPC，agent 以子进程接入编辑器 —— 明确对标 LSP 的"解耦语言智能"，让 agent 解耦 UI。编辑器提供多 buffer diff 审查、实时编辑可视化、跟随导航、语言服务器高亮。
- **ACP Registry**：命令 `zed: acp registry` 安装即用（Claude、Codex、OpenCode、Copilot、Cursor、Gemini CLI），自动更新；`agent_servers` 写在 settings.json 里可接自定义 agent；`dev: open acp logs` 直接看协议报文。
- **边界清晰**：外部 agent 自带认证/计费/模型选择，与 Zed 的 provider 配置解耦；Zed 的 MCP 可经 ACP 转发给 agent；第三方调用不过 Zed 服务器。
- **生态外溢**：Neovim（CodeCompanion、avante.nvim）、Emacs agent-shell、marimo、Eclipse 原型、Toad；可从外部 agent **导入历史 thread** 到 Zed 侧栏。

## 3. Continue

**形态**：开源 IDE 扩展（VS Code / JetBrains）+ CLI `cn`。**注意：GitHub README 声明仓库已只读，2.0.0 为 VS Code 扩展 / CLI / JetBrains 插件的最终版本**（移除了匿名遥测与认证）。以下为其实搜到的配置特色。

**特色**：

- **配置即代码**：`config.yaml` 声明 `models / context / rules / prompts / docs / mcpServers`，支持 YAML 锚点去重、`${{ secrets.* }}` 环境注入、hub 模型 `uses:` 复用。
- **模型角色制**：同一份配置里为 `chat / edit / apply / autocomplete / embed / rerank / summarize` 各指派不同模型与参数（含 `capabilities` 覆盖自动检测）。
- **System Message Tools**：不依赖各家原生 tool-calling API，而是把工具描述转成 XML 塞进 system message，模型以结构化 XML 回传工具调用再由客户端解析执行 —— **任何能读指令的模型都能跑 agent**，跨 provider 行为一致。

## 4. Void

**形态**：开源（YC）VS Code fork，直连 provider，无中间后端。

**特色**：

- **Gather 模式**：只读检索/分析代码库，与 Agent 模式（可写 + 终端）并列，形成读写分离。
- **Checkpoints**：可视化追踪并回滚 LLM 的每一次改动；配合 lint 错误检测。
- **Prompt 完全透明**：聊天历史里每条 prompt 可打开查看与编辑。
- **低门槛模型**：不支持原生 tool calling 的开源模型也能在 Agent 模式工作；自定义 FIM 补全模型；Fast apply 号称 1000 行级文件即时生效。
- **现状**：GitHub README（2026-06）称 **Void IDE 开发"暂时暂停"**，团队在试验新的 AI coding 想法 —— 引用时需注意。

## 5. Plandex（自选）

**形态**：开源 MIT，终端 agent（Go），客户端-服务器，Docker 自托管；云版已停止新用户。

**特色**：

- **大上下文工程**：默认模型包 **2M token 有效上下文**；tree-sitter 项目地图可索引 20M+ token，30+ 语言语法校验；全 provider 走上下文缓存。
- **累积 diff 审查沙箱**：所有改动先隔离在沙箱，`diff` 审完才 `apply` 落盘，命令执行受控可回滚。
- **自主度五档**：`None / Basic / Plus / Semi / Full`，且与自动上下文加载互斥（`--bg` 不能与 `-c` 同用），把"无人值守"与"交互确认"显式冲突化处理。
- **后台并行任务**：`plandex tell --bg` 立即交还终端，`ps` 看全部流、`connect` 接管、`stop` 停止；流式 TUI 按 `b` 键随时转后台；后台任务只生成 pending 变更不自动落盘。
- **计划级版本控制**：每次 plan 更新有版本，**分支机制可并行探索多条路径 / 对比不同模型**。

## 6. Forge（自选）

**形态**：开源 Apache 2.0，终端 coding agent，多 provider（宣传 300+ 模型），`forge.yaml` + `.mcp.json` 配置。

**特色**：

- **三内置 agent 按读写权限分工**：`forge`（实现，可改文件）/ `sage`（`:ask` 研究，只读）/ `muse`（`:plan` 计划，写入 `plans/`）。**是否可写是 agent 的一等属性**。
- **多 agent 工作流**：agent 互为工具被调用，各自独立 system prompt、模型、工具白名单、turn limit 上限；每个 agent 可指定不同 provider/模型（贵模型做复杂件、便宜模型做简单件）。
- **MCP 项目级/全局双层配置**（`.mcp.json` 本地优先），工具列表按配置哈希缓存、`forge mcp reload` 重建；restricted shell 模式限制文件系统访问。

## 对 WLLM 的吸收建议

**高**

1. **System Message Tools（Continue）**：XML 工具注入替代原生 tool call —— 本地 Qwen3 小模型工具调用不稳时的直接解法，且天然支持多 provider 切换。
2. **专用 sub-agent 分工（Amp）**：搜索用小快模型、推理用强模型、外部文档单独摘录，只回传结论。对"本地 8B/14B 分层调用"的多模型编排最有参考价值。
3. **diff 沙箱 + 自主度分档 + 后台并行（Plandex）**：改动不落盘直到 `apply`；五档自主度把安全与自动化显式挂钩；`--bg`/`ps`/`connect` 是可直接抄的并行任务 UX。

**中**

4. **协议解耦 UI 与 agent（Zed ACP）**：若 WLLM 要被编辑器/前端接入，走 ACP 而非私有接口；协议日志命令（`dev: open acp logs`）值得照做。
5. **配置即代码 + 模型角色制（Continue）**：`config.yaml` 里按 chat/apply/autocomplete/... 分派本地与远端模型，是多模型编排的配置形态。
6. **按 agent 划分读写权限（Forge）**：研究型 agent 只读、实现型可写、计划型只写 `plans/`，比"全有或全无"的权限更省确认成本。

**低**

7. **Amp Orbs 云端按 thread 开机器**：价值高但需云基础设施与计费，本地 MLX 场景不适用；仅借鉴"事件唤醒"思路。
8. **Void 的 VS Code fork 路线**：工程量大且项目已暂停开发，不建议跟进；其 Gather 只读模式已并入第 6 条建议。
