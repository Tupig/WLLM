@echo off
rem 构建 Go 版编排服务（v2）：dist\unity-orchestrator.exe
where go >nul 2>nul || (echo 错误: 未安装 go & exit /b 1)
cd /d "%~dp0..\server"
if not exist ..\dist mkdir ..\dist
go build -trimpath -ldflags "-s -w" -o ..\dist\unity-orchestrator.exe .
echo 构建完成: dist\unity-orchestrator.exe
