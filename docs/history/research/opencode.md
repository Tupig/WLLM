# 调研：opencode（B1）

> 来源：opencode.ai/docs（2026-09）。维度：架构/工具/压缩/权限/subagent/skills/UX。

## 架构与形态

- 终端 TUI / 桌面 / IDE 扩展 / CLI / Web / SDK(server 模式) 多形态，核心同一引擎
- 配置中心化：`opencode.json`（$schema 校验），provider 任意切换
- 项目约定：`/init` 生成项目根 `AGENTS.md`（提交进 git），agent 读取理解项目结构
- 内部 grep/glob 用 **ripgrep**，默认尊重 `.gitignore`；`.ignore` 文件可反向放行

## 内置工具（14 个）

| 工具 | 职责 | 备注 |
|------|------|------|
| bash | 执行 shell | |
| edit | 精确字符串替换编辑 | 主编辑方式 |
| write | 建/覆盖文件 | 与 edit/apply_patch 同受 `edit` 权限管 |
| read | 读文件（支持行区间） | |
| grep | 正则内容搜索 | ripgrep 底层 |
| glob | 模式匹配文件，按修改时间排序 | ripgrep 底层 |
| apply_patch | patch 文本落地（Add/Update/Move/Delete 标记行） | 路径相对项目根 |
| skill | 加载 SKILL.md 到上下文 | **I2 直接参考** |
| todowrite | 任务列表管理 | subagent 默认禁用 |
| webfetch / websearch | 抓页 / 搜索 | websearch 走自家托管 MCP |
| question | 执行中向用户提问（选项+自定义输入） | 交互澄清机制 |
| lsp（实验） | 定义/引用/hover/调用层级 | 需 LSP server 配置 |

- 扩展三路：custom tools（配置内定义函数）、MCP server、插件 hook
- 工具开关与掩码：`permission` 字段 per-tool `allow/deny/ask`，支持 `mymcp_*` 通配符

## 权限模型

- 默认：全部工具 enabled 且免许可
- `permission: { tool: allow|deny|ask }`，edit/write/apply_patch 合并为 `edit` 一个权限门
- Policies（独立页）做更细规则

## 模式与 UX

- **Plan mode / Build mode**：Tab 切换；Plan 禁写只建议（= Claude Code plan mode）
- `@` 模糊搜文件插进 prompt；拖拽图片入终端（多模态输入）
- **`/undo` `/redo`**：多步撤销/重做改动（会话级历史回滚）
- `/share` 生成对话分享链接；`/init` 项目分析
- 斜杠命令、自定义命令、主题、键位、formatter 可配

## 与 pilot 的相关性（C1 输入）

- 工具集思路与 E5 一致（bash/edit/write/read/grep/glob 核心 6 件 ≈ 我们 8 件）
- `skill` 工具 + SKILL.md → **I2 技能库直接对标**
- `permission ask/deny/allow` + edit 合并门 → **F3 权限分级参考**
- `question` 工具 → 交互澄清（本地模型可用性待评估）
- `/undo/redo`、Plan 模式 → 候选功能（C2 排优先级）
- todowrite（任务列表）→ E/F 阶段我们已用手动 todo，可做工具化

## Skills 机制（I2 蓝本，已核实）

- **文件即技能**：一技能一目录，`<dir>/SKILL.md`，YAML frontmatter：
  - `name`（必填：1-64 字符、`^[a-z0-9]+(-[a-z0-9]+)*$`、必须等于目录名）
  - `description`（必填：1-1024 字符，供 agent 判断何时用）
- **发现路径**（项目级从 cwd 上溯至 git worktree，沿途收集；全局并集）：
  - `.opencode/skills/*/SKILL.md`、`~/.config/opencode/skills/*/SKILL.md`
  - 兼容 `.claude/skills/`、`.agents/skills/`（项目级+全局）
- **按需加载不占上下文**：把 `<available_skills>`（仅 name+description 清单）注入 `skill` 工具描述；agent 需要时调 `skill({name})` 拉全文进对话
- **权限**：`permission.skill` 模式匹配 `{ "*": allow, "internal-*": deny, "exp-*": ask }`，可 per-agent 覆写；`tools.skill:false` 整体关（清单都不注入）
- **失败可见**：deny 的技能对 agent 隐藏；排查清单=全大写 SKILL.md/frontmatter/名字唯一/权限

## Agents / Subagent（B1 核心收获）

- **两类**：primary（Build 默认全工具 / Plan 默认 edit+bash 全 `ask`，Tab 切换）+ subagent（General 全工具除 todo、Explore 只读、Scout 只读查外部依赖），`@` 点名或 Task 工具自动派发
- **隐藏系统 agent**：`compaction`（自动压缩长上下文→小摘要）、`title`、`summary`——压缩不是硬编码函数而是隐藏 agent 跑的（**F1/F2 重要参考**）
- **定义双路**：JSON 配置 或 `~/.config/opencode/agents/*.md` / `.opencode/agents/*.md`（文件名=agent 名，frontmatter: description/mode/model/temperature/steps/prompt/permission）→ 文件即 agent，**I3/I4 进化可直接抄这个模式**
- **权限 key 全表**：read / edit(write+edit+apply_patch) / glob / grep / list / bash / task / external_directory / todowrite / webfetch / websearch / lsp / skill / question / **doom_loop（agent 疑似卡死时的恢复提示）** / **subagent 的 child session 可导航**
- **bash 细粒度**：`bash: {"*":"ask", "git status *":"allow", "git push":"ask"}`，**最后匹配胜、`*` 放最前**——F3 直接可用
- **task 权限**：`task: {"*":"deny","orchestrator-*":"allow"}` deny 时 subagent 从 Task 工具描述移除（模型根本看不见）
- **steps 上限**：到限注入“总结剩余工作”强制停止（防无限循环）
- **doom_loop 机制**：卡死时的 recovery prompt 权限门 → **E3 BUG-1 卡死的对照参考**
- subagent 默认禁 todowrite；主 agent 按 description 自动挑 subagent

## Plugins（I3 蓝本，已核实）

- **插件=JS/TS 模块**：`export const P: Plugin = async ({project, client, $, directory, worktree}) => ({ hooks... })`，返回 hook 对象
- **加载点/顺序**：全局 config → 项目 config → `~/.config/opencode/plugins/` → `.opencode/plugins/`（目录内文件自动加载；npm 包走 config `plugin: []` 启动时 Bun 自动装）
- **依赖**：配置目录放 `package.json`，启动 `bun install`
- **hook 点全表**（节选关键）：
  - `tool.execute.before / after`（改参数、抛错拦截——例：读 .env 直接 throw）
  - `session.compacted / idle / error / diff / status`、`permission.asked / replied`
  - `file.edited`、`message.*`、`todo.updated`、`shell.env`（注入环境变量）
  - **`experimental.session.compacting`**：压缩前 `output.context.push(...)` 注入持久状态，或 `output.prompt=` 整个替换压缩提示（**F2 压缩质量直接参考**）
- **插件可注册 custom tool**（Zod schema，`tool: {name: tool({...})}`，同名覆盖内置）
- 结构化日志 `client.app.log({service, level, message})`

## B1 结论

opencode 是本次调研最完整参考：工具 14 件、权限 16 key+bash 模式匹配、skills 文件即技能按需加载、agents 文件即 agent、plugins 事件化 hook、隐藏 compaction agent、doom_loop 恢复。**I2/I3/F1/F2/F3/E3 的蓝本主要来自它**。
