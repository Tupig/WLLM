# 目录定稿（D2，随模块化重构更新）

> 最终树形。★=D3/T0/D2b 新增。运行时目录全部 gitignore。

```
WLLM/
├── AGENTS.md / CLAUDE.md          # 工作约定（中文）
├── reasonix.toml                  # reasonix 配置（路径已改 WLLM）
├── package.json / tsconfig.json / vitest.config.ts
├── .gitignore                     # venv/ models/ logs/ state/ node_modules/ dist/ .reasonix/ .DS_Store *.bak …
│
├── bin/                           # CLI 薄壳（3-5 行，实现见 src/cli/）
│   ├── pilot / llm                # 主入口 / 本地大模型 CLI
│   └── mlx-local / opencode-local / claude-local / codex-local   # 第三方桥
│
├── src/                           # pilot-agent 源码（模块树，全 TS / UTF-8）
│   ├── index.ts / config.ts       # CLI 入口 + 全局配置
│   ├── engine/                    # 主链路：QueryEngine prompt Tool toolRegistry router harness…
│   ├── tools/                     # 工具实现（20+）
│   ├── services/                  # api bashSafety permissions sandbox failover
│   ├── session/                   # session sessionState checkpoint trajectory
│   ├── context/                   # compact/ budget cache rules repomap
│   ├── knowledge/                 # memory skills reflexion（知识沉淀）
│   ├── modes/                     # plan/act + spec
│   ├── agents/                    # 子代理（原 subagent）
│   ├── commands/                  # /doctor /init /review + REPL
│   ├── cli/                       # bin 启动器 TS 实现（pilot llm *-local）
│   └── git/ state/ utils/
│
├── tests/                         # vitest 30 文件 / 339 用例
│
├── mlx/                           # 推理服务层（已有）
│   ├── mlx-local.sh / lib.sh / unified_proxy.py / healthcheck.sh …
│   ├── models/ venv/ logs/ state/ # 运行时（gitignore）
│   └── test_unified_proxy.py      # pytest 31 用例
│
├── archive/
│   └── ★ gpt-visual-platform/     # D2b：Unity 测试平台归档（源码级，剔 .venv/dist/target 等产物）
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
| gpt-visual-platform | 归档移入 `archive/gpt-visual-platform/`（D2b 剔产物，根目录保持干净） |
| pilot src | 模块树两级（engine/session/context/knowledge/modes/agents/commands…），根仅 index.ts+config.ts |
| bin 启动器 | shell 全部 TS 化到 `src/cli/`，bin/ 只留薄壳 |
| 技能库 | `.wllm/skills/`（运行时，先审后存）+ `src/knowledge/skills.ts`（披露与门禁） |
