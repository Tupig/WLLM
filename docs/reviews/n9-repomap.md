# N9 repo 地图与搜索限量（A18） — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | research/editing-group（aider repo-map：tree-sitter 符号+热度裁剪+token 预算+磁盘缓存）；SWE-agent（结果超量只列文件名、逼模型缩窄）；本仓 Grep/Glob 已有 head_limit 但无符号地图 |
| ② 先测 | `tests/n9-repomap.test.ts` 12 用例先红（`src/search` 不存在） |
| ③ 落盘 | `src/search/index.ts`：`extractSymbols`（TS/JS 函数·类·接口·类型·枚举·const、Python、Go、Rust/Java/Ruby；跳过注释行）、`buildRepoMap`（目录白名单式跳过 node_modules/.git/dist/venv/models 等、单文件 512KB 上限、代码扩展白名单、字符预算截断、`.wllm/cache/repomap.json` mtime 缓存）；`src/tools/RepoMap.ts` 只读工具（path 走 safePath、budget 200–50k）；`Grep` content 模式超量且散在 >10 文件 → 降级为文件名清单；`tools.ts` 注册（默认 12→13） |
| ④ 审查 | 不引 tree-sitter/typescript 运行时（正则抽定义行，devDep 不入生产）；缓存按 `文件集+mtime` 判等，增删改名均失效；预算截断带"已显示 X/Y + 缩小范围"提示；Grep 降级只在 content+truncated+多文件时触发，files_with_matches/count 行为不变；RepoMap path 越界被 safePath 拒绝；walk 不跟随符号链接（`Dirent.isFile()` 对 symlink 为 false）；修测试用 `fromCache` 断言替代亚毫秒 mtime 比较（`utimesSync` 精度不足，属测试自身缺陷） |
| ⑤ 回归 | tsc 0 错 / vitest 285 绿（26 文件）/ bash -n 过 / pytest 31 绿 |
| ⑥ 验收 | 见下，全过 |

## AC

- [x] 符号抽取：TS 五类定义 + 导出/非导出 const + Python def/class + Go func/type，行号 1-based，注释行不收
- [x] 地图输出 `路径:行号 [种类] 符号名`，含总数与截断提示
- [x] 目录跳过：node_modules/.git/dist/venv/models/logs/state 等不出现在结果里
- [x] 字符预算（默认 6000）截断并提示如何缩窄；空仓库给出明确文案
- [x] 缓存 `.wllm/cache/repomap.json`：未变命中（`fromCache=true`）、mtime 变化重建
- [x] Grep 超量降级：匹配行超 head_limit 且散在 >10 文件 → 只列文件名 + 缩窄建议
- [x] RepoMap 入默认工具集（只读、path 受 safePath 约束）
- [x] 四连门槛全绿
