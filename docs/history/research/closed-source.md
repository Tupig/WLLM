# 调研：闭源商业 Coding Agent（Cursor / Windsurf / Copilot / Devin / Augment / Replit / Kiro）

> 来源：各产品官方 docs、changelog、blog（cursor.com、docs.windsurf.com、docs.github.com、docs.devin.ai、augmentcode.com、docs.replit.com、kiro.dev）+ 官方发布博文，2026-09 实搜。搜不到的标注「未获取」。

## 1. Cursor

- **产品形态**：VS Code fork IDE + 网页 + CLI + Cloud Agents（原 Background Agents，2.0 更名，跑专用 VM）+ `@cursor/sdk`（2026-04 发布，可用 TS/Python 复用同一 harness、同一 runtime 本地或云端跑）。自研模型 Composer 1.5/2.5，RL 直接在 agent harness 的工具（编辑/语义搜索/grep/终端）上训练。
- **agent 能力**：三要素 Instructions（系统提示+Rules）/Tools/Model，Cursor 针对每个模型单独调 prompt 与工具。Plan Mode（1.7 引入）先写详细计划再执行，支持「用一个模型出计划、另一个模型执行」的后台计划；2.0 起单 prompt 最多并行 8 个 agent，用 git worktree 或远程机隔离避免文件冲突。
- **上下文与记忆**：代码库语义索引——Merkle 树做增量同步、chunk 级 embedding 缓存、约 5 分钟 re-sync、约 80% 索引完成即可用语义搜索（官方称提升回答准确率 12.5%）。**无原生跨会话记忆**：Notepads 已于 2.0 移除，持久上下文靠 Rules 四类（`.cursor/rules/*.mdc` 项目级 / User / Team dashboard / AGENTS.md），frontmatter 用 `globs`/`alwaysApply`/`description` 控制触发（always-apply / auto-attached / agent-requested / manual 四档）。
- **权限与安全**：macOS 沙箱终端 GA，默认沙箱内只读写工作区、禁网、白名单外命令全进沙箱；企业可强制沙箱配置、分发 Hooks、查 Audit Log；宣称 SOC2/ISO27001/ISO42001/AIUC-1。
- **特色（可吸收）**：Rules 的**分级触发**而非一刀切注入；`/create-rule` 用对话生成规则文件；compact/balanced/detailed 三档工具轨迹显示密度；Cursor Router 自动选模型。

## 2. Windsurf（Cognition，2026-06 更名 Devin Desktop）

- **产品形态**：VS Code fork；2025-07 被 Cognition 收购，2026-06-02 并入 Devin，改名 Devin Desktop，内置 Agent Command Center（统一管理本地+云端 agent 的看板）；另有 40+ 编辑器插件与 ACP 协议接入第三方 agent。
- **agent 能力（Cascade）**：Code / Chat 双模式；每次 prompt 最多 **20 次工具调用**（JetBrains 版 25），轨迹断掉后按 continue 从断点续跑。**规划与执行分离**：后台一个专职 planning agent 持续精修长期计划，前台选定模型只做短期动作；会话内自动维护 Todo 列表，读到新 Memory 会自动改计划。
- **上下文与记忆**：Flow Awareness——实时感知用户正在编辑的文件、终端输出、剪贴板、浏览器活动，无需显式附加上下文。**Memories 自动生成跨会话** + Rules 手动定义（global / workspace / system 三级，单规则 12000 字符上限）；AGENTS.md 按**文件所在目录位置**推断激活范围（根目录=always-on），无需 frontmatter；另有 RAG 上下文引擎（索引、context pinning、M-Query）。
- **权限与安全**：命令自动执行三档 Off / Auto / Turbo + deny list；Restricted Mode 下 Cascade、Devin Local、所有 ACP agent 与 hooks 一律禁用；**命名 Checkpoint** 可把代码回滚到某步状态（提示不可撤销）；Cascade Hooks 支持 pre/post；企业有 RBAC、SSO、审计。
- **特色（可吸收）**：**Checkpoint 按步回滚**；规划 agent / 执行 agent 双模型分工；Workflows（markdown 文件存成 slash 命令，仅手动触发）与 Skills（可自动选用）明确分工；Arena 并行多实例对比方案。

## 3. GitHub Copilot

- **产品形态**：IDE 扩展 + github.com agents panel + **coding agent**（跑在 GitHub Actions 起的隔离 VM）+ Copilot CLI + VS Code Agents window + 2026-06 Build 发布的 Copilot 桌面 app（每个 session 独立 git worktree）。旧的 Copilot Workspace 技术预览已于 **2025-05-30 关停**，能力并入 coding agent；现还有 Copilot app 的 Canvas（人机双向查看/纠偏 agent 工作）。
- **agent 能力**：把 issue assign 给 Copilot → 起 VM、clone、用 GitHub code search 做 RAG 检索 → 持续推 commit 到 draft PR → 会话日志暴露推理与验证步骤 → PR 评论 `@copilot` 继续迭代（2026-03 起启动快 50%）。**Agent Merge**（2026-09 公测）自动处理 review 意见、失败检查与合并冲突；代码审查 agent 已可直接 approve PR。
- **上下文与记忆**：`.github/copilot-instructions.md`（全仓，每次交互都读）+ `.github/instructions/**/*.instructions.md`（`applyTo` glob 路径级，可 `excludeAgent` 排除某 agent/review）。CLI 额外发现 `AGENTS.md`/`CLAUDE.md`/`GEMINI.md` 与 `$HOME/.copilot/**` 用户级指令，支持 `@相对路径` 内联引用其它文件。**注意硬限制**：code review 只读每个指令文件前 **4000 字符**，且读 base 分支（chat/agent 读 head 分支）。另有 Spaces 用来归集项目上下文源。
- **权限与安全**：默认策略——只能推自己创建的分支、发起者不能自批 PR、网络访问限可定制白名单、Actions 工作流必须人工批准才跑、遵守 ruleset 与组织策略；已知限制：content exclusions 对 coding agent 不生效。
- **特色（可吸收）**：**custom agents**（`.github/agents/*.agent.md`，YAML frontmatter 指定 name/model/tools + markdown 指令，CLI 用 `/agent` 调用）；code review 可复用 `.github/skills` 技能与仓库 MCP；同一套 instructions 同时约束 chat、review、agent 三种面。

## 4. Devin（Cognition）

- **产品形态**：云端会话（独立 VM 内置 shell、编辑器、浏览器）+ Slack/GitHub/Linear 集成 + CLI（`devin --cloud`、`devin ssh` 直连云端 VM）+ Desktop + REST API/定时自动化；Devin 2.2（2026-02）起拥有完整 Linux 桌面做 computer use；Outposts 支持自托管。
- **agent 能力（规划-执行-验证）**：**Ask 模式**（只读研究与规划，产出结构化提示词）→ **Agent 模式**执行。Plan mode 把计划写入 `~/.devin/plans/plan-<session>.md` 持久文件，可手改、可交给新会话；`megaplan`（另有 ultraplan/masterplan）关键词触发深度规划且**必先至少问一个澄清问题**。验证侧：Devin Review Autofix——自己 plan、code、review、抓问题、修完才交 PR；桌面 computer use 会跑通应用并回传**屏幕录制**给人看。
- **上下文与记忆**：**Knowledge** 知识库（企业上限已提到 300 条，可建文件夹，会话中会主动建议新增 knowledge 卡片并写进 worklog）+ **Playbook**（可复用任务流程，Remix 会话会带上原 playbook）+ Machine Snapshots（环境存档 + 启动命令）+ 仓库索引。
- **权限与安全**：沙箱 VM、secrets 管理（新增企业级 secrets 跨组织共享）、企业可强制 sandbox 模式；会话分享会剥离系统提示与工具定义、脱敏路径与密钥。
- **计划复盘（特色）**：worklog 每步带可展开的 **retro**；会话结束后打开 **Session Insights → Generate Analysis**，产出时间线、可执行反馈、以及一条**改进后的提示词**供以后类似任务复用。

## 5. Augment Code

- **产品形态**：VS Code / JetBrains / Vim 插件 + Auggie CLI（`--acp` 兼容 Agent Client Protocol，可被 Zed 等编辑器挂载）+ 云端 Remote Agents + Context Engine 以 **MCP 形式对外提供**给其它 agent。
- **agent 能力**：**Plan → Execute → Checkpoint Review** 三段：先按代码库分析出 Tasklist（如「分析现有认证→建 token handler→改中间件→加轮转→写测试」）再动代码；每步生成 checkpoint，可 Accept / Revert / 中途改向。另有 Ask（只读探索）与 Auto（文件编辑、终端、集成调用全自动，做完再统一审）两种模式；subagents 用 `.augment/agents/*.md` 定义，可把 tools 限制成只读（如 explorer）。
- **上下文与记忆（核心差异）**：**Context Engine 预索引语义依赖图**，官方口径 400,000+ 文件、单次查询约 10 万行相关代码、约 5 万文件/分钟索引、commit 后秒级增量、跨仓依赖追踪。2026-06 上线 **Context Lineage**：把当前分支 commit（message/author/changed files）用轻量模型压成摘要再入索引，用于回答「为什么当时这么改」「上次类似 feature flag 是哪个 commit」。**Memories 需人工 approve 才入库**，可升级为 workspace Rules。
- **权限与安全**：终端命令可选「批准后执行」或自动执行；Cosmos 云端平台在模型之外限制仓库 push 权限与 shell 执行；SOC 2 Type II / ISO 42001 认证。
- **特色（可吸收）**：commit 摘要入索引（演化感知）；记忆**先审后存**；Prism 模型路由（降本同时保质量）。

## 6. Replit Agent

- **产品形态**：纯浏览器 IDE + 移动端，编辑器、运行时、数据库、托管同处一个 workspace；当前为 **Agent 4**。
- **agent 能力**：Plan mode 先出**有序任务清单**待批准再开工；Agent 4 支持**并行 agent**（Core 2 并发 / Pro 10 并发，跑在隔离 micro-VM），多个任务可乱序提交、由 agent 智能排序后执行；一次性 prompt 会先补全 requirements 再全量构建；Multi-Artifact——web 应用、移动 App、landing page 同项目共享后端与数据库。创建时可选「全栈」或「先前端原型后补后端」。
- **验证循环**：自研测试系统**周期性驱动浏览器**点按钮、表单、API、数据源，官方称比 Computer Use 模型快 3 倍、省 10 倍成本，出测试报告并自动修发现的问题；可自动登录 Replit Auth 应用测登录流；由 agent 判断「改动是否足够多」再决定是否测试。
- **上下文与记忆**：2026-06 起 Workspace Settings > Customization 可设**全局 instructions + 按需加载的 skills**；内置 Database/Auth/Connectors 与 MCP 目录（Supabase、Statsig 等）。
- **权限与安全**：**Package Firewall** 默认开启，安装时拦截恶意/被投毒包，且 agent 会主动改用更安全的替代方案；企业侧 SSO/SAML、SCIM、RBAC、审计日志、Security Agent（Semgrep + HoundDog + LLM 扫描，发布前跑）、Auto-Protect 24/7 盯 CVE 并自动生成可一键应用的补丁；Determinate Nix 锁死依赖版本。
- **特色（可吸收）**：浏览器自测-自修循环；先补 requirements 再构建；一键发布（托管、SSL、基础设施平台代管）。

## 7. Kiro（AWS）

- **产品形态**：AWS 的 agentic IDE（定位上替代 Amazon Q Developer）+ CLI + Web；核心是 **Specs**，另有 Feature/Bugfix/Quick 三种 spec。
- **agent 能力（spec 驱动三件套）**：`requirements.md`（EARS 记号、用户故事+验收标准；bugfix 版记录 current/expected/unchanged 行为）→ `design.md`（系统架构、时序图、数据流、错误处理与测试策略）→ `tasks.md`（离散可追踪任务）。两种工作流 **Requirements-First / Design-First**（后者先定架构再反推可行需求）；**Quick Plan** 三阶段一次跑完、无审批门。执行前可用 **Analyze Requirements** 让它先查逻辑矛盾、歧义与冲突。任务执行建**依赖图并按 wave 分组并行**，每完成一个任务界面实时标 in-progress/completed。
- **上下文与记忆**：**Steering**（`.kiro/steering/*.md`）是项目级持久知识，每次生成代码自动注入；spec 三文件也自动进入会话上下文，保证后续对话与已批准的规格对齐。
- **权限与安全**：**Hooks**（`.kiro/hooks/*.json`）事件驱动，触发点含 SessionStart / Stop / PreTaskExec / PostTaskExec / PostFileSave / UserPromptSubmit 等，action 可选 shell 命令或注入 agent 提示词。关键设计：`PreToolUse` 出口码 0 放行、2 拒绝，**其余一切情况（超时、崩溃、命令不可执行）一律 fail-closed 阻断**——deny 钩子坏掉也不能静默失效。custom agents 用 markdown 配工具与内联权限；默认多数操作要用户确认。
- **特色（可吸收）**：**Correctness 属性基测试**（bugfix spec 生成属性测试，同时验证修复生效与既有行为未被破坏）；逐任务出 diff 审阅再进下一任务。

## 8. 对 WLLM 的吸收建议（WLLM = 本地 Qwen 驱动的 TS coding agent）

| 优先级 | 吸收项 | 出处 | 落地要点 |
|---|---|---|---|
| **高** | Spec 三件套 + 任务依赖图 wave 并行 | Kiro | 本地小模型上下文最贵，先把需求/设计/任务**落盘成三个 markdown**，执行期只喂相关切片；tasks.md 解析依赖分 wave，独立任务并发跑 |
| **高** | PreToolUse fail-closed 门禁 | Kiro | 写操作/命令执行前跑 hook 校验，超时或异常一律判 deny；这是本地 agent 少有的硬安全网 |
| **高** | Rules 分级触发 + 目录级 AGENTS.md | Cursor / Windsurf | `alwaysApply` / `globs` / `description`(agent 自选) 三档，避免把全部规则常驻塞进本就不大的上下文 |
| 中 | 规划/执行双 agent 分离 | Windsurf / Cursor Plan Mode | 便宜的计划模型只读出计划，主模型只执行短期动作；计划落盘可复用 |
| 中 | Session Insights 式复盘 | Devin | 会话结束生成「时间线+可执行反馈+改进提示词」，**写回 AGENTS.md 或 memory 文件**，形成自我进化 |
| 中 | 记忆先审后存 | Augment | 自动提炼的记忆进 pending 队列，用户 Tab 批准/编辑后才持久化，防污染 |
| 中 | commit 摘要入索引 | Augment Context Lineage | 本地可用小模型把近期 commit 压成一两句，与文件 chunk 一起入检索，回答「为什么当时这么改」 |
| 中 | instructions 长度预算与分层 | Copilot | 明确单文件上限（Copilot review 仅 4000 字符），按 applyTo 分层，本地更要卡死预算 |
| 中 | 浏览器/端到端自测循环 | Replit | 降级实现：接 Playwright 截图+断言，agent 自判「改动够多」才触发一轮测试并自修 |
| 低 | 语义 embedding 全仓索引 | Cursor / Augment | 本地算力与内存吃紧，先用 grep/LSP/目录结构检索，索引留作大仓可选项 |
| 低 | Checkpoint 命名回滚 | Windsurf / Augment | 可用 git worktree + stash 近似，非首期必需 |
| 低 | 云端异步 VM / 托管部署 | Copilot / Replit | 依赖云基础设施，与本地定位冲突，不吸收 |
