# N1+N2 编辑加固 + lint 拦截回滚（A1/A2/A3） — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | FileEdit 未找到仅一行错误（无定位回喂）；lint 是写后提示不拦截；A1 来源 aider（结构化错误反馈+相近行）、A2 SWE-agent（写前拦截拒落盘）、A3 aider auto-lint+revert |
| ② 先测 | `tests/n1-edit.test.ts` 12 用例（levenshtein 3/相近行 3/回喂格式 2/回滚 4）先红（import 失败） |
| ③ 落盘 | `tools/similar.ts`：levenshtein、findSimilarLines（topK+行号+距离）、formatNoMatchFeedback（未找到+相近行+重读提示）；`tools/rollback.ts`：writeWithRollback（写→lint→失败回滚，**新文件回滚=删除**，lint 抛异常也回滚）；FileEdit 两分支与 FileWrite 全部接入（失败回喂含 linter 输出+"本次未生效"） |
| ④ 审查 | N2 的"auto-lint 回喂+反转裁"与 A2 回滚为同一机制，合并交付；未使用 import 清理 |
| ⑤ 回归 | tsc 0 错 / vitest 111 绿 / shellcheck 过 / bash -n 过 / pytest 31 绿 |
| ⑥ 验收 | 全部通过 |

**语义**："写前拦截"以"写→校验→回滚"实现，文件系统最终状态等效拒落盘。
