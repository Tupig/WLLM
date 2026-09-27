#!/usr/bin/env bash
# 构建 Go 版编排服务（v2）：dist/unity-orchestrator（注入版本号）
set -euo pipefail
command -v go >/dev/null || { echo "错误: 未安装 go"; exit 1; }
cd "$(dirname "$0")/../server"
VERSION="$(git describe --tags --always 2>/dev/null || echo dev)"
mkdir -p ../dist
go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o ../dist/unity-orchestrator .
echo "构建完成: dist/unity-orchestrator (版本 $VERSION)"
