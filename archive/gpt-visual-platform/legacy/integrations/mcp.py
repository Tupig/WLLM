"""
MCP (Master Control Protocol) 集成模块
允许平台与 Unity MCP 服务交互，实现 AI 助手对 Unity 编辑器的控制
"""
import json
import os
from typing import Dict, Optional, Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def get_mcp_server_url() -> str:
    """获取 MCP 服务器 URL，默认使用本地 Unity MCP 服务"""
    return os.getenv("MCP_SERVER_URL", "http://localhost:8080/mcp")


def _post_mcp_request(endpoint: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """向 MCP 服务器发送 POST 请求"""
    url = get_mcp_server_url() + endpoint
    req = Request(
        url,
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def _get_mcp_request(endpoint: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """向 MCP 服务器发送 GET 请求"""
    url = get_mcp_server_url() + endpoint
    if params:
        url += "?" + urlencode(params)
    req = Request(url, method="GET")
    with urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def get_unity_instances() -> Dict[str, Any]:
    """获取可用的 Unity 实例"""
    try:
        return _get_mcp_request("/resources/unity_instances")
    except Exception as e:
        return {"error": str(e)}


def set_active_instance(instance_id: str) -> Dict[str, Any]:
    """设置活动的 Unity 实例"""
    try:
        return _post_mcp_request("/tools/set_active_instance", {"instance_id": instance_id})
    except Exception as e:
        return {"error": str(e)}


def execute_unity_tool(tool_name: str, tool_params: Dict[str, Any]) -> Dict[str, Any]:
    """执行 Unity MCP 工具"""
    try:
        return _post_mcp_request(f"/tools/{tool_name}", tool_params)
    except Exception as e:
        return {"error": str(e)}


def batch_execute_tools(tools: list) -> Dict[str, Any]:
    """批量执行多个 Unity MCP 工具"""
    try:
        return _post_mcp_request("/tools/batch_execute", {"tools": tools})
    except Exception as e:
        return {"error": str(e)}


def create_unity_script(script_name: str, script_content: str, folder_path: str = "Assets/Scripts") -> Dict[str, Any]:
    """创建 Unity 脚本"""
    try:
        return _post_mcp_request("/tools/create_script", {
            "script_name": script_name,
            "script_content": script_content,
            "folder_path": folder_path
        })
    except Exception as e:
        return {"error": str(e)}


def manage_gameobject(action: str, gameobject_path: str, properties: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """管理 Unity 游戏对象"""
    try:
        params = {
            "action": action,
            "gameobject_path": gameobject_path
        }
        if properties:
            params.update(properties)
        return _post_mcp_request("/tools/manage_gameobject", params)
    except Exception as e:
        return {"error": str(e)}


def refresh_unity() -> Dict[str, Any]:
    """刷新 Unity 编辑器"""
    try:
        return _post_mcp_request("/tools/refresh_unity", {})
    except Exception as e:
        return {"error": str(e)}


def run_unity_tests(test_filter: Optional[str] = None) -> Dict[str, Any]:
    """运行 Unity 测试"""
    try:
        params = {}
        if test_filter:
            params["test_filter"] = test_filter
        return _post_mcp_request("/tools/run_tests", params)
    except Exception as e:
        return {"error": str(e)}


def manage_scene(action: str, scene_path: str, properties: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """管理 Unity 场景"""
    try:
        params = {
            "action": action,
            "scene_path": scene_path
        }
        if properties:
            params.update(properties)
        return _post_mcp_request("/tools/manage_scene", params)
    except Exception as e:
        return {"error": str(e)}


def manage_asset(action: str, asset_path: str, properties: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """管理 Unity 资产"""
    try:
        params = {
            "action": action,
            "asset_path": asset_path
        }
        if properties:
            params.update(properties)
        return _post_mcp_request("/tools/manage_asset", params)
    except Exception as e:
        return {"error": str(e)}


def manage_material(action: str, material_path: str, properties: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """管理 Unity 材质"""
    try:
        params = {
            "action": action,
            "material_path": material_path
        }
        if properties:
            params.update(properties)
        return _post_mcp_request("/tools/manage_material", params)
    except Exception as e:
        return {"error": str(e)}


def execute_menu_item(menu_path: str) -> Dict[str, Any]:
    """执行 Unity 菜单命令"""
    try:
        return _post_mcp_request("/tools/execute_menu_item", {"menu_path": menu_path})
    except Exception as e:
        return {"error": str(e)}


def get_project_info() -> Dict[str, Any]:
    """获取项目信息"""
    try:
        return _get_mcp_request("/resources/project_info")
    except Exception as e:
        return {"error": str(e)}


def get_scene_info() -> Dict[str, Any]:
    """获取场景信息"""
    try:
        return _get_mcp_request("/resources/scene_info")
    except Exception as e:
        return {"error": str(e)}


def is_mcp_available() -> bool:
    """检查 MCP 服务是否可用"""
    try:
        response = get_project_info()
        return "error" not in response
    except Exception:
        return False
