"""测试配置文件

测试数据全部隔离到临时目录（DATA_DIR 环境变量），避免污染真实 data/。
必须在 import main 之前设置环境变量（main.py 在导入期初始化 DATA_DIR）。
"""
import os
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="unity-platform-test-data-"))

import pytest
from fastapi.testclient import TestClient
from main import app


@pytest.fixture
def client():
    """测试客户端 fixture"""
    return TestClient(app)


@pytest.fixture
def test_agent_data():
    """测试 Agent 数据"""
    return {
        "agent_id": "test-agent-1",
        "platform": "mac",
        "skills": ["PlayMode", "EditMode"]
    }


@pytest.fixture
def test_job_data():
    """测试任务数据"""
    return {
        "platform": "mac",
        "required_skills": ["PlayMode"],
        "unity_project_path": "/path/to/project",
        "test_filter": "test*"
    }
