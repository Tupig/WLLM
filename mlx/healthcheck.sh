#!/usr/bin/env bash
# ==============================================================================
#  mlx-local 健康检查模块
# ==============================================================================

# 加载共享库
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

cmd_doctor() {
  echo "MLX 环境诊断"
  echo

  local errors=0

  # 1. 检查基础目录
  echo "1. 检查基础目录"
  for dir in "$MLX_HOME" "$VENV" "$LOGS" "$MODELS" "$STATE"; do
    if [ -d "$dir" ]; then
      echo "  ✓ $dir"
    else
      echo "  ✗ $dir (不存在)"
      errors=$((errors + 1))
    fi
  done
  echo

  # 2. 检查Python环境
  echo "2. 检查Python环境"
  if check_venv; then
    local python_version
    python_version=$("$VENV/bin/python" --version 2>&1)
    echo "  ✓ Python: $python_version"
  else
    echo "  ✗ Python虚拟环境不存在"
    errors=$((errors + 1))
  fi
  echo

  # 3. 检查模型
  echo "3. 检查模型"
  local current_key
  current_key="$(cat "$STATE/current_model" 2>/dev/null || echo '')"
  if [ -n "$current_key" ]; then
    local model_dir
    model_dir="$(model_dir_for "$current_key")"
    if [ -n "$model_dir" ] && [ -d "$MODELS/$model_dir" ]; then
      echo "  ✓ 当前模型: $current_key ($model_dir)"
    else
      echo "  ✗ 当前模型目录不存在: $model_dir"
      errors=$((errors + 1))
    fi
  else
    echo "  ⚠ 未设置当前模型"
  fi
  echo

  # 4. 检查服务状态
  echo "4. 检查服务状态"
  check_service "server" "$SERVER_PORT" "$STATE/server.pid"
  check_service "unified_proxy" "$UNIFIED_PORT" "$STATE/unified_proxy.pid"
  echo

  # 5. 检查端口
  echo "5. 检查端口"
  check_port "$SERVER_PORT" && echo "  ✓ 端口 $SERVER_PORT 可用" || echo "  ✗ 端口 $SERVER_PORT 不可用"
  check_port "$UNIFIED_PORT" && echo "  ✓ 端口 $UNIFIED_PORT 可用" || echo "  ✗ 端口 $UNIFIED_PORT 不可用"
  echo

  # 6. 检查日志文件
  echo "6. 检查日志文件"
  for logfile in "$LOGS/server.log" "$LOGS/unified_proxy.log"; do
    if [ -f "$logfile" ]; then
      local size
      size=$(ls -lh "$logfile" | awk '{print $5}')
      echo "  ✓ $(basename "$logfile") ($size)"
    else
      echo "  ⚠ $(basename "$logfile") (不存在)"
    fi
  done
  echo

  # 总结
  echo "诊断完成"
  if [ $errors -eq 0 ]; then
    echo "✓ 未发现问题"
  else
    echo "✗ 发现 $errors 个问题"
  fi

  return $errors
}

cmd_healthcheck() {
  local auto_restart="${1:-0}"
  local auto_downgrade="${2:-0}"

  echo "健康检查"
  echo

  # 检查服务状态
  local server_pid proxy_pid
  server_pid="$(port_pid "$SERVER_PORT")"
  proxy_pid="$(port_pid "$UNIFIED_PORT")"

  # 检查server是否响应
  local server_ok=false
  if [ -n "$server_pid" ]; then
    if curl -s --max-time 5 "http://127.0.0.1:$SERVER_PORT/v1/models" >/dev/null 2>&1; then
      server_ok=true
      echo "✓ 推理服务响应正常"
    else
      echo "✗ 推理服务无响应"
    fi
  else
    echo "✗ 推理服务未运行"
  fi

  # 检查proxy是否响应
  local proxy_ok=false
  if [ -n "$proxy_pid" ]; then
    if curl -s --max-time 5 "http://127.0.0.1:$UNIFIED_PORT/health" >/dev/null 2>&1; then
      proxy_ok=true
      echo "✓ 统一代理响应正常"
    else
      echo "✗ 统一代理无响应"
    fi
  else
    echo "✗ 统一代理未运行"
  fi

  echo

  # 自动恢复
  if [ "$server_ok" = false ] || [ "$proxy_ok" = false ]; then
    echo "检测到服务异常"

    if [ "$auto_restart" = "1" ] || [ "$auto_restart" = "true" ]; then
      echo "自动重启服务..."
      cmd_stop
      sleep 2
      cmd_start
    fi

    if [ "$auto_downgrade" = "1" ] || [ "$auto_downgrade" = "true" ]; then
      if [ "$server_ok" = false ]; then
        echo "自动降级到轻量模型..."
        local next_key="8b"
        cmd_stop
        sleep 2
        cmd_start "$next_key"
      fi
    fi
  else
    echo "✓ 所有服务正常"
  fi
}

# 如果直接运行此脚本
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  cmd_doctor "$@"
fi
