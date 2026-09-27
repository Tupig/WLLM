#!/usr/bin/env python3
"""
Web 测试 Agent：向编排服务注册、拉取 Web 任务、执行浏览器/自动化测试、上报结果。
支持所有 Web 测试：多浏览器（Chrome/Firefox/Safari/Edge）、Playwright/Selenium/Cypress、无头等。
环境变量 AGENT_SKILLS 可指定技能，如：Playwright,WebChrome,WebFirefox,WebHeadless
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from agents.runner_common import register, heartbeat, poll_job, submit_result

PLATFORM = "web"
POLL_INTERVAL = 15

# 默认 Web 技能：覆盖主流浏览器与自动化工具，便于“测试所有 web”
DEFAULT_WEB_SKILLS = ["Playwright", "WebChrome", "WebFirefox", "WebEdge", "WebHeadless"]


def _skills_from_env():
    s = os.getenv("AGENT_SKILLS", "")
    return [x.strip() for x in s.split(",") if x.strip()] if s.strip() else DEFAULT_WEB_SKILLS


def run_web_test(job: dict) -> tuple:
    """
    执行 Web 测试。占位：根据 job.extra 可扩展为真实 Playwright/Selenium 调用。
    extra 示例：{"url": "https://...", "browser": "chromium", "headless": true, "script_path": "..."}
    返回 (success, log_path, summary)。
    """
    print(f"[Web Agent] 执行任务 job_id={job.get('job_id')} platform={job.get('platform')}")
    extra = job.get("extra") or {}
    url = extra.get("url", "")
    browser = extra.get("browser", "chromium")
    headless = extra.get("headless", True)
    
    # 检查是否需要使用 MCP 执行测试
    if extra.get("use_mcp", False):
        print("[Web Agent] 使用 MCP 执行测试")
        try:
            from agents.runner_common import execute_mcp_tool
            # 这里可以根据实际情况调用适合的 MCP 工具
            result = execute_mcp_tool("execute_custom_tool", {
                "tool_name": "web_test",
                "parameters": {
                    "url": url,
                    "browser": browser,
                    "headless": headless
                }
            })
            print(f"[Web Agent] MCP 测试结果: {result}")
            return "error" not in result, None, {"message": "MCP web test run", "result": result, "url": url, "browser": browser}
        except Exception as e:
            print(f"[Web Agent] MCP 执行错误: {e}")
            return False, None, {"message": "MCP execution error", "error": str(e)}
    
    # 占位：真实实现可调用 Playwright/Selenium，例如：
    # with sync_playwright() as p: b = p.chromium.launch(headless=headless); page = b.new_page(); page.goto(url); ...
    summary = {"message": "web test placeholder", "url": url or "(none)", "browser": browser, "headless": headless}
    return True, None, summary


def main() -> None:
    skills = _skills_from_env()
    agent_id = register(platform=PLATFORM, skills=skills)
    print(f"[Web Agent] 已注册 agent_id={agent_id} platform={PLATFORM} skills={skills}")

    while True:
        try:
            heartbeat(agent_id, status="idle")
            job = poll_job(PLATFORM, skills=skills)
            if job:
                heartbeat(agent_id, status="running", current_job_id=job["job_id"])
                success, log_path, summary = run_web_test(job)
                submit_result(job["job_id"], agent_id, success, log_path, summary)
                heartbeat(agent_id, status="idle", current_job_id=None)
            else:
                time.sleep(POLL_INTERVAL)
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"[Web Agent] 错误: {e}")
            time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
