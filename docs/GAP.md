# 差距矩阵（C1）

> 基准：pilot 现状 × research/ 12 份调研。评级：缺失＝无实现；薄弱＝有雏形但低于调研水位；持平＝与主流开源相当；领先＝强于多数对象。

| 维度 | pilot 现状 | 调研对象做法（一格浓缩） | 评级 |
|---|---|---|---|
| 工具集 | 26 个工具；保留 8 件候选、E5 拟裁 18 件；无 todo/skill/question | opencode 14 件（含 skill/todowrite/question/lsp）<br>Cline 收敛 7 件、Roo 按模式分组<br>gemini：read_many_files/save_memory/activate_skill<br>claude：只读工具并行、写工具串行 | 薄弱 |
| 编辑机制 | FileEdit(106)/FileWrite 存在；自盘未记录匹配与失败反馈 | aider：SEARCH/REPLACE 精确回喂＋Did you mean＋只重发失败块<br>Roo apply_diff：行号＋Levenshtein＋连续错误计数<br>SWE-agent：edit 内嵌 linter、不合法拒落盘<br>opencode：apply_patch 文本落地 | 薄弱 |
| 权限审批 | permissions.ts 136 行简单分级，F3 待对照重做 | codex：untrusted/on-request/never＋Suggest/AutoEdit/FullAuto<br>claude：deny→ask→allow＋Tool(glob) 词边界<br>opencode：16 权限 key＋bash 模式最后命中胜<br>Qwen Code：五档＋自修改面强制复审；CodeBuddy auto 分类器 | 薄弱 |
| 上下文压缩 | compact 5 阶段流水线 316 行（F1/F2 待重做） | claude：5 层管线（工具结果预算/microcompact/auto-compact）<br>Qwen：warn/auto/hard 梯子＋失败熔断＋compress-fast<br>OpenHands Condenser：keep_first＋软硬双触发<br>Roo 非破坏性 condenseParent；opencode 隐藏 compaction agent | 持平 |
| 记忆 | 无 memory 模块（仅 session/rules/config） | claude：分层 CLAUDE.md＋auto memory 索引按需<br>Qwen：三层 QWEN.md＋四类自动记忆＋pinned＋/dream<br>Copilot：结构化条目带引用校验；Augment 先审后存<br>goose：两级 memory 落盘 | 缺失 |
| 技能 | 无 skills 模块（I2 规划） | opencode/claude：SKILL.md frontmatter＋三级渐进披露＋列表预算 1%<br>claude：注入后常驻、压缩重注入（单 5k/总 25k）<br>skills-selection：已选 8-12 个技能包 | 缺失 |
| 插件 hooks | hooks/system.ts 122＋plugins/index.ts 136（事件面未记录） | claude：20+ 事件、退出码 0/2、JSON permissionDecision<br>opencode：tool.execute.before/after、session.compacting 注入<br>Kiro：PreToolUse fail-closed（超时/崩溃一律 deny） | 薄弱 |
| 子代理 | subagent/index.ts 235 行 | claude：独立上下文＋工具掩码＋Explore/Plan＋worktree 隔离<br>opencode：文件即 agent、task deny 时工具不可见<br>Amp：专用 sub-agent 各配独立模型<br>Kimi：三内置子代理可后台持久 | 薄弱 |
| 多模型路由 | api.ts 三模式，E1 后只剩本地单模型；无路由 | RouteLLM/ACRouter：任务画像→选模型<br>Continue：模型角色制 chat/apply/summarize<br>aider：architect/editor 双模型<br>CodeBuddy：models.json 能力标记＋fallback | 缺失 |
| 提示词优化 | 无（E10 规划 /optimize） | prompt-optimizer：命令触发＋diff 确认＋最多 3 问＋特征清单改写<br>WorkBuddy：增强开关（不透明无 diff）<br>Cline/Roo：走 Plan 澄清而非静默改写 | 缺失 |
| 会话管理 | session/index.ts 183 行持久化＋/clear；无 checkpoint/undo/resume | claude：checkpoint＋/rewind 四动作、--resume/fork/worktree<br>gemini：shadow git＋Rewind 三档<br>Cline：checkpoints 三档恢复<br>opencode：/undo /redo；codex：resume | 缺失 |
| 流式 UX | REPL 经 QueryEngine 异步迭代器；bin/llm chat 非流式＋300s 超时（E7/E8） | claude：yield* 背压＋流式工具执行＋只读并发<br>Kimi：wire.jsonl 记完整请求轨迹<br>Plandex：--bg/ps/connect 后台任务 | 薄弱 |
| 沙箱 | 无（reasonix.toml 白名单属外部 reasonix，非 pilot） | codex：Seatbelt/Landlock 三级＋writable_roots<br>claude：OS sandbox＋autoAllowBashIfSandboxed<br>Qwen 容器 -s；OpenHands Docker 默认 | 缺失 |
| 校验自修复 | 有 lint 工具(131)却列为裁剪对象；无 auto-lint 循环 | aider：--auto-lint/--auto-test 默认开、错误回喂<br>SWE-agent：落盘前 linter 拦截<br>Kiro：Correctness 属性测试；Replit：浏览器自测 | 薄弱（且拟裁方向相反） |
| spec/计划工作流 | modes 169 行 plan/acceptEdits 雏形 | Kiro：spec 三件套＋依赖图 wave 并行<br>claude：plan 5 阶段＋allowedPrompts<br>Cline：plan/act 双模式<br>Devin：plan 落盘＋Ask/Agent；Plandex 计划版本分支 | 薄弱 |
| 搜索 | Glob/Grep(125) 保留；Web(196) 列为裁剪；无 repo 地图 | opencode：ripgrep 尊重 .gitignore<br>aider repo-map：tree-sitter 符号热度＋磁盘缓存＋token 预算<br>Cursor/Augment：语义索引（Merkle 增量）<br>codex --search 联网；SWE-agent 结果只列文件名、超量拒绝 | 薄弱 |
| 任务清单 | 无 todowrite 工具（当前手动 todo） | claude：TaskCreate/Update＋TaskCompleted hook 回滚<br>Cline Focus Chain：跨压缩保持进度<br>opencode todowrite：子代理默认禁用 | 缺失 |
| 轨迹可观测 | trajectory 296 行＋errors 244 行 | Kimi：wire.jsonl 落盘请求 schema<br>claude：/context /cost /doctor 体检<br>OpenHands：事件溯源可重放 | 持平 |

## 差距总结（按影响排序）

1. **权限＋沙箱双缺失**：本地小模型越权风险最高，却只有 136 行规则、零 OS/目录级隔离——所有写与命令操作都无硬安全网。
2. **编辑机制无失败反馈与写前拦截**：小模型生成精确 diff 最弱，aider/SWE-agent 的消融证明这块 ACI 投资提分最大，直接决定任务成功率。
3. **压缩 F1/F2 待重做却窗口更紧**：E2 把上下文压到 30k，但缺阈值梯子、非破坏性摘要、工具结果预算，长会话必撞墙。
4. **记忆与技能双零**：跨会话零积累、重复犯错，I1/I2 全靠新建。
5. **checkpoint/undo 缺失**：无本地 CI 时最廉价的安全网不存在，误改只能整段重来。
6. **自修复方向相反**：拟裁掉 lint 工具，缺 auto-lint 回喂循环。
7. **无本地模型 harness**：api.ts 只做协议转换，缺工具调用不稳时的 XML 注入等降级（Continue/Open Interpreter 均为开源模型定制）。
