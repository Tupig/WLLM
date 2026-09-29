# 目录定稿（D2，随模块化重构更新）

> 最终树形。★=D3/T0/D2b 新增。运行时目录全部 gitignore。

```
WLLM/
├── AGENTS.md / CLAUDE.md          # 工作约定（中文）
├── package.json / tsconfig.json / vitest.config.ts
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
│   ├── proxy/                     # ★ 统一协议代理（convert 三协议转换 + server SSE relay）
│   ├── cli/                       # 6 个入口（shebang）+ common/mlxcmd（服务管理 TS 化）
│   └── git/ state/ utils/
│
├── tests/                         # vitest 32 文件 / 381 用例
│
├── mlx/                           # 推理服务层
│   ├── models/ venv/ logs/ state/ # 运行时（gitignore）
│   └── models.json / README.md    # 模型目录 + 说明（shell/py 已删，服务管理走 src/cli/mlxcmd.ts）
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
| `.DS_Store` | 已全清，gitignore 已有 |
| gpt-visual-platform | 归档移入 `archive/gpt-visual-platform/`（D2b 剔产物，根目录保持干净） |
| pilot src | 模块树两级（engine/session/context/knowledge/modes/agents/commands…），根仅 index.ts+config.ts |
| bin 启动器 | 已消除：入口=src/cli/*.ts（node shebang），package.json bin → dist/cli/*.js，`~/.local/bin` 直链 dist |
| mlx 服务层 | 5 shell + unified_proxy.py → `src/cli/mlxcmd.ts` + `src/proxy/`（pytest 31 用例平移 vitest），config.env 删除（配置走环境变量） |
| 技能库 | `.wllm/skills/`（运行时，先审后存）+ `src/knowledge/skills.ts`（披露与门禁） |
