@echo off
rem 停止编排服务（Windows）：schtasks 任务或进程
setlocal
set TASKNAME=UnityTestPlatform-Orchestrator

schtasks /query /tn "%TASKNAME%" >nul 2>nul && (
  schtasks /end /tn "%TASKNAME%" >nul 2>nul
  echo 已停止计划任务 %TASKNAME%（开机自启保留，重新启动: schtasks /run /tn "%TASKNAME%"）
  goto :done
)

tasklist /fi "imagename eq unity-orchestrator.exe" | find /i "unity-orchestrator" >nul && (
  taskkill /im unity-orchestrator.exe /f >nul 2>nul
  echo 已终止 unity-orchestrator.exe 进程
  goto :done
)

echo 没有正在运行的编排服务。

:done
endlocal
