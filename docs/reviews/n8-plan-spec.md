# N8 计划与 spec（A17：Plan 5 阶段 + spec 三件套） — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | research/closed-source §7 Kiro（requirements/design/tasks 三件套、依赖图 wave 并行、Quick Plan）；research/claude-code §5（Plan 5 阶段：探索→写 plan→自校验→呈现→批准/修改/拒绝，plan 模式唯一可写计划文件，子代理禁进 plan）；本仓 modes/（plan 只读雏形）、permissions plan 分支 |
| ② 先测 | `tests/n8-spec.test.ts` 先红：createSpec 三件套、名字门禁、parseTasks/@depends、buildWaves（链/菱形/环不死循环/悬空依赖）、validatePlan 结构门禁、approveSpec（需求非空+任务非空+plan 合规）、plan 模式写 `.wllm/specs` 放行/源码与 `../` 逃逸拒绝、plan 指引注入 |
| ③ 落盘 | `src/spec/index.ts`：createSpec/listSpecs/loadSpec/parseTasks/buildWaves/validatePlan/approveSpec；`services/permissions.ts` plan 分支加唯一可写面（resolve 后须含 `/.wllm/specs/`）；`prompt.ts` `planSpec` 选项注入 5 阶段指引；`QueryEngine.buildSystemPrompt` plan 模式取激活 spec；`index.ts` `/spec new\|list\|show\|waves\|approve` 五子命令 + help |
| ④ 审查 | plan.md 由 createSpec 预置骨架（模型知道写什么，空骨架因缺编号/列表仍过不了自校验）；`resolve()` 吃掉 `../` 逃逸，非 Write/Edit 或非 specs 路径一律 deny；validatePlan 只认四节标题+编号步骤+文件列表，本地 14B 可稳定产出；环检测有 guard 上限，悬空依赖按无依赖处理；命名门禁 `^[A-Za-z0-9_-]+$` + resolve 越界双保险；未引入 allowedPrompts 预批准（留待后续，避免规则污染） |
| ⑤ 回归 | tsc 0 错 / vitest 273 绿（25 文件）/ bash -n 过 / pytest 31 绿 |
| ⑥ 验收 | 见下，全过 |

## AC

- [x] spec 三件套落盘 `.wllm/specs/<name>/{requirements,design,tasks,plan}.md` + `status.json`
- [x] 名字/路径门禁：空、`..`、斜杠、重复创建全部拒绝
- [x] tasks 解析：`- [ ] T1 内容 @depends T0,T2`，状态与依赖可解析
- [x] 依赖 wave：拓扑分层同层并行、菱形合并、环不死循环落最后一层、悬空依赖降级为无依赖
- [x] plan 模式唯一可写面 = `.wllm/specs/**`，源码写入与 `../` 逃逸 deny
- [x] 5 阶段可被本地模型驱动：plan 模式系统提示注入路径与四节结构要求
- [x] 批准门禁：需求非空 + 至少一个任务 + plan 四节/编号/列表齐全，否则列出错误拒绝
- [x] `/spec` 五子命令可用，`/spec waves` 展示并行分组
- [x] 四连门槛全绿
