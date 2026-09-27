#!/usr/bin/env python3
"""
Mac 环境 Agent：向编排服务注册、拉取任务、执行占位逻辑、上报结果。
实际需替换为：调用 Unity Editor 或 Player 跑 Test Framework。
"""
import os
import sys
import time

# 兼容直接运行与作为模块
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from agents.runner_common import register, heartbeat, poll_job, submit_result

PLATFORM = "mac"
POLL_INTERVAL = 15


def _skills_from_env():
    s = os.getenv("AGENT_SKILLS", "")
    return [x.strip() for x in s.split(",") if x.strip()]


def run_unity_test(job: dict) -> tuple:
    """
    执行 Unity 测试。占位：仅打印任务信息。
    实际应调用 Unity Editor 或 Player，例如：
      Unity -batchmode -projectPath <path> -runTests -testPlatform PlayMode -testResults <path>
    返回 (success, log_path, summary)。
    """
    print(f"[Mac Agent] 执行任务 job_id={job.get('job_id')} platform={job.get('platform')}")
    project_path = job.get("unity_project_path") or ""
    test_filter = job.get("test_filter") or ""
    extra = job.get("extra", {})
    
    # 检查是否需要使用 MCP 执行测试
    if extra.get("use_mcp", False):
        print("[Mac Agent] 使用 MCP 执行测试")
        try:
            from agents.runner_common import execute_mcp_tool
            result = execute_mcp_tool("run_tests", {"test_filter": test_filter})
            print(f"[Mac Agent] MCP 测试结果: {result}")
            return "error" not in result, None, {"message": "MCP test run", "result": result, "test_filter": test_filter}
        except Exception as e:
            print(f"[Mac Agent] MCP 执行错误: {e}")
            return False, None, {"message": "MCP execution error", "error": str(e)}
    
    if project_path:
        # 占位：真实实现里这里调 Unity
        # subprocess.run(["Unity", "-batchmode", "-projectPath", project_path, "-runTests", ...], check=True)
        pass
    return True, None, {"message": "placeholder run", "test_filter": test_filter}


def main() -> None:
    skills = _skills_from_env()
    agent_id = register(platform=PLATFORM, skills=skills)
    print(f"[Mac Agent] 已注册 agent_id={agent_id} platform={PLATFORM} skills={skills}")

    while True:
        try:
            heartbeat(agent_id, status="idle")
            job = poll_job(PLATFORM, skills=skills)
            if job:
                heartbeat(agent_id, status="running", current_job_id=job["job_id"])
                success, log_path, summary = run_unity_test(job)
                submit_result(job["job_id"], agent_id, success, log_path, summary)
                heartbeat(agent_id, status="idle", current_job_id=None)
            else:
                time.sleep(POLL_INTERVAL)
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"[Mac Agent] 错误: {e}")
            time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
