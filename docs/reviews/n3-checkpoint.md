# N3 会话检查点（A4） — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | B4 gemini-cli shadow Git checkpoint：每轮副作用前快照、可列表/回滚，不污染用户分支 |
| ② 先测 | `tests/n3-checkpoint.test.ts` 7 用例（snapshot 4/rollback 3），temp git 仓库集成，先红 |
| ③ 落盘 | `src/checkpoint.ts`：snapshot（commit→`refs/wllm/checkpoints/<id>` 存对象→mixed reset **还原用户工作区与分支**，零污染）、list（`.wllm/checkpoints.jsonl` 倒序）、rollback（**先自动生成 safety 检查点**再 `reset --hard`，不存在 id 报错）；REPL `/checkpoint new|list|rollback <id>` + /help 更新 |
| ④ 审查 | 非 git 目录安全返回 null/报错；safety 防误回滚丢工作 |
| ⑤ 回归 | tsc 0 错 / vitest 166 绿 / shellcheck 过 / bash -n 过 / unittest 31 绿 |
| ⑥ 验收 | 全部通过 |
