@echo off
rem 构建 Rust Agent（v2）：dist\unity-agent.exe
where cargo >nul 2>nul || (echo 错误: 未安装 cargo & exit /b 1)
cd /d "%~dp0..\agent"
cargo build --release
if not exist ..\dist mkdir ..\dist
copy /y target\release\unity-agent.exe ..\dist\unity-agent.exe >nul
echo 构建完成: dist\unity-agent.exe
