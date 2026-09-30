---
name: shell-command-engager
description: 安全执行 shell：正确引用、超时意识、失败诊断，破坏性操作前必确认
---

# Shell 命令执行守则

## 执行前

- 破坏性命令（rm -rf、git push --force、drop、truncate、覆盖重定向到关键文件）**先确认再执行**
- 长命令给 timeout；可能挂起的（交互式、watch、需要 TTY）不要直接跑
- 路径含空格/中文 → 双引号包裹每一个路径参数

## 引用坑

```bash
# 错：变量/通配被提前展开
rm $FILE
# 对：
rm "$FILE"

# 单引号内不展开（正则、反引号安全）
rg 'pattern' --glob '*.ts'
```

## 失败诊断顺序

1. 看 **exit code** 与 stderr 第一行（错误根因通常在最前）
2. command not found → 装没装 / PATH / 是否该用 npx·npm run
3. permission denied → 路径错误还是权限（别急着 chmod 777）
4. EACCES/EPERM on macOS → 别碰 /System /Library /usr 等敏感路径（会被权限层 deny）
5. 网络类（fetch failed/timeout）→ 先 curl 复现，再看代理/DNS

## 输出处理

- 大输出用 `| tail -30` / `rg` 过滤，不整段吞
- 管道失败排查：`set -o pipefail` 或分步跑
- 修改类命令（mutate）跑完给一句结果确认；远程发布类（push/publish/deploy）必须人工确认
