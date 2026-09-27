# 调研：OpenAI Codex CLI（B2，开源 Apache-2.0，127k stars）

> 来源：github.com/openai/codex README + developers.openai.com/codex（features/sandbox/reference）+ help.openai.com，2026-09。

## 形态

- Rust 编写（codex-rs）+ CLI/TUI；npm/brew/官方脚本安装；macOS/Linux/Windows(WSL/原生沙箱)
- 三形态：本地 CLI、IDE 扩展、`codex app` 桌面、Codex Web 云端
- 登录：ChatGPT plan（Plus/Pro/Business）或 API key；`~/.codex/config.toml` 中心配置

## 沙箱与审批（F3 核心参考）

- **沙箱模式**：`read-only` / `workspace-write`（默认，网络默认关）/ `danger-full-access`
  - macOS Seatbelt；Linux Landlock+seccomp；Windows 沙箱
  - `sandbox_workspace_write.network_access=true` 才开网；`writable_roots` 扩展可写目录
- **审批策略**：`untrusted`（非白名单命令问）/ `on-request`（越界才问）/ `never`
- **经典预设**：
  - Suggest（默认）：只提议，改/跑都要批
  - Auto Edit：文件自动改，shell 仍要批
  - Full Auto = `--full-auto` = workspace-write + on-request（沙箱内自治）
  - `--yolo`：全关（警告不建议）
- **会话内**：`/permissions` 切模式、`/model` 切模型+reasoning effort、`/status` 看配置
- 非版本控制目录进入 Auto/Full 前**警告**
- **writable_roots**：多目录工作不拆沙箱 → F3 分级可抄（只读/工作区写/全局问）

## 命令面（可吸收功能清单）

- `/init`：生成 AGENTS.md；`/review`：非交互评审（未提交改动/某 commit/对 base 分支 PR 式/自定义指令），**只报告不改工作区**，输出优先级 findings
- `codex resume`：恢复历史会话（按 ID 或最近）；`codex unarchive`
- `codex --image`：截图/架构图进 prompt（多模态）；交互式可粘贴图片
- **subagents**：委派专项调查，结果回主会话（原生子代理）
- `codex --search`：实时联网搜索（默认缓存模式）；搜索活动在 transcript 可见
- `codex mcp`：本地/远程 MCP + 会话工具检视
- `codex sandbox <cmd>`：单独在沙箱里跑任意命令（`--log-denials`）
- `codex exec`（非交互，CI 模式，搜索结果提及 scripting/CI）
- shell 补全、主题、`$EDITOR` 长 prompt
- hooks：`--dangerously-bypass-hook-trust` 反证**有 hook 信任机制**（持久化 trust）

## 与 pilot 相关（C1/C2 输入）

| codex 能力 | pilot 现状 | 动作 |
|------------|-----------|------|
| 沙箱三级+审批三档组合 | 仅 permissions.ts 简单审批 | **F3 吸收**：分级矩阵（本地无系统级沙箱，用目录白名单+命令模式近似） |
| `/review` 非交互评审 | 无 | **C2 候选**（本地模型可跑，成本低） |
| resume/会话恢复 | session/index.ts 有雏形 | 对照完善 |
| subagents 原生 | 235 行有 | G1 后对照 |
| AGENTS.md `/init` | 无（我们有静态 AGENTS.md） | C2 候选 |
| `--image` 多模态 | 无 | 依赖 qwen-vl-8b，**C2 候选（后期）** |
| MCP | 无 | C2 候选（本地价值有限，pilot 先不做或后置） |
| 非版本控制目录警告 | 无 | 并入 F3 |
