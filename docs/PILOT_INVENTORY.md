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
