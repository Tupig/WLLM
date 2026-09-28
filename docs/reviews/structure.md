# 目录结构模块化 + bin TS 化 — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | 全仓核查：`src` 62 文件全 `.ts`、无 JS 残留；全部文件 charset=utf-8/ascii ✓；根目录 25 个散文件 + 27 个单文件目录，分类不清；`plugins/` `context/` `testing/` 三目录全仓 0 引用（死代码） |
| ② 先测 | 结构重构以 tsc + vitest 332 为红绿基线（重构本身无新行为）；bin TS 化先写 `tests/cli.test.ts` 7 用例（薄壳形态、package.json bin、llm 纯函数） |
| ③ 落盘 | **模块树**：根仅 `index.ts config.ts` + 11 模块目录——`engine/`（QueryEngine prompt Tool toolRegistry router harness constants errors hooks promptOptimize）、`session/`（session sessionState checkpoint trajectory）、`context/`（compact/ budget cache rules repomap）、`knowledge/`（memory skills reflexion）、`modes/`（modes spec）、`commands/`（diag repl）、`agents/`（原 subagent）、`services/`（+failover）、`tools/ git/ state/ utils/`；删三死目录；**bin TS 化**：`src/cli/` 新增 common（cliRoot/端口探测/ensureService/execReplace）、pilot、llm（fetch 替代 curl+python）、agentLocal（GPU 警告/服务拉起/exec 三段式）、claude-local、codex-local、opencode-local、mlx-local；`bin/*` 改 3-5 行薄壳（dist 存在走 node，否则 tsx）；package.json `bin` 六项指 `dist/cli/*.js` |
| ④ 审查 | import 重写脚本三轮迭代（back-map 缺 `.ts` 后缀、裸目录引用 `/index` fallback、config 遗漏）最终 52 文件一次改对；逐轮 `git checkout` 恢复基线避免叠加错改；`llm start` 分支对齐原 shell（直接委托不 ensure）；esm `require` 残留改为顶部 import；清理全部 `void X` 占位 |
| ⑤ 回归 | tsc 0 错 / vitest 339 绿（30 文件）/ bash -n 6 薄壳过 / pytest 31 绿 / `bin/llm help` 冒烟通过 |
| ⑥ 验收 | 见下，全过 |

## AC

- [x] `src` 根仅入口与全局配置，其余按模块入目录，树状两级
- [x] 死目录 `plugins/context/testing` 已删
- [x] 全仓源文件 UTF-8，代码全 TS（无 .js/.mjs 源文件）
- [x] `subagent` → `agents`、`search` → `repomap`（并入 context）、`tools.ts` → `toolRegistry.ts` 精准命名
- [x] bin 6 个 shell 全部 TS 化（`src/cli/`），bin/* 只留薄壳；package.json bin 更新
- [x] 四连门槛全绿
