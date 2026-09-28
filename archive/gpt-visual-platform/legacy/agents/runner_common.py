"""
Agent 公共逻辑：注册、心跳、拉取任务、上报结果。
各环境 runner 复用此模块。
"""
import json
import os
import uuid
from pathlib import Path
from typing import List, Optional, Dict, Any, Tuple
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def _base_url() -> str:
    return os.getenv("PLATFORM_URL", "http://localhost:9111").rstrip("/")


def _agent_id() -> str:
    return os.getenv("AGENT_ID", str(uuid.uuid4())[:8])


def _platform() -> str:
    return os.getenv("PLATFORM", "mac")


def _headers() -> dict:
    """公共请求头：服务端设置 PLATFORM_TOKEN 时须携带同名环境变量的令牌。"""
    h = {}
    token = os.getenv("PLATFORM_TOKEN", "").strip()
    if token:
        h["X-Platform-Token"] = token
    return h


def _open(req, timeout: int = 10):
    """打开请求：服务端为自签名 HTTPS 时，设置 PLATFORM_INSECURE_TLS=1 跳过证书校验。"""
    if os.getenv("PLATFORM_INSECURE_TLS", "").strip() == "1":
        import ssl
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return urlopen(req, timeout=timeout, context=ctx)
    return urlopen(req, timeout=timeout)


def _post(path: str, body: dict) -> dict:
    req = Request(_base_url() + path, data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json", **_headers()}, method="POST")
    with _open(req) as r:
        return json.loads(r.read().decode("utf-8"))


def _get(path: str, params: Optional[dict] = None) -> dict:
    url = _base_url() + path
    if params: url = url + ("&" if "?" in url else "?") + urlencode(params)
    req = Request(url, method="GET", headers=_headers())
    with _open(req) as r:
        return json.loads(r.read().decode("utf-8"))


def register(
    platform: Optional[str] = None,
    skills: Optional[List[str]] = None,
    extra: Optional[dict] = None,
) -> str:
    """注册 Agent，可声明 skills（如 ['PlayMode', 'EditMode', 'AltTester']）。"""
    aid = _agent_id()
    _post("/api/agents/register", {"agent_id": aid, "platform": platform or _platform(), "skills": skills or [], "extra": extra or {}})
    return aid


def heartbeat(agent_id: str, status: str = "idle", current_job_id: Optional[int] = None) -> None:
    _post("/api/agents/heartbeat", {"agent_id": agent_id, "status": status, "current_job_id": current_job_id})


def poll_job(platform: Optional[str] = None, skills: Optional[List[str]] = None) -> Optional[dict]:
    """拉取该平台下一条匹配任务；skills 为 Agent 具备的技能列表，用于匹配 required_skills。"""
    pl = platform or _platform()
    params = {"skills": ",".join(skills)} if skills else {}
    out = _get(f"/api/jobs/poll/{pl}", params if params else None)
    return out.get("job")


def submit_result(job_id: int, agent_id: str, success: bool, log_path: Optional[str] = None, summary: Optional[dict] = None) -> None:
    _post("/api/jobs/result", {"job_id": job_id, "agent_id": agent_id, "success": success, "log_path": log_path, "summary": summary or {}})


def check_mcp_status() -> Dict[str, Any]:
    """检查 MCP 服务状态"""
    return _get("/api/mcp/status")


def execute_mcp_tool(tool_name: str, tool_params: Dict[str, Any]) -> Dict[str, Any]:
    """执行 MCP 工具"""
    return _post("/api/mcp/execute-tool", {"tool_name": tool_name, "tool_params": tool_params})


def batch_execute_mcp_tools(tools: List[Dict[str, Any]]) -> Dict[str, Any]:
    """批量执行 MCP 工具"""
    return _post("/api/mcp/batch-execute", {"tools": tools})


def set_active_mcp_instance(instance_id: str) -> Dict[str, Any]:
    """设置活动的 Unity 实例"""
    return _post("/api/mcp/set-active-instance", {"instance_id": instance_id})


def manage_mcp_scene(action: str, scene_path: str, properties: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """管理 Unity 场景"""
    return _post("/api/mcp/manage-scene", {"action": action, "scene_path": scene_path, "properties": properties or {}})


def manage_mcp_asset(action: str, asset_path: str, properties: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """管理 Unity 资产"""
    return _post("/api/mcp/manage-asset", {"action": action, "asset_path": asset_path, "properties": properties or {}})


def manage_mcp_material(action: str, material_path: str, properties: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """管理 Unity 材质"""
    return _post("/api/mcp/manage-material", {"action": action, "material_path": material_path, "properties": properties or {}})


def execute_mcp_menu_item(menu_path: str) -> Dict[str, Any]:
    """执行 Unity 菜单命令"""
    return _post("/api/mcp/execute-menu-item", {"menu_path": menu_path})


def get_mcp_project_info() -> Dict[str, Any]:
    """获取项目信息"""
    return _get("/api/mcp/project-info")


def get_mcp_scene_info() -> Dict[str, Any]:
    """获取项目信息"""
    return _get("/api/mcp/scene-info")


# ---------- 可选集成任务分发 ----------

def dispatch_integrations(job: dict, platform: str) -> Tuple[bool, Optional[bool], Optional[str], Optional[dict]]:
    """按 extra.job_type 将任务分发到可选集成（airtest / ai_exploratory）。

    返回 (handled, success, log_path, summary)：
    - handled=False：无匹配的 job_type，调用方继续走 runner 自身的占位/真实逻辑；
    - handled=True：结果已产生（成功或带明确错误信息的失败），调用方直接上报。
    集成依赖为可选安装（requirements-airtest.txt），缺失时返回明确错误而非抛异常。
    """
    extra = job.get("extra") or {}
    job_type = extra.get("job_type")
    if job_type not in ("airtest", "ai_exploratory"):
        return False, None, None, None
    root = os.getenv("AGENT_WORKDIR") or str(Path(__file__).resolve().parent.parent / "data" / "agent_runs")
    workdir = Path(root) / f"job_{job.get('job_id')}"
    workdir.mkdir(parents=True, exist_ok=True)
    try:
        if job_type == "airtest":
            from integrations.airtest_executor import run_airtest_script
            ok, log_path, summary = run_airtest_script(job, platform, workdir)
        else:
            from integrations.ai_agent import run_ai_exploratory
            ok, log_path, summary = run_ai_exploratory(job, platform, workdir)
    except Exception as e:  # 集成内部已兜底，这里防止意外异常导致 Agent 循环退出
        return True, False, None, {"message": "集成执行异常", "error": str(e)}
    return True, bool(ok), log_path, summary or {}
