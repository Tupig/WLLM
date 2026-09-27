@echo off
rem 一键启动编排服务（v2）：dist\unity-orchestrator.exe，看板 http://localhost:9111
where go >nul 2>nul || (echo 错误: 未安装 go & exit /b 1)
cd /d "%~dp0.."
if not exist dist mkdir dist
if not exist dist\unity-orchestrator.exe (
  echo [启动] 构建编排服务...
  (cd server && go build -o ..\dist\unity-orchestrator.exe .)
)
echo [启动] 看板地址: http://localhost:9111  （Ctrl+C 停止）
set PORT=9111
set DATA_DIR=data
set STATIC_DIR=static
dist\unity-orchestrator.exe
