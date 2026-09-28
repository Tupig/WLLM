# I4 Reflexion + review 代理（A24：复盘写回四选一） — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | ABSORPTION I4（P2，"会话结束复盘+不重犯"）；evolution §触发②（会话结束 fork review 代理，只带 memory/skill 工具，对产出做 discard/merge/新技能/新规则四选一）；评测器必须是真实测试/lint 失败而非模型自评 |
| ② 先测 | `tests/i4-reflexion.test.ts` 17 用例先红（`src/reflexion` 不存在） |
| ③ 落盘 | 新建 `src/reflexion/index.ts`：`buildRetroPrompt`（四选一+JSON 约束+失败记录，diff 12k 截断，空输入"无可复盘"）、`parseReviewDecision`（fence/裸 JSON 容错、非法 action→null、skill/rule 缺 content→null）、`applyReviewDecision`（全部落 `.wllm/runs/<id>.json`；skill/rule 走 `.wllm/staging/` 先审后存，与 I1 一致；discard/merge 只留记录）、`extractFailures`（会话消息 is_error 工具结果）、`listRuns`（ts 降序）；`/retro` 命令接入 `src/index.ts`（收集 git diff HEAD + 会话失败 → 一次性 query → 解析四选一 → 应用），帮助文本补一行 |
| ④ 审查 | listRuns 同毫秒排序用 `ts || id` 二级键；失败记录每条截 400、上限 5 条防 prompt 爆炸；`/retro` 无 git 仓库不报错按空 diff 走；复盘跑 plan 模式只读、写入仅由 applyReviewDecision 单点执行；skill 草稿不直接入 `.wllm/skills` |
| ⑤ 回归 | tsc 0 错 / vitest 332 绿（29 文件）/ bash -n 过 / pytest 31 绿 |
| ⑥ 验收 | 见下，全过 |

## AC

- [x] prompt 明示四选一动作与 JSON 输出格式，附真实失败记录（is_error 回喂，非模型自评）
- [x] 空改动+无失败 → "无可复盘"，不调模型
- [x] 解析容错：代码块、前后废话、非法 action、缺 content 均安全失败（null，不写任何文件）
- [x] skill/rule → staging 先审后存；discard/merge → 仅 runs 留痕；每次决策 runs 必写
- [x] `listRuns` 倒序可查
- [x] `/retro` 命令 + 帮助文案；四连门槛全绿
