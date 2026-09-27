"""可选集成测试：Airtest 执行引擎 / AI 探索测试（纯逻辑部分，不依赖 airtest 安装与真实设备）"""
import pytest

from agents import runner_common
from integrations import ai_agent
from integrations import airtest_executor
from modules.skills import get_skill_by_id, get_skills_by_category


# ---------- AI 动作解析 ----------

def test_parse_action_plain_json():
    assert ai_agent.parse_action('{"action":"tap","x":0.5,"y":0.3}') == {"action": "tap", "x": 0.5, "y": 0.3}


def test_parse_action_code_fence():
    text = "```json\n{\"action\":\"finish\",\"success\":true,\"reason\":\"ok\"}\n```"
    assert ai_agent.parse_action(text)["action"] == "finish"


def test_parse_action_with_noise():
    text = '好的，下一步：{"action":"tap","x":0.1,"y":0.2} 请确认'
    assert ai_agent.parse_action(text)["action"] == "tap"


def test_parse_action_invalid_returns_empty():
    assert ai_agent.parse_action("我觉得应该点击设置按钮") == {}
    assert ai_agent.parse_action("") == {}


def test_validate_action():
    assert ai_agent.validate_action({"action": "tap", "x": 0.1, "y": 0.9})
    assert not ai_agent.validate_action({"action": "tap", "x": 1.5, "y": 0.1})
    assert not ai_agent.validate_action({"action": "fly", "x": 0.1, "y": 0.1})
    assert ai_agent.validate_action({"action": "swipe", "x1": 0, "y1": 0, "x2": 1, "y2": 1})
    assert ai_agent.validate_action({"action": "finish", "success": False})
    assert not ai_agent.validate_action({"action": "finish", "success": "yes"})
    assert not ai_agent.validate_action({"action": "wait", "seconds": 999})
    assert ai_agent.validate_action({"action": "key", "key": "BACK"})


def test_to_pixels():
    px = ai_agent.to_pixels({"action": "tap", "x": 0.5, "y": 0.25}, 1080, 1920)
    assert px == {"action": "tap", "x": 540, "y": 480}
    sw = ai_agent.to_pixels({"action": "swipe", "x1": 0, "y1": 0, "x2": 1, "y2": 1}, 1000, 2000)
    assert sw["x1"] == 0 and sw["y2"] == 2000 and sw["duration"] == 0.5


def test_build_step_messages_contains_task_and_history():
    msgs = ai_agent.build_step_messages("打开设置面板", [{"step": 1, "action": {"action": "tap"}, "result": "ok"}])
    assert msgs[0]["role"] == "system"
    assert "打开设置面板" in msgs[1]["content"]
    assert "历史步骤" in msgs[1]["content"]
    assert "tap" in msgs[1]["content"]


# ---------- 设备 URI ----------

def test_build_device_uri_android():
    uri, err = airtest_executor.build_device_uri("android", {"device_serial": "emulator-5554"})
    assert uri == "Android:///emulator-5554" and err is None
    uri, err = airtest_executor.build_device_uri("android", {})
    assert uri == "Android:///" and err is None


def test_build_device_uri_windows():
    uri, err = airtest_executor.build_device_uri("windows", {"window_title": "My Game (32-bit)"})
    assert err is None and "title_re=" in uri
    uri, err = airtest_executor.build_device_uri("windows", {})
    assert uri == "Windows:///" and err is None


def test_build_device_uri_unsupported_platform():
    uri, err = airtest_executor.build_device_uri("mac", {})
    assert uri is None and err and "不支持" in err


# ---------- 任务分发 ----------

def test_dispatch_ignores_jobs_without_matching_type():
    handled, success, log_path, summary = runner_common.dispatch_integrations({"extra": {}}, "mac")
    assert handled is False


def test_dispatch_airtest_without_dependency(monkeypatch, tmp_path):
    monkeypatch.setattr(airtest_executor, "_airtest_installed", lambda: False)
    handled, success, log_path, summary = runner_common.dispatch_integrations(
        {"job_id": 1, "extra": {"job_type": "airtest", "script_path": "/tmp/x.air"}}, "android")
    assert handled is True and success is False
    assert "airtest" in str(summary).lower()


def test_dispatch_ai_without_api_key(monkeypatch, tmp_path):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("AGENT_WORKDIR", str(tmp_path))
    handled, success, log_path, summary = runner_common.dispatch_integrations(
        {"job_id": 2, "extra": {"job_type": "ai_exploratory", "prompt": "探索主界面"}}, "android")
    assert handled is True and success is False
    assert "OPENAI_API_KEY" in summary.get("message", "")


def test_dispatch_ai_without_prompt(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("AGENT_WORKDIR", str(tmp_path))
    handled, success, log_path, summary = runner_common.dispatch_integrations(
        {"job_id": 3, "extra": {"job_type": "ai_exploratory"}}, "android")
    assert handled is True and success is False
    assert "prompt" in summary.get("message", "")


# ---------- Skills 注册 ----------

def test_new_skills_registered():
    for sid in ("Airtest", "Poco", "AIAgent"):
        assert get_skill_by_id(sid) is not None
    ai_skills = get_skills_by_category("ai")
    assert [s["id"] for s in ai_skills] == ["AIAgent"]
