"""
数据服务模块测试
"""

import time
from pathlib import Path
from modules.services.data_service import DataService


def test_data_service_initialization(tmp_path):
    """测试数据服务初始化"""
    data_service = DataService(tmp_path)
    
    # 验证目录创建
    assert (tmp_path / "runs").exists()
    
    # 验证初始数据
    assert data_service.agents == {}
    assert data_service.jobs == []
    assert data_service.job_id == 0


def test_next_job_id(tmp_path):
    """测试获取下一个任务ID"""
    data_service = DataService(tmp_path)
    
    # 测试初始ID
    assert data_service.job_id == 0
    
    # 测试获取下一个ID
    job_id_1 = data_service.next_job_id()
    assert job_id_1 == 1
    
    job_id_2 = data_service.next_job_id()
    assert job_id_2 == 2
    
    # 验证job_id文件已更新
    job_id_file = tmp_path / "job_id.txt"
    assert job_id_file.exists()
    with open(job_id_file, 'r') as f:
        assert f.read().strip() == "2"


def test_save_and_find_job(tmp_path):
    """测试保存和查找任务"""
    data_service = DataService(tmp_path)
    
    # 创建测试任务
    job = {
        "job_id": 1,
        "platform": "windows",
        "required_skills": ["PlayMode"],
        "status": "pending",
        "created_at": time.time(),
        "result": None
    }
    
    # 保存任务
    save_result = data_service.save_job(job)
    assert save_result is True
    
    # 验证任务文件已创建
    job_file = tmp_path / "runs" / "job_1.json"
    assert job_file.exists()
    
    # 查找任务
    found_job = data_service.find_job(1)
    assert found_job is not None
    assert found_job["job_id"] == 1
    assert found_job["platform"] == "windows"
    
    # 测试查找不存在的任务
    not_found_job = data_service.find_job(999)
    assert not_found_job is None


def test_get_jobs_by_status(tmp_path):
    """测试按状态获取任务"""
    data_service = DataService(tmp_path)
    
    # 添加测试任务
    job1 = {
        "job_id": 1,
        "platform": "windows",
        "status": "pending",
        "created_at": time.time()
    }
    
    job2 = {
        "job_id": 2,
        "platform": "mac",
        "status": "running",
        "created_at": time.time()
    }
    
    job3 = {
        "job_id": 3,
        "platform": "linux",
        "status": "pending",
        "created_at": time.time()
    }
    
    data_service.jobs.extend([job1, job2, job3])
    
    # 测试按状态获取任务
    pending_jobs = data_service.get_jobs_by_status("pending")
    assert len(pending_jobs) == 2
    assert all(job["status"] == "pending" for job in pending_jobs)
    
    running_jobs = data_service.get_jobs_by_status("running")
    assert len(running_jobs) == 1
    assert running_jobs[0]["status"] == "running"
    
    # 测试不存在的状态
    non_existent_jobs = data_service.get_jobs_by_status("non_existent")
    assert len(non_existent_jobs) == 0


def test_get_agents_by_platform(tmp_path):
    """测试按平台获取Agent"""
    data_service = DataService(tmp_path)
    
    # 添加测试Agent
    agent1 = {
        "agent_id": "agent1",
        "platform": "windows",
        "skills": ["PlayMode"],
        "last_seen": time.time()
    }
    
    agent2 = {
        "agent_id": "agent2",
        "platform": "mac",
        "skills": ["EditMode"],
        "last_seen": time.time()
    }
    
    agent3 = {
        "agent_id": "agent3",
        "platform": "windows",
        "skills": ["PlayMode", "EditMode"],
        "last_seen": time.time()
    }
    
    data_service.agents.update({
        "agent1": agent1,
        "agent2": agent2,
        "agent3": agent3
    })
    
    # 测试按平台获取Agent
    windows_agents = data_service.get_agents_by_platform("windows")
    assert len(windows_agents) == 2
    assert all(agent["platform"] == "windows" for agent in windows_agents)
    
    mac_agents = data_service.get_agents_by_platform("mac")
    assert len(mac_agents) == 1
    assert mac_agents[0]["platform"] == "mac"
    
    # 测试不存在的平台
    non_existent_agents = data_service.get_agents_by_platform("non_existent")
    assert len(non_existent_agents) == 0


def test_save_data(tmp_path):
    """测试保存数据"""
    data_service = DataService(tmp_path)
    
    # 添加测试数据
    agent = {
        "agent_id": "agent1",
        "platform": "windows",
        "skills": ["PlayMode"],
        "last_seen": time.time()
    }
    
    job = {
        "job_id": 1,
        "platform": "windows",
        "status": "pending",
        "created_at": time.time()
    }
    
    data_service.agents["agent1"] = agent
    data_service.jobs.append(job)
    data_service.job_id = 1
    
    # 保存数据
    save_result = data_service.save_data()
    assert save_result is True
    
    # 验证文件已创建
    agents_file = tmp_path / "agents.json"
    jobs_file = tmp_path / "jobs.json"
    job_id_file = tmp_path / "job_id.txt"
    
    assert agents_file.exists()
    assert jobs_file.exists()
    assert job_id_file.exists()


def test_load_data(tmp_path):
    """测试加载数据"""
    # 先创建测试数据文件
    agents_file = tmp_path / "agents.json"
    jobs_file = tmp_path / "jobs.json"
    job_id_file = tmp_path / "job_id.txt"
    
    # 写入测试数据
    with open(agents_file, 'w') as f:
        f.write('{"agent1": {"agent_id": "agent1", "platform": "windows", "skills": ["PlayMode"], "last_seen": 1234567890}}')
    
    with open(jobs_file, 'w') as f:
        f.write('[{"job_id": 1, "platform": "windows", "status": "pending", "created_at": 1234567890}]')
    
    with open(job_id_file, 'w') as f:
        f.write('1')
    
    # 创建数据服务实例，应该自动加载数据
    data_service = DataService(tmp_path)
    
    # 验证数据已加载
    assert "agent1" in data_service.agents
    assert len(data_service.jobs) == 1
    assert data_service.job_id == 1


def test_load_data_with_invalid_job_id(tmp_path):
    """测试加载数据时job_id文件无效的情况"""
    # 创建测试数据文件，但job_id文件内容无效
    agents_file = tmp_path / "agents.json"
    jobs_file = tmp_path / "jobs.json"
    job_id_file = tmp_path / "job_id.txt"
    
    # 写入测试数据
    with open(agents_file, 'w') as f:
        f.write('{}')
    
    with open(jobs_file, 'w') as f:
        f.write('[{"job_id": 5, "platform": "windows", "status": "pending", "created_at": 1234567890}]')
    
    with open(job_id_file, 'w') as f:
        f.write('invalid')  # 无效的job_id
    
    # 创建数据服务实例
    data_service = DataService(tmp_path)
    
    # 验证job_id已从jobs列表中计算
    assert data_service.job_id == 5


def test_cache_mechanism(tmp_path):
    """测试缓存机制"""
    data_service = DataService(tmp_path)
    
    # 创建测试任务
    job = {
        "job_id": 1,
        "platform": "windows",
        "status": "pending",
        "created_at": time.time()
    }
    
    # 保存任务
    data_service.save_job(job)
    
    # 第一次查找任务（应该从文件读取并缓存）
    found_job = data_service.find_job(1)
    assert found_job is not None
    
    # 检查缓存是否有数据
    cache_key = "job_1"
    assert cache_key in data_service._cache
    
    # 第二次查找任务（应该从缓存读取）
    found_job_from_cache = data_service.find_job(1)
    assert found_job_from_cache is not None
    assert found_job_from_cache["job_id"] == 1
    
    # 测试清除缓存
    data_service._clear_cache(cache_key)
    assert cache_key not in data_service._cache
    
    # 测试清除所有缓存
    data_service.find_job(1)  # 重新缓存
    assert cache_key in data_service._cache
    
    data_service._clear_cache()
    assert len(data_service._cache) == 0
