---
name: code-review
description: >
  Review implementation code for quality, correctness, and production readiness via an independent
  reviewer agent. Use when: (1) implementation code has been written and needs quality validation,
  (2) user says /code-review, (3) after TDD implementation phase (Wave B), (4) before merge to main,
  (5) after a teammate implements features. Acts as a quality gate — catches bugs, architecture issues,
  and security problems before they compound. Triggers on: "review code", "check implementation",
  "is this code ready", "code quality", or any context where implementation quality is in question.
---

# Code Review

Dispatch an independent reviewer agent to evaluate implementation quality. You (the session leader) handle the workflow; the reviewer handles the analysis.

## Flow

```
1. Identify changes to review (git diff or file list)
2. Gather context (spec, plan, test results)
3. Dispatch reviewer agent with context
4. Receive report
5. Present result + gate decision to user
```

## Step 1: Identify Changes

If no path/SHA specified, auto-discover:

1. `git diff --name-only HEAD~1..HEAD` for recent changes
2. Or `git diff --name-only origin/main..HEAD` for branch changes
3. Tell the user which files will be reviewed

If path or SHA range given (e.g., `/code-review HEAD~3..HEAD`), use it directly.

## Step 2: Gather Context

Collect these items — they become the reviewer's input:

| Context Item | Where to Find | Required? |
|---|---|---|
| **Changed files** | git diff from Step 1 | Yes |
| **What was implemented** | Recent commits, plan docs, or infer from diff | Yes |
| **Plan/requirements** | `docs/superpowers/plans/`, spec docs | No but helpful |
| **Test results** | `cargo test` / `pytest` / `npm test` output | Yes (run if not available) |
| **Language/framework** | Infer from file extensions and imports | Yes (auto-detected) |

## Step 3: Dispatch Reviewer Agent

Spawn a **new agent** as the reviewer. The reviewer must be independent — it should NOT have context from implementation or prior conversation. This ensures unbiased review.

Use the Agent tool:

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

[paste the FULL contents of code-reviewer.md here — the dispatched reviewer is a fresh, independent agent that does NOT share your file access, so it must receive the rubric inline, not as a path reference]

## 本次审核输入

### 变更范围
[git diff stat + file list]

### 实现描述
[what was implemented — feature description]

### 需求/计划文档
[spec/plan content if available, or "无"]

### 测试结果
[test output summary — passed/failed counts]

### 语言/框架
[e.g., Rust / cargo / axum]

请阅读所有变更文件，按规范完成审核并输出报告。
```

**Important**: The reviewer reads `code-reviewer.md` for review criteria, dimensions, and report format. Do NOT duplicate the methodology in this file.

## Step 4: Receive and Present Report

The reviewer returns a structured report with:
- 6-dimension scores
- Final score (weighted)
- Gate result (PASS/FAIL)
- Issues list (Critical/Important/Minor)
- Strengths and recommendations

Present the full report to the user as-is.

## Step 5: Gate Decision

Read the gate result from the report:

- **PASS** (all dimensions ≥ 7.0 AND final ≥ 7.5 AND no Critical issues):
  Tell the user: "Code passes quality gate. Ready to merge/proceed."

- **FAIL**:
  Tell the user: "Code needs improvement. Fix the issues listed above, then run /code-review again."
  Do NOT allow merge without fixing Critical/Important issues.

## Notes

- Each review is a **fresh agent** — no memory of previous reviews. This prevents bias.
- If the user disagrees with a finding, they can override the gate. But the default is strict enforcement.
- When used inside `tdd-workflow`, the gate controls whether the workflow advances to merge/release.
- code-review 和 test-review 互补：test-review 审测试质量，code-review 审实现质量。
