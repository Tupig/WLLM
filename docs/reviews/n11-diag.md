# N11 命令与诊断（A22：/review /init /doctor） — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | codex `/init` 生成 AGENTS.md、`/review` 非交互只报告不改工作区、findings 按优先级；claude `/doctor` 配置体检（重复项/慢 hook/未用 skill）；Kimi wire.jsonl 请求轨迹（本仓 trajectory 已覆盖，不重复造）；OpenHands 事件溯源（本仓 session 事件 N4 已覆盖） |
| ② 先测 | `tests/n11-diag.test.ts` 15 用例先红（`src/diag` 不存在） |
| ③ 落盘 | `src/diag/index.ts`：`runDoctor`（provider/config/tools/技能重名/子代理重名/hooks.json 可解析/缓存体积/git 九项）、`renderDoctor`（error→warn→ok 排序 + ✅⚠️❌ + 摘要计数）、`initAgentMd`（package.json scripts + pytest 探测 + 目录概览，已存在需 `--force`）、`buildReviewPrompt`（只读约束 + P0/P1/P2 findings 格式 + 12k 预算截断）、`isValidRef`；`index.ts` 接 `/doctor`、`/init [--force]`、`/review [ref]`（plan 模式跑评审）+ help |
| ④ 审查 | **安全**：`/review <ref>` 拼进 `git diff` 有 shell 注入面 → 提炼 `isValidRef` 白名单（拒 `;`、空格、`$()`、反引号、`&&`），补注入测试；清理 `renderDoctor` 冗余分支；`runDoctor` 各段独立 try 不外抛；`initAgentMd` 只读 package.json/探测固定文件名，无任意路径；`/review` 走 `initialMode: "plan"` 且 prompt 声明只报告（双保险）；轨迹/事件未重复造（trajectory + session events 已有） |
| ⑤ 回归 | tsc 0 错 / vitest 300 绿（27 文件）/ bash -n 过 / pytest 31 绿 |
| ⑥ 验收 | 见下，全过 |

## AC

- [x] `/doctor`：provider 状态（mock/openai/anthropic 或中文修复建议）、非法 `PILOT_HARNESS`/`PILOT_MAX_CONTEXT_TOKENS` 告警、默认工具 schema 完整性、技能与子代理重名 warn、hooks.json 解析失败 warn、缓存 >5MB 告警、git 仓库检测
- [x] `renderDoctor` 按严重度排序、三档符号、`N error / N warn / N ok` 摘要
- [x] `/init`：生成含项目名、`npm test`/`npm run build`/`pytest` 命令与目录概览的 AGENTS.md；已存在拒绝，`--force` 覆盖
- [x] `/review [ref]`：收集 `git diff HEAD`（或指定 ref）→ 只读 plan 模式跑评审，findings 按 P0/P1/P2；空 diff 明确提示；diff 超 12k 截断
- [x] ref 白名单防 shell 注入（含注入用例）
- [x] 四连门槛全绿
