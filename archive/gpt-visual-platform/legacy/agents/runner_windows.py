#!/usr/bin/env python3
"""
Windows 环境 Agent。需在 Windows 上安装 Python，执行方式同上。
实际执行可调用 Unity Editor 或已构建的 Player 跑 Test Framework。
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from agents.runner_common import register, heartbeat, poll_job, submit_result, dispatch_integrations

PLATFORM = "windows"
POLL_INTERVAL = 15


def _skills_from_env():
    s = os.getenv("AGENT_SKILLS", "")
    return [x.strip() for x in s.split(",") if x.strip()]


def run_unity_test(job: dict) -> tuple:
    """执行 Unity 测试。返回 (success, log_path, summary)。"""
    print(f"[Windows Agent] 执行任务 job_id={job.get('job_id')}")
    # 可选集成：airtest / ai_exploratory（未命中 job_type 时走下方占位逻辑）
    handled, success, log_path, summary = dispatch_integrations(job, PLATFORM)
    if handled:
        print(f"[Windows Agent] 集成任务结果: {summary}")
        return success, log_path, summary
    return True, None, {"message": "placeholder run"}


def main() -> None:
    skills = _skills_from_env()
    agent_id = register(platform=PLATFORM, skills=skills)
    print(f"[Windows Agent] 已注册 agent_id={agent_id} skills={skills}")

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
            print(f"[Windows Agent] 错误: {e}")
            time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
