# rewrite-ts — 统一语言重写（mlx shell / proxy / bin → TS）

> PROCESS ④审查 + ⑥验收留痕。范围：mlx/ 5 shell + unified_proxy.py + test_unified_proxy.py + bin/ 6 薄壳 + config.env。
> 蓝本保真对译，测试先行，全量回归后删除旧文件（git 历史可回溯）。

## ④ 审查

### 1. proxy 转换层 src/proxy/convert.ts
- unified_proxy.py 4 转换函数 + textOf + STOP_MAP + BACKEND_MODEL 逐一对译
- pytest 31 用例先写红（tests/proxy-convert.test.ts），实现一次转绿
- max_tokens || 4096 对齐 python or 语义；uuid 位数对齐 python hex

### 2. proxy HTTP 层 src/proxy/server.ts
- node:http 对译：GET /health、GET /、POST 鉴权（MLX_AUTH_TOKEN）/协议检测（anthropic-version 头 / /responses 路径）/10MB 体限/400 无效 JSON/count_tokens 存根
- relay：非流式按协议转换回写；流式三路（anthropic SSE 状态机含 tool_use slot 与 usage、responses SSE、chat 直通）
- 新增 python 没有的集成测试 tests/proxy-server.test.ts（mock 后端 + 真实 http，10 用例）
- ECONNREFUSED 经 fetch 的 cause 透出，归入 502 backend error

### 3. 服务管理 src/cli/mlxcmd.ts
- mlx-local.sh/lib.sh/healthcheck.sh/model_utils.sh/metrics.sh 对译为单一入口 runMlxCmd
- models.json 查询由 python 内嵌改为 TS 直读（status/model list 不再起 python 子进程）
- 修复蓝本 bug：model_utils.sh 的 export MODEL_KEY 在 python 调用之后，download 永远拿不到 key（TS 直接传参）
- config.env 是 shell 语法且内容等于内置默认，删除；配置统一走环境变量
- 保留 python 生态：mlx_lm.server 进程、venv python 的 huggingface snapshot_download
- lsof/ps/sysctl/memory_pressure 仍为外部命令（macOS 原生），属进程诊断非语言逻辑
- 并发上限 1（24GB Metal OOM 约束）、120s 模型加载轮询、细粒度 stop 等待节奏与蓝本一致

### 4. bin 消除
- 6 薄壳删除；src/cli 六入口加 node shebang，tsc 输出保留，build script chmod +x
- ~/.local/bin 5 个链接原指向已废弃 ~/Workspace/LLM/bin（实际是坏链），重指本仓 dist/cli/*.js
- 修复 llm 入口守卫：symlink 下 import.meta.url（真实路径）不等于 argv[1]（链接路径），改 realpathSync 比对；其余 5 入口为无条件执行的纯入口

### 5. 调用方切换
- common.ensureService 动态 import mlxcmd（避免静态循环依赖），不再 spawnSync shell
- llm/mlx-local 分发从 passthrough 改 runMlxCmd；pilot/agentLocal 删 ensureMlxScript
- passthrough/mlxScript/ensureMlxScript/mlxHome(common) 已无调用方，一并删除

## ⑥ 验收（AC）

| AC | 结果 |
|----|------|
| pytest 31 用例平移 vitest 全过 | ✓ 31/31（tests/proxy-convert.test.ts） |
| proxy HTTP/relay 有测试覆盖 | ✓ 新增 10 用例（tests/proxy-server.test.ts），含流式与后端故障 |
| TS proxy 真实端到端（对 :8080 真模型） | ✓ 非流式三协议 + anthropic 流式 SSE 手测通过 |
| mlxcmd 对译冒烟 | ✓ status/model list/doctor/help 输出与蓝本一致，服务 PID 识别正确 |
| 链路命令可用 | ✓ llm status / mlx-local help 经 ~/.local/bin 新链走 dist 正常 |
| 回归门槛 | ✓ npx tsc --noEmit 0 错；npx vitest run 32 文件 381 用例全绿 |
| 文档同步 | ✓ PROCESS 门槛改 tsc+vitest；DIRECTORY 树/决议更新；INVENTORY 顶部现状注；mlx/README 更新 |
| 死文件清除 | ✓ bin/、5 shell、unified_proxy.py、test_unified_proxy.py、config.env、__pycache__ 已删 |

已知保留：mlx/venv、models、logs、state 为运行时目录（gitignore）；docs 历史盘点（ABSORPTION/INVENTORY/reviews）不改写，仅 INVENTORY 加现状注。
