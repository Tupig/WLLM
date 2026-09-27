"""
文件操作工具模块
提供文件读写、目录操作等通用功能
"""
import json
from pathlib import Path
from typing import Any


def ensure_directory(path: Path) -> None:
    """确保目录存在，如果不存在则创建

    Args:
        path: 目录路径
    """
    path.mkdir(parents=True, exist_ok=True)


def read_json_file(file_path: Path, default: Any = None) -> Any:
    """读取JSON文件

    Args:
        file_path: JSON文件路径
        default: 默认值，如果文件不存在或读取失败则返回

    Returns:
        文件内容或默认值
    """
    if not file_path.exists():
        return default

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"读取文件失败: {e}")
        return default


def write_json_file(file_path: Path, data: Any) -> bool:
    """写入JSON文件

    Args:
        file_path: JSON文件路径
        data: 要写入的数据

    Returns:
        是否写入成功
    """
    try:
        # 确保目录存在
        ensure_directory(file_path.parent)

        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"写入文件失败: {e}")
        return False


def read_text_file(file_path: Path, default: str = '') -> str:
    """读取文本文件

    Args:
        file_path: 文本文件路径
        default: 默认值，如果文件不存在或读取失败则返回

    Returns:
        文件内容或默认值
    """
    if not file_path.exists():
        return default

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        print(f"读取文件失败: {e}")
        return default


def write_text_file(file_path: Path, content: str) -> bool:
    """写入文本文件

    Args:
        file_path: 文本文件路径
        content: 要写入的内容

    Returns:
        是否写入成功
    """
    try:
        # 确保目录存在
        ensure_directory(file_path.parent)

        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    except Exception as e:
        print(f"写入文件失败: {e}")
        return False
