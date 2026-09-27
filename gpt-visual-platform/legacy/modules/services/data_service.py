"""
数据存储服务模块
处理数据的加载和保存
"""
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional, Any

from modules.utils.file_utils import (
    read_json_file, write_json_file,
    read_text_file, write_text_file
)


class DataService:
    """数据存储服务类"""

    def __init__(self, data_dir: Path):
        """初始化数据存储服务

        Args:
            data_dir: 数据目录路径
        """
        self.data_dir = data_dir
        self.runs_dir = data_dir / "runs"

        # 确保目录存在
        self._ensure_directories()

        # 数据文件路径
        self.agents_file = self.data_dir / "agents.json"
        self.jobs_file = self.data_dir / "jobs.json"
        self.job_id_file = self.data_dir / "job_id.txt"

        # 内存中的数据
        self.agents: Dict[str, dict] = {}
        self.jobs: List[dict] = []
        self.job_id = 0

        # 缓存机制
        self._cache: Dict[str, Any] = {}
        self._cache_expiry: Dict[str, float] = {}
        self._cache_lock = threading.Lock()

        # 线程锁，确保数据一致性
        self._lock = threading.RLock()

        # 初始化加载数据
        self.load_data()

    def _ensure_directories(self) -> None:
        """确保数据目录存在"""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.runs_dir.mkdir(parents=True, exist_ok=True)

    def load_data(self) -> None:
        """加载数据"""
        with self._lock:
            # 加载agents
            self.agents = read_json_file(self.agents_file, {})

            # 加载jobs
            self.jobs = read_json_file(self.jobs_file, [])

            # 加载job_id
            job_id_str = read_text_file(self.job_id_file, "0")
            try:
                self.job_id = int(job_id_str)
            except ValueError:
                # 如果读取失败，从jobs列表中计算最大的job_id
                if self.jobs:
                    self.job_id = max(
                        job.get("job_id", 0) for job in self.jobs
                    )
                else:
                    self.job_id = 0
                # 保存计算出的job_id
                write_text_file(self.job_id_file, str(self.job_id))

    def save_data(self) -> bool:
        """保存数据

        Returns:
            是否保存成功
        """
        with self._lock:
            # 保存agents
            agents_saved = write_json_file(self.agents_file, self.agents)

            # 保存jobs
            jobs_saved = write_json_file(self.jobs_file, self.jobs)

            # 保存job_id
            job_id_saved = write_text_file(self.job_id_file, str(self.job_id))

            # 清除缓存
            self._clear_cache()

            return agents_saved and jobs_saved and job_id_saved

    def next_job_id(self) -> int:
        """获取下一个任务ID

        Returns:
            下一个任务ID
        """
        with self._lock:
            self.job_id += 1
            # 立即保存job_id，确保即使服务重启也能保持连续性
            write_text_file(self.job_id_file, str(self.job_id))
            return self.job_id

    def save_job(self, job: dict) -> bool:
        """保存单个任务到文件

        Args:
            job: 任务数据

        Returns:
            是否保存成功
        """
        job_file = self.runs_dir / f"job_{job['job_id']}.json"
        result = write_json_file(job_file, job)

        # 清除相关缓存
        self._clear_cache(f"job_{job['job_id']}")

        return result

    def find_job(self, job_id: int) -> Optional[dict]:
        """按job_id查找任务

        Args:
            job_id: 任务ID

        Returns:
            任务数据或None
        """
        cache_key = f"job_{job_id}"

        # 检查缓存
        cached_job = self._get_cache(cache_key)
        if cached_job:
            return cached_job

        # 从内存中查找
        job = next((j for j in self.jobs if j["job_id"] == job_id), None)

        # 从文件中查找（如果内存中没有）
        if not job:
            job_file = self.runs_dir / f"job_{job_id}.json"
            job = read_json_file(job_file, None)

        # 存入缓存
        if job:
            self._set_cache(cache_key, job)

        return job

    def _get_cache(self, key: str) -> Optional[Any]:
        """获取缓存数据

        Args:
            key: 缓存键

        Returns:
            缓存数据或None
        """
        with self._cache_lock:
            if key in self._cache:
                # 简单的缓存过期检查（这里使用固定过期时间）
                if time.time() - self._cache_expiry.get(key, 0) < 300:  # 5分钟过期
                    return self._cache[key]
                else:
                    # 缓存过期，删除
                    del self._cache[key]
                    del self._cache_expiry[key]
            return None

    def _set_cache(self, key: str, value: Any) -> None:
        """设置缓存数据

        Args:
            key: 缓存键
            value: 缓存值
        """
        with self._cache_lock:
            self._cache[key] = value
            self._cache_expiry[key] = time.time()

    def _clear_cache(self, key: Optional[str] = None) -> None:
        """清除缓存

        Args:
            key: 缓存键，如果为None则清除所有缓存
        """
        with self._cache_lock:
            if key:
                if key in self._cache:
                    del self._cache[key]
                if key in self._cache_expiry:
                    del self._cache_expiry[key]
            else:
                self._cache.clear()
                self._cache_expiry.clear()

    def get_jobs_by_status(self, status: str) -> List[dict]:
        """按状态获取任务

        Args:
            status: 任务状态

        Returns:
            符合条件的任务列表
        """
        return [job for job in self.jobs if job.get("status") == status]

    def get_agents_by_platform(self, platform: str) -> List[dict]:
        """按平台获取Agent

        Args:
            platform: 平台名称

        Returns:
            符合条件的Agent列表
        """
        return [agent for agent in self.agents.values()
                if agent.get("platform") == platform]
