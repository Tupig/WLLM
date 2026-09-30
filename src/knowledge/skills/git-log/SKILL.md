---
name: git-log
description: 提交历史考古：归因某行为引入点、找回归窗口、生成变更摘要
---

# Git 历史考古

## 定位「谁引入了这个行为」

```bash
# 该行的完整提交链
git log -L :函数名:路径 --  或  git blame -L 10,30 文件

# 找引入某字符串/结构的提交
git log -S '关键词' --oneline -- 路径
git log -G '正则' --oneline   # 按 diff 内容匹配（更宽）
```

## 缩小回归窗口（二分）

```bash
git bisect start HEAD <good-sha>
git bisect run npm test -s   # 或自定义脚本：非 0 = bad
git bisect reset
```

## 变更摘要（给 PR / 周报）

```bash
git log --oneline --no-merges <base>..HEAD
git diff --stat <base>..HEAD
git log --format='%h %s' --since='2 weeks ago' | head -50
```

## 常用形态

- `git log --graph --oneline -20` 分支线形
- `git show <sha> --stat` 单提交全貌
- `git reflog` 找回丢失的 HEAD / 被 reset 的提交
- `git stash list` / `git stash pop` 临时现场

## 读史原则

- 先看 commit message 关联的 issue/PR（`git log --grep='#\d+'`）
- 归因结论要带 sha + 文件:行号，不猜
