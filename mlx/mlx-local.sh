#!/usr/bin/env bash
# ==============================================================================
#  mlx-local —— 本地 MLX 模型服务管理
#
#  Apple Silicon + MLX。同时提供三种协议，供不同 AI CLI 使用：
#    :8080  mlx_lm.server       OpenAI Chat Completions   ← opencode
#    :4100  unified_proxy.py    Anthropic/OpenAI/Responses ← Claude Code, codex
#
#  本脚本自定位：MLX_HOME 默认取脚本自身所在目录，整体移动后无需修改。
# ==============================================================================
set -uo pipefail

# 加载共享库
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

# 信号处理
cleanup() {
  # 清理PID文件
  rm -f "$STATE/server.pid" "$STATE/unified_proxy.pid" 2>/dev/null
}
trap cleanup EXIT INT TERM

# ------------------------------------------------------------------ 启动服务

cmd_start() {
  local key="${1:-$DEFAULT_KEY}"

  echo "启动 MLX 本地模型服务"
  echo "────────────────────────────────────────────────"

  # 检查Python环境
  if ! check_venv; then
    die "Python虚拟环境不存在，请先运行: python3 -m venv venv && venv/bin/pip install mlx-lm"
  fi

  # 检查模型目录
  local model_dir
  model_dir="$(model_dir_for "$key")"
  if [ -z "$model_dir" ]; then
    die "未知模型别名: $key"
  fi

  if [ ! -d "$MODELS/$model_dir" ]; then
    echo "模型目录不存在: $MODELS/$model_dir"
    echo "使用 'mlx-local model download $key' 下载"
    return 1
  fi

  # 保存当前模型
  echo "$key" > "$STATE/current_model"

  # 启动 server
  echo "启动推理服务..."
  # 并发上限为1：24GB机器上多路大上下文并发会触发Metal OOM
  nohup "$VENV/bin/mlx_lm.server" \
    --model "$MODELS/$model_dir" \
    --host 127.0.0.1 \
    --port "$SERVER_PORT" \
    --prompt-concurrency 1 \
    --decode-concurrency 1 \
    --prompt-cache-size 1 \
    --prefill-step-size 1024 \
    --chat-template-args '{"enable_thinking":false}' \
    >> "$LOGS/server.log" 2>&1 </dev/null &
  local server_pid=$!
  echo "$server_pid" > "$STATE/server.pid"
  echo "  PID: $server_pid"

  # 等待 server 端口监听
  echo "等待推理服务端口就绪..."
  if ! wait_port "$SERVER_PORT" "server" "$server_pid" 120; then
    die "推理服务启动超时（120秒）"
  fi

  # 等待模型实际加载完成（最多120秒）
  echo "等待模型加载完成..."
  local i=0
  local model_ready=false
  while [ "$i" -lt 120 ]; do
    if curl -s --max-time 5 -X POST "http://127.0.0.1:$SERVER_PORT/v1/chat/completions" \
      -H "Content-Type: application/json" \
      -d '{"model":"default_model","messages":[{"role":"user","content":"hi"}],"max_tokens":1}' \
      2>/dev/null | grep -q '"choices"'; then
      model_ready=true
      break
    fi
    # 检查进程是否还活着
    if ! kill -0 "$server_pid" 2>/dev/null; then
      die "推理服务进程已退出"
    fi
    sleep 2
    i=$((i + 2))
  done

  if [ "$model_ready" = false ]; then
    die "模型加载超时（120秒）"
  fi
  echo "  ✓ 推理服务已就绪（模型已加载）"

  # 启动 unified_proxy
  echo "启动统一代理..."
  nohup "$VENV/bin/python" "$SCRIPT_DIR/unified_proxy.py" \
    >> "$LOGS/unified_proxy.log" 2>&1 </dev/null &
  local proxy_pid=$!
  echo "$proxy_pid" > "$STATE/unified_proxy.pid"
  echo "  PID: $proxy_pid"

  # 等待 proxy 就绪
  echo "等待统一代理就绪..."
  if ! wait_port "$UNIFIED_PORT" "unified_proxy" "$proxy_pid" 30; then
    die "统一代理启动超时（30秒）"
  fi
  echo "  ✓ 统一代理已就绪"

  echo
  echo "全部就绪。"
  echo
  echo "  端口: $UNIFIED_PORT (Chat/Responses/Anthropic)"
  echo "  模型: $key ($model_dir)"
  echo "  状态: mlx-local status"
  echo "  停止: mlx-local stop"
}

# ------------------------------------------------------------------ 停止服务

cmd_stop() {
  local spec name port pf pid
  for spec in "server:$SERVER_PORT:$STATE/server.pid" \
              "unified_proxy:$UNIFIED_PORT:$STATE/unified_proxy.pid"; do
    name="${spec%%:*}"; spec="${spec#*:}"
    port="${spec%%:*}"; pf="${spec#*:}"
    pid="$(port_pid "$port" "$pf")"
    [ -z "$pid" ] && pid="$(cat "$pf" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null
      # 细粒度等待进程退出：前3次200ms间隔，之后1s间隔
      local i=0
      while [ "$i" -lt 3 ] && kill -0 "$pid" 2>/dev/null; do
        sleep 0.2
        i=$((i + 1))
      done
      while [ "$i" -lt 5 ] && kill -0 "$pid" 2>/dev/null; do
        sleep 1
        i=$((i + 1))
      done
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null
      fi
      log "$(printf '%-10s' "$name") 已停止   pid $pid"
    else
      log "$(printf '%-10s' "$name") 未运行"
    fi
    rm -f "$pf"
  done
}

# ------------------------------------------------------------------ 状态

cmd_status() {
  echo "本地 MLX 模型服务"
  echo

  local current_key
  current_key="$(cat "$STATE/current_model" 2>/dev/null || echo '未知')"
  local current_model
  current_model="$(model_dir_for "$current_key" 2>/dev/null || echo '')"

  echo "  环境目录    $MLX_HOME"
  echo "  架构        单端口(:$UNIFIED_PORT)"
  echo "  当前模型    $current_key  ($current_model)"
  echo

  echo "  服务"
  check_service "server" "$SERVER_PORT" "$STATE/server.pid" | sed 's/^/    /'
  check_service "unified_proxy" "$UNIFIED_PORT" "$STATE/unified_proxy.pid" | sed 's/^/    /'
  echo

  echo "  对外端口    :$UNIFIED_PORT (支持 Chat/Responses/Anthropic 协议)"
  echo

  # 列出已下载的模型
  echo "  已下载模型"
  if [ -d "$MODELS" ]; then
    "$VENV/bin/python" -c "
import json, os

models_dir = '$MODELS'
with open('$MLX_HOME/models.json') as f:
    data = json.load(f)

for key, info in data['models'].items():
    name = info['name']
    size = info.get('size', '?')
    alias = info.get('alias', key)

    model_path = os.path.join(models_dir, name)
    if os.path.isdir(model_path):
        print(f'    {name:<45} {size:<8} {alias}')
" 2>/dev/null | sed 's/^/    /'
  fi
}

# ------------------------------------------------------------------ 日志

cmd_logs() {
  local type="${1:-server}"
  case "$type" in
    server|s) tail -f "$LOGS/server.log" ;;
    proxy|p)  tail -f "$LOGS/unified_proxy.log" ;;
    *)        echo "用法: mlx-local logs [server|proxy]"; exit 1 ;;
  esac
}

# ------------------------------------------------------------------ 帮助

usage() {
  cat <<'EOF'
用法: mlx-local <命令> [参数]

启动与停止:
  start [模型别名]           启动服务（默认14b）
  stop                       停止所有服务
  restart [模型别名]         重启服务

状态与诊断:
  status                     查看服务状态
  doctor                     健康检查
  healthcheck                健康检查（自动恢复）

模型管理:
  model list                 列出模型
  model info <别名>          查看模型详情
  model download <别名>      下载模型
  model remove <别名>        删除模型

监控与日志:
  metrics [间隔] [次数]      性能监控
  logs [server|proxy]        查看日志

可用模型:
  14b          Qwen3-14B-4bit         7.8G   默认模型
  8b           Qwen3-8B-4bit          4.3G   轻量快速
  30b          Qwen3-Coder-30B-A3B    16G    代码专精
  qwen-vl-8b   Qwen3-VL-8B            5.5G   视觉语言

示例:
  mlx-local start 14b       启动14B模型
  mlx-local use 8b          切换到8B模型
  mlx-local status          查看状态
  mlx-local metrics         性能监控
  mlx-local logs server     查看推理日志
EOF
}

# ------------------------------------------------------------------ 切换模型

cmd_use() {
  local key="${1:-}"
  [ -z "$key" ] && die "用法: mlx-local use <模型别名>"

  # 验证模型别名
  local model_dir
  model_dir="$(model_dir_for "$key")"
  [ -z "$model_dir" ] && die "未知模型别名: $key"

  # 检查是否已设置
  local current_key
  current_key="$(cat "$STATE/current_model" 2>/dev/null || echo '')"
  if [ "$current_key" = "$key" ]; then
    echo "当前已是模型: $key"
    return 0
  fi

  echo "切换模型: $current_key -> $key"

  # 如果服务正在运行，重启
  local server_pid
  server_pid="$(port_pid "$SERVER_PORT")"
  if [ -n "$server_pid" ]; then
    cmd_stop
    sleep 2
    cmd_start "$key"
  else
    # 仅保存设置
    echo "$key" > "$STATE/current_model"
    log "模型设置已保存: $key"
  fi
}

# ------------------------------------------------------------------ 分发

case "${1:-status}" in
  start)       shift; cmd_start "${1:-$DEFAULT_KEY}" ;;
  stop)        cmd_stop ;;
  restart)     cmd_stop; sleep 2; shift; cmd_start "${1:-$DEFAULT_KEY}" ;;
  status)      cmd_status ;;
  use)         shift; cmd_use "$@" ;;
  logs)        shift; cmd_logs "${1:-server}" ;;
  doctor)      shift; source "$SCRIPT_DIR/healthcheck.sh"; cmd_doctor "${1:-}" ;;
  healthcheck) shift
               _auto_restart=0
               _auto_downgrade=0
               while [ $# -gt 0 ]; do
                 case "$1" in
                   --auto-restart)   _auto_restart=1 ;;
                   --auto-downgrade) _auto_downgrade=1 ;;
                   *) die "未知参数: $1" ;;
                 esac
                 shift
               done
               source "$SCRIPT_DIR/healthcheck.sh"; cmd_healthcheck "$_auto_restart" "$_auto_downgrade" ;;
  model)       shift; source "$SCRIPT_DIR/model_utils.sh"; cmd_model "$@" ;;
  metrics)     shift; source "$SCRIPT_DIR/metrics.sh"; cmd_metrics "${1:-1}" "${2:-0}" ;;
  help|-h|--help) usage ;;
  *)           printf '[mlx] 错误: 未知命令 %s\n\n' "$1" >&2; usage >&2; exit 1 ;;
esac
