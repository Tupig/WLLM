# B8 GitHub 热门 Skills 选型

> 数据源：skillleaderboard.com（GitHub 真实数据排行，2026-09）+ awesome 列表交叉核对。
> 选型原则：① 编码工作流相关 ② 适配本地 Qwen3-14B/8B 能力（单次推理可控、不依赖云端多模态）③ 符合 Agent Skills SKILL.md 标准（frontmatter name+description）④ 许可宽松 ⑤ 体积可控。

## 热门榜单（star 排名节选）

| 排名 | 仓库 | Stars | 内容 | 是否选 |
|------|------|-------|------|--------|
| 1 | mattpocock/skills | 249k | 领域建模、架构设计、bug 诊断、规范式评审 | ✅ 首选 |
| 2 | multica-ai/andrej-karpathy-skills | 125k | 写码/评审行为准则：最小假设、最小范围、可验证标准 | ✅ |
| 3 | DietrichGebert/ponytail | 103k | 反过度工程审计、技术债台账 | ✅ |
| 4 | addyosmani/agent-skills | 84.3k | API 设计、接口契约、上下文工程 | ✅ |
| 5 | Egonex-AI/Understand-Anything | 81.5k | 代码库知识图谱/可视化（工具型，依赖运行时） | ⚠️ 备选 |
| 6 | ComposioHQ/awesome-claude-skills | 61.2k | 864 个技能大库（100+ 服务集成，多依赖 MCP） | ⚠️ 挑选子集 |
| — | anthropics/skills | 52k+ | Anthropic 官方技能（标准参考实现） | ✅ 必收 |
| 8 | addyosmani/agent-skills | 84.3k | （同上） | — |
| 10 | sickn33/agentic-awesome-skills | 46k | 253+ 自动化技能模板 | ⚠️ 挑选子集 |
| — | obra/superpowers | 35k+ | agentic 技能框架与开发方法论 | ✅ |
| — | MiniMax-AI/skills | 12.6k | 开发技能 | ⚠️ 备选 |
| — | github/awesome-copilot | 25.4k | Copilot 生态（agent workflow 设计） | ⚠️ 挑选 |
| — | google/skills | — | GCloud 运维 | ❌ 无关 |
| — | kepano/obsidian-skills | 46.2k | Obsidian 笔记 | ❌ 无关 |
| — | K-Dense-AI/scientific-agent-skills | 42.3k | 生物/时序 ML | ❌ 无关 |
| — | Donchitos/Claude-Code-Game-Studios | 24.3k | 游戏开发管线 | ❌ 无关 |

## 最终集成清单（第一批，8-12 个技能包）

1. **anthropics/skills** — 官方标准参考，收其核心子集（文档/PDF 处理类按需）
2. **mattpocock/skills** — 最火，工程方法论核心（domain-modeling / architecture / bug-diagnosis / spec-review）
3. **multica-ai/andrej-karpathy-skills** — 写码行为准则（对本地小模型的行为矫正价值高）
4. **DietrichGebert/ponytail** — 反过度工程（防小模型瞎改）
5. **addyosmani/agent-skills** — API/契约/上下文工程
6. **obra/superpowers** — agentic 流程框架
7. **ComposioHQ/awesome-claude-skills** — 只挑通用编码子集（code-review、testing、changelog 类，跳过 MCP 服务集成类）
8. **sickn33/agentic-awesome-skills** — 挑审计/部署类子集

## 集成方式（I2 执行时）

- 统一落盘到 `WLLM/skills/<name>/SKILL.md`（pilot 技能库标准目录，兼容 `.claude/skills/` 布局，便于外部工具共用）
- 每个技能入库前**人工审一遍 frontmatter**（name 合规 `^[a-z0-9]+(-[a-z0-9]+)*$`、description 中文/英文清晰）+ **脚本审引用的外部命令**（本地模型会盲执行技能里的命令，安全必须把关）
- 体积控制：单技能目录 < 100KB；scripts 若需运行时依赖（非 stdlib）标注 `compatibility` 或剔除
- 下载方式：`git clone --depth 1` 到临时目录 → 挑选 → 拷贝 → 记录来源与 commit（SOURCE.md）
- **验收（进 G3/G4）**：`skill 清单测试`（发现 N 个技能、frontmatter 全合法、无违禁命令）+ 抽 3 个技能做真实加载冒烟

## 风险

- star 榜含营销型仓库，**入库前逐个抽查实际 SKILL.md 质量**（I2 内做，不合格换替补）
- 第三方技能内容=半可信指令，**权限上默认 skill=ask 或只读**（F3 落地时定）
