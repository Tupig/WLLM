#!/usr/bin/env bash
# 服务状态总览：运行方式 / 进程 / 健康检查 / TLS 证书指纹
# 用法：./scripts/status.sh [PORT]   （默认 9111）
set -euo pipefail
OS="$(uname -s)"
LABEL="com.unity-test-platform.orchestrator"
SERVICE_NAME="unity-orchestrator"
PORT="${1:-9111}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "── 运行方式 ──────────────────────────────"
RUN_MODE="手动进程（未注册）"
case "$OS" in
  Darwin)
    LAUNCHED="$(launchctl list 2>/dev/null || true)"
    if [ -f "$HOME/Library/LaunchAgents/$LABEL.plist" ] && printf "%s" "$LAUNCHED" | grep -q "$LABEL"; then
      RUN_MODE="launchd 系统服务（开机自启）"
    fi
    ;;
  Linux)
    ACTIVE="$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || true)"
    if [ "$ACTIVE" = "active" ]; then
      RUN_MODE="systemd 系统服务（开机自启）"
    elif [ -f /etc/systemd/system/$SERVICE_NAME.service ]; then
      RUN_MODE="systemd 服务（已注册，未运行）"
    fi
    ;;
esac
echo "  $RUN_MODE"

echo "── 进程 ──────────────────────────────────"
if pgrep -f "unity-orchestrator" >/dev/null 2>&1; then
  pgrep -lf "unity-orchestrator" | head -3 | sed 's/^/  /'
else
  echo "  未运行"
fi

  echo "  健康检查: https://localhost:${PORT}"
HEALTH=""
if command -v curl >/dev/null; then
  HEALTH=$(curl -sk --max-time 5 "https://localhost:$PORT/api/health" 2>/dev/null || true)
fi
if [ -n "$HEALTH" ]; then
  echo "$HEALTH" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print('  状态:', '正常' if d.get('ok') else '异常', '| 版本:', d.get('version'))
except Exception:
    print('  响应异常:', sys.stdin.read()[:80] if False else '')
" 2>/dev/null || echo "  $HEALTH"
else
  echo "  无响应（服务未启动或端口不符）"
fi

echo "── TLS 证书 ──────────────────────────────"
CERT="$ROOT/data/tls/cert.pem"
if [ -f "$CERT" ]; then
  FP=$(openssl x509 -in "$CERT" -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2)
  END=$(openssl x509 -in "$CERT" -noout -enddate 2>/dev/null | cut -d= -f2)
  echo "  证书: $CERT"
  echo "  指纹(SHA-256): $FP"
  echo "  有效期至: $END"
else
  echo "  未生成（服务首次 HTTPS 启动时自动创建）"
fi
