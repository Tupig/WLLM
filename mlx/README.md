# 本地 MLX 大模型环境

Apple M4 / 24GB / macOS 上用 MLX 运行本地大模型，单端口接入 opencode / Claude Code / codex。

## 快速开始

```bash
llm                        # 启动交互式对话
llm "解释闭包"             # 单次提问
llm start                  # 启动服务
llm stop                   # 停止服务
llm use 8b                 # 切换模型
llm status                 # 查看状态
llm doctor                 # 健康检查
```

服务就绪后直接用：

```bash
opencode-local "解释闭包"
claude-local "重构这个函数"
codex-local exec "写个快排"
```

## 架构

```
CLI工具 → :4100 TS 统一代理 (src/proxy/) → :8080 mlx_lm.server
```

- **:4100** 统一代理 - 对外，支持 Chat/Responses/Anthropic 三种协议（TS 实现）
- **:8080** 推理服务 - 仅本地内部调用

服务管理（`mlx-local` / `llm`）为 TS 实现（`src/cli/mlxcmd.ts`），配置走环境变量
（`MLX_UNIFIED_PORT` / `MLX_SERVER_PORT` / `MLX_DEFAULT_MODEL` / `MLX_AUTH_TOKEN` 等）。

## 模型

| 别名 | 模型 | 大小 | 功能 |
|------|------|------|------|
| `14b` | Qwen3-14B-4bit | 7.8G | 默认，性能均衡 |
| `8b` | Qwen3-8B-4bit | 4.3G | 轻量快速 |
| `30b` | Qwen3-Coder-30B-A3B-Instruct-4bit | 16G | 代码专精，需提高GPU上限 |
| `qwen-vl-8b` | Qwen3-VL-8B-Instruct-4bit | 5.5G | 视觉语言模型 |

## 命令

```bash
mlx-local start [模型]           # 启动
mlx-local restart [模型]         # 重启/切换模型
mlx-local stop                   # 停止
mlx-local status                 # 状态
mlx-local logs server|proxy      # 日志
mlx-local healthcheck            # 健康检查
mlx-local model list|info        # 模型管理
mlx-local metrics                # 性能监控
```

## 内存限制

24GB 机器 GPU 上限约 16GB。codex 请求 5.3 万 token 会 OOM，建议用云端模型。

## 卸载

```bash
mlx-local stop
rm -rf ~/Workspace/LLM/mlx ~/Workspace/LLM/bin
rm -f ~/Workspace/LLM/AGENTS.md ~/Workspace/LLM/CLAUDE.md
rm -f ~/.local/bin/*-local
rm -f ~/.claude/settings-local.json ~/.codex/local.config.toml
```
