# I2 技能：披露预算 + 三重门禁（A12） — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | A12=Claude/skills 生态：目录仅披露 name+description（省上下文），用到才加载全文；门禁防路径穿越/坏格式/超大文件 |
| ② 先测 | `tests/i2-skills.test.ts` 11 用例（扫描门禁 4/预算 3/加载门禁 4）先红 |
| ③ 落盘 | `skills/index.ts`：loadSkills（扫 `.wllm/skills/*/SKILL.md` frontmatter，**门禁②** 缺 name/description 不入目录）、formatSkillCatalog（**预算 3000 字符**内逐条披露，超出→"其余 N 个未展示"）、resolveSkill（**门禁①** 名字含 .. / 斜杠且 resolve 后必须在 skills root 内、**门禁③** ≤100KB、frontmatter 再校验）；PromptOptions 加 skillCatalog 注入；REPL `/skills`、`/skill <name>` |
| ④ 审查 | 排序稳定、坏文件跳过不抛 |
| ⑤ 回归 | tsc 0 错 / vitest 215 绿 / shellcheck 过 / bash -n 过 / unittest 31 绿 |
| ⑥ 验收 | 全部通过 |
