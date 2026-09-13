---
name: test-review
description: >
  Review test cases for quality, coverage, and rigor via an independent reviewer agent.
  Use when: (1) tests have been written and need quality validation, (2) user says /test-review,
  (3) during TDD at the checkpoint selected by the parent workflow, (4) after a teammate writes
  tests and you need to verify quality. Acts as a test quality gate at that checkpoint.
  Triggers on: "review tests", "check test quality", "are these tests good enough", "test coverage",
  or any context where test adequacy is in question.
---

# Test Case Review

Dispatch an independent reviewer agent to evaluate test quality. You (the session leader) handle the workflow; the reviewer handles the analysis.

Use companion `review-gate` for the combined three-gate workflow. This standalone skill still handles a single test review. The parent may supply a JSON output schema; the scoring criteria and selected checkpoint remain unchanged.

## Flow

```
1. Discover test files
2. Gather context (spec, source, feature description)
3. Dispatch reviewer agent with context
4. Receive report
5. Present result + gate decision to user
```

## Step 1: Discover Test Files

Use the explicit paths or the task's known source checkout first. Keep the runtime's session root separate: use absolute paths and `git -C <source>`.

1. Record the source, branch/HEAD, and task scope. Honor a supplied range and resolve base/head refs to full SHAs.
2. For current work, inspect staged and unstaged changes plus `git ls-files --others --exclude-standard`; `git diff HEAD` alone misses new tests. Include only this task's relevant files.
3. If no changed tests are found, inspect the known feature's test directories and the explicit file list. Use the last commit only if it is the intended review; do not infer it from an empty diff. File-only review also works without Git or a first commit.
4. Announce the test files and checkpoint. Ask only if read-only discovery and task context still leave the target unclear.

## Step 2: Gather Context

Collect these items — they become the reviewer's input:

Declare `diff`, `working-tree`, or `snapshot`. Changes are judged against their base; a snapshot judges the specified suite's current state. Read applicable source-checkout `AGENTS.md` and `REVIEW_GUIDELINES.md`, including nested rules for target files. Separate requirements, observed execution results, and author explanations. Missing tests are a coverage finding, not proof that implementation is wrong.

| Context Item | Where to Find | Required? |
|---|---|---|
| **Test files** | Paths from Step 1 | Yes |
| **Feature description** | Specifications, README or observable behavior; test names only locate intent | Yes; state missing evidence rather than invent requirements |
| **Source code** | The implementation files the tests target (if they exist) | No (pure TDD may not have impl yet) |
| **Related spec** | `docs/`, design docs, plan docs | No but helpful |
| **Language/framework** | Infer from file extensions and imports | Yes (auto-detected) |

## Step 3: Dispatch Reviewer Agent

Spawn a **new agent** as the reviewer. The reviewer must be independent — it should NOT have context from implementation planning or prior conversation. This ensures unbiased review.

Use the runtime's independent-agent facility (pseudocode below). Pass the source, scope, constraints, and required backend/model explicitly according to user/project policy. An unavailable required backend blocks the review; it does not authorize substitution.

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

[paste the FULL contents of test-reviewer.md here — the dispatched reviewer can read repo files, but it has no idea where this skill is installed (skill dirs live outside the repo), so the rubric must arrive inline, not as a path reference. Repo files are different: pass paths and let the reviewer read them itself]

## 本次审核输入

### 测试文件
[source checkout absolute path + branch/HEAD + frozen SHAs OR current diff and explicit new-file list; test paths and task constraints]

### 当前检查点
[父流程指定的检查点，例如当前 RED 切片的前置评审、GREEN 后的切片评审或实现完成后的套件评审；不得自行改换阶段]

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
- Gate result (PASS/FAIL/INCONCLUSIVE)
- Missing scenarios list
- Suggestions

Keep the original report available. Summaries retain every finding ID, blocking decision, human callout and unrun check, without changing scores or verdicts. Informational changes are not missing scenarios or automatic fix tasks. Behavior bugs identified by this reviewer can enter `repro` under the same evidence rules as bugs found by code-review.

## Step 5: Gate Decision

Read the gate result from the report:

- **PASS** (all *applicable* dimensions ≥ 7.5 AND final ≥ 8.0; N/A dimensions are excluded from the per-dimension bar and their weight is redistributed):
  Report the gate passed for the recorded scope, then continue the parent's authorized workflow at its selected checkpoint.

- **FAIL**:
  Report concrete missing scenarios or test defects. For an authorized implementation task, the parent fixes in-scope test defects and reruns relevant checks and review; a review-only task returns findings without modifying files. Do not pass the blocked checkpoint until the findings are resolved or the user overrides it.

- **INCONCLUSIVE**:
  Preserve missing evidence or the absence of an applicable review target. Do not fabricate scores or pass the checkpoint; gather available inputs within scope and request only information that cannot be discovered.

With `tdd`, review a completed vertical slice or the suite after RED → GREEN; do not turn it into a mandatory review of all tests before any implementation. If a parent workflow explicitly requires a pre-implementation gate, preserve that gate and review the current slice before proceeding. Do not change another skill's automatic trigger or override an explicit approval requirement.

## 示例

同一个 `slugify` 函数、两份不同充分度的测试套件——这一对就是 reviewer 的校准夹具（真实运行产物）：
- [不足版（5 测试）→ FAIL 5.32](examples/sample-fail.md) —— 附 8 条具体缺失场景，「状态组合」N/A
- [充分版（15 测试，补齐 7 条）→ PASS 8.35](examples/sample-pass.md) —— Boundary 压线但达标，reviewer 不放水

这些是历史报告，不是可执行测试夹具。充分版中的两个 property test 只有占位注释；如果把展示代码当作实际测试输入，应如实报告空断言，不能为了复现历史 PASS 而忽略。前向校准只提供真实输入、规格和检查点，隐藏历史分数和判定。

## 失败模式与安全边界

dispatch 之前先处理这些边界，别让 reviewer 拿着空输入裸跑：
- **找不到测试文件**：先检查任务源码目录、暂存区和新文件；仍没有就如实说明。只有目标缺失时才询问路径，不无中生有地审。
- **不在 git 仓库 / `git diff` 失败**：检查已知源码路径与命令错误；显式文件 review 不依赖 Git。
- **读不到 `test-reviewer.md`**：说明 skill 安装不完整，停下来报告，**不要**用空 rubric 凑合 dispatch。

**安全边界**：reviewer 是**只读**的——阅读测试、打分、列缺失场景，**不修改文件、不执行变更、不调用外部服务**；必要的测试执行由父任务在已有授权内完成。父任务保留已批准的实现权限，跨 skill、委派、续接时携带授权来源和范围；新增范围和明确审批门仍需批准。review 结论不授权发布或 merge。

## Notes

- Each review is a **fresh agent**, without the author's discussion history. A re-review receives the current scope and accepted evidence with finding IDs, not instructions to preserve the earlier conclusion.
- If the user disagrees with a score, they can override the gate. But the default is strict enforcement.
- The parent workflow chooses the checkpoint; this skill evaluates test quality without redefining the parent's TDD order.

当前组合的独立前向校准输入与原始判定见 [calibration evidence](../review-gate/references/calibration/README.md)。历史例子的分数不是新版 rubric 的断言。
