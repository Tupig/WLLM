# 功能吸收清单（C2）

> 过两关：本地 Qwen 14B/8B 能驱动、TS 单机可实现，否则入第三节。缩写 ev=evolution｜ss=技能选型｜po=提示词优化；归属 N1-N12 见第四节，E6/E9 无定义。

## 一、已规划项（E / F / I）

| ID | 功能 | 来源 | 解决 | 落点 | 适配 | 优先 | 归属 |
|---|---|---|---|---|---|---|---|
| E1 | 删 anthropic SDK、门禁 :4100 | 自盘 | 免云端 | api.ts | 高 | P0 | E1 |
| E2 | 常量对齐 30k/1.8M/model | 自盘 | 适配本地 | constants.ts | 高 | P0 | E2 |
| E3 | 修 BUG-1 工具调用卡死 | 自盘 | 主链路 | QueryEngine.ts | 高 | P0 | E3 |
| E4 | healthcheck 自动降级 8b | 自盘 | 抗 OOM | healthcheck.sh | 高 | P1 | E4 |
| E5 | 工具裁 8 件＋延迟装载 | 自盘 | 防稀释 | tools.ts | 高 | P1 | E5 |
| E7/E8 | bin/llm 流式＋超时对齐 | 自盘 | 体验一致 | bin/llm | 高 | P1 | E7/E8 |
| E10 | /optimize：diff 确认＋3 问 | po | 输入可执行 | optimizer | 中·不迭代 | P1 | E10 |
| F1/F2 | 压缩流水线重做 | 自盘 | 不撞墙 | compact/ | 高 | P0 | F1/F2 |
| F3 | 权限分级对照 codex 重做 | 自盘 | 安全底座 | permissions.ts | 高 | P0 | F3 |
| I1 | 分层记忆＋MEMORY＋失败卡 | Claude、ev | 跨会话积累 | memory/ | 高·纯 md | P1 | I1 |
| I2 | 技能库 SKILL.md 渐进披露 | opencode、ss | 省上下文 | skills/ | 高 | P1 | I2 |
| I3 | 插件 hooks 事件化 | opencode、Claude | 确定控制 | hooks/ | 高 | P1 | I3 |
| I4 | Reflexion＋review 代理 | ev | 不重犯 | .wllm/runs | 中·用退出码 | P2 | I4 |

## 二、新吸收项（A）

| ID | 功能 | 来源 | 解决 | 落点 | 适配 | 优先 | 归属 |
|---|---|---|---|---|---|---|---|
| A1 | 编辑失败回喂＋Levenshtein 模糊匹配 | aider、Roo | diff 弱 | FileEdit.ts | 高·规则 | P0 | N1 |
| A2 | 写前 linter 拦截、拒落盘 | SWE-agent | 不进坏盘 | FileEdit | 高·免自评 | P0 | N1 |
| A3 | auto-lint 回喂＋反转裁 lint | aider | 自验证 | QueryEngine＋lint | 高·退出码 | P0 | N2 |
| A4 | auto-commit＋/rewind 三档 | aider、Cline | 可回滚 | git/＋checkpoint/ | 高 | P0 | N3 |
| A5 | 会话 resume/fork | codex、Claude | 可续 | session/＋repl | 高 | P1 | N4 |
| A6 | deny→ask→allow＋glob | Claude、opencode | 硬执行 | permissions.ts | 高 | P0 | F3 |
| A7 | 五档审批＋自修改面复审＋人工触发 | Qwen、Trae | 防自改 | permissions＋modes | 高 | P0 | F3 |
| A8 | 目录白名单＋审批分类器 | codex、Qwen | 越界兜底 | sandbox/ | 中·非系统级 | P1 | N5 |
| A9 | hooks 退出码 0/2＋fail-closed | Claude、Kiro、opencode | 确定性 | hooks/ | 高 | P0 | I3 |
| A10 | 分层记忆＋就近注入＋@path | Claude、opencode | 规则落位 | context/＋rules/ | 高·零成本 | P0 | I1 |
| A11 | 记忆先审后存＋引用校验 | Augment、Cursor | 防污染 | memory/ | 高 | P1 | I1 |
| A12 | skill 披露预算＋三重门禁＋技能包 | Claude、ss | 省上下文 | skills/＋index | 高 | P0 | I2 |
| A13 | 阈值梯子＋熔断＋隐藏 agent | Qwen、opencode | 压缩稳 | compact/ | 高 | P0 | F1/F2 |
| A14 | 非破坏性压缩＋keep_first＋结果预算 | Roo、OpenHands、Claude | 可回卷 | compact/ | 高 | P0 | F1/F2 |
| A15 | 子代理独立上下文＋工具掩码＋agent 文件 | Claude、opencode | 读取外包 | subagent/ | 高·上下文贵 | P0 | N6 |
| A16 | 任务清单＋Focus Chain | Claude、Cline | 进度不丢 | todo 工具 | 高 | P1 | N7 |
| A17 | Plan 5 阶段＋spec 三件套 | Claude、Kiro | 想错别动 | modes/＋spec/ | 中·需编排 | P1 | N8 |
| A18 | 搜索限量＋repo-map 符号索引 | SWE-agent、aider | 知结构 | search/＋repo-map | 中·大仓 | P1 | N9 |
| A19 | 保留 Web 检索＋question 工具 | opencode、Cline | 查外部先问 | Web＋Question | 高 | P1 | E5 |
| A20 | XML 工具注入＋专属 harness＋Ralph | Continue、Kimi | 工具不稳 | api.ts | 高·刚需 | P0 | N10 |
| A21 | doom_loop 恢复＋steps 上限 | opencode | 防卡死 | QueryEngine.ts | 高 | P0 | E3 |
| A22 | /review /init /doctor＋轨迹/事件 | codex、Kimi、OpenHands | 可调试 | repl＋diag＋events | 高 | P1 | N11 |
| A23 | routelog 画像选型＋模型角色制 | ev、Continue | 多模型 | router | 中·双模型 | P2 | N12 |
| A24 | 复盘写回＋review 代理四选一 | Devin、Hermes | 自动沉淀 | 退出钩子 | 中 | P1 | I4 |

## 三、暂不吸收

| 功能 | 来源 | 理由 |
|---|---|---|
| MCP 全量接入/市场 | Claude、Cline | 本地集成需求弱 |
| 语义全仓索引 | Cursor、Augment | 内存吃紧，grep 够用 |
| 云端 VM/托管/Orbs | Copilot、Amp | 与本地单机冲突 |
| computer use/浏览器/生图 | Replit、Trae | 依赖视觉模型 |
| agent teams/workflows/teleport | Claude | 多实例＋云端，14B 不稳 |
| IM 机器人/daemon 分发 | Qwen、iFlow | 非核心路径 |
| 训练式路由/OPRO | ev、po | 自迭代已被证伪 |
| 发送前静默改写 prompt | WorkBuddy | 不可归因 |
| 已关停 agent 新版 | 调研备注 | 仅取可迁移机制 |

## 四、建议新增的 todo 项汇总

- N1 编辑加固：回喂、模糊匹配、lint（A1、A2）
- N2 lint 自修复：auto-lint 回喂（A3）
- N3 checkpoint 回滚：auto-commit、/rewind（A4）
- N4 会话 resume/fork（A5）
- N5 沙箱近似：白名单＋writable_roots（A8）
- N6 子代理强化：独立上下文、文件即 agent（A15）
- N7 任务清单：todo＋Focus Chain（A16）
- N8 计划与 spec：Plan 5 阶段、spec 三件套（A17）
- N9 repo 地图：符号索引、结果限量（A18）
- N10 本地 harness：XML 注入、专属 loop（A20）
- N11 命令与诊断：/review /init /doctor（A22）
- N12 路由骨架：routelog＋角色制（A23）
