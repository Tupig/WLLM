@echo off
REM 在 Windows 上构建可执行文件
REM 用法: scripts\build.bat（在项目根目录执行）

cd /d "%~dp0\.."

echo ==> 安装构建依赖...
if not exist .venv python -m venv .venv
call .venv\Scripts\activate.bat
pip install -q -r requirements-build.txt

echo ==> 执行 PyInstaller 构建...
pyinstaller -y build.spec

echo ==> 构建完成
echo     可执行文件: dist\unity-test-platform.exe
echo     运行: dist\unity-test-platform.exe
echo     数据目录将创建在 exe 同目录下: data\
