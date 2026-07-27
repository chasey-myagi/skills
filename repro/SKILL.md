---
name: repro
description: >
  Turn review findings into executable evidence: dispatch an agent to write a red-light
  reproduction test per verifiable finding — red on current code proves the finding is real
  (false positives get REFUTED), and the same test becomes the tamper-proof acceptance contract
  for the fix agent. Use after code-review returns FAIL with Critical/Important findings, before
  dispatching a fix, or standalone to pin down a reported bug. Triggers on: /repro, "复现这个 bug",
  "验证这些 findings", "这个 finding 是真的吗", "把问题钉成测试", "写个复现测试".
---

# Repro — 把 review finding 钉成红灯测试

Review finding 是 LLM 意见；红灯测试是可执行证据。本 skill 把「意见」升格为「证据」：给每个可测的 finding 派一个独立 agent 写**红灯复现测试**——断言 spec 期望的正确行为、在当前代码上真实失败。一份测试两次回报：

1. **验真**：写得红 = finding 属实；诚实尝试后写不红 = 强误报信号（这是复读代码永远给不出的）。
2. **验收**：修复后同一份测试必须不加修改地翻绿——fix agent 不能靠改测试、skip 测试或特判输入蒙混过关。翻绿后测试晋升为永久回归资产。

你（主控 / session leader）负责路由、验收和握手；dispatch 的 agent 只负责写测试和跑测试。

## 适用范围（先路由，再 dispatch）

这是窄门，不是全量流程。路由由你做，agent 无权改判：

- **severity**：Critical 全做；Important 由用户或你点名才做；Minor 永不。
- **类别白名单**：正确性 / 错误处理 / 数据丢失 / 输入型安全（注入、路径穿越、日志泄密——测试 harness 内可表达的攻击输入）。
- **不做**：架构、可维护性、命名、风格、需求符合类——它们结构上不可证伪（当前输入下不存在失败行为），强写只会产出焊死实现的负债测试。这些保留原有人审路径，本 skill 对它们**沉默而非否决**。性能类仅在项目已有稳定 benchmark harness 时做，否则不碰。
- **数量护栏**：每轮最多 3 个 finding——超过 3 个 Critical 说明该整体打回重写，不是逐条诉讼。每个 finding 最多 2 次 dispatch 尝试，超限如实记 NOT-TESTABLE，不无限凹。

## Step 1: 收集 findings

来源不限于 code-review：code-review 报告的 Critical/Important Issues、linus-review 的吐槽、用户口述的 bug、issue 文本都行。每条 finding 整理出：

| 字段 | 说明 | 缺了怎么办 |
|---|---|---|
| id | 稳定编号（C1/I2，或自编） | 自己编一个 |
| file:line | 问题位置 | 让来源方补 |
| category / severity | 类别与等级 | 按路由规则判 |
| 声称的行为偏差 | **预期 X，实际 Y**——具体到可观察行为 | 只有「这里不好」没有行为偏差 → 不可测，如实告知 |
| 复现思路 | 具体输入 / 触发场景 | 可选，有则给 agent |

## Step 2: Dispatch repro agent

每个 finding 派一个独立 agent（findings 互不依赖时可并行）。

```
Agent(
  description: "repro: [finding id]",
  prompt: <see below>,
  subagent_type: "general-purpose"
)
```

### Dispatch Prompt Template

Read `repro-agent.md`（它与本文件同目录）for the full agent rubric. Construct the dispatch prompt as:

```
你是一个独立的复现工程师。请严格按照以下工作规范执行：

[paste the FULL contents of repro-agent.md here — the dispatched agent can read repo files,
but it has no idea where this skill is installed (skill dirs live outside the repo), so the
rubric must arrive inline. Repo files are different: pass paths and let the agent read them]

## 本次任务输入

### Finding
[id / file:line / category / severity / 声称的行为偏差（预期 X，实际 Y）/ 复现思路]

### 仓库与测试环境
[repo 路径；测试框架与运行命令，如 `cargo test` / `npx vitest run` / `node --test`；
多 worktree 环境务必给隔离 build 指令，如 CARGO_TARGET_DIR=./target]

### Spec / 文档
[spec、设计文档、issue 的路径或内容；没有就写"无——oracle 需从邻近测试/文档注释/标准语义中找"]

请按规范完成复现并输出报告。你的写权限严格限于：在约定测试目录新增测试文件 + 运行测试。
```

## Step 3: 机械验收 agent 产物（红灯合法性）

Agent 报告回来后，**你亲自跑，不采信转述**。逐条核对：

- [ ] agent 的改动只含约定目录下的**新增**测试文件（`git status --porcelain` + `git diff` 核查；碰了实现代码 / 既有测试 / runner 配置 → **整轮作废重跑**——越界 agent 的「确认」不可信，它可能已经改变了被测对象）
- [ ] CONFIRMED 的红灯：失败类型是**测试体内断言失败**（编译错、超时、setup 崩溃都不算红灯，退回判 BLOCKED）
- [ ] 失败输出与 finding 声称的行为偏差对得上（核对报告里的 predicted ↔ observed 映射）
- [ ] 同文件 control test（相同 setup 的合法场景）为绿——排除环境性红灯
- [ ] 红灯连跑 3 次全红——杀 flaky
- [ ] 其余 suite 在同环境为绿

多 worktree / 共享 build cache 环境（Rust 尤甚）：验收一律用隔离 target（`CARGO_TARGET_DIR=./target`），否则你验的可能根本不是当前代码。

## Step 4: 按判定处理

- **CONFIRMED** → 红灯测试落**独立 commit**（如 `repro: red tests for review round N`）作验收基线，记下 commit sha 和每个测试文件的内容快照。finding 升格为「已证实，附执行证据」。
- **REFUTED** → finding 解除 blocking（视同 withdrawn），反证测试 + 可红性证明输出**留档回写**审查报告。不要替 reviewer 改分——若该 finding 是某维度低分的主因，带证据重新 dispatch review round 2，让 reviewer 自己修正。分数是 reviewer 的判断产物，你只有转发权。
- **NOT-TESTABLE** → finding **保持原 severity**（不可测 ≠ 不成立），Critical 依旧 blocking，交人裁决。
- **BLOCKED** → 环境问题，修好重试；suite 本身跑不动时所有 finding 判 BLOCKED 并停止。

## Step 5: 与 fix agent 的握手（验收契约）

CONFIRMED 的红灯就是修复的验收契约。fix dispatch prompt 里 hardcode 硬约束（不靠自觉）：

```
修复以下已证实的 finding，使这些红灯测试通过：<test paths>（红灯基线 commit: <sha>）。
禁止：
- 修改 tests/repro/** 或任何既有测试文件
- 修改 test runner / CI / build 配置（含 skip list、测试路径过滤）
- 在实现代码中新增测试环境探测分支（cfg!(test)、NODE_ENV === 'test' 之类）
验收由主控亲自运行，不采信你自报的测试结果。
```

修复完成后，你机械验收五条（全是命令级检查，不是判断题）：

1. `git diff <repro-commit>..HEAD -- <repro 测试路径> <既有测试路径>` 为**空**
2. 每个红灯测试单独运行**变绿**
3. 全量 suite 绿，且 pass 列表 ⊇ 修复前基线（防删/skip 其他测试凑全绿）
4. fix diff 的文件名不含 runner / CI / build 配置
5. grep fix diff 无新增测试环境探测模式

全过 → 红灯测试去掉 repro 前缀、晋升为正式回归测试，然后**照常进 code-review round 2**。红灯契约是验收下界，不取代审查上界——fix diff 可能引入契约范围外的新问题。

## 示例

这些是真实运行产物（repro agent 实际输出），不是虚构样例：

- [真 bug → CONFIRMED](examples/sample-confirmed.md) —— 展示预注册失败签名 + control test + 断言↔finding 映射
- [误报 → REFUTED](examples/sample-refuted.md) —— 展示可红性证明（翻转断言变红，恢复变绿）与场景边界声明
- [不可测 → NOT-TESTABLE](examples/sample-not-testable.md) —— 展示枚举不被滥用：附真实尝试记录，finding 保持 blocking

## 失败模式与安全边界

dispatch 之前先处理这些边界：

- **没有可测 finding**：全部走人审，如实告知——不要为了产出硬凑测试。
- **finding 缺「预期 X 实际 Y」**：让来源方补具体行为偏差，不要替它脑补。
- **agent 越界改了非测试文件**：整轮作废重跑，不要「顺手保留」它的改动。
- **suite 无法运行**：全部判 BLOCKED 并停止，先修环境。
- **单轮 NOT-TESTABLE 超过送审 finding 的半数**：停下来向用户说明——大概率是路由出了问题（不可证伪类混进了队列），不是继续标。
- **读不到 `repro-agent.md`**：skill 安装不完整，停下报告，不要用空 rubric 凑合 dispatch。

**安全边界**：repro agent 的写权限严格限于「约定目录下新增测试文件 + 运行测试」，由主控 `git diff` 机械核查兜底，不是 honor system。本 skill 不修 bug、不改实现、不替用户 merge；判定结论是证据，最终裁决权在用户。

## Notes

- 与 test-review 互补不重叠：test-review 审套件整体充分度（**面**），repro 验单个 finding 真伪（**点**）。CONFIRMED 测试翻绿晋升后就是普通套件成员，受 test-review 管辖——所以 rubric 要求它本身达到 test-review「测试质量」维度标准，别造应急负债。
- 链路位置：`tdd → test-review → code-review →（FAIL 且要修：repro → fix → 机械验收 → code-review round 2）→ linus-review`。
- 经济账：一次红灯 dispatch 对冲的是「假 Critical 触发完整 fix + re-review 循环」与「修了没修好拖到下轮全量 review 才暴露」。review 报告读完即弃，翻绿的红灯测试永久摊销。
