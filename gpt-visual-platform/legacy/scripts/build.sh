#!/usr/bin/env bash
# 在 Linux 或 Mac 上构建可执行文件（产出当前系统对应平台）
# 用法：./scripts/build.sh（在项目根目录执行）
set -e
cd "$(dirname "$0")/.."

echo "==> 安装构建依赖..."
python3 -m venv .venv 2>/dev/null || true
.venv/bin/pip install -q -r requirements-build.txt

echo "==> 执行 PyInstaller 构建..."
.venv/bin/pyinstaller -y build.spec

echo "==> 构建完成"
echo "    可执行文件: dist/unity-test-platform (Mac/Linux)"
echo "    运行: ./dist/unity-test-platform"
echo "    数据目录将创建在可执行文件同目录下: ./data/"
