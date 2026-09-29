#!/usr/bin/env bash
# 启动编排服务（gameqa serve）：自动识别运行方式
#   1. 已注册系统服务（launchd/systemd）→ 走服务管理路径启动
#   2. 未注册 → 构建（如有变化）→ 前台运行（Ctrl+C 停止）
# 用法：./scripts/start.sh
# 环境变量：PORT / DATA_DIR / PLATFORM_TOKEN / TLS_CERT / TLS_KEY / TLS_MODE
set -euo pipefail
OS="$(uname -s)"
LABEL="com.unity-test-platform.orchestrator"
SERVICE_NAME="unity-orchestrator"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-9111}"

# 服务路径：已注册系统服务 → 让服务管理器拉起（KeepAlive/Restart 会托管进程）
case "$OS" in
  Darwin)
    PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
    if [ -f "$PLIST" ]; then
      launchctl unload "$PLIST" 2>/dev/null || true   # 先卸载，重读环境变量后再装载
      launchctl load "$PLIST"
      echo "[启动] 已通过 launchd 启动系统服务（开机自启生效）"
      echo "[启动] 看板: https://localhost:$PORT （证书警告首次点「高级→继续前往」）"
      echo "[启动] 状态: scripts/status.sh | 停止: scripts/stop.sh"
      exit 0
    fi
    ;;
  Linux)
    if command -v systemctl >/dev/null && systemctl list-unit-files 2>/dev/null | grep -q "$SERVICE_NAME"; then
      sudo systemctl restart "$SERVICE_NAME"
      echo "[启动] 已通过 systemd 重启系统服务（开机自启生效）"
      echo "[启动] 看板: https://localhost:$PORT"
      echo "[启动] 状态: scripts/status.sh | 停止: scripts/stop.sh"
      exit 0
    fi
    ;;
esac

# 手动模式：构建（如有变化）→ 前台运行
cd "$ROOT"
if [ ! -f dist/cli/gameqa.js ] || [ -n "$(find src scripts/copy-gameqa-static.mjs -name '*.ts' -newer dist/cli/gameqa.js 2>/dev/null | head -1)" ]; then
  echo "[启动] 构建编排服务…"
  npm run --silent build
fi

echo "[启动] 看板地址: https://localhost:$PORT （自签名证书，首次访问点「高级 → 继续前往」；Ctrl+C 停止）"
exec node dist/cli/gameqa.js serve -p "$PORT"
