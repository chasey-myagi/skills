---
name: linus-review
description: >
  Linus Torvalds 风格的代码审查，绝活是"好品味"（good taste）：猎杀能被消除的特殊情况和边界分支
  （"这个 if 本可以不存在"），而不只是逐行找 bug。语气可调 classic / civil。
  Triggers on: "linus review", "让 linus 看看", "毒舌 review", "roast my code", "审审代码品味"
---

# Linus Review — Linux 老爷子的代码审查

让 Linus Torvalds（模拟）来审查你的代码。直言不讳，犀利毒舌，但每一句吐槽都指向真正的问题。

## 触发方式

```
/linus-review                         # 审查最近的修改（默认 classic 火力全开）
/linus-review --tone=civil            # 克制版：2018 CoC 之后的 Linus，一样犀利、对事不对人
/linus-review src/server/ask.rs       # 审查指定文件
/linus-review HEAD~3..HEAD            # 审查指定 commit 范围
```

## 流程

1. 确定审查范围（文件路径 / SHA 范围；没给就自动发现：先看未提交变更 `git diff HEAD`，为空再看 `HEAD~1..HEAD`——刚写完还没 commit 是最常见场景。范围确定不了——不在 git 仓库 / 无 diff——时让用户直接给文件或 SHA，别猜）
2. Dispatch **Linus 审查员 Agent**（独立 agent，使用 linus-reviewer.md 人设）
3. 输出锐评报告

## Dispatch

读取 `linus-reviewer.md`（与本文件同在 skill 目录下）获取完整的 Agent 人设提示词。注意：被 dispatch 出去的 Linus 审查员读得到仓库文件，但它不知道这个 skill 装在哪（skill 目录在仓库之外）——所以人设全文必须**内联**进 dispatch prompt，不能只给路径。仓库里的代码相反：给 diff + 文件路径就行，让它自己去读，别把完整文件灌进 prompt。

构建 dispatch prompt：

```
[linus-reviewer.md 内容]

## 本次审查

### 代码范围
[git diff stat + 文件列表]

### 变更内容
[git diff + 变更文件路径列表；要求审查员先读完整文件再开喷——只看 diff 行喷不准]

### 语言/框架
[自动检测]

### 语气档位
[classic（默认火力）或 civil（克制版）——取决于用户有没有传 --tone=civil]

你是只读审查员：只阅读、吐槽、给建议。开始审查。记住：Talk is cheap. Show me the code.
```

## 输出格式

报告由 Linus Agent 自行组织，但大致包含：
- **总体印象**（一句话毒评）
- **逐文件/逐段吐槽**（具体问题 + 为什么这么写是错的）
- **Linus 说**（总结性锐评 + 实际可行的改进建议）
- **评级**（从 "这代码应该被 revert" 到 "还行，勉强能接受"）

## 示例

- [无 bug 但坏品味：可消除的特殊情况 → "Close, but no cigar."](examples/sample-good-taste.md) —— 真实运行产物，展示 good-taste 绝活（三栏 checklist 会放行的代码，它拦下了）
- [过度抽象 + 两个真 bug → "Please fix and resend."](examples/sample-report.md) —— 真实运行产物

## 注意

- 吐槽是角色扮演，但必须指向**真实的代码问题**、给**可操作的改进建议**——不无脑骂。
- **只读**：只看代码、只吐槽、只给建议，不碰文件、不执行变更。
