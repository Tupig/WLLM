"""
文件工具模块测试
"""
import os
from pathlib import Path
from modules.utils.file_utils import (
    ensure_directory, read_json_file, write_json_file,
    read_text_file, write_text_file
)


def test_ensure_directory(tmp_path):
    """测试确保目录存在"""
    # 创建一个不存在的目录路径
    test_dir = tmp_path / "test" / "subdir"
    assert not test_dir.exists()
    
    # 调用函数确保目录存在
    ensure_directory(test_dir)
    assert test_dir.exists()
    assert test_dir.is_dir()
    
    # 再次调用函数，应该不会报错
    ensure_directory(test_dir)
    assert test_dir.exists()


def test_read_json_file(tmp_path):
    """测试读取JSON文件"""
    # 测试文件不存在的情况
    non_existent_file = tmp_path / "non_existent.json"
    assert not non_existent_file.exists()
    result = read_json_file(non_existent_file, {"default": "value"})
    assert result == {"default": "value"}
    
    # 测试文件存在的情况
    test_file = tmp_path / "test.json"
    test_data = {"key": "value", "number": 42}
    with open(test_file, 'w', encoding='utf-8') as f:
        f.write('{"key": "value", "number": 42}')
    
    result = read_json_file(test_file)
    assert result == test_data
    
    # 测试文件格式错误的情况
    invalid_file = tmp_path / "invalid.json"
    with open(invalid_file, 'w', encoding='utf-8') as f:
        f.write('invalid json')
    
    result = read_json_file(invalid_file, {"error": "invalid"})
    assert result == {"error": "invalid"}


def test_write_json_file(tmp_path):
    """测试写入JSON文件"""
    # 测试写入到不存在的目录
    test_file = tmp_path / "subdir" / "test.json"
    assert not test_file.parent.exists()
    
    test_data = {"key": "value", "number": 42}
    result = write_json_file(test_file, test_data)
    assert result is True
    assert test_file.exists()
    
    # 验证文件内容
    with open(test_file, 'r', encoding='utf-8') as f:
        content = f.read()
    assert '"key": "value"' in content
    assert '"number": 42' in content


def test_read_text_file(tmp_path):
    """测试读取文本文件"""
    # 测试文件不存在的情况
    non_existent_file = tmp_path / "non_existent.txt"
    assert not non_existent_file.exists()
    result = read_text_file(non_existent_file, "default")
    assert result == "default"
    
    # 测试文件存在的情况
    test_file = tmp_path / "test.txt"
    test_content = "Hello, world!"
    with open(test_file, 'w', encoding='utf-8') as f:
        f.write(test_content)
    
    result = read_text_file(test_file)
    assert result == test_content


def test_write_text_file(tmp_path):
    """测试写入文本文件"""
    # 测试写入到不存在的目录
    test_file = tmp_path / "subdir" / "test.txt"
    assert not test_file.parent.exists()
    
    test_content = "Hello, world!"
    result = write_text_file(test_file, test_content)
    assert result is True
    assert test_file.exists()
    
    # 验证文件内容
    with open(test_file, 'r', encoding='utf-8') as f:
        content = f.read()
    assert content == test_content
