@echo off
REM Windows 下从源码运行编排服务（无需构建）
REM 用法: scripts\run.bat（在项目根目录执行）

cd /d "%~dp0\.."

if not exist .venv (
  echo 创建虚拟环境...
  python -m venv .venv
)
call .venv\Scripts\activate.bat

echo 安装依赖...
pip install -q -r requirements.txt

echo 启动服务 http://localhost:9111 ...
python run_server.py
