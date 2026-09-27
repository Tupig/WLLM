# 目录定稿（D2）

> 最终树形。★=D3/T0/D2b 新增，其余已存在。运行时目录全部 gitignore。

```
WLLM/
├── AGENTS.md / CLAUDE.md          # 工作约定（中文）
├── reasonix.toml                  # reasonix 配置（路径已改 WLLM）
├── .gitignore                     # venv/ models/ logs/ state/ node_modules/ dist/ .reasonix/ .DS_Store *.bak …
│
├── bin/                           # CLI 入口
│   ├── llm / mlx-local            # 已有
│   ├── opencode-local / claude-local / codex-local   # 已有（第三方桥）
│   └── ★ pilot                    # D4：本地 agent 入口（服务拉起+node dist/index.js）
│
├── mlx/                           # 推理服务层（已有）
│   ├── mlx-local.sh / lib.sh / unified_proxy.py / healthcheck.sh …
│   ├── models/ venv/ logs/ state/ # 运行时（gitignore）
│   └── test_unified_proxy.py      # pytest 33 用例
│
├── ★ src/                         # D3：pilot-agent 源码（42 文件/7083 行）
│   ├── index.ts / QueryEngine.ts / Tool.ts / tools.ts / constants.ts
│   ├── services/（api→provider 抽象、permissions） tools/（8 件核心+裁剪归档）
│   ├── compact/ context/ cache/ budget/ state/ session/ subagent/
│   ├── ★ providers/               # E1：Local + Cloud 全协议
│   ├── ★ router.ts                # E9：难度分流
│   ├── ★ hooks/ plugins/ skills/ memory/   # I1-I3（或按调研定稿调整）
│   └── ★ checkpoint/ spec/ search/ todo/    # N3/N8/N9/N7
│
├── ★ package.json / tsconfig.json / vitest.config.ts   # T0
│
├── ★ skills/                      # I2：技能库（B8 的 8 包 + 自研）
│   └── <name>/SKILL.md
│
├── ★ gpt-visual-platform/         # D2b：Unity 测试平台归档（源码级，剔 .venv/dist/target 等产物）
│
├── docs/
│   ├── INVENTORY.md / PILOT_INVENTORY.md   # A1/A2
│   ├── PROCESS.md                 # 六步流程
│   ├── DIRECTORY.md               # 本文件（D2）
│   ├── GAP.md / ABSORPTION.md     # C1/C2
│   ├── research/（12 份）          # B1-B12
│   └── ★ reviews/                 # PROCESS ④⑥ 留痕（每功能一份）
│
└── （git：baseline→v3.0，origin=github.com:Tupig/WLLM）
```

## D2 决议记录

| 项 | 决议 |
|----|------|
| reasonix.toml filesystem 路径 | 已改 `/Users/tupig/Workspace/WLLM` |
| `.reasonix/` 任务状态 | gitignore（不入库） |
| `.DS_Store` | 已全清，gitignore 已有 |
| gpt-visual-platform | 子目录归档，剔产物（D2b），旧目录 G3+G4 后删 |
| pilot src | 拍平入根 `src/`（D3），历史 merge |
| 技能库 | `skills/` 一级目录（兼容 .claude/skills 布局） |
| 云端凭据 | 环境变量/本地配置，**永不入 git** |
| 旧 `~/Workspace/LLM` | 仅留环境垫片，H1 删除 |
