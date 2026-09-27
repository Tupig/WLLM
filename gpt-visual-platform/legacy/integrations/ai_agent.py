"""
可选集成：AI 探索测试 Agent —— 视觉大模型驱动设备循环操作（截图 → 决策 → 执行 → 上报）。
依赖：pip install -r requirements-airtest.txt（含 openai、airtest）。
环境变量：OPENAI_API_KEY 必需；OPENAI_VISION_MODEL 可选（默认取 OPENAI_MODEL 或 gpt-4o-mini）；OPENAI_BASE_URL 可选（OpenAI 兼容接口）。
任务协议（创建任务时的 extra）：
  {"job_type": "ai_exploratory", "prompt": "登录游戏并打开设置面板",
   "max_steps": 15, "device_serial": "emulator-5554", "window_title": "游戏窗口"}
产物：data/agent_runs/job_<id>/step_NN.png 每步截图；steps.json 全部步骤记录。
"""
import base64
import io
import json
import os
import re
from pathlib import Path
from typing import Optional

from integrations.airtest_executor import build_device_uri

# 模型可输出的动作空间；坐标一律归一化 0~1，与设备分辨率无关
ALLOWED_ACTIONS = ("tap", "swipe", "text", "key", "wait", "finish")

_SYSTEM_PROMPT = """你是一个游戏 QA 自动化测试 Agent，通过观察屏幕截图来操作设备完成测试任务。
每一步你只能输出一个 JSON 对象（不要 markdown 代码块、不要解释），动作为以下之一：
{"action": "tap", "x": 0.5, "y": 0.3}          # 点击，坐标为归一化 0~1（相对截图宽高）
{"action": "swipe", "x1": 0.5, "y1": 0.8, "x2": 0.5, "y2": 0.2}   # 滑动
{"action": "text", "text": "hello"}             # 向输入框输入文本（需先点击输入框）
{"action": "key", "key": "BACK"}                # Android 按键：BACK/HOME/MENU/ENTER 等
{"action": "wait", "seconds": 3}                # 等待 1~30 秒
{"action": "finish", "success": true, "reason": "设置面板已打开"}   # 任务完成或确认无法完成
要求：
1. x/y 坐标必须来自当前截图观察，不要凭空猜测。
2. 任务目标未完成且仍有可尝试的操作时，不要输出 finish。
3. 界面明显无法继续（卡死、报错、找不到入口）时，输出 finish 且 success=false，并说明原因。"""


def parse_action(text_out: str) -> dict:
    """从模型输出中提取首个 JSON 对象；解析失败返回 {}。"""
    if not text_out:
        return {}
    s = text_out.strip()
    m = re.search(r"```(?:json)?\s*(.+?)\s*```", s, re.S)
    if m:
        s = m.group(1)
    start, end = s.find("{"), s.rfind("}")
    if start == -1 or end <= start:
        return {}
    try:
        obj = json.loads(s[start:end + 1])
    except Exception:
        return {}
    return obj if isinstance(obj, dict) else {}


def _coord_ok(v) -> bool:
    return isinstance(v, (int, float)) and 0 <= v <= 1


def validate_action(act: dict) -> bool:
    """校验动作合法性：action 在动作空间内、坐标/参数类型正确。"""
    if not isinstance(act, dict):
        return False
    a = act.get("action")
    if a not in ALLOWED_ACTIONS:
        return False
    if a == "tap":
        return _coord_ok(act.get("x")) and _coord_ok(act.get("y"))
    if a == "swipe":
        return all(_coord_ok(act.get(k)) for k in ("x1", "y1", "x2", "y2"))
    if a == "text":
        return isinstance(act.get("text"), str) and len(act["text"]) > 0
    if a == "key":
        return isinstance(act.get("key"), str) and len(act["key"]) > 0
    if a == "wait":
        w = act.get("seconds", 1)
        return isinstance(w, (int, float)) and 0 < w <= 30
    if a == "finish":
        return isinstance(act.get("success"), bool)
    return False


def to_pixels(act: dict, width: int, height: int) -> dict:
    """归一化坐标 → 设备像素坐标，返回可直接执行的动作参数。"""
    a = act["action"]
    if a == "tap":
        return {"action": a, "x": int(act["x"] * width), "y": int(act["y"] * height)}
    if a == "swipe":
        return {"action": a,
                "x1": int(act["x1"] * width), "y1": int(act["y1"] * height),
                "x2": int(act["x2"] * width), "y2": int(act["y2"] * height),
                "duration": float(act.get("duration", 0.5))}
    return {**act}


def build_step_messages(task: str, history: list) -> list:
    """构造每步请求的文本消息（不含图片；截图由调用方以 image_url 追加到最后一条 user 消息）。"""
    if history:
        lines = []
        for h in history[-8:]:
            desc = {k: h[k] for k in ("step", "action", "result", "error") if k in h}
            lines.append(f"{len(lines) + 1}. {json.dumps(desc, ensure_ascii=False)}")
        hist = "历史步骤（最近 8 条）：\n" + "\n".join(lines)
    else:
        hist = "历史步骤：无，这是第一步。"
    user = f"测试任务：{task}\n\n{hist}\n\n请观察当前截图，输出下一步动作 JSON。"
    return [{"role": "system", "content": _SYSTEM_PROMPT}, {"role": "user", "content": user}]


def _encode_screenshot(path: Path, max_side: int = 1024) -> str:
    """截图压成 JPEG data URL（长边缩放，节省 token）。"""
    from PIL import Image  # airtest 依赖中自带
    img = Image.open(str(path)).convert("RGB")
    if max(img.size) > max_side:
        img.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=80)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")


def run_ai_exploratory(job: dict, platform: str, workdir: Path) -> tuple:
    """AI 探索测试主循环。返回 (success, log_path, summary)。"""
    extra = job.get("extra") or {}
    task = extra.get("prompt") or ""
    if not task:
        return False, None, {"message": "缺少 extra.prompt（AI 探索测试目标）"}
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return False, None, {"message": "OPENAI_API_KEY 未配置"}
    try:
        import openai
    except ImportError:
        return False, None, {"message": "未安装 openai，请执行: pip install -r requirements-airtest.txt"}
    try:
        from airtest.core.api import (
            connect_device, snapshot, touch, swipe, keyevent, wake,
            sleep as air_sleep, text as device_text,
        )
    except ImportError as e:
        return False, None, {"message": "未安装 airtest，请执行: pip install -r requirements-airtest.txt", "error": str(e)}

    uri, err = build_device_uri(platform, extra)
    if err:
        return False, None, {"message": err}

    model = os.getenv("OPENAI_VISION_MODEL") or os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    base_url = os.getenv("OPENAI_BASE_URL") or None
    client = openai.OpenAI(api_key=api_key, base_url=base_url, timeout=90)
    max_steps = int(extra.get("max_steps") or 12)
    workdir = Path(workdir)
    workdir.mkdir(parents=True, exist_ok=True)

    connect_device(uri)
    if platform == "android":
        try:
            wake()
        except Exception:
            pass

    history = []
    success, reason = False, "达到最大步数"
    for i in range(1, max_steps + 1):
        png = workdir / f"step_{i:02d}.png"
        img = snapshot(filename=str(png))
        try:
            w, h = img.size
        except Exception:
            w, h = 1080, 1920
        messages = build_step_messages(task, history)
        messages[-1]["content"] = [
            {"type": "text", "text": messages[-1]["content"]},
            {"type": "image_url", "image_url": {"url": _encode_screenshot(png)}},
        ]
        try:
            r = client.chat.completions.create(model=model, messages=messages, temperature=0.2)
            out = (r.choices[0].message.content or "").strip()
        except Exception as e:
            reason = f"模型调用失败: {e}"
            break
        act = parse_action(out)
        if not validate_action(act):
            history.append({"step": i, "raw": out[:200], "error": "动作解析失败，请重新输出 JSON"})
            continue
        if act["action"] == "finish":
            success = bool(act.get("success"))
            reason = act.get("reason", "")
            history.append({"step": i, "action": act, "result": "finish"})
            break
        px = to_pixels(act, w, h)
        try:
            if px["action"] == "tap":
                touch((px["x"], px["y"]))
            elif px["action"] == "swipe":
                swipe((px["x1"], px["y1"]), (px["x2"], px["y2"]), duration=px["duration"])
            elif px["action"] == "text":
                device_text(px["text"])
            elif px["action"] == "key":
                keyevent(px["key"])
            elif px["action"] == "wait":
                air_sleep(px["seconds"])
            result = "ok"
        except Exception as e:
            result = f"执行失败: {e}"
        history.append({"step": i, "action": act, "result": result, "screenshot": png.name})
        air_sleep(1.0)

    steps_path = workdir / "steps.json"
    steps_path.write_text(
        json.dumps({"task": task, "success": success, "reason": reason, "steps": history}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    summary = {
        "message": "AI 探索测试达成" if success else "AI 探索测试未达成",
        "model": model,
        "device": uri,
        "steps": len(history),
        "reason": reason,
    }
    return success, str(steps_path), summary
