# 历史文档合集（归档）

> docs 精简时合并：原 `INVENTORY.md`（A1 自盘）+ `PILOT_INVENTORY.md`（A2 pilot 盘点）+ `GAP.md`（C1 差距）+ `ABSORPTION.md`（C2 吸收清单）。
> 仅为历史留痕与依据追溯，现状以 `docs/DIRECTORY.md` 为准。

---

## 章一 · LLM 仓库自盘（A1，原 INVENTORY.md）

# LLM 仓库自盘（A1）

> 范围：`~/Workspace/WLLM` 中纳入 git 的全部源码与配置（运行时 `venv/ models/ logs/ state/` 已 gitignore）。
> 行号为写本文时的实测行号，供后续 E/F 阶段引用。
> **现状更新（rewrite-ts）**：`bin/` 与 `mlx/` 5 个 shell、`unified_proxy.py`、`test_unified_proxy.py`、`config.env` 已删除，
> 分别由 `src/cli/*.ts`（shebang 入口）、`src/cli/mlxcmd.ts`、`src/proxy/`（vitest 31+10 用例）取代；本文以下保留为 A1 时点历史盘点，现状以 `docs/DIRECTORY.md` 为准。

## 1. 仓库概况

- 合并根：`~/Workspace/WLLM`（原 `~/Workspace/LLM` 整体迁入，历史自 baseline tag `7e2c90c` 起）
- 分支：`main`；remote：`origin → git@github.com:Tupig/WLLM.git`（合并完成 + G3 全绿后首推）
- 环境：Apple M4 / 24GB / macOS；推理栈 MLX（mlx-lm，venv 内）

## 2. 目录结构

```
WLLM/
├── AGENTS.md          # 模型工作约定（中文，962B）
├── CLAUDE.md          # 指向 AGENTS.md（11B）
├── bin/               # 5 个 CLI 入口（详见 §3）
├── mlx/               # 本地推理服务（详见 §4）
├── docs/              # 本文档
└── .gitignore         # venv/ models/ logs/ state/ node_modules/ dist/ *.bak 等
```

## 3. bin/ — 5 个 CLI 入口

统一模式：解析软链接 `BASH_SOURCE` → 定位 `MLX_HOME` → 确保 `:4100` 监听（未运行则 `mlx-local.sh start` + 轮询等待）→ `exec` 外部 CLI。

| 文件 | 行数 | 职责 | 关键点 |
|------|------|------|--------|
| `llm` | 201 | 统一本地对话入口 | `ensure_running()`(:33) 前 10 次 200ms + 后 50 次 1s 轮询；`chat()`(:51) 非流式 `curl --max-time 300`，Python 构造/解析 JSON 防注入；分发 start/stop/restart/status/doctor/use/model/logs |
| `mlx-local` | 19 | 转发器 | 解析软链接后 `exec mlx/mlx-local.sh` |
| `opencode-local` | 34 | 接 opencode | `exec opencode -m local-mlx/default_model "$@"`；等待逻辑 60×1s（:26-31） |
| `claude-local` | 37 | 接 Claude Code | 挂 `~/.claude/settings-local.json` 独立配置，不动云端设置 |
| `codex-local` | 49 | 接 codex | GPU 上限检查（:29，`iogpu.wired_limit_mb=0` 时警告 5.3 万 token 会 OOM）；等待 90×1s |

**D4 待复用**：`opencode-local:23-32` 的端口等待模式 → 新 `bin/pilot`。

## 4. mlx/ — 本地推理服务

### 架构

```
CLI 工具 → :4100 unified_proxy.py → :8080 mlx_lm.server（仅 127.0.0.1）
```

### 文件清单

| 文件 | 行数 | 职责 |
|------|------|------|
| `mlx-local.sh` | 317 | 总控：start/stop/status/use/logs/doctor/healthcheck/model/metrics 分发（:293-317） |
| `lib.sh` | 130 | 共享库：config.env 加载、`port_pid`(:34 优先 PID 文件)、`wait_port`(:50)、`model_dir_for`(:70 models.json 动态查询+硬编码回退)、`check_*` |
| `unified_proxy.py` | 800 | 三协议代理，零第三方依赖（标准库 http.server + ThreadingHTTPServer） |
| `healthcheck.sh` | 162 | `cmd_doctor`(:10 六步诊断) + `cmd_healthcheck`(:94，`--auto-restart`/`--auto-downgrade` 降级到 8b：:145-153) |
| `model_utils.sh` | 235 | model list/info/download/remove（huggingface_hub snapshot_download） |
| `metrics.sh` | 90 | 性能监控面板（进程 CPU/内存、请求速率、系统内存） |
| `config.env` | 25 | 端口 4100/8080、`MLX_REQUEST_TIMEOUT=1800`、`MLX_AUTH_TOKEN`（空=不启用）、`MLX_DEFAULT_MODEL=14b`（用户确认不改） |
| `models.json` | 31 | 4 模型：14b/8b/30b(requires_high_gpu)/qwen-vl-8b(multimodal) |
| `README.md` | 95 | 中文使用文档 |
| `test_unified_proxy.py` | 592 | pytest：31 用例，纯转换函数测试（见 §5） |

### unified_proxy.py 结构

- 常量：`BACKEND=:8080`(:31)、`PORT=4100`(:33)、`REQUEST_TIMEOUT=1800`(:36)、`AUTH_TOKEN`(:39 可选 Bearer)、`STOP_MAP`(:42)
- 转换层（纯函数，全部有单测）：
  - `anthropic_to_openai`(:69) — Messages→Chat，含 tool_use/tool_result 双向
  - `openai_to_anthropic`(:169) — 响应反向 + stop_reason 映射
  - `responses_to_chat`(:211) — Responses→Chat（codex 用）
  - `chat_to_responses`(:287) — 响应反向（SSE event 流）
- `Handler`(:355)：`do_GET`(:462 `/health` 等)、`do_POST`(:475 路由 /v1/chat/completions、/v1/responses、/v1/messages)
- `_handle_chat`(:506 附近)：本会话已修 `want_stream`（:535 前），修掉"SSE 当 JSON 解析"的 500
- `main`(:775)

### mlx-local.sh 关键行为

- `cmd_start`(:26)：server 参数固化（:56-64，本会话已改）：
  `--prompt-concurrency 1 --decode-concurrency 1 --prompt-cache-size 1 --prefill-step-size 1024 --chat-template-args '{"enable_thinking":false}'`（修并发 OOM + thinking 慢）
- 就绪判定：端口监听（120s）→ 真实请求 `"choices"` 探测（120s，:81-98）→ 起 proxy（30s）
- `cmd_use`(:258)：服务运行中则 stop→start 换模型，否则只写 `state/current_model`
- `healthcheck --auto-downgrade`：server 失活 → `cmd_stop` + `cmd_start 8b`（E4 依赖点）

## 5. 测试现状（A5 同步完成）

- `mlx/test_unified_proxy.py`：**31 用例全绿基线**（pytest；A5 初记 33 有误，E8 与 baseline diff 核实）
  - TestAnthropicToOpenAI ×12（text/system/多轮/tool_calls/tool_results/tools 定义/tool_choice×4/temperature/stop）
  - TestOpenAIToAnthropic ×4、TestResponsesToChat ×7、TestChatToResponses ×3、TestTextOf ×5
- pilot-agent 侧：PILOT_MOCK 回归通过（见 A2，tsc 通过、build 通过），无正式测试框架 → T0 加 vitest
- 无 shellcheck/bash -n 基线 → D5 补

## 6. 配置与遗留问题

| 项 | 状态 |
|----|------|
| 旧 `~/Workspace/LLM` | 仅留环境垫片，H1 阶段一并清理 |
| `bin/llm chat` 非流式、`--max-time 300` < config 1800s | **已修**（E8 → 1800） |
| BUG-1：pilot 带工具调用端到端卡死 | **已修**（E3：doom loop+工具超时+非TTY快拒） |
| 并发 OOM、thinking 慢、SSE→JSON 500 | **已修**（mlx-local.sh 参数 + want_stream），G2/G3 回归确认 |

## 7. 运行时（gitignore，迁移后随目录走）

- `venv/`（mlx-lm + mlx_lm.server + huggingface_hub）、`models/`（4 个模型目录）、`logs/`（server.log / unified_proxy.log）、`state/`（current_model、server.pid、unified_proxy.pid）
- 当前状态：8b 在线（迁移后需重启验证——路径自定位 `SCRIPT_DIR` 应自动适配，G1 前用 `mlx-local doctor` 确认）


---

## 章二 · pilot-agent 盘点（A2，原 PILOT_INVENTORY.md）

# pilot-agent 自盘（A2）

> 源：`~/Workspace/Agent`（baseline `18dbce9`，非工作区变更时整体迁入 WLLM，见 D3）。
> pilot-agent@2.0.0，TypeScript ESM，42 个 src 文件 / 7083 行，Claude Code 仿制架构。

## 1. 工程现状

- `package.json`：bin `pilot → dist/index.js`；scripts 仅 `build(tsc) / dev(tsx) / start(node)`
- **无 test 脚本、无测试文件**（`src/testing/index.ts` 是自带的 130 行简易 TestRunner/assert，全仓无调用者）
- 依赖：`@anthropic-ai/sdk`(E1 处理对象)、chalk、commander、glob、zod、zod-to-json-schema
- `tsconfig`：ES2022 + strict + moduleResolution bundler，outDir dist
- 已验证基线：`tsc` 通过、`build` 通过、`PILOT_MOCK=1` 手动冒烟通过、本地单轮问答通过
- **已知 BUG-1**：带工具调用端到端卡死无输出（归 E3）

## 2. 入口与 CLI（src/index.ts，161 行）

- commander：`-m/--model`、`-t/--max-tokens`(8192)、`--max-turns`(20)、`-w/--work-dir`、`-p/--prompt` 单次模式
- 门禁（:143）：`ANTHROPIC_API_KEY` 或 `PILOT_MOCK=1` 或 `OPENAI_BASE_URL` 三者都没有则退出 → **E1 改为本地 :4100 免 env**
- REPL（:57-115）：`/quit /help /clear /cost /model`；`handleSDKMessage` 消费 QueryEngine 异步迭代器
- 模型默认：`PILOT_MODEL || DEFAULT_MODEL`（`claude-sonnet-4-20250514`，E2→`default_model`）

## 3. 模块结构（按行数）

### 核心循环

| 模块 | 行 | 职责 | 关键点 |
|------|----|------|--------|
| `QueryEngine.ts` | 567 | 主循环：压缩触发→工具执行→权限→多轮 | 端到端链路都在此，BUG-1 疑点集中地 |
| `services/api.ts` | 292 | `createClient` 三模式：anthropic/openai/mock | :24 PILOT_MOCK 分支；:256 tool_calls id 拼接疑点；E1 只留 openai 本地 |
| `Tool.ts` | 184 | 工具抽象基类/注册协议 | zod→JSON Schema |
| `tools.ts` | 60 | 工具注册表（26 个） | E5 裁到 8 件的落点 |

### 26 工具清单（src/tools/）

- 保留候选 8 件：`FileRead(73) FileWrite(54) FileEdit(106) Glob(50) Grep(125) Bash(102) + git/tools.ts(78, GitStatus/GitDiff)`
- 裁剪对象 18 件：`Analysis(386) Refactor(397) PackageManager(238) Web(196) parallel(200) lint(131) DocRead(128) state(74) + Web/lint/DocRead 等`
- 归档区（`src/` 之外不动的）：`git/tools.ts`、`utils/path.ts(15)`、`utils/process.ts(10)`

### 上下文与状态

| 模块 | 行 | 职责 |
|------|----|------|
| `compact/index.ts` + `filters.ts` | 136+180 | 5 阶段压缩流水线（F1/F2 对象） |
| `context/index.ts` | 291 | 上下文构建/系统提示 |
| `cache/index.ts` | 195 | prompt cache |
| `budget/index.ts` | 167 | token 预算 |
| `constants.ts` | 16 | `MAX_CONTEXT_TOKENS=200_000`(E2→30_000)、`API_FETCH_TIMEOUT_MS=60_000`(E2→1_800_000)、`DEFAULT_MODEL` |
| `state/AppState.ts + store.ts` | 46+37 | 全局 store（tokenUsage/compactionCount/mode） |
| `session/index.ts` | 183 | 会话持久化 |

### 权限/扩展/周边

| 模块 | 行 | 职责 |
|------|----|------|
| `services/permissions.ts` | 136 | 审批分级（F3 对照 codex 重做） |
| `modes/index.ts` | 169 | 模式（plan/acceptEdits 等） |
| `subagent/index.ts` | 235 | 子代理（B 调研对照） |
| `hooks/system.ts` | 122 | hooks |
| `plugins/index.ts` | 136 | 插件 |
| `rules/index.ts` + `config/index.ts` | 62+155 | 规则/配置加载 |
| `repl/index.ts` | 225 | REPL 实现（index.ts 是外层） |
| `trajectory/index.ts` | 296 | 轨迹记录 |
| `errors/index.ts` | 244 | 错误分类 |
| `git/index.ts` | 295 | git 集成 |
| `repl/errors` 等 | — | — |

## 4. 与 WLLM 合并的衔接点

- **D3**：`src/ + package.json + tsconfig.json` 入 WLLM（拍平到根，与 `mlx/ bin/` 并列），`git merge --allow-unrelated-histories` 保留 Agent 历史
- **E1**：删 `@anthropic-ai/sdk` 依赖 + anthropic 分支；门禁改本地 `:4100`
- **T0**：自带 `src/testing` 废弃换 vitest（或保留至迁移后删）
- **D4**：新 `bin/pilot` = `opencode-local` 等待逻辑 + `node dist/index.js`

## 5. 测试债（A5 补充）

- pilot 侧：**0 个自动化测试**；T0 后每个 E/F 项先写测试再改码
- mlx 侧：pytest 33 用例（INVENTORY §5），G3 时实跑


---

## 章三 · 差距清单（C1，原 GAP.md）

# 差距矩阵（C1）

> 基准：pilot 现状 × research/ 12 份调研。评级：缺失＝无实现；薄弱＝有雏形但低于调研水位；持平＝与主流开源相当；领先＝强于多数对象。

| 维度 | pilot 现状 | 调研对象做法（一格浓缩） | 评级 |
|---|---|---|---|
| 工具集 | 26 个工具；保留 8 件候选、E5 拟裁 18 件；无 todo/skill/question | opencode 14 件（含 skill/todowrite/question/lsp）<br>Cline 收敛 7 件、Roo 按模式分组<br>gemini：read_many_files/save_memory/activate_skill<br>claude：只读工具并行、写工具串行 | 薄弱 |
| 编辑机制 | FileEdit(106)/FileWrite 存在；自盘未记录匹配与失败反馈 | aider：SEARCH/REPLACE 精确回喂＋Did you mean＋只重发失败块<br>Roo apply_diff：行号＋Levenshtein＋连续错误计数<br>SWE-agent：edit 内嵌 linter、不合法拒落盘<br>opencode：apply_patch 文本落地 | 薄弱 |
| 权限审批 | permissions.ts 136 行简单分级，F3 待对照重做 | codex：untrusted/on-request/never＋Suggest/AutoEdit/FullAuto<br>claude：deny→ask→allow＋Tool(glob) 词边界<br>opencode：16 权限 key＋bash 模式最后命中胜<br>Qwen Code：五档＋自修改面强制复审；CodeBuddy auto 分类器 | 薄弱 |
| 上下文压缩 | compact 5 阶段流水线 316 行（F1/F2 待重做） | claude：5 层管线（工具结果预算/microcompact/auto-compact）<br>Qwen：warn/auto/hard 梯子＋失败熔断＋compress-fast<br>OpenHands Condenser：keep_first＋软硬双触发<br>Roo 非破坏性 condenseParent；opencode 隐藏 compaction agent | 持平 |
| 记忆 | 无 memory 模块（仅 session/rules/config） | claude：分层 CLAUDE.md＋auto memory 索引按需<br>Qwen：三层 QWEN.md＋四类自动记忆＋pinned＋/dream<br>Copilot：结构化条目带引用校验；Augment 先审后存<br>goose：两级 memory 落盘 | 缺失 |
| 技能 | 无 skills 模块（I2 规划） | opencode/claude：SKILL.md frontmatter＋三级渐进披露＋列表预算 1%<br>claude：注入后常驻、压缩重注入（单 5k/总 25k）<br>skills-selection：已选 8-12 个技能包 | 缺失 |
| 插件 hooks | hooks/system.ts 122＋plugins/index.ts 136（事件面未记录） | claude：20+ 事件、退出码 0/2、JSON permissionDecision<br>opencode：tool.execute.before/after、session.compacting 注入<br>Kiro：PreToolUse fail-closed（超时/崩溃一律 deny） | 薄弱 |
| 子代理 | subagent/index.ts 235 行 | claude：独立上下文＋工具掩码＋Explore/Plan＋worktree 隔离<br>opencode：文件即 agent、task deny 时工具不可见<br>Amp：专用 sub-agent 各配独立模型<br>Kimi：三内置子代理可后台持久 | 薄弱 |
| 多模型路由 | api.ts 三模式，E1 后只剩本地单模型；无路由 | RouteLLM/ACRouter：任务画像→选模型<br>Continue：模型角色制 chat/apply/summarize<br>aider：architect/editor 双模型<br>CodeBuddy：models.json 能力标记＋fallback | 缺失 |
| 提示词优化 | 无（E10 规划 /optimize） | prompt-optimizer：命令触发＋diff 确认＋最多 3 问＋特征清单改写<br>WorkBuddy：增强开关（不透明无 diff）<br>Cline/Roo：走 Plan 澄清而非静默改写 | 缺失 |
| 会话管理 | session/index.ts 183 行持久化＋/clear；无 checkpoint/undo/resume | claude：checkpoint＋/rewind 四动作、--resume/fork/worktree<br>gemini：shadow git＋Rewind 三档<br>Cline：checkpoints 三档恢复<br>opencode：/undo /redo；codex：resume | 缺失 |
| 流式 UX | REPL 经 QueryEngine 异步迭代器；bin/llm chat 非流式＋300s 超时（E7/E8） | claude：yield* 背压＋流式工具执行＋只读并发<br>Kimi：wire.jsonl 记完整请求轨迹<br>Plandex：--bg/ps/connect 后台任务 | 薄弱 |
| 沙箱 | 无 | codex：Seatbelt/Landlock 三级＋writable_roots<br>claude：OS sandbox＋autoAllowBashIfSandboxed<br>Qwen 容器 -s；OpenHands Docker 默认 | 缺失 |
| 校验自修复 | 有 lint 工具(131)却列为裁剪对象；无 auto-lint 循环 | aider：--auto-lint/--auto-test 默认开、错误回喂<br>SWE-agent：落盘前 linter 拦截<br>Kiro：Correctness 属性测试；Replit：浏览器自测 | 薄弱（且拟裁方向相反） |
| spec/计划工作流 | modes 169 行 plan/acceptEdits 雏形 | Kiro：spec 三件套＋依赖图 wave 并行<br>claude：plan 5 阶段＋allowedPrompts<br>Cline：plan/act 双模式<br>Devin：plan 落盘＋Ask/Agent；Plandex 计划版本分支 | 薄弱 |
| 搜索 | Glob/Grep(125) 保留；Web(196) 列为裁剪；无 repo 地图 | opencode：ripgrep 尊重 .gitignore<br>aider repo-map：tree-sitter 符号热度＋磁盘缓存＋token 预算<br>Cursor/Augment：语义索引（Merkle 增量）<br>codex --search 联网；SWE-agent 结果只列文件名、超量拒绝 | 薄弱 |
| 任务清单 | 无 todowrite 工具（当前手动 todo） | claude：TaskCreate/Update＋TaskCompleted hook 回滚<br>Cline Focus Chain：跨压缩保持进度<br>opencode todowrite：子代理默认禁用 | 缺失 |
| 轨迹可观测 | trajectory 296 行＋errors 244 行 | Kimi：wire.jsonl 落盘请求 schema<br>claude：/context /cost /doctor 体检<br>OpenHands：事件溯源可重放 | 持平 |

## 差距总结（按影响排序）

1. **权限＋沙箱双缺失**：本地小模型越权风险最高，却只有 136 行规则、零 OS/目录级隔离——所有写与命令操作都无硬安全网。
2. **编辑机制无失败反馈与写前拦截**：小模型生成精确 diff 最弱，aider/SWE-agent 的消融证明这块 ACI 投资提分最大，直接决定任务成功率。
3. **压缩 F1/F2 待重做却窗口更紧**：E2 把上下文压到 30k，但缺阈值梯子、非破坏性摘要、工具结果预算，长会话必撞墙。
4. **记忆与技能双零**：跨会话零积累、重复犯错，I1/I2 全靠新建。
5. **checkpoint/undo 缺失**：无本地 CI 时最廉价的安全网不存在，误改只能整段重来。
6. **自修复方向相反**：拟裁掉 lint 工具，缺 auto-lint 回喂循环。
7. **无本地模型 harness**：api.ts 只做协议转换，缺工具调用不稳时的 XML 注入等降级（Continue/Open Interpreter 均为开源模型定制）。


---

## 章四 · 吸收清单（C2，原 ABSORPTION.md）

# 功能吸收清单（C2）

> 过两关：本地 Qwen 14B/8B 能驱动、TS 单机可实现，否则入第三节。缩写 ev=evolution｜ss=技能选型｜po=提示词优化；归属 N1-N12 见第四节，E6/E9 无定义。

## 一、已规划项（E / F / I）

| ID | 功能 | 来源 | 解决 | 落点 | 适配 | 优先 | 归属 |
|---|---|---|---|---|---|---|---|
| E1 | 删 anthropic SDK、门禁 :4100 | 自盘 | 免云端 | api.ts | 高 | P0 | E1 |
| E2 | 常量对齐 30k/1.8M/model | 自盘 | 适配本地 | constants.ts | 高 | P0 | E2 |
| E3 | 修 BUG-1 工具调用卡死 | 自盘 | 主链路 | QueryEngine.ts | 高 | P0 | E3 |
| E4 | healthcheck 自动降级 8b | 自盘 | 抗 OOM | healthcheck.sh | 高 | P1 | E4 |
| E5 | 工具裁 8 件＋延迟装载 | 自盘 | 防稀释 | tools.ts | 高 | P1 | E5 |
| E7/E8 | bin/llm 流式＋超时对齐 | 自盘 | 体验一致 | bin/llm | 高 | P1 | E7/E8 |
| E10 | /optimize：diff 确认＋3 问 | po | 输入可执行 | optimizer | 中·不迭代 | P1 | E10 |
| F1/F2 | 压缩流水线重做 | 自盘 | 不撞墙 | compact/ | 高 | P0 | F1/F2 |
| F3 | 权限分级对照 codex 重做 | 自盘 | 安全底座 | permissions.ts | 高 | P0 | F3 |
| I1 | 分层记忆＋MEMORY＋失败卡 | Claude、ev | 跨会话积累 | memory/ | 高·纯 md | P1 | I1 |
| I2 | 技能库 SKILL.md 渐进披露 | opencode、ss | 省上下文 | skills/ | 高 | P1 | I2 |
| I3 | 插件 hooks 事件化 | opencode、Claude | 确定控制 | hooks/ | 高 | P1 | I3 |
| I4 | Reflexion＋review 代理 | ev | 不重犯 | .wllm/runs | 中·用退出码 | P2 | I4 |

## 二、新吸收项（A）

| ID | 功能 | 来源 | 解决 | 落点 | 适配 | 优先 | 归属 |
|---|---|---|---|---|---|---|---|
| A1 | 编辑失败回喂＋Levenshtein 模糊匹配 | aider、Roo | diff 弱 | FileEdit.ts | 高·规则 | P0 | N1 |
| A2 | 写前 linter 拦截、拒落盘 | SWE-agent | 不进坏盘 | FileEdit | 高·免自评 | P0 | N1 |
| A3 | auto-lint 回喂＋反转裁 lint | aider | 自验证 | QueryEngine＋lint | 高·退出码 | P0 | N2 |
| A4 | auto-commit＋/rewind 三档 | aider、Cline | 可回滚 | git/＋checkpoint/ | 高 | P0 | N3 |
| A5 | 会话 resume/fork | codex、Claude | 可续 | session/＋repl | 高 | P1 | N4 |
| A6 | deny→ask→allow＋glob | Claude、opencode | 硬执行 | permissions.ts | 高 | P0 | F3 |
| A7 | 五档审批＋自修改面复审＋人工触发 | Qwen、Trae | 防自改 | permissions＋modes | 高 | P0 | F3 |
| A8 | 目录白名单＋审批分类器 | codex、Qwen | 越界兜底 | sandbox/ | 中·非系统级 | P1 | N5 |
| A9 | hooks 退出码 0/2＋fail-closed | Claude、Kiro、opencode | 确定性 | hooks/ | 高 | P0 | I3 |
| A10 | 分层记忆＋就近注入＋@path | Claude、opencode | 规则落位 | context/＋rules/ | 高·零成本 | P0 | I1 |
| A11 | 记忆先审后存＋引用校验 | Augment、Cursor | 防污染 | memory/ | 高 | P1 | I1 |
| A12 | skill 披露预算＋三重门禁＋技能包 | Claude、ss | 省上下文 | skills/＋index | 高 | P0 | I2 |
| A13 | 阈值梯子＋熔断＋隐藏 agent | Qwen、opencode | 压缩稳 | compact/ | 高 | P0 | F1/F2 |
| A14 | 非破坏性压缩＋keep_first＋结果预算 | Roo、OpenHands、Claude | 可回卷 | compact/ | 高 | P0 | F1/F2 |
| A15 | 子代理独立上下文＋工具掩码＋agent 文件 | Claude、opencode | 读取外包 | subagent/ | 高·上下文贵 | P0 | N6 |
| A16 | 任务清单＋Focus Chain | Claude、Cline | 进度不丢 | todo 工具 | 高 | P1 | N7 |
| A17 | Plan 5 阶段＋spec 三件套 | Claude、Kiro | 想错别动 | modes/＋spec/ | 中·需编排 | P1 | N8 |
| A18 | 搜索限量＋repo-map 符号索引 | SWE-agent、aider | 知结构 | search/＋repo-map | 中·大仓 | P1 | N9 |
| A19 | 保留 Web 检索＋question 工具 | opencode、Cline | 查外部先问 | Web＋Question | 高 | P1 | E5 |
| A20 | XML 工具注入＋专属 harness＋Ralph | Continue、Kimi | 工具不稳 | api.ts | 高·刚需 | P0 | N10 |
| A21 | doom_loop 恢复＋steps 上限 | opencode | 防卡死 | QueryEngine.ts | 高 | P0 | E3 |
| A22 | /review /init /doctor＋轨迹/事件 | codex、Kimi、OpenHands | 可调试 | repl＋diag＋events | 高 | P1 | N11 |
| A23 | routelog 画像选型＋模型角色制 | ev、Continue | 多模型 | router | 中·双模型 | P2 | N12 |
| A24 | 复盘写回＋review 代理四选一 | Devin、Hermes | 自动沉淀 | 退出钩子 | 中 | P1 | I4 |

## 三、暂不吸收

| 功能 | 来源 | 理由 |
|---|---|---|
| MCP 全量接入/市场 | Claude、Cline | 本地集成需求弱 |
| 语义全仓索引 | Cursor、Augment | 内存吃紧，grep 够用 |
| 云端 VM/托管/Orbs | Copilot、Amp | 与本地单机冲突 |
| computer use/浏览器/生图 | Replit、Trae | 依赖视觉模型 |
| agent teams/workflows/teleport | Claude | 多实例＋云端，14B 不稳 |
| IM 机器人/daemon 分发 | Qwen、iFlow | 非核心路径 |
| 训练式路由/OPRO | ev、po | 自迭代已被证伪 |
| 发送前静默改写 prompt | WorkBuddy | 不可归因 |
| 已关停 agent 新版 | 调研备注 | 仅取可迁移机制 |

## 四、建议新增的 todo 项汇总

- N1 编辑加固：回喂、模糊匹配、lint（A1、A2）
- N2 lint 自修复：auto-lint 回喂（A3）
- N3 checkpoint 回滚：auto-commit、/rewind（A4）
- N4 会话 resume/fork（A5）
- N5 沙箱近似：白名单＋writable_roots（A8）
- N6 子代理强化：独立上下文、文件即 agent（A15）
- N7 任务清单：todo＋Focus Chain（A16）
- N8 计划与 spec：Plan 5 阶段、spec 三件套（A17）
- N9 repo 地图：符号索引、结果限量（A18）
- N10 本地 harness：XML 注入、专属 loop（A20）
- N11 命令与诊断：/review /init /doctor（A22）
- N12 路由骨架：routelog＋角色制（A23）
