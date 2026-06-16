---
name: test-review
description: >
  Review test cases for quality, coverage, and rigor via an independent reviewer agent.
  Use when: (1) tests have been written and need quality validation, (2) user says /test-review,
  (3) in TDD workflows before implementation, (4) after a teammate writes tests and you need to
  verify quality. Acts as a quality gate — implementation should NOT proceed until review passes.
  Triggers on: "review tests", "check test quality", "are these tests good enough", "test coverage",
  or any context where test adequacy is in question.
---

# Test Case Review

Dispatch an independent reviewer agent to evaluate test quality. You (the session leader) handle the workflow; the reviewer handles the analysis.

## Flow

```
1. Discover test files
2. Gather context (spec, source, feature description)
3. Dispatch reviewer agent with context
4. Receive report
5. Present result + gate decision to user
```

## Step 1: Discover Test Files

If no path specified, auto-discover:

1. `git diff --name-only` for recently added/modified test files
2. Scan: `tests/`, `**/tests/`, `**/*_test.*`, `**/*_spec.*`, `**/test_*.*`
3. Tell the user which files will be reviewed

If path given (e.g., `/test-review tests/store_test.rs`), use it directly.

## Step 2: Gather Context

Collect these items — they become the reviewer's input:

| Context Item | Where to Find | Required? |
|---|---|---|
| **Test files** | Paths from Step 1 | Yes |
| **Feature description** | Spec docs, plan docs, README, or infer from test names | Yes (can be inferred) |
| **Source code** | The implementation files the tests target (if they exist) | No (pure TDD may not have impl yet) |
| **Related spec** | `docs/`, design docs, plan docs | No but helpful |
| **Language/framework** | Infer from file extensions and imports | Yes (auto-detected) |

## Step 3: Dispatch Reviewer Agent

Spawn a **new agent** as the reviewer. The reviewer must be independent — it should NOT have context from implementation planning or prior conversation. This ensures unbiased review.

Use the Agent tool:

```
Agent(
  description: "test-review: [feature name]",
  prompt: <see below>,
  subagent_type: "general-purpose"
)
```

### Reviewer Prompt Template

Read `test-reviewer.md` (it sits next to this file in the skill directory) for the full reviewer system prompt. Construct the dispatch prompt as:

```
你是一个测试用例审核专家。请严格按照以下审核规范工作：

[paste the FULL contents of test-reviewer.md here — the dispatched reviewer is a fresh, independent agent that does NOT share your file access, so it must receive the rubric inline, not as a path reference]

## 本次审核输入

### 测试文件
[list test file paths]

### 功能描述
[feature description — what the tests are supposed to cover]

### 相关规格文档
[spec/plan content if available, or "无"]

### 实现代码
[source code paths if available, or "纯 TDD，尚无实现代码"]

### 语言/框架
[e.g., Rust / cargo test]

请阅读所有测试文件，按规范完成审核并输出报告。你是只读审核员：只阅读和评估，不修改任何文件、不执行任何变更命令、不调用外部服务。
```

**Important**: The reviewer reads `test-reviewer.md` for scoring criteria, dimensions, and report format. Do NOT duplicate the scoring methodology in this file.

## Step 4: Receive and Present Report

The reviewer returns a structured report with:
- 6-dimension scores
- Final score (weighted + E2E bonus)
- Gate result (PASS/FAIL)
- Missing scenarios list
- Suggestions

Present the full report to the user as-is.

## Step 5: Gate Decision

Read the gate result from the report:

- **PASS** (all *applicable* dimensions ≥ 7.5 AND final ≥ 8.0; N/A dimensions are excluded from the per-dimension bar and their weight is redistributed):
  Tell the user: "Tests pass quality gate. Proceed to implementation."

- **FAIL**:
  Tell the user: "Tests need improvement. Address the missing scenarios listed above, then run /test-review again."
  Do NOT allow implementation to proceed.

## 示例

同一个 `slugify` 函数、两份不同充分度的测试套件——这一对就是 reviewer 的校准夹具（真实运行产物）：
- [不足版（5 测试）→ FAIL 5.32](examples/sample-fail.md) —— 附 8 条具体缺失场景，「状态组合」N/A
- [充分版（15 测试，补齐 7 条）→ PASS 8.35](examples/sample-pass.md) —— Boundary 压线但达标，reviewer 不放水

## 失败模式与安全边界

dispatch 之前先处理这些边界，别让 reviewer 拿着空输入裸跑：
- **找不到测试文件**：让用户直接给测试文件路径，不要猜；也可能是测试还没写——如实告知，不要无中生有地审。
- **不在 git 仓库 / `git diff` 失败**：让用户给路径。
- **读不到 `test-reviewer.md`**：说明 skill 安装不完整，停下来报告，**不要**用空 rubric 凑合 dispatch。

**安全边界**：reviewer 是**只读**的——阅读测试、打分、列缺失场景，**不修改文件、不运行测试之外的变更、不调用外部服务**。本 skill 不替用户写测试或推进实现；gate 结论是建议。

## Notes

- Each review is a **fresh agent** — no memory of previous reviews. This prevents bias.
- If the user disagrees with a score, they can override the gate. But the default is strict enforcement.
- When used inside `tdd-workflow`, the gate result controls whether the workflow advances to implementation.
