---
name: issue-fix
description: >
  Issue-driven bug fixing: an 8-stage flow with 2 approval gates — read issue → gather evidence →
  reproduce as a red test → root-cause analysis → [gate 1] → fix plan + acceptance tests → [gate 2] →
  implement → regression → PR. 核心纪律：先复现再分析、先钉红灯再改代码、修根因不修症状。
  Use when the user hands over a bug report or issue id and wants it fixed end-to-end.
  Triggers on: /issue-fix, "修这个 issue", "fix issue #123", "按 issue 修", "这个 bug 帮我修了",
  or any bug report arriving with reproduction conditions attached.
---

# Issue 驱动的 Bug 修复（8 阶段 + 2 审批门）

核心理念：**先理解问题、钉住红灯，再动手改代码。开发目标 = 让可复跑的验收测试翻绿，而不是"让报错消失"。**

```
阶段 1: 读 Issue         → 现象、复现条件、环境、关联线索
阶段 2: 取证             → 附件/日志/样本落工作目录
阶段 3: 复现 → 红灯测试   → 当前代码上真实失败的测试（= 修复验收契约）
阶段 4: 根因分析         → root_cause.md
  ──── 审批门 1：用户确认根因 ────
阶段 5: 修复方案 + 测试    → plan.md + 验收测试清单
  ──── 审批门 2：用户确认方案 ────
阶段 6: 开发实施         → 红灯翻绿，禁改测试
阶段 7: 回归验证         → 全量测试 + 质量门
阶段 8: 提 PR            → 引用 issue + 附证据
```

## 项目适配层（先看这个）

复现入口、测试命令、PR 惯例是**项目知识**，不属于本 skill：

- 项目里有 project 级 skill（`.agents/skills/`、`.claude/skills/`）或 AGENTS.md / CLAUDE.md 时，阶段 2-3、6-8 的具体命令**以它们为准**——本 skill 只提供流程骨架和纪律。
- 什么都没有时，从 README / Makefile / package.json scripts 找测试与运行入口；找不到就问用户，不要猜。

工作目录约定（项目已有惯例则从之）：

```
issues/{slug}/
    issue.md          # 提取的 issue 元信息（阶段 1）
    evidence/         # 附件 / 日志 / 样本（阶段 2）
    results/          # 复现输出（阶段 3）
    root_cause.md     # 根因分析（阶段 4，审批门 1）
    plan.md           # 修复方案（阶段 5，审批门 2）
```

## 阶段 1：读 Issue

提取：错误现象、复现条件（输入/环境/步骤）、期望行为、关联 PR / issue / 评论里的进展。模板见 `references/templates.md`。
**缺「预期 X，实际 Y」级别的信息 → 先问，不要脑补着开修。**

## 阶段 2：取证

下载附件、抓相关日志、留样本，落 `evidence/`。

**取证诚实性底线**：
- 拿到 0 个附件/样本时，把「无真实样本」写进分析和 PR，不得声称验证过真实数据
- 有真实样本优先用真实样本回归；没有时用仓库内稳定 fixture 覆盖同一路径，并写明验证边界
- 只有截图/错误文本时，最小复现仍要覆盖实际数据流，不能只测报错函数本身

## 阶段 3：复现 → 钉成红灯测试

复现成功不算完——固化成**红灯测试**：断言 spec 期望的正确行为、在当前代码上真实失败。装了 `repro` skill 就按它的协议做（oracle 引出处、预注册失败签名、同文件 control test、3 连跑稳定红）；这个红灯就是阶段 6 的验收契约。

- **无法复现 → 如实报告并停下**（环境差异？信息不足？疑似已修？），不要跳过复现直接改代码。
- 工作流/集成类问题不能只跑低层单测：至少补一条覆盖实际数据流的端到端复现。

## 阶段 4：根因分析 → root_cause.md（审批门 1）

取证顺序：**先看原始输入，再看运行产物，再看 debug 中间产物，最后进代码**——反着来容易拿代码脑补数据。产出 `root_cause.md`（模板见 `references/templates.md`），数据流追踪到具体 `file:line`。

**向用户展示 root_cause.md，确认根因后再进入方案。**

## 阶段 5：修复方案 + 验收测试 → plan.md（审批门 2）

产出 `plan.md`（模板同上）+ 验收测试清单：
- 检查规则同时覆盖**正面验证**（正确行为存在）与**负面验证**（错误行为不再出现）
- 测试写法遵守 tdd 铁律：走公共接口、测行为不测实现——修复往往伴随重构，钉死内部的测试会反过来冤枉修复

**向用户展示 plan.md + 测试清单，确认后再编码。**

## 阶段 6：开发实施

按 plan.md 编码，目标 = 阶段 3 的红灯翻绿 + 新验收测试全过。

**修根因，不许用禁配置/删功能/跳测试/改测试断言的方式让测试变绿。** 红灯测试文件在开发期间不许动——改它等于篡改验收契约。

## 阶段 7：回归验证

该链路全量测试 + 单测全绿；装了 review skill 就过质量门（`/code-review`，或 review-gate 三门）。
flaky test（与本次修改无关的间歇失败）单独立 issue 记录，不阻塞当前 PR。

## 阶段 8：提 PR

按项目 PR 惯例（有 pr skill 走 pr skill）。PR 里引用 issue 号，附：复现证据、根因结论、红灯→绿灯的测试证明；无真实样本时写明验证边界。
提 PR 前做**测试收尾检查**：多轮 review/repro 循环钉下的测试应已按行为域晋升归并（纪律见 repro skill Step 5）；测试目录不残留以评审轮次命名（`*_round*`、`*_review_findings*` 之类）的文件——按轮次堆积的是评审历史，不是行为规格。
没有远程 / 不便提真 PR 时，这一阶段**不许静默省略**：把同样内容落成 `issues/{slug}/pr_comment.md`，交付物是「可直接粘进 PR 的描述」。

## 失败模式与安全边界

- **issue 信息不足以定位**：列出缺什么（输入样本？版本？步骤？），要到再开工。
- **无法复现**：停在阶段 3 如实报告，给出已尝试的路径与判断（环境差异 / 疑似已修 / 需要更多信息）。
- **审批门不许静默跳过**：用户明确说「不用确认、直接修」才可以连跑；默认每道门都停。这两道门存在的原因：agent 最常见的失败不是修不动，而是兴冲冲修错了方向。
- **根因在依赖/上游**：如实说明，给 workaround 方案 + 上游 issue 建议，不要硬改 vendored 代码。

**安全边界**：本 skill 不替用户 merge PR、不关 issue；分支与 commit 遵守项目惯例；红灯测试与验收清单是证据，最终裁决权在用户。

## Notes

- 链路关系：阶段 3 = `repro` 的红灯契约协议（单 finding 验真的同款纪律）；阶段 5-6 = `tdd` 的红绿纪律；阶段 7 = `code-review` / review-gate 质量门。都没装也能独立使用。
- 与 `to-issues` 互补：to-issues 把计划拆成 issue（进），issue-fix 把 issue 修成 PR（出）。
- 「项目适配层」的参考实现：MOI monorepo 的 project 级 issue-fix overlay——component 分派表 + make 管线在 overlay，流程骨架在本 skill。同名时 project 级优先，二者内容一致。
