#!/usr/bin/env bash
# ==============================================================================
#  mlx-local 模型管理模块
# ==============================================================================

# 加载共享库
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

cmd_model() {
  local action="${1:-list}"
  local key="${2:-}"

  case "$action" in
    list)
      cmd_model_list
      ;;
    info)
      [ -z "$key" ] && die "用法: mlx-local model info <模型别名>"
      cmd_model_info "$key"
      ;;
    download)
      [ -z "$key" ] && die "用法: mlx-local model download <模型别名>"
      cmd_model_download "$key"
      ;;
    remove)
      [ -z "$key" ] && die "用法: mlx-local model remove <模型别名>"
      cmd_model_remove "$key"
      ;;
    *)
      die "未知操作: $action (可用: list, info, download, remove)"
      ;;
  esac
}

cmd_model_list() {
  echo "可用模型"
  echo

  # 读取models.json
  if [ ! -f "$MLX_HOME/models.json" ]; then
    die "models.json 不存在"
  fi

  "$MLX_HOME/venv/bin/python" -c "
import json
with open('$MLX_HOME/models.json') as f:
    data = json.load(f)

import os
models_dir = '$MODELS'

for key, info in data['models'].items():
    name = info['name']
    size = info.get('size', '?')
    desc = info.get('description', '')
    alias = info.get('alias', key)

    # 检查是否已下载
    model_path = os.path.join(models_dir, name)
    downloaded = os.path.isdir(model_path)
    status = '[✓]' if downloaded else '[ ]'

    print(f'  {status} {alias:<12} {name:<45} {size:<8} {desc}')

print()
print('状态: [✓] 已下载  [ ] 未下载')
"
}

cmd_model_info() {
  local key="$1"

  # 验证模型别名
  local model_dir
  model_dir="$(model_dir_for "$key")"
  if [ -z "$model_dir" ]; then
    die "未知模型别名: $key"
  fi

  # 检查目录是否存在
  if [ ! -d "$MODELS/$model_dir" ]; then
    echo "模型目录不存在: $MODELS/$model_dir"
    echo "使用 'mlx-local model download $key' 下载"
    return 1
  fi

  # 获取模型信息
  echo "模型信息: $key"
  echo "────────────────────────────────────────────────"
  echo "  目录: $MODELS/$model_dir"

  # 统计文件数量和大小
  local file_count total_size
  file_count=$(find "$MODELS/$model_dir" -type f | wc -l | tr -d ' ')
  total_size=$(du -sh "$MODELS/$model_dir" 2>/dev/null | cut -f1)
  echo "  文件数: $file_count"
  echo "  总大小: $total_size"

  # 检查模型文件
  echo "  模型文件:"
  find "$MODELS/$model_dir" -maxdepth 1 -name "*.safetensors" -o -name "*.gguf" -o -name "*.mlx" | while read -r f; do
    local fname size
    fname=$(basename "$f")
    size=$(ls -lh "$f" | awk '{print $5}')
    echo "    - $fname ($size)"
  done
}

cmd_model_download() {
  local key="$1"

  # 验证模型别名
  local model_dir
  model_dir="$(model_dir_for "$key")"
  if [ -z "$model_dir" ]; then
    die "未知模型别名: $key"
  fi

  # 检查目录是否已存在
  if [ -d "$MODELS/$model_dir" ]; then
    echo "模型目录已存在: $MODELS/$model_dir"
    echo "如需重新下载，请先删除: mlx-local model remove $key"
    return 0
  fi

  # 获取HuggingFace仓库
  local hf_repo
  hf_repo=$("$MLX_HOME/venv/bin/python" -c "
import json, sys, os
key = os.environ.get('MODEL_KEY')
with open('$MLX_HOME/models.json') as f:
    data = json.load(f)
if key not in data['models']:
    print(f'未知模型: {key}', file=sys.stderr)
    sys.exit(1)
info = data['models'][key]
if info.get('size_warning'):
    print(f'WARNING:{info[\"size_warning\"]}', file=sys.stderr)
print(info['huggingface'])
" 2>&1)
      local py_exit=$?
      export MODEL_KEY="$key"

      if [ $py_exit -ne 0 ]; then
        echo "$hf_repo" >&2
        return 1
      fi

  local target_dir="$MODELS/$model_dir"
  echo "下载模型: $key ($hf_repo)"
  echo "目标目录: $target_dir"
  echo

  # 下载模型
  "$MLX_HOME/venv/bin/python" -c "
import sys
from huggingface_hub import snapshot_download

try:
    path = snapshot_download(
        '$hf_repo',
        local_dir='$target_dir',
        resume_download=True,
        max_workers=4
    )
    print(f'下载完成: {path}')
except Exception as e:
    print(f'下载失败: {e}', file=sys.stderr)
    sys.exit(1)
"
  local exit_code=$?

  if [ $exit_code -eq 0 ]; then
    log "模型下载完成: $model_dir"
  else
    die "模型下载失败（退出码: $exit_code）"
  fi
}

cmd_model_remove() {
  local key="$1"

  # 验证模型别名
  local model_name
  model_name=$("$MLX_HOME/venv/bin/python" -c "
import json, sys, os
key = os.environ.get('MODEL_KEY')
with open('$MLX_HOME/models.json') as f:
    data = json.load(f)
if key not in data['models']:
    print(f'未知模型: {key}', file=sys.stderr)
    sys.exit(1)
print(data['models'][key]['name'])
" 2>&1)
      local py_exit=$?
      export MODEL_KEY="$key"

      if [ $py_exit -ne 0 ]; then
        echo "$model_name" >&2
        return 1
      fi

  local model_dir="$MODELS/$model_name"
  if [ ! -d "$model_dir" ]; then
    echo "模型目录不存在: $model_dir"
    return 1
  fi

  # 检查是否正在使用
  local current_key
  current_key="$(cat "$STATE/current_model" 2>/dev/null || echo '')"
  if [ "$current_key" = "$key" ]; then
    die "不能删除正在使用的模型，请先切换到其他模型"
  fi

  # 确认删除
  echo "将删除模型: $key ($model_name)"
  echo "目录: $model_dir"
  echo
  read -r -p "确认删除？(y/N): " confirm
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "已取消"
    return 0
  fi

  # 删除目录
  rm -rf "$model_dir"
  log "模型已删除: $model_name"
}

# 如果直接运行此脚本
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  cmd_model "$@"
fi
