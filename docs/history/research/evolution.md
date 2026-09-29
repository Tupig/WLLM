# AI agent 进化机制：跨会话积累与自我改进调研

调研方式：websearch/webfetch 实搜（含 2025–2026 资料）。每条给出来源、实现方式、对本地小模型 agent（MLX/Qwen 小参）的可落地性。

## 一、记忆系统

**1. Claude Code 分层 CLAUDE.md + auto memory**（来源：code.claude.com/docs/en/memory）
实现：CLAUDE.md 从 cwd 逐级向上拼接（根→cwd，越近越后读=优先级越高），`/init` 生成；`.claude/rules/*.md` 支持 `paths:` frontmatter，读到匹配文件才加载。auto memory 由 agent 自写，存 `~/.claude/projects/<git-root>/memory/`，`MEMORY.md` 是索引（启动只载前 200 行/25KB），细节放 topic 文件按需读；触发时机=用户纠正或 agent 判定"未来有用"。subagent 有独立记忆目录。compaction 后项目根 CLAUDE.md 与 auto memory 从磁盘重新注入。
可落地：**高** —— 纯 markdown + 按需读，小模型只需会写条目。

**2. opencode AGENTS.md**（opencode.ai/docs/rules、/v2/docs/instructions）
实现：启动①从 cwd 向上取第一个 `AGENTS.md`（v2 继续向上至 home）②全局 `~/.config/opencode/AGENTS.md` ③兼容 `~/.claude/CLAUDE.md`；`instructions` 数组可挂额外文件/glob/远程 URL（5s 超时）；嵌套 AGENTS.md 在 agent 探索读文件时"就近注入+去重"，编辑后不自动重载。`/init` 扫描仓库生成。**未获取**到 opencode 官方的 agent 自写记忆功能。
可落地：**高**。

**3. MemGPT / Letta**（arxiv 2310.08560；letta docs）
实现：main context（system/working context/FIFO）与 external（recall 全量对话、archival 向量库）分层；agent 用 `core_memory_replace/append`、`archival_memory_insert/search`、`conversation_search` 自我编辑；队列管理器在 ~70% token 发警告、100% 触发递归摘要 flush，检索带分页。新版 Letta：memory blocks 落 git 仓库（MemFS），另有 sleep-time/dreaming 后台代理离线改写。
可落地：**中** —— 自编辑工具+分页好仿，完整 OS 式调度成本高。

**4. mem0**（arxiv 2504.19413；docs.mem0.ai）
实现：写入异步六段：LLM 单次抽取（ADD-only，不改不删）→hash 查重→embed→实体链接→时间元数据；三存储（向量/实体图/SQL 历史）。检索时语义+BM25+实体+时间意图四路并行打分融合。LoCoMo 92.5，p95 延迟比全上下文低 91%、token 省 90%。
可落地：**中** —— 需 embedding 模型+抽取调用，可换本地模型但流水线偏重。

**5. goose**（block-goose docs；dev.to 实践文）
实现：两层。静态 hints 文件每次请求全量注入；Memory 扩展是 MCP 工具 `store_memory/retrieve_memory`，按 category+tags 存 `~/.config/goose/memory/global/`（全局）与 `<repo>/.goose/memory/`（本地），会话前解析关键词命中 tag 才注入对应条目。
可落地：**高**。

**6. Cursor Rules / Memories**（cursor.com/docs/rules、changelog 0.49）
实现：`.cursor/rules/*.mdc` frontmatter 四类加载（alwaysApply 常驻 / globs 匹配文件才载 / description 由 agent 自判 / @手动），Team→Project→User 合并；`/Generate Cursor Rules` 从当前对话直接产出规则文件；Memories=从聊天自动生成的事实，按仓库管理，Privacy Mode 下不可用。
可落地：**高**。

## 二、技能积累

**1. SKILL.md 按需加载**（code.claude.com/docs/en/skills；anthropic engineering；opencode docs/skills）
实现：三级渐进披露——L1 只有 name+description（约 100 token/个）常驻 system prompt；L2 触发时才把正文读进上下文；L3 references 按需读、scripts 执行（只有输出进上下文）。Claude Code 额外有 `disable-model-invocation`、`user-invocable`、`model` 覆盖、`context: fork`。opencode 搜索 `.opencode/skills`、`~/.config/opencode/skills`、`.claude/skills`、`.agents/skills`（含向上遍历到 worktree），并有 allow/ask/deny 权限。
可落地：**高** —— 小模型省上下文的核心手段。

**2. Anthropic skills 官方仓库 + skill-creator**（github/anthropics/skills）
实现：一技能一目录，frontmatter 仅 name/description 必填，description≤1024 字符且必须"做什么+何时用"（正文写 when-to-use 无效）；SKILL.md <500 行，超出拆 `references/`（>300 行加目录），`scripts/` 做确定性重复劳动。skill-creator 自带触发评测（20 条 should/should-not trigger）+ 描述优化 + init/package 脚本；其经验：若 3 个测试用例里 agent 都重写了同类脚本，就把该脚本固化进 `scripts/`。
可落地：**高**（写法规范）/ 中（触发评测需批跑）。

**3. aider CONVENTIONS.md**（aider.chat/docs/usage/conventions；github/aider-ai/conventions）
实现：`--read CONVENTIONS.md` 或 `.aider.conf.yml: read:[...]` 每会话只读注入并吃 prompt cache；社区仓库提供模板。"自学习"无内置实现，靠用户让 aider 分析仓库/本次会话后写回该文件，持久化交给第三方（Mnemonic、Kit 等）。
可落地：**高**。

## 三、自我改进循环（重点）

**1. Reflexion**（arxiv 2303.11366）
实现：Actor→Evaluator（二分/启发式/自评三种信号）→失败即让 Self-Reflection 生成自然语言教训，存入 episodic memory（历史上限 1–3 条），下一次 trial 前拼进 prompt。核心是把标量奖励"放大"成可执行文本；HumanEval pass@1 91%。
可落地：**高** —— 有测试/lint 退出码即可，无需训练。

**2. Self-Refine**（NeurIPS 2023）
实现：同一模型 generate→feedback→refine 循环，历史 feedback 与输出追加进 prompt 直到停止条件；7 任务平均 +20%。纯会话内，不跨会话。
可落地：**高**。

**3. AIDE**（arxiv 2502.13138；github/WecoAI/aideml）
实现：解法树（节点=脚本，边=一次改进），硬编码搜索策略选 draft/debug/improve；improve 只允许一个"原子"改动以便归因；每次调用注入 `journal.generate_summary()` 摘要而非原始日志；执行结果由 feedback 模型给出 metric/is_bug。MLE-Bench 上树搜索奖牌数约为线性 agent 的 4 倍。
可落地：**中** —— 强依赖可执行指标。

**4. AgentEvolver**（arxiv 2511.10395，阿里 Tongyi）
实现：self-questioning（好奇心探索环境自造任务）→并行 rollout→experience summarization（把轨迹压成 skills/tactics/failure notes，建索引后下次 rollout 作 ICL 检索）→self-attributing（步级 credit，ADCA-GRPO 训练）。7B/14B 相对基线 +29.4%/+27.8%。
可落地：**低**（RL 训练部分）；其中"经验池+ICL 检索"**高**，可直接抄。

**5. GitHub Copilot agentic memory**（2026 公开预览；arinco 博客转述官方）
实现：结构化条目 `{subject, fact, citations[文件:行], reason}`，由 Coding Agent/Code Review/CLI 在工作中发现；**使用前先对照当前代码库校验**（自愈：过期条目自动失效）；repo owner 在 Settings→Copilot→Memory 审阅。
可落地：**高** —— 纯文件条目+引用校验，最适合本地 agent。

**6. Devin Knowledge / Playbooks**（docs.devin.ai；cognition.com 博客）
实现：每条 knowledge 必须有 trigger 描述，按上下文相关性检索而非全量注入，可 pin 到单 repo/全部；Devin 会**根据聊天反馈自动建议**新知识（可编辑/拒绝/重生成），并从 README、`.cursorrules`、`CLAUDE.md`、`AGENTS.md` 等自动生成 repo knowledge；playbook 是带版本历史的可复用任务 prompt。高级能力支持"分析会话成败→提炼教训→生成/修订 playbook、去重冲突知识"，可用定时会话每周跑知识维护。
可落地：**高/中** —— trigger 检索与自动建议都能本地实现。

**7. 规则自生成（Cursor 与社区）**
实现：`/Generate Cursor Rules` 把当前对话沉淀成 `.mdc`；Memories 自动生成；社区"自学习 meta-rule"规定出错时写根因+正确解并存进 `.cursor/rules/registry/`（agent_requested 类型按 description 自取）。
可落地：**高**。

**8. Letta sleep-time / dreaming**（letta.com/blog/sleep-time-compute；arxiv 2504.13171；letta docs）
实现：空闲期离线推理，把原始 context c 重写为 learned context c'，测试时只读 c'（同准确率下测试算力降约 5×）。落地为双 agent：主代理无 memory 编辑工具，sleep-time 代理独占编辑权、异步改写 memory blocks；新版 dreaming 支持 trigger=step-count/compaction-event、behavior=auto-launch 后台整理。
可落地：**中** —— 本地可在会话结束后跑一次整理，成本可控。

**9. "agent 写技能给未来的自己"**
- skillcam：读 `~/.claude/projects/` 会话日志→轻量 judge 先判有无可复用模式（无则短路）→强模型产出严格 JSON→渲染 `SKILL.md` 落 `~/.claude/skills/`，写前用 Jaro-Winkler 相似度去重（阈值 0.80）。
- AutoSkill（ECNU）：从对话/轨迹抽技能，有 discard/improve/merge/create 四决策与版本演进（v0.1.0→v0.1.1），SkillEvo 做 replay-eval-mutate-promote。
- self-learning-skills（Kula）：**三重门禁**——通过校验（测试/绿灯）+命名失败模式+排除过至少一条死路，全满足才升为 skill，否则只留 MEMORY 一行笔记。
- Hermes agent：turn 结束后 fork 一个只带 memory/skill 管理工具的后台 review 代理，问"是否该存/改技能或记忆"，直接写存储。
可落地：**高** —— 最契合本地小模型的进化形态。

## 四、路由 / 任务画像学习

**1. RouteLLM**（arxiv 2406.18665；lmsys 博客；github/lm-sys/RouteLLM）
实现：偏好数据训练 router（Arena 80k 战绩聚成 10 档；或 golden 标签、GPT-4 judge 标注 120k 条约 $700），四种：矩阵分解、BERT 分类、因果 LLM 分类、sw_ranking（query embedding 与训练集余弦相似度加权的 Bradley-Terry，推理时求解、免训练）。输出强模型胜率与 cost threshold 比较决定路由；可达 95% GPT-4 质量下省 85% 成本。
可落地：**中** —— sw_ranking/mf 本地可跑，但需本地偏好数据。

**2. ACRouter / Agent-as-a-Router**（arxiv 2606.22902，2026）
实现：C-A-F 循环（Context→Action→Feedback）；Memory 是向量库，key=任务 embedding，value=所选模型/性能/成本/验证轨迹，FIFO 2 万条；Orchestrator 取维度先验 + top-10 近邻 + 微调 Qwen3.5-0.8B 策略与规则加权投票。关键结论：路由瓶颈是**信息不足**而非推理不足（仅加性能统计即 +15.3%）。已提供 Claude Code Router / cc-switch 网关集成。
可落地：**中高** —— 0.8B 策略模型+向量记忆，本地完全可仿。

**3. TRACE-Router**（arxiv 2607.22465，2026）
实现：任务级而非 per-call 路由——contextual bandit 在任务受理时选一次模型并 pin 全程调用，用任务终局 reward（准确率+延迟）更新策略；tau2-Bench 上比延迟匹配插值高 7–8 分。
可落地：**中** —— 更新规则简单，需任务级成败信号。

**4. 产品形态**：Azure AI Foundry model router（训练好的轻量 ML 模型读 system/user/tools/history，难度感知，Balanced/Cost/Quality 三模式，响应 `model` 字段披露）；Pioneer Router（对每个 coding 请求给每个候选模型打"标定成功概率"，选过阈值的最便宜者，带 max_regret 与 fallback，决策写入 metadata.model_routing）。
可落地：**低**（闭源），但"每模型成功率标定+阈值+兜底"的规则可本地实现。

## 五、WLLM 进化能力三件套落地路线

**I1 记忆**
- 文件布局：`<repo>/AGENTS.md`（项目规则，启动读）+ `~/.config/opencode/AGENTS.md`（全局偏好）+ `.wllm/memory/MEMORY.md`（索引，≤120 行、每条一行）+ `.wllm/memory/<topic>.md`（细节按需读）+ `.wllm/memory/failures/<date>-<slug>.md`（失败卡：root_cause / correction / evidence）。
- 触发：①用户纠正或第二次重复同一提醒→会话内自写一条（单会话限 1–2 条防污染）；②测试/lint 失败被修复→写失败卡；③会话结束跑一次整理（借 sleep-time）：合并去重、过期条目加引用校验（借 Copilot）、超 120 行压缩。

**I2 技能库**
- 文件布局：`.opencode/skills/<name>/SKILL.md`（正文 <150 行）+ `references/` + `scripts/`；跨项目共享放 `~/.config/opencode/skills/`；`.wllm/skills/index.jsonl` 记录 `uses / last_used / pass_rate / source_session`。
- 触发：description 只写"做什么+何时用"（≤300 字），由 skill 工具按需加载；**三重门禁**（校验通过+命名失败模式+排除过死路）才晋升技能，否则只在 MEMORY.md 留一行；同一现象出现 ≥2 次才建新技能，写前按 index 相似度去重。

**I4 自我改进**
- 文件布局：`.wllm/runs/<ts>/trace.jsonl`（逐步动作/输出/退出码）+ `.wllm/lessons/lessons.jsonl`（结构化教训 `{subject, fact, citations, reason, status}`，抄 Copilot）+ `.wllm/audit.log`（谁生成了哪条技能/规则，带来源会话）。
- 触发：①会话内失败→当场 Reflexion 一轮，评测器必须是真实测试/lint 退出码而非模型自评；②会话结束→后台 fork 一个只带 memory/skill 工具的 review 代理（抄 Hermes），对本次产出做 discard/merge/新技能/新规则四选一；③每周批量：校验并清理 lessons、把出现 ≥2 次的教训升级为技能。路由暂不上训练：等本地有 ≥2 个模型后，先记 `routelog.jsonl`（任务画像→所选模型→是否一次通过）用规则选型。
