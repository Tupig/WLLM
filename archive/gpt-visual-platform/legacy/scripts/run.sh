#!/usr/bin/env bash
# Unity MMORPG 自动化测试平台 - 编排服务一键启动（Mac/Linux）
# 用法：./scripts/run.sh（在项目根目录执行）
set -e
cd "$(dirname "$0")/.."
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
.venv/bin/pip install -q -r requirements.txt
exec .venv/bin/python run_server.py
