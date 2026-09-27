#!/usr/bin/env bash
# ==============================================================================
#  mlx-local 共享函数库
#
#  包含所有模块共用的函数和配置
# ==============================================================================

# 加载配置文件
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/config.env" ]; then
  source "$SCRIPT_DIR/config.env"
fi

# 基础路径
MLX_HOME="${MLX_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
VENV="${MLX_VENV:-$MLX_HOME/venv}"
LOGS="${MLX_LOGS:-$MLX_HOME/logs}"
MODELS="${MLX_MODELS:-$MLX_HOME/models}"
STATE="${MLX_STATE:-$MLX_HOME/state}"
mkdir -p "$LOGS" "$STATE"

# 端口配置
UNIFIED_PORT="${MLX_UNIFIED_PORT:-4100}"
SERVER_PORT="${MLX_SERVER_PORT:-8080}"
DEFAULT_KEY="${MLX_DEFAULT_MODEL:-14b}"

# ------------------------------------------------------------------ 日志函数

log()  { printf '[mlx] %s\n' "$*"; }
die()  { printf '[mlx] 错误: %s\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------------ 进程管理

port_pid() {
  local port="$1"
  local pid_file="${2:-}"
  # 优先使用PID文件（更快）
  if [ -n "$pid_file" ] && [ -f "$pid_file" ]; then
    local pid
    pid="$(cat "$pid_file" 2>/dev/null)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "$pid"
      return 0
    fi
  fi
  # 回退到lsof
  lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1
}

wait_port() {
  local port="$1" label="$2" pid="${3:-}" timeout_sec="${4:-60}"
  local i=0
  while [ "$i" -lt "$timeout_sec" ]; do
    # 如果提供了PID，先检查进程是否存活
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
      return 1
    fi
    # 检查端口
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 | grep -q .; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

# ------------------------------------------------------------------ 模型管理

model_dir_for() {
  local key="${1:-}"
  if [ -z "$key" ]; then
    return 1
  fi
  # 从models.json动态查询
  if [ -f "$MLX_HOME/models.json" ]; then
    "$MLX_HOME/venv/bin/python" -c "
import json, sys
key = sys.argv[1]
with open('$MLX_HOME/models.json') as f:
    data = json.load(f)
if key in data['models']:
    print(data['models'][key]['name'])
else:
    sys.exit(1)
" "$key" 2>/dev/null
    return $?
  fi
  # 回退到硬编码映射
  case "$key" in
    14b|qwen3-14b)                echo "Qwen3-14B-4bit" ;;
    8b|qwen3-8b)                  echo "Qwen3-8B-4bit" ;;
    30b|coder|qwen3-coder)        echo "Qwen3-Coder-30B-A3B-Instruct-4bit" ;;
    qwen-vl-8b|vl-8b)             echo "Qwen3-VL-8B-Instruct-4bit" ;;
    *) return 1 ;;
  esac
}

# ------------------------------------------------------------------ 环境检查

check_venv() {
  [ -d "$VENV" ] && [ -x "$VENV/bin/python" ]
}

check_model() {
  local key="${1:-}"
  local model_dir
  model_dir="$(model_dir_for "$key")"
  [ -n "$model_dir" ] && [ -d "$MODELS/$model_dir" ]
}

# ------------------------------------------------------------------ 健康检查

check_port() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 | grep -q .
}

check_service() {
  local name="$1" port="$2" pid_file="$3"
  local pid
  pid="$(port_pid "$port" "$pid_file")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "✓ $name (PID: $pid)"
    return 0
  else
    echo "✗ $name"
    return 1
  fi
}
