# 国内 Coding Agent 调研（5 个 + Qwen Code 补注）

> 资料来源：各产品官网、官方文档与中文社区实搜（2026-09）。搜不到的项标注"未获取"。

## 1. Trae（字节跳动）

- **产品形态**：AI 原生 IDE（VS Code 内核），国内版 trae.cn（手机号/掘金登录）、国际版 trae.ai（新加坡 SPRING PTE 运营，Google/GitHub 登录）；另有 Trae Plugin（VS Code ≥1.93 插件形态）、SOLO 网页端与移动端。**无 CLI 形态**（第三方对比文明确列为缺失）。
- **Agent 能力**：三档递进——Chat（问答/行内修改）→ Builder（从 0 到 1：抽取上下文→建改文件→生成并运行命令→回读执行状态）→ SOLO（AI 主导，2025-07 国际版 beta、11-25 登陆国内版）：多任务并行、Plan 审批 + DiffView 掌控、主 Agent 调度 Sub Agent 并行、SOLO Coder 自定义智能体、TRAE Work 自动拆解任务并调用 Skills。Editor 模式保留人主导。
- **模型与多模型**：国内版内置 Doubao-Seed-Code、GLM-4.7、GLM-4.6、MiniMax-M2.1/M2、Kimi-K2-0905 六款（2026-01 起 SOLO 全量免费开放），支持 API Key 自定义模型（早期 Chat 与 Builder 的自定义模型列表不互通）；国际版 Claude/GPT-4o/Gemini，已被 Anthropic 封禁。2026-04 起国内版改日/周/月动态限额（第三方实测补全约 80-120 次/天、对话约 30-50 轮/天，官方称"动态调整"不公布数字），付费"速通"99-1999 元/月仅免排队、不提供 Claude。
- **上下文与记忆**：`@`/`#Context` 引用文件与文件夹，本地全目录索引、跨文件类型同步（第三方实测准确率高于 Cursor）；多模态图片输入（早期国内版不支持）。跨会话持久记忆机制：未获取。
- **权限安全**：Builder 命令生成后需用户点击 Run 才在终端执行，可跳过；代码变更自动落盘以便预览，按全局/文件/单处三级 Accept/Reject，**拒绝即从磁盘删除**。细粒度权限规则/沙箱：未获取。
- **特色功能（可吸收）**：① Builder 的"命令人工触发 + 三级 diff 审查"低风险默认；② SOLO 的"Plan 先行审批、执行可视、多任务独立上下文并行"；③ 面向国内网络的国产模型直连与全中文原生界面。

## 2. CodeBuddy（腾讯）

- **产品形态**：四端——插件（VS Code/JetBrains）、CodeBuddy IDE（自研，产设研一体：Figma 转代码、CloudBase/Supabase、CloudStudio 一键部署）、CodeBuddy Code CLI（`codebuddy`/`cbc`，交互/`-p` 无头/管道/守护进程 `daemon`+Worker、ACP、`--ide` 连接）、WorkBuddy（腾讯龙虾，公测，含小程序/移动端）；另有 Agents 平台 Beta。
- **Agent 能力**：IDE 三模式 Ask（只答不改）/ **Craft**（Agent 模式，当前上下文内代码生成与局部修改）/ Plan，可自建 Agent；IDE Agent Mode 支持**并行多任务**，四视图（产物 / 全部文件 / 变更 / 预览）审查，默认 Work 模式（文档、PPT、数据分析、Deep Research）与 Programming 模式。CLI 有四种 mainAgent（cli/ptc/minimal/create）+ `multitask`；工具含 Agent 子代理、Workflow 异步后台跑、Cron 定时、EnterWorktree 隔离分支、ToolSearch/Defer **按需延迟装载工具**、Esc+Esc 回退（`/rewind`）、`!` 前缀直跑 shell、Ctrl+B 后台命令。
- **模型与多模型**：内置混元 Hy4/Hy3、GLM-5.3/5.2/5.1、MiniMax-M3/m2.7、Kimi-K3/K2.7-Code/K2.6、DeepSeek-V4-Pro/Flash（多款 1M 上下文）；`models.json` 用户级/项目级自定义模型（id/url/apiKey/最大 token/工具调用与图片能力标记，apiKey 支持环境变量与 macOS Keychain），`--fallback-model` 过载回退；国际版含 Claude/GPT/Gemini。设置项 `language: "简体中文"` 可锁定回复语言。
- **上下文与记忆**：默认 200K 上下文窗口，**Max 模式开关**——关闭则自动压缩省积分，开启则全程不压缩；Memories 跨会话持久记忆（`~/.codebuddy/memories/global/` 与项目级）；Rules（`.codebuddy/rules`）、Skills（`.codebuddy/skills/`）、CODEBUDDY.md 记忆文件；聊天本地保留 30 天可配。
- **权限安全**：七种权限模式（default / acceptEdits / **auto** / dontAsk / plan / bypassPermissions / **delegate**）+ IDE 协议传入的 fullAccess/work/ignore；`auto` 把待确认动作交给**分类器**判定 allow/deny（`autoMode` 可写 allow 规则）；`delegate` 下主 Agent 只做拆解分发、实现类工具被禁用；`permissions` 支持 `Edit(src/**)`、`Bash(git:status,git:diff)` 这类 allow/ask/deny glob 规则；Bash 沙箱（`autoAllowBashIfSandboxed`、网络与文件系统访问控制、excludedCommands）；`Shift+Tab` 循环切换。
- **特色功能（可吸收）**：① auto 权限分类器 + delegate 分工模式；② ToolSearch/Defer 工具延迟加载；③ Max 模式（压缩/全保留二选一直接暴露给用户）；④ models.json 能力标记式自定义模型。

## 3. Kimi CLI / Kimi Code CLI（月之暗面）

- **产品形态**：终端 CLI（`kimi`），Kimi CLI（2025-10 建仓）正演进为 Kimi Code CLI，旧仓库逐步停更；VS Code 扩展、ACP 模式（Zed/JetBrains 走 `kimi acp`）、`kimi web` 浏览器 UI、`kimi vis` 追踪可视化、zsh 插件（Ctrl-X 切换 agent/shell 模式）。
- **Agent 能力**：主 Agent 用 YAML 定义（内置 default/okabe，`--agent`/`--agent-file` 选择，`extend` 继承、可 `exclude_tools`）；**三个内置子 Agent**（coder / explore / plan），独立上下文、可后台运行、实例持久可多次恢复，由主 Agent 按任务复杂度自动调度；Agent Skills（`--skills-dir` + 用户/项目自动发现）、Hooks(Beta)、插件(Beta)、MCP、`/goal` 目标模式、**Ralph Loop**（`--max-ralph-iterations` 反复喂同一 prompt 迭代到 `<choice>STOP</choice>` 或达上限）。
- **模型与多模型**：主力 K2.7 Code / K3（最高 1M 上下文）；`-m` 临时切模型，`provider` 子命令管理供应商、可浏览 models.dev 目录（未接第三方细节未获取）。计费：Kimi 会员共享额度池（¥49/月起四档），Kimi Code 另有独立的 5 小时/每周速率限制；API 侧上下文缓存命中价约为未命中的 1/5。
- **上下文与记忆**：会话落 `$KIMI_CODE_HOME/sessions/<workDirKey>/<sessionId>/`，`state.json` 元数据 + `agents/*/wire.jsonl` 事件流**并记录发给模型的请求轨迹（工具 schema、参数、MCP 清单）**；接近窗口上限自动压缩，`/compact` 可带"优先保留 X"指引；`/fork` 派生会话、`kimi export` 打包 ZIP、`/export-md` 导出可读记录；系统提示模板变量 `${KIMI_AGENTS_MD}`（自项目根逐层合并 AGENTS.md 含 `.kimi/AGENTS.md`）、`${KIMI_WORK_DIR_LS}`、`${KIMI_SKILLS}`。
- **权限安全**：读类（Read/Grep/Glob/WebSearch/FetchURL）默认 auto-allow，写与执行（Write/Edit/Bash）默认需审批；`--yolo` 跳过普通审批（**Plan 退出审批不被绕过**）、`--auto` 全自动且不提问、`--plan` 只读探索先行；`config.toml` 的 `[[permission.rules]]` 顺序匹配首条命中；Plan 模式下 Write/Edit 被限制只能写计划文件、TaskStop 禁用。
- **特色功能（可吸收）**：① 图片读取按模型上限**自动压缩，压不下直接报错不发原图**；② wire.jsonl 记录完整请求轨迹便于调试；③ Ralph Loop；④ 提示词模板变量合并 AGENTS.md。

## 4. 智谱 CodeGeeX / GLM Coding / ZCode

- **产品形态**：三条线——① **CodeGeeX**：IDE 插件（VS Code/JetBrains/Vim/HBuilderX 等），个人免费，代码生成补全、跨语言翻译、注释、单测、Code Review、Inline Chat（Cmd/Ctrl+I），侧栏 `/explain` `/comment` `/fixbug` `/tests`；② **GLM Coding Plan**：订阅套餐（国内团队标准席位 ¥598/月、高级 ¥1198/月；国际 Lite $12.6/月起），以 Anthropic/OpenAI 三协议 Base URL 接入 Claude Code、Codex、OpenCode 等 20+ 工具，`npx @z_ai/coding-helper` 一键配置；③ **ZCode**：桌面 Agentic Development Environment（跨平台 + 开源 zai-org/ZCode，含 TUI/Web/`zcode` Agent CLI）。
- **Agent 能力**：ZCode 自研 ZCode Agent，围绕 GLM-5.x 深度调优，长程任务（理解→规划→改码→验证→Review 同一上下文）、`/goal`（设置/暂停/清除会话目标）与 `/compact` 两内置命令、Skills（`$` 调用）、命令可**从 Claude Code 一键导入**、Subagents、远程开发（SSH 主机 / Docker 容器）、浏览器元素选中作上下文、内置终端与 Mermaid 渲染、增强版 Find/Grep 自带更快替换品、手机 Remote Control 与飞书/微信 Bot 续接任务、**闲时任务**（订阅者在空闲算力跑，不耗套餐额度）。
- **模型与多模型**：GLM-5.3 / 5.3-Flash / 5.2 / 5.1（1M 上下文）、GLM-4.6V 视觉等；Coding Plan 只允许在指定工具环境用（5 小时 + 每周双限额）；CodeGeeX 插件走 GLM 系，CodeGeeX4-All-9B 权重开源（一代 13B 开源，中文场景专项优化）。
- **上下文与记忆**：**AGENTS.md 为项目记忆**（随仓库走、团队共享），另有 Agent 自动维护的 Project Memory（仅存本机、不进 git，二者分工写在官方文档）；ZCode 强调 1M 稳定上下文持续读文件/终端/浏览器/Git 状态。
- **权限安全**：ZCode 敏感命令、文件改动、高权限动作执行前确认；细粒度规则与沙箱：未获取。
- **特色功能（可吸收）**：① AGENTS.md 与自动 Project Memory 的**双轨分工**；② `/goal` 目标模式 + 闲时任务队列；③ 从 Claude Code 迁移 commands/对话记录的导入向导。

## 5. iFlow CLI（心流）

- **产品形态**：终端 CLI（Node.js 22+，npm 或 gitee 安装脚本），VS Code（含衍生 IDE）/JetBrains 插件（CLI 内 `/ide` 连接），支持 ACP、Jenkins/Jira 等集成；`iflow --resume`、`/chat` 恢复回滚。**官网公告：2026-04-17 正式停止服务，迁移至 Qoder。**
- **Agent 能力**：Sub Agent（`$code-reviewer` 触发、`/agent` 查看预置、任务工具做子 Agent 并行）、Plan 模式、Todo、Hook、输出风格、Thinking、Workflow、SDK、自定义命令、`/skills` 在线装 Skills、`/mcp online` 浏览**安全认证的 MCP 市场**与智能体/命令商店、`/init` 生成 IFLOW.md、`!` shell 模式、`@` 引用文件。
- **模型与多模型**：心流平台自部署免费模型（Kimi K2、Qwen3 Coder、DeepSeek v3、GLM-4.5/4.7、MiniMax-M2/M2.1、iFlow-Rome 等），登录 iFlow 平台的模型"针对工具调用优化"；全 OpenAI 协议可换第三方。Changelog 细节：GLM-5 上下文限制从默认调到 170K（留 16% 安全边距防 token 溢出）。
- **上下文与记忆**：任务工具做**上下文达 70% 自动压缩**、`/compress` 手动摘要替换、IFLOW.md + `/memory` 指令上下文；`/clear` 支持清 todo（子 Agent 间 todo 隔离）。
- **权限安全**：yolo 执行模式（默认允许全部操作）、**子 Agent 默认以 yolo 执行**；细粒度审批规则：未获取。
- **特色功能（可吸收）**：① 上下文 70% 阈值的自动压缩与手动 `/compress`；② 子 Agent 之间 todo/上下文隔离；③ 对国产模型工具调用的专项优化与按模型设上下文安全边距。

## Qwen Code 补注

B3 已覆盖，此处只记国内特色：与 Claude Code 对齐的功能矩阵（五档审批、三层压缩阈值梯子、`qwen serve` 守护进程、自动记忆四分类 + `/dream`）、多协议多 provider（含 Ollama/vLLM 本地模型）与 Agent Arena 多模型对打；`qwen channel` 直接支持钉钉/微信/飞书 IM 机器人——国内独有的分发渠道。

## 对 WLLM 的吸收建议

- **高优先级**
  1. **权限分类器 + delegate 模式（CodeBuddy）**：本地小模型误判风险高，`auto` 把每个工具调用交给分类器、`delegate` 只让主 Agent 分发不执行，是比纯规则更稳的护栏。
  2. **读写审批分级 + 图片按模型上限压缩（Kimi CLI）**：读类自动放行、写/执行必审；图片压不下就报错而不硬塞，直接对应本地小模型的上下文预算。
  3. **命令人工触发 + 三级 diff 审查（Trae Builder）**：Shell 命令需点 Run、diff 按全局/文件/单处接受拒绝、拒绝即删盘——最小惊讶原则，适合小模型场景默认开启。
  4. **AGENTS.md 与自动 Project Memory 双轨（ZCode）**：团队约定进仓库、临时事实留本机，语义清晰、易实现。
- **中优先级**
  5. **Max 模式开关（CodeBuddy）**：把"自动压缩 vs 全量保留"交给用户，等价于小模型的 token 预算开关。
  6. **Ralph Loop（Kimi CLI）**：同一 prompt 迭代到模型自报 STOP，弥补小模型规划能力不足。
  7. **ToolSearch / Defer 延迟装载（CodeBuddy）**：按需把工具 schema 注入上下文，缓解小模型工具列表膨胀导致的注意力稀释。
  8. **请求轨迹 wire.jsonl（Kimi CLI）**：落盘工具 schema、参数、MCP 清单，本地调试小模型 agent 的刚需。
  9. **子 Agent todo/上下文隔离 + 70% 自动压缩（iFlow）**：实现成本低，配合子 Agent 并行使用。
- **低优先级**
  10. SOLO 多任务并行视图、云端 Workspace/移动端续接（Trae）：依赖云端算力，本地单机价值有限。
  11. 从 Claude Code 导入 commands/对话的迁移向导（ZCode）：利于获客，对 WLLM 自身增益一般。
  12. 免费额度/套餐运营玩法（Trae 限额、GLM Coding Plan 双限额、Kimi 共享额度池）：商业策略，非工程能力。
