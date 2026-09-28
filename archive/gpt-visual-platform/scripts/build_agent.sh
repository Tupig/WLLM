#!/usr/bin/env bash
# 构建 Rust Agent（v2）：dist/unity-agent（目标机无需 Python 运行时）
set -euo pipefail
command -v cargo >/dev/null || { echo "错误: 未安装 cargo"; exit 1; }
cd "$(dirname "$0")/../agent"
cargo build --release
mkdir -p ../dist
cp target/release/unity-agent ../dist/
echo "构建完成: dist/unity-agent (版本 $(./target/release/unity-agent --version 2>/dev/null || echo dev))"
