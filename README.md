# WLLM

[![CI](https://img.shields.io/github/actions/workflow/status/Tupig/WLLM/ci.yml?branch=main&label=CI)](https://github.com/Tupig/WLLM/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-black?logo=nodedotjs&logoColor=white)](#-快速开始)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript&logoColor=white)](#-项目结构)
[![vitest](https://img.shields.io/badge/vitest-464%20%E7%BB%BF-brightgreen?logo=vitest&logoColor=white)](#-测试与-ci)
[![gameqa](https://img.shields.io/badge/gameqa-Unity%20%E6%B5%8B%E8%AF%95%E5%B9%B3%E5%8F%B0-orange?logo=unity&logoColor=white)](#-gameqa--unity-%E8%87%AA%E5%8A%A8%E5%8C%96%E6%B5%8B%E8%AF%95%E5%B9%B3%E5%8F%B0)

> 全 TypeScript 的**本地 AI 工作站**：Claude Code 式编码代理（pilot）+ Unity 游戏自动化测试平台（gameqa）+ Apple MLX 本地推理层（llm）+ 单端口三协议代理，全部自托管、零云依赖、一份 README 即全部文档。

## 目录

- [🥮 这是什么](#-这是什么)
- [🚀 快速开始](#-快速开始)
- [🧭 七个命令入口](#-七个命令入口)
- [🤖 pilot — AI 编码代理](#-pilot--ai-编码代理)
- [🎮 gameqa — Unity 自动化测试平台](#-gameqa--unity-自动化测试平台)
- [🧠 MLX 本地推理 + 协议代理](#-mlx-本地推理--协议代理)
- [🏗️ 架构](#️-架构)
- [📁 项目结构](#-项目结构)
- [⚙️ 配置与环境变量](#️-配置与环境变量)
- [📜 开发流程（PROCESS）](#-开发流程process)
- [🧪 测试与 CI](#-测试与-ci)
- [🔧 常见问题](#-常见问题)
- [🗺️ 演进里程碑](#️-演进里程碑)

## 🥮 这是什么

一个跑在自己机器上的 AI 研发工作台，四个部分拼成完整闭环：

| 组件 | 是什么 | 入口 |
| --- | --- | --- |
| **pilot-agent** | 参照 Claude Code 架构实现的 AI 编码代理：读代码、改文件、跑命令、多步规划，全链路可本地运行 | `pilot` |
| **gameqa** | Unity3D 游戏自动化测试编排平台：HTTPS 看板 + 任务队列 + 跨机 Agent + Unity batchmode 真执行，API 与数据格式兼容原 gpt-visual-platform（Go 版） | `gameqa serve` / `gameqa agent` |
| **MLX 推理层** | Apple Silicon（M4）上用 MLX 跑本地大模型，管理服务生命周期，单端口暴露给任意客户端 | `llm` |
| **协议代理** | 一个端口同时说 OpenAI Chat / OpenAI Responses / Anthropic Messages 三种协议，互相转换后转本地后端 | `:4100`（由 `llm` 拉起） |

设计原则：

- **一种语言**：全仓 TypeScript（含脚本、代理、测试），无 Python / Go / Rust 残留
- **自托管隐私**：代码、模型、测试数据全部不出本机；云端 Provider 是可选项而非依赖
- **客户端开放**：任何支持 OpenAI 或 Anthropic 协议的工具（opencode / Claude Code / codex…）都能直接接本机
- **一份文档**：本 README 即项目全部文档，随代码同步更新；历史看 git 记录

## 🚀 快速开始

```bash
git clone https://github.com/Tupig/WLLM.git && cd WLLM
npm ci                # 安装依赖（Node ≥ 20，构建需 Node 22+）
npm run build         # tsc 编译 + 拷贝 gameqa 看板静态资源 + 入口 chmod
npm test              # 38 文件 / 464 用例全绿（tsc + vitest 是 CI 双门槛）
```

构建后 `dist/cli/*.js` 即 7 个可执行入口。常用一分钟上手：

```bash
# 1) 本地对话（先 llm start 起 MLX 服务，见下文）
llm "解释闭包"

# 2) AI 编码代理（在任意代码仓里）
pilot                      # 交互式 REPL
pilot "把 src/utils 里的重复逻辑抽出来"

# 3) Unity 测试平台（HTTPS 自签名，看板 https://localhost:9111）
gameqa serve -p 9111 -d data
PLATFORM_URL=https://localhost:9111 AGENT_ID=agent-1 PLATFORM=mac \
  AGENT_SKILLS=PlayMode PLATFORM_INSECURE_TLS=1 gameqa agent
```

> [!IMPORTANT]
> - **开发态**可用 `npm run dev:pilot` / `npm run gameqa:serve`（tsx 直跑，免构建）。
> - gameqa 默认全站 HTTPS（自签名证书自动生成于 `data/tls/`）；浏览器首次访问点「高级 → 继续前往」，macOS 可用 `./scripts/trust-cert-macos.sh` 一键信任。
> - 跑 MLX 需要 Apple Silicon；`llm doctor` 自检环境。

## 🧭 七个命令入口

| 命令 | 用途 | 典型用法 |
| --- | --- | --- |
| `pilot` | AI 编码代理主入口 | `pilot "重构这个模块"` / `pilot`（REPL） |
| `llm` | MLX 本地服务管理 + 对话 | `llm start` / `llm use 8b` / `llm "问题"` / `llm doctor` |
| `gameqa` | 测试平台 serve / agent 双子命令 | `gameqa serve --tls off` / `gameqa agent` |
| `opencode-local` | 走本机代理的 opencode 入口 | `opencode-local "写个快排"` |
| `claude-local` | 走本机代理的 Claude Code 入口 | `claude-local "重构这个函数"` |
| `codex-local` | 走本机代理的 Codex 入口 | `codex-local exec "跑测试"` |
| `mlx-local` | MLX 模型直连入口 | `mlx-local "补全这段"` |

开发态脚本：`npm run dev`（index）、`dev:pilot`、`dev:llm`、`gameqa:serve`、`gameqa:agent`、`test`、`test:watch`。

## 🤖 pilot — AI 编码代理

### 能力清单（20+ 工具）

| 类别 | 工具 |
| --- | --- |
| 读写 | `FileRead`（文本 + 图片多模态输入，png/jpg/webp/gif ≤5MB）`FileWrite` `FileEdit`（精确 + 模糊回退：容忍缩进/空白/单字符漂移，唯一命中才替换）`DocRead` |
| 检索 | `Grep`（ripgrep 主路径 + 内置降级）`Glob` `RepoMap`（全仓地图）`similar`（语义近邻） |
| 执行 | `Bash`（沙箱 + 安全护栏）`PackageManager` `lint` `Refactor` `Analysis` |
| 规划 | `todo`（任务清单）`Question`（向用户澄清）`parallel`（并行子任务）`Agent`（子代理派发） |
| 状态 | `rollback`（回滚）`state`（状态机）`Web`（联网抓取） |

### 内核特性

- **上下文工程**：预算制压缩（`compact`）、`PILOT_MAX_CONTEXT_TOKENS` 自适应（30k ~ 10M 窗口）、轨迹（trajectory）记录与复盘
- **多 Provider 容错**：Anthropic / OpenAI / 本地代理统一接入，`PILOT_FAILOVER` 链式降级，`PILOT_ROLE_MODELS` 分角色选模型
- **会话与恢复**：session / checkpoint / 一键回滚，跨进程续跑
- **知识沉淀**：memory（长期记忆）+ skills（技能库，`.wllm/skills/` 先审后存）+ reflexion（反思入库）
- **工作模式**：plan / act 双模式 + spec 规格驱动开发（`n8-spec`）
- **工程护栏**：写路径沙箱（`PILOT_SANDBOX_WRITE/DENY`）、权限分级、hooks（`PILOT_HOOKS_FILE`）、`/doctor` 自诊断、`/init` 项目初始化、`/review` 代码评审

## 🎮 gameqa — Unity 自动化测试平台

跨环境（Mac / Linux / Windows / iOS / Android）的 Unity3D 游戏自动化测试编排与结果收集，
`data/` 数据格式与原 gpt-visual-platform（Go server + Rust agent）完全兼容；原蓝本文档已删，历史见 git。

### 任务类型（Agent 侧，`extra.job_type`）

| job_type | 执行内容 |
| --- | --- |
| （缺省）/ `generate_and_run` | **Unity batchmode 真执行**：`-runTests -testPlatform PlayMode/EditMode -testResults xml`，解析 NUnit3 XML；`generate_and_run` 先把 `extra.generated_test_csharp` 写入 `Assets/Tests/Generated/` 再带 `-testFilter Generated` 执行（默认执行后清理，`extra.keep_generated` 保留） |
| `use_mcp: true` | 直连 Unity MCP `/tools/run_tests` |
| `self_check` | Agent 环境自检 |
| `airtest` | Airtest CLI 跑 `.air` 图像识别脚本（Android/Windows 设备 URI） |
| `ai_exploratory` | 视觉大模型「截图 → 决策 → 执行」循环（Android；动作校验防 shell 注入） |
| `game_perf` | 帧率/卡顿/内存采样 + 阈值断言（dumpsys gfxinfo / meminfo） |
| `unity_log_scan` | Unity Player.log 错误/异常扫描（阈值 `max_errors`） |
| `device_inventory` | ADB 设备清单（型号/版本/分辨率/电量） |

### 内置执行器（服务端，`platform=web`，无需 Agent）

`web_check`（网站可用性）/ `api_check`（接口断言）/ `api_load`（k6 式性能冒烟）/
`api_flow`（多步接口流程）/ `self_check` / `port_check` / `cert_check` / `dns_check`；
`extra.repeat_minutes` 开启循环监控（蓝本的断链 bug 已修，服务端 worker 直读 `extra`）。

### 服务端 API（30 路由）

注册 / 心跳 / 领任务（`POST /api/agent/poll`）/ 结果上报（3 次重试，poll 只认 pending）/
产物上传（截尾 64KB，`ARTIFACT_MAX_BYTES`）/ 任务 CRUD / 取消 / Agent 列表 / 技能表 /
MCP 代理 / OpenAI 用例生成 / Webhook 通知 / 看板静态资源；可选 `X-Platform-Token` 认证（`PLATFORM_TOKEN`）。

### 关键环境变量

| 变量 | 侧 | 说明 |
| --- | --- | --- |
| `PORT` / `DATA_DIR` / `STATIC_DIR` | serve | 端口（默认 9111）/ 数据目录 / 看板目录（缺省自动定位） |
| `TLS_MODE` | serve | `auto`（自签名/用户证书，默认）\| `off`（明文，仅限可信内网） |
| `TLS_CERT` / `TLS_KEY` | serve | 用户证书（优先；自签名存 `data/tls/`，跨重启复用，key 0600） |
| `PLATFORM_TOKEN` | serve | 启用 `X-Platform-Token` API 认证（公网部署必设） |
| `STALE_MINUTES` | serve | running 任务超时判 Agent 失联标失败（默认 30） |
| `PLATFORM_URL` | agent | 编排服务地址（默认 `http://localhost:9111`） |
| `AGENT_ID` / `AGENT_SKILLS` / `AGENT_WORKDIR` | agent | 标识 / 技能（逗号分隔，任务 `required_skills` 须为其子集）/ 工作目录 |
| `PLATFORM_INSECURE_TLS` | agent | `1` = 信任自签名服务端；或 `PLATFORM_TLS_CERT=<cert.pem>` 指定 CA |
| `UNITY_PATH` | agent | Unity 可执行文件（缺省探测 Unity Hub 最高版本 / PATH） |
| `ADB_PATH` / `ANDROID_SERIAL` | agent | adb 可执行覆盖 / 默认设备序列号 |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_VISION_MODEL` | agent | `ai_exploratory` 视觉模型 |

### 运维脚本与部署

```bash
./scripts/e2e.sh              # 全链路冒烟（HTTPS + Agent + 内置执行器 + 取消/删除 + 落盘）
./scripts/start.sh            # 前台启动（已注册系统服务则转 launchd/systemd）
./scripts/install-service.sh  # 注册开机自启（macOS launchd / Linux systemd）
./scripts/stop.sh / status.sh / uninstall-service.sh / trust-cert-macos.sh
```

## 🧠 MLX 本地推理 + 协议代理

Apple M4 上跑本地大模型，架构：

```
CLI（llm / *-local / 任意 OpenAI/Anthropic 客户端）
   → :4100  TS 统一协议代理（src/proxy/，三协议互转）
      → :8080  mlx_lm.server（MLX 推理）
```

- **llm**：`llm start|stop|status|doctor`（服务生命周期）、`llm use 8b`（切模型，`mlx/models.json` 管清单）、`llm "问题"`（直连对话）
- **mlx-local 全命令**：`start [模型]` / `restart [模型]` / `stop` / `status` / `logs server|proxy` / `healthcheck` / `model list|info` / `metrics`
- **代理三协议**：`/v1/chat/completions`（OpenAI Chat）、`/v1/responses`（OpenAI Responses）、`/v1/messages`（Anthropic Messages）互转（`src/proxy/convert.ts`），后端统一 `mlx_lm.server`；`:4100` 对外、`:8080` 仅本地内部调用
- **客户端接入**：`opencode-local` / `claude-local` / `codex-local` 三个 shim 已配好本机 provider；配到别的 AI 工具同样只要把 base URL 指到 `:4100`
- 模型目录 `mlx/models/`、虚拟环境 `mlx/venv/`、日志与状态均运行时（gitignore）

**内置模型清单**（`mlx/models.json`）：

| 别名 | 模型 | 大小 | 定位 |
| --- | --- | --- | --- |
| `14b` | Qwen3-14B-4bit | 7.8G | 默认，性能均衡 |
| `8b` | Qwen3-8B-4bit | 4.3G | 轻量快速 |
| `30b` | Qwen3-Coder-30B-A3B-Instruct-4bit | 16G | 代码专精，需提高 GPU 上限 |
| `qwen-vl-8b` | Qwen3-VL-8B-Instruct-4bit | 5.5G | 视觉语言模型 |

> [!WARNING]
> 24GB 内存机器 GPU 上限约 16GB：30B 模型需调高 `MLX` GPU 上限；超长上下文（5 万+ token）请求可能 OOM，长任务建议切云端 Provider（`PILOT_PROVIDER`）。

## 🏗️ 架构

```
                         ┌─────────────────────────────────────────┐
   pilot / gameqa /      │  src/engine      QueryEngine 主链路      │
   *-local 客户端  ──────▶│  src/tools       20+ 工具（读写/检索/执行）│
                         │  src/session     会话/检查点/轨迹         │
                         │  src/context     压缩/预算/RepoMap        │
                         │  src/knowledge   记忆/技能/反思           │
                         │  src/modes       plan·act + spec         │
                         │  src/agents      子代理                  │
                         │  src/services    API/沙箱/权限/容错       │
                         └─────────────────────────────────────────┘

   gameqa serve ── HTTPS :9111 ── 看板 static + REST API + 内置执行器 worker
        ▲  poll / 上报（X-Platform-Token 可选）
   gameqa agent ── Unity batchmode · Airtest · AI 探索 · ADB/性能/日志
   （跨 Mac/Linux/Windows/iOS/Android；PLATFORM_INSECURE_TLS 信任自签名）

   任意 OpenAI/Anthropic 客户端 ──▶ :4100 代理（三协议互转）──▶ :8080 mlx_lm.server
```

## 📁 项目结构

```
WLLM/
├── AGENTS.md                  # AI 协作约定（工作流/issue 闭环/README 维护规则）
├── README.md                  # 本文件——项目唯一文档，随代码同步更新
├── package.json               # 7 bin + 构建/开发脚本
├── scripts/                   # gameqa 运维：e2e/start/stop/status/install-service…
│
├── src/
│   ├── index.ts / config.ts   # CLI 入口 + 全局配置
│   ├── engine/                # 主链路：QueryEngine prompt Tool toolRegistry router harness
│   ├── tools/                 # 20+ 工具实现
│   ├── services/              # api bashSafety permissions sandbox failover
│   ├── session/               # session sessionState checkpoint trajectory
│   ├── context/               # compact/ budget cache rules repomap
│   ├── knowledge/             # memory skills reflexion（知识沉淀）
│   ├── modes/                 # plan/act + spec
│   ├── agents/                # 子代理
│   ├── commands/              # /doctor /init /review + REPL
│   ├── proxy/                 # 统一协议代理（convert 三协议转换 + server SSE relay）
│   ├── gameqa/                # Unity 测试平台（store/server/builtin/agent/unity/
│   │                          #   airtest/gameperf/ai/tls + static 看板）
│   ├── cli/                   # 7 个入口（pilot llm gameqa *-local mlx-local mlxcmd）
│   └── git/ state/ utils/
│
├── tests/                     # vitest 38 文件 / 464 用例
├── mlx/                       # 推理服务层（models/venv/logs/state 运行时 + models.json）
├── .wllm/                     # 运行时技能库（先审后存）
└── .github/workflows/ci.yml   # 门槛：tsc + vitest + build
```

## ⚙️ 配置与环境变量

### pilot / 引擎

| 变量 | 说明 |
| --- | --- |
| `PILOT_PROVIDER` / `PILOT_MODEL` | Provider（`anthropic` / `openai` / `proxy`…）与模型 |
| `PILOT_CLOUD_MODEL` / `PILOT_ROLE_MODELS` | 云端模型 / 按角色（读码、改码…）分模型 |
| `PILOT_MAX_CONTEXT_TOKENS` | 上下文窗口 30_000 ~ 10_000_000，自适应压缩迭代 |
| `PILOT_FAILOVER` | Provider 链式降级 |
| `PILOT_SANDBOX_WRITE` / `PILOT_SANDBOX_DENY` | 写沙箱白名单 / 黑名单 |
| `PILOT_HOOKS_FILE` / `PILOT_HOOKS_FAIL_OPEN` | hooks 配置 / 失败是否放行 |
| `PILOT_HARNESS` / `PILOT_DEBUG` / `PILOT_MOCK` / `PILOT_PROMPT_OPT` / `PILOT_EXTRA_TOOLS` | harness、调试、Mock、prompt 优化、额外工具 |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENAI_BASE_URL` | 云端 Provider 凭证（可选） |

### MLX / 代理

| 变量 | 说明 |
| --- | --- |
| `MLX_HOME` / `MLX_VENV` / `MLX_LOGS` / `MLX_STATE` | MLX 根目录/虚拟环境/日志/状态 |
| `MLX_MODELS` / `MLX_MODEL` / `MLX_DEFAULT_MODEL` | 模型清单 / 当前模型 / 默认模型 |
| `MLX_SERVER_PORT` / `MLX_UNIFIED_PORT` | 后端推理端口（8080）/ 统一代理端口（4100） |
| `MLX_BACKEND` / `MLX_AUTH_TOKEN` / `MLX_REQUEST_TIMEOUT` | 后端选择 / 鉴权 / 超时 |

gameqa 环境变量见上文 [gameqa 节](#-gameqa--unity-自动化测试平台)。

## 📜 开发流程（PROCESS）

每个功能单元走完六步，**不允许跳步**：

```
① 调研 → ② 测试（先写测试，必须红） → ③ 落盘（最小实现转绿）
      → ④ 审查 → ⑤ 全量回归 → ⑥ 验收
```

| 步 | 出口条件 |
| --- | --- |
| ① 调研 | 读本仓代码 + git 历史 + 同类开源实现，边界写清 |
| ② 测试 | 测试文件落盘，跑一次确认按预期红——**没有测试不许改代码** |
| ③ 落盘 | 相关用例绿；只改本功能代码 |
| ④ 审查 | 正确性/边界/错误路径/安全（注入、路径逃逸、命令盲执行）/无死代码；审查点进提交信息 |
| ⑤ 回归 | `npx tsc --noEmit` + `npx vitest run` 全绿 |
| ⑥ 验收 | AC 全过才算完成 |

### 🐛 Bug / 优化 · Issue 强制流程

本地发现的**任何 bug 或优化点，必须先上报 GitHub issue 再动手修**：

1. `gh issue create` 上报（现象/根因/影响面/复现）——**无 issue 不许改代码**
2. 修复提交必须引用 issue 号：`fix #<N>: ...`
3. 回归全绿 + 推送后 CI 绿 → `gh issue close <N>`（留一句修复摘要）

历史 bug 查询：`gh issue list --state all`；过往决策用 `git log`。工作区不留待办文档。

## 🧪 测试与 CI

```bash
npm test              # = npx vitest run，38 文件 / 464 用例
npx tsc --noEmit      # 类型门槛
npm run build         # 构建门槛（含 gameqa 静态资源拷贝 + 入口 chmod）
```

用例分组：`n1~n12`（编辑/会话/沙箱/子代理/规格/RepoMap/harness…）、`e1~e10`
（Provider/配置/护栏/容错/工具/并行/路由/优化）、`f*`（压缩/权限）、`i1~i4`
（记忆/技能/hooks/反思）、`g1~g5`（gameqa store/服务/内置执行器/Unity 真执行全链路/
airtest·性能·AI 集成/TLS·CLI）、`proxy-*`（三协议转换/SSE）、`smoke`、`cli`、`ctx10m`。

**CI**（`.github/workflows/ci.yml`，ubuntu-latest + Node 22 + ripgrep）三连：
`tsc --noEmit` → `vitest run` → `npm run build`。本地全绿但 CI 红 → 先建 issue 再修。

## 🔧 常见问题

**打开看板报「您的连接不是私密连接」？**
自签名证书的预期行为，点「高级 → 继续前往 localhost」；macOS 想彻底消除：`./scripts/trust-cert-macos.sh`（导入钥匙串并设为始终信任）。

**Agent 连不上 serve？**
自签名服务端需 `PLATFORM_INSECURE_TLS=1`，或 `PLATFORM_TLS_CERT=<data/tls/cert.pem>` 指定 CA；协议要 https。

**gameqa 端口冲突 / 数据在哪？**
`-p` 换端口；任务、Agent、证书都在 `DATA_DIR`（默认 `./data`），已 gitignore。

**LSP/编辑器报 `../harness.js` 找不到之类错误？**
陈旧索引缓存，以 `npx tsc --noEmit` 为准；ESM 相对导入必须带 `.js` 后缀。

**切本地模型？**
`llm use 8b`（清单 `mlx/models.json`），`llm doctor` 自检，`llm status` 看服务。

**CI 挂了？**
看 `gh run list` / `gh run view <id> --log-failed`，按上文 Issue 强制流程处理。

## 🗺️ 演进里程碑

| 阶段 | 内容 |
| --- | --- |
| v1 | Python 原版（pilot + FastAPI 平台 + Python Agent） |
| v2 | gpt-visual-platform：Go server + Rust agent（单二进制，API 兼容 v1） |
| v3 | **统一语言重写**：全仓 TS 单实现（engine/proxy/mlx/tools），CI 三门槛全绿 |
| v4 | **gameqa 整合**：蓝本占位全部落地（Unity batchmode 真执行、Agent 全链路、TLS、系统服务与运维脚本），archive 删除 |
| 当前 | 单 README 文档制 + bug/优化 issue 强制闭环 |
