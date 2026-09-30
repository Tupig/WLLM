---
name: gitingest
description: 快速吃透一个陌生仓库：结构优先、入口追起、测试锚定，避免全文通读
---

# 陌生仓库速读（gitingest 式）

## 五步顺序（禁则：不要从头读）

1. **骨架**：`ls` 根目录 → README（架构/命令）→ package.json / pyproject（脚本与依赖）
2. **入口**：bin/main/index/CLI 定义处，顺一条最短调用链读下去
3. **测试当文档**：挑 2-3 个测试文件看断言——测试是行为的真契约
4. **目录地图**：`RepoMap` 工具或 `find src -name '*.ts' | head -50` 建立心智模型
5. **定向读**：带着问题 grep（`Grep`/`Glob` 工具），只读命中文件的命中段落

## 抓手

- 配置即行为：env 变量、config schema、CI workflow 揭示真实约束
- TODO/FIXME/`issue #N` 注释指向未完事项
- CHANGELOG/git log 看演进方向（配套 git-log 技能）

## 输出物

读完应能回答：入口在哪、核心数据流、怎么跑测试、改动应落在哪个目录。
不能回答就继续定向读，不要开始猜。
