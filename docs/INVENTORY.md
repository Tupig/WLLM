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
