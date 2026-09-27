#!/usr/bin/env bash
# ==============================================================================
#  mlx-local 性能监控模块
# ==============================================================================

# 加载共享库
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

cmd_metrics() {
  local interval="${1:-1}"
  local count="${2:-0}"

  echo "性能监控（按 Ctrl+C 停止）"
  echo "刷新间隔: ${interval}s"
  echo

  # 获取当前模型
  local current_key
  current_key="$(cat "$STATE/current_model" 2>/dev/null || echo '未知')"

  # 统计请求数
  local prev_requests=0
  local iteration=0

  while true; do
    iteration=$((iteration + 1))

    # 检查服务状态
    local server_pid proxy_pid
    server_pid="$(port_pid "$SERVER_PORT")"
    proxy_pid="$(port_pid "$UNIFIED_PORT")"

    # 获取进程资源使用
    local server_cpu=0 server_mem=0
    if [ -n "$server_pid" ]; then
      server_cpu=$(ps -p "$server_pid" -o %cpu= 2>/dev/null | tr -d ' ')
      server_mem=$(ps -p "$server_pid" -o %mem= 2>/dev/null | tr -d ' ')
    fi

    # 获取系统内存使用
    local mem_used mem_total mem_pct
    if command -v vm_stat >/dev/null 2>&1; then
      # macOS
      mem_total=$(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.1f", $1/1024/1024/1024}')
      mem_used=$(memory_pressure 2>/dev/null | grep "System-wide memory" | awk '{print $5}' | tr -d '%' || echo "0")
    fi

    # 计算请求速率
    local current_requests=0
    if [ -f "$LOGS/server.log" ]; then
      current_requests=$(grep -c "POST /v1/chat/completions" "$LOGS/server.log" 2>/dev/null || echo "0")
    fi
    local requests_per_sec=0
    if [ "$iteration" -gt 1 ]; then
      requests_per_sec=$(echo "scale=1; ($current_requests - $prev_requests) / $interval" | awk '{printf "%.1f", $1}' 2>/dev/null || echo "0")
    fi
    prev_requests=$current_requests

    # 清屏并显示
    clear 2>/dev/null || printf '\033[2J\033[H'
    echo "MLX 性能监控"
    echo "══════════════════════════════════════════════════════════════════════════════"
    echo "  模型: $current_key"
    echo "  服务: server=$([ -n "$server_pid" ] && echo "✓" || echo "✗") unified_proxy=$([ -n "$proxy_pid" ] && echo "✓" || echo "✗")"
    echo "──────────────────────────────────────────────────────────────────────────────"
    echo "  推理服务 (PID: ${server_pid:-无})"
    echo "    CPU: ${server_cpu:-0}%    内存: ${server_mem:-0}%"
    echo "──────────────────────────────────────────────────────────────────────────────"
    echo "  请求统计"
    echo "    总请求数: $current_requests    请求速率: ${requests_per_sec}/s"
    echo "──────────────────────────────────────────────────────────────────────────────"
    echo "  系统内存"
    echo "    总计: ${mem_total:-?}GB    使用率: ${mem_used:-?}%"
    echo "══════════════════════════════════════════════════════════════════════════════"
    echo "  按 Ctrl+C 停止    刷新: ${interval}s    迭代: $iteration"

    # 检查是否达到指定次数
    if [ "$count" -gt 0 ] && [ "$iteration" -ge "$count" ]; then
      break
    fi

    sleep "$interval"
  done
}

# 如果直接运行此脚本
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  cmd_metrics "$@"
fi
