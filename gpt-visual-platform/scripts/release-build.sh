#!/usr/bin/env bash
# 本地多平台构建：Go 编排服务 5 平台矩阵 + Rust Agent（本机平台）
# （Release 流水线里的 Rust 全 target 矩阵见 .github/workflows/release.yml）
set -euo pipefail
command -v go >/dev/null || { echo "错误: 未安装 go"; exit 1; }
command -v cargo >/dev/null || { echo "错误: 未安装 cargo（仅影响 Agent 产物）"; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(cd "$ROOT" && git describe --tags --always 2>/dev/null || echo dev)"
mkdir -p "$ROOT/dist"

echo "[release] 版本: $VERSION"
echo "[release] Go 编排服务 × 5 平台…"
for target in darwin/arm64 darwin/amd64 linux/amd64 linux/arm64 windows/amd64; do
  goos="${target%/*}"; goarch="${target#*/}"
  ext=""; [ "$goos" = "windows" ] && ext=".exe"
  (cd "$ROOT/server" && \
    CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
    go build -trimpath -ldflags "-s -w -X main.version=$VERSION" \
    -o "$ROOT/dist/unity-orchestrator-$goos-$goarch$ext" .)
  echo "  ✓ unity-orchestrator-$goos-$goarch$ext"
done

if command -v cargo >/dev/null; then
  echo "[release] Rust Agent（本机平台）…"
  (cd "$ROOT/agent" && cargo build --release --quiet)
  host="$(rustc -vV | awk '/host/{print $2}')"
  cp "$ROOT/agent/target/release/unity-agent" "$ROOT/dist/unity-agent-$host"
  echo "  ✓ unity-agent-$host"
fi

echo "[release] 完成。产物清单："
ls -lh "$ROOT/dist" | awk 'NR>1 {print "  " $NF "  (" $5 ")"}'
