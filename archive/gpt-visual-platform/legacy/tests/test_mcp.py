"""MCP模块功能测试"""
import pytest
from unittest import mock
from modules.mcp import (
    get_mcp_server_url,
    is_mcp_available,
    get_unity_instances,
    set_active_instance,
    execute_unity_tool,
    batch_execute_tools,
    create_unity_script,
    manage_gameobject,
    refresh_unity,
    run_unity_tests,
    manage_scene,
    manage_asset,
    manage_material,
    execute_menu_item,
    get_project_info,
    get_scene_info
)


@mock.patch('modules.mcp.os.getenv')
def test_get_mcp_server_url(mock_getenv):
    """测试获取MCP服务器URL"""
    # 测试默认值
    mock_getenv.side_effect = lambda key, default=None: default if key == "MCP_SERVER_URL" else None
    assert get_mcp_server_url() == "http://localhost:8080/mcp"
    
    # 测试环境变量值
    mock_getenv.side_effect = lambda key, default=None: "http://custom-server:8080/mcp" if key == "MCP_SERVER_URL" else None
    assert get_mcp_server_url() == "http://custom-server:8080/mcp"


@mock.patch('modules.mcp.get_project_info')
def test_is_mcp_available(mock_get_project_info):
    """测试检查MCP服务是否可用"""
    # 测试MCP服务可用
    mock_get_project_info.return_value = {"project_name": "TestProject"}
    assert is_mcp_available() is True
    
    # 测试MCP服务不可用（返回错误）
    mock_get_project_info.return_value = {"error": "Service unavailable"}
    assert is_mcp_available() is False
    
    # 测试MCP服务不可用（抛出异常）
    mock_get_project_info.side_effect = Exception("Connection error")
    assert is_mcp_available() is False


@mock.patch('modules.mcp._get_mcp_request')
def test_get_unity_instances(mock_get_request):
    """测试获取可用的Unity实例"""
    # 测试成功获取实例
    mock_get_request.return_value = {"instances": [{"id": "instance1", "name": "Unity Editor"}]}
    result = get_unity_instances()
    assert "instances" in result
    assert len(result["instances"]) == 1
    
    # 测试获取失败
    mock_get_request.side_effect = Exception("Connection error")
    result = get_unity_instances()
    assert "error" in result


@mock.patch('modules.mcp._post_mcp_request')
def test_set_active_instance(mock_post_request):
    """测试设置活动的Unity实例"""
    # 测试成功设置
    mock_post_request.return_value = {"success": True}
    result = set_active_instance("instance1")
    assert result == {"success": True}
    
    # 测试设置失败
    mock_post_request.side_effect = Exception("Connection error")
    result = set_active_instance("instance1")
    assert "error" in result


@mock.patch('modules.mcp._post_mcp_request')
def test_execute_unity_tool(mock_post_request):
    """测试执行Unity MCP工具"""
    # 测试成功执行
    mock_post_request.return_value = {"success": True, "result": "Tool executed"}
    result = execute_unity_tool("test_tool", {"param1": "value1"})
    assert result == {"success": True, "result": "Tool executed"}
    
    # 测试执行失败
    mock_post_request.side_effect = Exception("Connection error")
    result = execute_unity_tool("test_tool", {"param1": "value1"})
    assert "error" in result


@mock.patch('modules.mcp._post_mcp_request')
def test_batch_execute_tools(mock_post_request):
    """测试批量执行多个Unity MCP工具"""
    # 测试成功执行
    mock_post_request.return_value = {"success": True, "results": ["Tool1 executed", "Tool2 executed"]}
    result = batch_execute_tools([{"tool": "tool1", "params": {}}, {"tool": "tool2", "params": {}}])
    assert result == {"success": True, "results": ["Tool1 executed", "Tool2 executed"]}
    
    # 测试执行失败
    mock_post_request.side_effect = Exception("Connection error")
    result = batch_execute_tools([{"tool": "tool1", "params": {}}])
    assert "error" in result


@mock.patch('modules.mcp._post_mcp_request')
def test_create_unity_script(mock_post_request):
    """测试创建Unity脚本"""
    # 测试成功创建
    mock_post_request.return_value = {"success": True, "path": "Assets/Scripts/TestScript.cs"}
    result = create_unity_script("TestScript.cs", "public class TestScript {}")
    assert result == {"success": True, "path": "Assets/Scripts/TestScript.cs"}
    
    # 测试创建失败
    mock_post_request.side_effect = Exception("Connection error")
    result = create_unity_script("TestScript.cs", "public class TestScript {}")
    assert "error" in result


@mock.patch('modules.mcp._post_mcp_request')
def test_manage_gameobject(mock_post_request):
    """测试管理Unity游戏对象"""
    # 测试成功管理
    mock_post_request.return_value = {"success": True}
    result = manage_gameobject("activate", "GameObject/TestObject")
    assert result == {"success": True}
    
    # 测试管理失败
    mock_post_request.side_effect = Exception("Connection error")
    result = manage_gameobject("activate", "GameObject/TestObject")
    assert "error" in result


@mock.patch('modules.mcp._post_mcp_request')
def test_refresh_unity(mock_post_request):
    """测试刷新Unity编辑器"""
    # 测试成功刷新
    mock_post_request.return_value = {"success": True}
    result = refresh_unity()
    assert result == {"success": True}
    
    # 测试刷新失败
    mock_post_request.side_effect = Exception("Connection error")
    result = refresh_unity()
    assert "error" in result


@mock.patch('modules.mcp._post_mcp_request')
def test_run_unity_tests(mock_post_request):
    """测试运行Unity测试"""
    # 测试成功运行
    mock_post_request.return_value = {"success": True, "results": {"passed": 5, "failed": 0}}
    result = run_unity_tests("TestFilter")
    assert result == {"success": True, "results": {"passed": 5, "failed": 0}}
    
    # 测试运行失败
    mock_post_request.side_effect = Exception("Connection error")
    result = run_unity_tests("TestFilter")
    assert "error" in result


@mock.patch('modules.mcp._post_mcp_request')
def test_manage_scene(mock_post_request):
    """测试管理Unity场景"""
    # 测试成功管理
    mock_post_request.return_value = {"success": True}
    result = manage_scene("load", "Assets/Scenes/TestScene.unity")
    assert result == {"success": True}
    
    # 测试管理失败
    mock_post_request.side_effect = Exception("Connection error")
    result = manage_scene("load", "Assets/Scenes/TestScene.unity")
    assert "error" in result


@mock.patch('modules.mcp._post_mcp_request')
def test_manage_asset(mock_post_request):
    """测试管理Unity资产"""
    # 测试成功管理
    mock_post_request.return_value = {"success": True}
    result = manage_asset("import", "Assets/Textures/TestTexture.png")
    assert result == {"success": True}
    
    # 测试管理失败
    mock_post_request.side_effect = Exception("Connection error")
    result = manage_asset("import", "Assets/Textures/TestTexture.png")
    assert "error" in result


@mock.patch('modules.mcp._post_mcp_request')
def test_manage_material(mock_post_request):
    """测试管理Unity材质"""
    # 测试成功管理
    mock_post_request.return_value = {"success": True}
    result = manage_material("create", "Assets/Materials/TestMaterial.mat")
    assert result == {"success": True}
    
    # 测试管理失败
    mock_post_request.side_effect = Exception("Connection error")
    result = manage_material("create", "Assets/Materials/TestMaterial.mat")
    assert "error" in result


@mock.patch('modules.mcp._post_mcp_request')
def test_execute_menu_item(mock_post_request):
    """测试执行Unity菜单命令"""
    # 测试成功执行
    mock_post_request.return_value = {"success": True}
    result = execute_menu_item("Assets/Import New Asset...")
    assert result == {"success": True}
    
    # 测试执行失败
    mock_post_request.side_effect = Exception("Connection error")
    result = execute_menu_item("Assets/Import New Asset...")
    assert "error" in result


@mock.patch('modules.mcp._get_mcp_request')
def test_get_project_info(mock_get_request):
    """测试获取项目信息"""
    # 测试成功获取
    mock_get_request.return_value = {"project_name": "TestProject", "version": "1.0.0"}
    result = get_project_info()
    assert result == {"project_name": "TestProject", "version": "1.0.0"}
    
    # 测试获取失败
    mock_get_request.side_effect = Exception("Connection error")
    result = get_project_info()
    assert "error" in result


@mock.patch('modules.mcp._get_mcp_request')
def test_get_scene_info(mock_get_request):
    """测试获取场景信息"""
    # 测试成功获取
    mock_get_request.return_value = {"scene_name": "TestScene", "gameobjects": 10}
    result = get_scene_info()
    assert result == {"scene_name": "TestScene", "gameobjects": 10}
    
    # 测试获取失败
    mock_get_request.side_effect = Exception("Connection error")
    result = get_scene_info()
    assert "error" in result
