"""
可选集成：Airtest 执行引擎（图像识别 UI 自动化，当前支持 Android / Windows）。
依赖：pip install -r requirements-airtest.txt（airtest、pocoui）；未安装时返回明确错误提示，不影响 Agent 其他任务。
任务协议（创建任务时的 extra）：
  {"job_type": "airtest", "script_path": "/path/to/demo.air",
   "device_serial": "emulator-5554",    # Android 设备序列号（或环境变量 ANDROID_SERIAL）
   "window_title": "游戏窗口标题",        # Windows：按窗口标题匹配（自动转义）
   "window_title_re": "^Unity.*$",       # Windows：直接指定窗口标题正则（优先于 window_title）
   "timeout": 3600}
说明：.air 脚本内可自行使用 Poco（需游戏集成 Poco-SDK），本模块只负责设备连接与脚本运行。
"""
import os
import re
import sys
import shutil
import subprocess
from pathlib import Path
from typing import Optional, Tuple
from urllib.parse import quote


def _airtest_installed() -> bool:
    try:
        import airtest  # noqa: F401
        return True
    except ImportError:
        return False


def _airtest_cmd() -> list:
    """定位 airtest CLI：优先当前解释器同环境的入口脚本，其次 PATH，最后 python -m 兜底。"""
    name = "airtest.exe" if os.name == "nt" else "airtest"
    local = Path(sys.executable).parent / name
    if local.exists():
        return [str(local)]
    which = shutil.which("airtest")
    if which:
        return [which]
    return [sys.executable, "-m", "airtest"]


def build_device_uri(platform: str, extra: dict) -> Tuple[Optional[str], Optional[str]]:
    """根据平台与任务参数构造 Airtest 设备 URI。返回 (uri, error)，error 非 None 表示平台不支持。"""
    extra = extra or {}
    if platform == "android":
        serial = extra.get("device_serial") or os.getenv("ANDROID_SERIAL", "")
        return f"Android:///{serial}", None
    if platform == "windows":
        title_re = extra.get("window_title_re") or ""
        title = extra.get("window_title") or ""
        if title_re:
            return f"Windows:///?title_re={quote(title_re, safe='')}", None
        if title:
            return f"Windows:///?title_re={quote(re.escape(title), safe='')}", None
        return "Windows:///", None
    return None, f"Airtest 暂不支持 platform={platform}（当前支持 android / windows，iOS/Mac 驱动待接入）"


def run_airtest_script(job: dict, platform: str, workdir: Path) -> tuple:
    """运行 .air 脚本。返回 (success, log_path, summary)。"""
    extra = job.get("extra") or {}
    script = extra.get("script_path") or ""
    if not _airtest_installed():
        return False, None, {"message": "未安装 airtest，请执行: pip install -r requirements-airtest.txt"}
    script_path = Path(script)
    if not script or not script_path.exists():
        return False, None, {"message": f"脚本不存在: {script}", "hint": "script_path 需为 Agent 本机上的 .air 目录"}
    uri, err = build_device_uri(platform, extra)
    if err:
        return False, None, {"message": err}
    log_dir = Path(workdir) / "airtest_log"
    log_dir.mkdir(parents=True, exist_ok=True)
    cmd = _airtest_cmd() + ["run", str(script_path), "--device", uri, "--log", str(log_dir)]
    timeout = float(extra.get("timeout") or 3600)
    print(f"[Airtest] 执行: {' '.join(cmd)}")
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return False, str(log_dir), {"message": "脚本执行超时", "timeout": timeout, "device": uri}
    success = proc.returncode == 0
    log_path = str(log_dir / "log.txt") if (log_dir / "log.txt").exists() else str(log_dir)
    summary = {
        "message": "airtest 脚本执行成功" if success else "airtest 脚本执行失败",
        "script": str(script_path),
        "device": uri,
        "exit_code": proc.returncode,
        "stdout_tail": (proc.stdout or "")[-500:],
        "stderr_tail": (proc.stderr or "")[-500:],
    }
    return success, log_path, summary
