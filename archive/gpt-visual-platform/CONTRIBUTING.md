# 贡献指南

## 开发环境

- Go ≥ 1.22（编排服务）、Rust stable（Agent）、Python 3.10+（legacy 测试）

## 提交前必过

```bash
# Go（server/）
gofmt -w . && go vet ./... && go test -race ./...

# Rust（agent/）
cargo fmt && cargo clippy -- -D warnings && cargo test

# Python legacy
pytest tests/ -q

# 端到端（构建双端并跑通完整任务流程）
./scripts/e2e.sh
```

CI 会执行同样的检查（`.github/workflows/ci.yml`），任一失败将无法合并。

## 约定

- API 与 `data/` 文件格式需与 Python legacy 版保持兼容（见 `docs/规则文档.md`）；
  技能表改动需同步 `modules/skills.py` 与 `server/skills_gen.go`。
- 遵循各文档的目录与代码风格约定；新功能需带测试。
- 提交信息使用中文或英文均可，一行说明「做了什么、为什么」。
