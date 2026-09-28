"""API端点功能测试"""
import pytest


def test_list_skills(client):
    """测试列出所有技能"""
    response = client.get("/api/skills")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert isinstance(data["items"], list)
    assert len(data["items"]) > 0
    assert "total" in data
    assert data["total"] == len(data["items"])


def test_register_agent(client, test_agent_data):
    """测试注册Agent"""
    response = client.post("/api/agents/register", json=test_agent_data)
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["agent_id"] == test_agent_data["agent_id"]


def test_agent_heartbeat(client, test_agent_data):
    """测试Agent心跳"""
    # 先注册Agent
    client.post("/api/agents/register", json=test_agent_data)
    
    # 发送心跳
    heartbeat_data = {
        "agent_id": test_agent_data["agent_id"],
        "status": "idle"
    }
    response = client.post("/api/agents/heartbeat", json=heartbeat_data)
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True


def test_list_agents(client, test_agent_data):
    """测试列出所有Agent"""
    # 先注册Agent
    client.post("/api/agents/register", json=test_agent_data)
    
    # 列出Agent
    response = client.get("/api/agents")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert isinstance(data["items"], list)
    assert len(data["items"]) > 0
    assert "total" in data
    assert data["total"] == len(data["items"])


def test_create_job(client, test_job_data):
    """测试创建任务"""
    response = client.post("/api/jobs", json=test_job_data)
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert "job_id" in data
    assert isinstance(data["job_id"], int)


def test_list_jobs(client, test_job_data):
    """测试列出所有任务"""
    # 先创建任务
    client.post("/api/jobs", json=test_job_data)
    
    # 列出任务
    response = client.get("/api/jobs")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert isinstance(data["items"], list)
    assert len(data["items"]) > 0
    assert "total" in data
    assert data["total"] == len(data["items"])


def test_poll_job(client, test_job_data):
    """测试拉取任务"""
    # 先创建任务
    client.post("/api/jobs", json=test_job_data)
    
    # 拉取任务
    response = client.get(f"/api/jobs/poll/{test_job_data['platform']}")
    assert response.status_code == 200
    data = response.json()
    assert "job" in data


def test_get_mcp_status(client):
    """测试检查MCP服务状态"""
    response = client.get("/api/mcp/status")
    assert response.status_code == 200
    data = response.json()
    assert "available" in data
    assert isinstance(data["available"], bool)


def test_index_page(client):
    """测试Web看板首页"""
    response = client.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
