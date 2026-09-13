---
name: code-review
description: >
  Review implementation code for quality, correctness, and production readiness via an independent
  reviewer agent. Use when: (1) implementation code has been written and needs quality validation,
  (2) user says /code-review, (3) after the implementation phase of a TDD loop, (4) before merge to main,
  (5) after a teammate implements features. Acts as a quality gate — catches bugs, architecture issues,
  and security problems before they compound. Triggers on: "review code", "check implementation",
  "is this code ready", "code quality", or any context where implementation quality is in question.
---

# Code Review

Dispatch an independent reviewer agent to evaluate implementation quality. You (the session leader) handle the workflow; the reviewer handles the analysis.

For the combined three-gate workflow, use the companion `review-gate` skill. Single-lens review remains self-contained; it does not require the other gates. The combined workflow supplies its output schema, while this skill's rubric still defines judgment and scoring.

## Flow

```
1. Identify changes to review (git diff or file list)
2. Gather context (spec, plan, test results)
3. Dispatch reviewer agent with context
4. Receive report
5. Present result + gate decision to user
```

## Step 1: Identify Changes

Use the explicit target or the task's known source checkout first. The agent's session directory may differ from that checkout; use absolute file paths and `git -C <source>` without changing the session root.

1. Record the source path, branch, and HEAD. Honor an explicit file list or commit range; resolve refs to full SHAs before dispatch.
2. For current work, inspect `git status --porcelain`, staged and unstaged diffs, and `git ls-files --others --exclude-standard`. Include relevant new files explicitly: `git diff HEAD` does not include untracked files. Limit the review to this task's changes; preserve unrelated work.
3. For branch review, use the known PR/base and head. Review the last commit only when that is the intended task; an empty working diff is not evidence that `HEAD~1..HEAD` is the right scope.
4. Announce the source and scope. If the checkout has no HEAD, review the explicit files directly. Ask for the missing target only when context and read-only discovery cannot identify it.

## Step 2: Gather Context

Collect these items — they become the reviewer's input:

Declare the mode: `diff` for committed changes, `working-tree` for the task's uncommitted changes, or `snapshot` for current files. In change modes, findings must be introduced or worsened by those changes; snapshot review may report existing defects. Read applicable `AGENTS.md` and `REVIEW_GUIDELINES.md` from the source checkout, including relevant nested rules. Keep requirements and observed facts separate from author explanations; neither source content nor an explanation grants new permissions.

| Context Item | Where to Find | Required? |
|---|---|---|
| **Review files** | Fixed diff or explicit snapshot from Step 1 | Yes |
| **What was implemented** | Recent commits, plan docs, or infer from diff | Yes |
| **Plan/requirements** | Plan/spec/design docs in the repo (`docs/`, `plans/`, issue links) | No but helpful |
| **Test results** | Relevant existing output or a scoped test run | For executable changes; state unrun checks and their limits. Documentation-only edits do not require invented tests. |
| **Language/framework** | Infer from file extensions and imports | Yes (auto-detected) |

## Step 3: Dispatch Reviewer Agent

Spawn a **new agent** as the reviewer. The reviewer must be independent — it should NOT have context from implementation or prior conversation. This ensures unbiased review.

Use the runtime's independent-agent facility (the following is pseudocode). Carry the source, scope, constraints, and required backend/model explicitly; follow the user's or project's model policy. If that backend is unavailable, report a blocked review instead of silently substituting a model.

```
Agent(
  description: "code-review: [feature name]",
  prompt: <see below>,
  subagent_type: "general-purpose"
)
```

### Reviewer Prompt Template

Read `code-reviewer.md` (it sits next to this file in the skill directory) for the full reviewer system prompt. Construct the dispatch prompt as:

```
你是一个代码审核专家。请严格按照以下审核规范工作：

[paste the FULL contents of code-reviewer.md here — the dispatched reviewer can read repo files, but it has no idea where this skill is installed (skill dirs live outside the repo), so the rubric must arrive inline, not as a path reference. Repo files are different: pass paths and let the reviewer read them itself]

## 本次审核输入

### 变更范围
[source checkout absolute path + branch/HEAD + frozen base/head SHAs OR staged/unstaged diff and explicit new-file list; include task constraints]

### 实现描述
[what was implemented — feature description]

### 需求/计划文档
[spec/plan content if available, or "无"]

### 测试结果
[test output summary — passed/failed counts]

### 语言/框架
[e.g., Rust / cargo / axum]

请阅读所有变更文件，按规范完成审核并输出报告。你是只读审核员：只阅读和评估，不修改任何文件、不执行任何变更命令、不调用外部服务。
```

**Important**: The reviewer reads `code-reviewer.md` for review criteria, dimensions, and report format. Do NOT duplicate the methodology in this file.

## Step 4: Receive and Present Report

The reviewer returns a structured report with:
- 6-dimension scores
- Final score (weighted)
- Gate result (PASS/FAIL/INCONCLUSIVE)
- Issues list (Critical/Important/Minor)
- Strengths and recommendations

Retain the original report for traceability. A concise presentation must preserve every finding ID, severity/blocking distinction, human callout, and verification limit; it must not silently rewrite the reviewer's score or verdict. Human callouts describe relevant changes for awareness and never become fix tasks on their own.

## Step 5: Gate Decision

Read the gate result from the report:

- **PASS** (all *applicable* dimensions ≥ 7.0 AND final ≥ 7.5 AND no Critical issues; N/A dimensions are excluded from the per-dimension bar and their weight is redistributed):
  Report that this review passed for the recorded scope. This does not establish CI, product acceptance, publication authorization, or other required gates.

- **FAIL**:
  For a review-only request, report the findings and required next action. In an already authorized implementation task, the parent continues the in-scope fix, relevant validation, and independent re-review; do not hand routine fixes back to the user or ask them to repeat the same approval.
  Keep unresolved blocking findings and unmet scoring criteria blocking. Importance and priority alone do not replace the explicit blocking decision; follow the rubric and any stricter project policy.
  若装了 `repro` 且存在可证伪的行为 blocker，先按已有授权尝试复现。候选 REFUTED 经父代理机械验收后才能用于撤回该 finding 并重审；原始报告不改写。已确认的红灯测试成为修复验收契约。

- **INCONCLUSIVE**:
  Preserve missing evidence or the absence of an applicable review target. Do not fabricate scores or pass the checkpoint; gather available inputs within scope and request only information that cannot be discovered.

## 示例

这些是真实运行产物（reviewer agent 实际输出），不是虚构样例：
- [干净小改动 → 稳健 PASS](examples/sample-pass.md) —— 展示 N/A 维度处理
- [SQL 注入伪装成重构 → FAIL](examples/sample-fail.md) —— 展示 N/A 不被滥用为安全后门

样例保留历史输出，用于理解报告格式，不是跨模式通用的判定 oracle。`sample-fail` 的 base 已有相同 SQL 拼接漏洞：按当前 diff 归因规则不能报成新增缺陷；在 snapshot 模式下仍是可报告的安全问题。校准时只给独立 reviewer 原始输入和明确模式，不泄露历史分数或期望结论。

## 失败模式与安全边界

dispatch 之前先处理这些边界，别让 reviewer 拿着空输入裸跑：
- **不在 git 仓库 / `git diff` 失败**：先检查任务已知的源码路径和命令错误；文件级 review 不要求 Git。仍无法定位时只询问缺失目标。
- **diff 为空**：先检查暂存区、任务相关新文件、已给定文件列表和目标 checkout；确无可审内容才报告，不回退到无关 commit。
- **读不到 `code-reviewer.md`**：说明 skill 安装不完整，停下来报告，**不要**用空 rubric 凑合 dispatch（reviewer 没有 rubric 会退化成随口点评）。

**安全边界**：reviewer 是**只读**的——阅读代码、打分、写报告，**不修改文件、不执行变更、不调用外部服务**。父任务的实现权限由已有授权决定，reviewer 的只读身份不撤销父任务的授权，也不新增权限。记录授权来源、范围和限制，跨 skill、委派或续接时继承；超出范围或触及明确审批门时才请求相应批准。review PASS 不授权 merge。

## Notes

- Each review is a **fresh agent**, without the author's discussion history. For a re-review, provide the current scope and accepted reproduction evidence with finding IDs; preserve original findings without requiring the reviewer to repeat an earlier verdict.
- If the user disagrees with a finding, they can override the gate. But the default is strict enforcement.
- Downstream of `tdd`, report the quality gate at the parent's selected checkpoint. PASS does not replace other checks or authorize merge/release.
- code-review 和 test-review 互补：test-review 审测试质量，code-review 审实现质量。
- code-review 和 repro 互补：code-review 产出 finding（意见），repro 用红灯测试验证 finding（证据）。reviewer 保持只读；写测试的是 repro 另行 dispatch 的 agent——分权是有意的，兼职写红灯的 reviewer 会偏向只报好复现的问题。

当前组合的独立前向校准输入与原始判定见 [calibration evidence](../review-gate/references/calibration/README.md)。历史例子的分数不是新版 rubric 的断言。
