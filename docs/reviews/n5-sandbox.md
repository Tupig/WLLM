# N5 沙箱策略（A8） — 验收记录

| 步骤 | 结果 |
|------|------|
| ① 调研 | safePath 已有 workDir 逃逸防护；缺敏感路径拦截与可配白名单（CodeBuddy 审批分级 + CLI 安全边界） |
| ② 先测 | `tests/n5-sandbox.test.ts` 10 用例（policy 解析 2/checkPath 5/checkBashPaths 3）先红 |
| ③ 落盘 | `services/sandbox.ts`：resolveSandboxPolicy（默认写限 workDir，PILOT_SANDBOX_WRITE/PILOT_SANDBOX_DENY 追加）、checkPath（读敏感 deny/写白名单外 deny）、checkBashPaths（命令含拦截路径 deny，默认拦 /etc/.ssh/id_rsa/.aws/.gnupg/.git/hooks）；接入 FileRead/FileWrite/FileEdit/Bash 的 checkPermissions |
| ④ 审查 | blocked 默认含 /etc（覆盖 shadow/sudoers 及写 /etc 任意文件）；~ 路径展开 |
| ⑤ 回归 | tsc 0 错 / vitest 145 绿 / shellcheck 过 / bash -n 过 / pytest 31 绿 |
| ⑥ 验收 | 全部通过 |
