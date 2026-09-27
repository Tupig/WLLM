# 代码编辑策略调研（2 个）：aider / SWE-agent

> 资料来源：官方文档、GitHub README 与源码（实搜于 2026-09）。搜不到的项标注"未获取"。

## 1. aider（Aider-AI/aider）

- **架构与形态**：终端 AI 结对编程工具，Python 单进程 CLI，无守护进程。核心是 `Coder` 基类（`aider/coders/base_coder.py`）编排"组装上下文 → 调模型 → 解析编辑 → 落盘 → lint → commit"循环，子类按 edit format 分派（`editblock_coder.py` 等）。模型经 litellm 接入，支持云端与本地模型；`--edit-format` 可强制指定格式。
- **编辑机制（重点）**：
  - 多套 edit format 按模型能力自动选择：`diff`（SEARCH/REPLACE 块，git 冲突标记风格，只回传变更片段）、`diff-fenced`（块前带文件路径围栏）、`whole`（整文件重写）、`udiff`（统一 diff）、`patch`、`editor-diff`/`editor-whole`（architect 模式下精简 prompt，只负责把指令转成语法正确的编辑）。
  - 失败反馈：`apply_edits` 对每个块做精确匹配替换，未命中进 `failed`，汇总抛错回喂模型，报错含 `SearchReplaceNoExactMatch`、`find_similar_lines` 给出的 "Did you mean to match some of these actual lines"、"REPLACE 行已存在于文件" 两种诊断，并明确"已成功的 N 个块不要重发，只重发失败的"；SEARCH 匹配要求含全部空白/缩进/注释。
  - `--architect` 双模型：architect 出自然语言方案、editor 出编辑，`--auto-accept-architect` 默认开。
- **上下文管理（repo-map）**：tree-sitter 提取全仓文件与符号定义关键行，按被引用热度排序取最重要片段，`--map-tokens` 默认 1k 且动态伸缩（chat 无文件时 `--map-multiplier-no-files` 默认 2 放大）；标签结果落盘缓存 `.aider.tags.cache.v4`（diskcache），`--map-refresh` 默认 auto；仓库过大自动禁用并提示。
- **校验与自修复**：`--auto-lint` 默认开，每次编辑后 lint 被改文件，内置各语言 linter，可用 `--lint-cmd` / `--lint "语言: cmd"` 覆盖；约定非零退出码 + stdout/stderr 打印错误即视为失败，随后把错误回喂模型修复。测试走 `--test-cmd` + `--auto-test` 或 `/test`；`/run` 手动跑命令并可把输出并入对话。编译型语言建议用 lint/test 命令兼做 build。lint 修复存在"反复修不好空转"的已知问题（issue #1090，已关闭）。
- **权限与安全**：安全主要靠 git 而非沙箱——每次改动自动 commit（`--no-auto-commits` 关闭），编辑脏文件前先提交既有改动（`--no-dirty-commits`），形成原子回滚点；`/undo` `/diff` `/commit` `/git` 内置；默认跳过 pre-commit hook（`--git-commit-verify` 打开）。`--no-git` 时官方提示自行备份。细粒度权限审批/容器沙箱：未获取。
- **特色功能**：weak model 生成 Conventional Commits 提交信息，author/committer 标 `(aider)`；`--watch-files` 监听文件里 `# AI:` 注释触发编辑（IDE 集成）；`/voice` Whisper 语音输入；图片（vision 模型）与网页抓取进上下文；copy/paste 与网页版 LLM 互通；100+ 语言。

## 2. SWE-agent（princeton-nlp/SWE-agent）

- **架构与形态**：`sweagent` CLI → `SWEEnv`（1.0 起为 SWE-ReX 薄封装）→ Deployment（本地 Docker 或 modal/AWS 远程）→ 容器内 shell 会话；`Agent.forward()` 走 ReAct（每步出 thought + action），输出经 parser 抽取动作，历史经 HistoryProcessor 压缩。工具以 tool bundle 组织（`bin/` 可执行 + `config.yaml` + `state` 命令，state 每次动作后返回 JSON 供模板注入 cwd/open_file）。**注意：官方已转为 maintenance-only，推荐后继项目 mini-swe-agent。**
- **ACI 与编辑流程（重点）**：核心主张是"好的 Agent-Computer Interface 比换模型更能提分"（消融：ACI vs 裸 shell +10.7pp）。
  - `edit` 命令与文件查看器联动，3 个必填参数：起始行、结束行、替换文本（行范围替换，非 search/replace）；`create` 新建并打开文件；配套滚动、文件内搜索。查看器每次只显示 `WINDOW=100` 行、`OVERLAP=2`。
  - **编辑内嵌 linter**：edit 执行时跑 linter，语法不正确则**丢弃该编辑、不让落盘**，把选中的 linter 错误连同出错处前后代码片段回喂 agent 要求重试。消融显示带 linting 18.0 vs 无 15.0。
  - 搜索：全目录字符串搜索**只列有命中的文件名**，不展示命中上下文（展示过多会让模型困惑）；单查询超 50 条结果则不返回并提示写更精确的查询。
  - **补丁收口**：`submit` 命令基于此前所有编辑生成 patch 并关闭 shell，即"编辑 → 自检 → submit 出补丁"的产物形态；容器镜像内预置 `files_to_edit.txt` 跟踪编辑目标。
- **上下文管理**：HistoryProcessor 过滤历史（经典 `last_n_observations n=5`，旧观察替换为 "(n lines omitted)"；另有 CacheControl、RemoveRegex、TagToolCallObservations）；Summarizer 处理超长命令输出——`SimpleSummarizer` 落盘并提示用 `open` 查看，`LMSummarizer` 用同模型摘要后替换原观察。消融：仅最近 5 条观察 18.0 vs 全历史 15.0。
- **错误反馈机制**：强调"信息量充分的 prompt、错误消息、history processor"三件套；空输出统一回 "Your command ran successfully and did not produce any output."（避免模型误判失败）；文档明确提示"读错误消息改命令，重复执行同一命令只会得到同一错误"。编辑后的自检（改完立即 re-view 文件）写在 prompt 模板 tips 里。
- **权限与安全**：所有命令在 Docker/远程容器内执行，与宿主文件系统隔离；限制一次只发一条命令、必须等反馈再发下一条。细粒度权限审批、用户确认闸门：未获取（研究型定位）。
- **特色功能**：yaml 单文件驱动全部配置；Trajectory 记录 + inspector 可视化回放；EnIGMA 模式（CTF，IAT 交互式工具如调试器可与主 shell 并行）；2025-07 加入多模态（GitHub issue 图片走 vision 模型）。

## 3. 对 WLLM 的吸收建议（本地 Qwen 驱动的 TS coding agent）

- **高**：aider 的 search/replace **结构化失败反馈**（未命中原因分类 + `Did you mean` 相近行 + "已成功块勿重发" + 仅重试失败块）。本地小模型生成精确 diff 弱，这类"精确错误回喂 + 限缩重试范围"最能补短板。
- **高**：SWE-agent 的 **edit 内嵌 linter、语法不合法直接拒绝落盘**（附出错处前后片段）。在写入前拦截坏编辑，比事后 lint 循环更省 token，Qwen 小模型收益明显。
- **高**：aider 的 **git 原子 auto-commit 作 undo**（脏文件先提交、weak model 生成提交信息、`/undo`）。TS agent 缺安全网时最廉价的兜底。
- **中**：aider **repo-map** 思路——tree-sitter 提符号 + 按引用热度裁剪 + token 预算动态伸缩 + 磁盘缓存。WLLM 可用 TS 的 `typescript` AST/clangd 式索引替代，控制本地小模型上下文。
- **中**：SWE-agent **一次只发一条命令、强制等反馈** 与"空输出明确告知成功"的反馈约定；及 100 行窗口式文件查看（滚动/搜索/编辑同源）。约束小模型行为很有效。
- **中**：aider **architect/editor 双模型分工**（强模型出方案、弱模型出编辑）。WLLM 有 Qwen 14B/8B 可做同构分层，降幻觉。
- **低**：aider 语音/图片/网页输入、copy/paste web chat——与本地 TS agent 场景关系弱。
- **低**：SWE-agent 的 container/SWE-ReX 远程部署与 benchmark 型 submit 补丁流——WLLM 面向本地工作区协作，非 SWE-bench 评测形态；EnIGMA/CTF 更无关。
