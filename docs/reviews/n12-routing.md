# N12 路由骨架（A23：routelog 画像 + 模型角色制） — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | ABSORPTION A23（ev、Continue）；research/evolution §4（任务画像→所选模型→是否一次通过，规则选型，训练等本地 ≥2 模型）；research/other-agents Continue 角色制 chat/apply/summarize；本仓 E9 只做难度分流 + 单向 routelog |
| ② 先测 | `tests/n12-routing.test.ts` 15 用例先红（`profileTask` 等 5 个 API 不存在、`kind`/`workDir` 参数类型不符） |
| ③ 落盘 | `router.ts` 扩展：`profileTask`（chat/edit/search/review/plan/summarize 六类 + 沿用难度启发式）、`resolveRoleModel`（`PILOT_MODEL_<ROLE>` > `PILOT_ROLE_MODELS` JSON）、`routeTask` 角色覆盖（显式 > mock > 角色 env > 难度分流；easy 本地分支先查画像建议）、`appendRouteFeedback`/`readRouteProfile`/`suggestModel`（样本≥3 且一次通过率≥0.8 才建议）、`formatRouteLog` 带 `type`+`kind`；`QueryEngine`：route 传 workDir、route 行记 kind、submitMessage 结束回填 feedback（success + oneShot=≤2 轮） |
| ④ 审查 | 清理 summarize 正则重复项；画像建议只在本地分支生效（不把 8b/14b 选进云端）；feedback 与 route 同文件按 `type` 区分、旧无 type 行兼容计入 totalRoutes；routelog 写入全部 try 包裹不影响主流程；角色覆盖不越过显式 `--model` 与 mock |
| ⑤ 回归 | tsc 0 错 / vitest 315 绿（28 文件）/ bash -n 过 / pytest 31 绿 |
| ⑥ 验收 | 见下，全过 |

## AC

- [x] 画像六类：编辑/搜索/评审/计划/摘要/对话，难度沿用 E9 启发式，空输入安全
- [x] 角色制：`PILOT_MODEL_CHAT/APPLY/SUMMARIZE` 与 `PILOT_ROLE_MODELS` JSON 两级解析，命中即覆盖分流（reason 标注 `role:<角色>`）
- [x] routelog 闭环：route 行带 `kind`；执行结束回填 `feedback`（model/kind/success/oneShot）
- [x] `readRouteProfile` 聚合 totalRoutes 与按画像的 feedback/oneShot/rate/byModel
- [x] `suggestModel` 规则选型：样本 ≥3 且一次通过率 ≥0.8 才建议，否则 null（数据不足不乱选）
- [x] 命中画像建议时 `routeTask` 改选模型，reason 为 `profile:<kind>→<model>`
- [x] 四连门槛全绿
