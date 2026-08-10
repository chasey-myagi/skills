# Skills

我日常在 Claude Code 里用的 skill，按需平铺在这个仓库里——拿你想要的，留下你不想要的。

灵感来自 [mattpocock/skills](https://github.com/mattpocock/skills)。安装用 [`skills`](https://github.com/vercel-labs/skills) CLI——每个 skill 下方都给了 `npx skills@latest add <owner>/<repo>/<skill>` 一行命令。

## Develop

- **tdd** — 测试驱动开发的红绿重构工作流：垂直切片 / tracer bullet（一个测试 → 一个实现），测行为不测实现、测试能扛住重构。是下面 review 三件套的上游入口——先用它写测试和实现，再往下游送审。[看真实 TDD session →](tdd/examples/tdd-session.md)

  ```
  npx skills@latest add chasey-myagi/skills/tdd
  ```

- **issue-fix** — Issue 驱动的 bug 修复编排：8 阶段 + 2 审批门（读 issue → 取证 → 复现钉红灯 → 根因确认 → 方案确认 → 开发 → 回归 → PR），修根因不修症状、红灯即验收契约。复现/测试/PR 的具体命令交给「项目适配层」（project 级 skill / AGENTS.md），本 skill 只带流程骨架和纪律。

  ```
  npx skills@latest add chasey-myagi/skills/issue-fix
  ```

## Review

派一个**全新 agent** 当审查员：它不继承你的会话历史、不知道代码是谁写的——这正是在自己代码上自查最缺的东西。评分带置信度门（不确定不报）和 **N/A 维度**（不适用的维度诚实标 N/A、权重重分配，不硬凑分污染 PASS 结论）。

- **code-review** — 代码评审：6 维加权评分 + 优先级问题清单 + PASS/FAIL 质量门。[看真实报告 →](code-review/examples/sample-pass.md)

  ```
  npx skills@latest add chasey-myagi/skills/code-review
  ```

- **test-review** — 测试评审：6 维评分 + 具体缺失场景清单。TDD 实施前的质量门。[看真实报告 →](test-review/examples/sample-fail.md)

  ```
  npx skills@latest add chasey-myagi/skills/test-review
  ```

- **linus-review** — Linus 老爷子风格的毒舌 review：不留情面，但每句吐槽都指向真问题、给可执行的 fix。[看真实报告 →](linus-review/examples/sample-report.md)

  ```
  npx skills@latest add chasey-myagi/skills/linus-review
  ```

## Verify

Review finding 是 LLM 意见，可能真实也可能虚假；dev-agent 修复时可能真验证也可能只是把测试跑绿。这一层把「意见」升格为「可执行证据」。

- **repro** — 给每个可证伪的 Critical/Important finding 派独立 agent 写**红灯复现测试**：写得红 = finding 属实（CONFIRMED，红灯即修复的防篡改验收契约）；诚实尝试后反证为绿 = 误报（REFUTED，解除 blocking）；本质测不了 = NOT-TESTABLE（不可测 ≠ 不成立，保持 blocking 交人审）。窄门设计：架构/品味类不进队列，每轮 cap 3。[CONFIRMED →](repro/examples/sample-confirmed.md) · [REFUTED →](repro/examples/sample-refuted.md) · [NOT-TESTABLE →](repro/examples/sample-not-testable.md)

  ```
  npx skills@latest add chasey-myagi/skills/repro
  ```

完整链路：`tdd → test-review → code-review →（FAIL 且要修：repro → fix → 机械验收 → code-review round 2）→ linus-review`。
修 bug 走 `issue-fix` 编排全程——它的阶段 3 / 5-6 / 7 分别落在 repro 协议、tdd 纪律和 review 质量门上。

## Anywhere

- **workflow-run** — 在**任意** agent CLI（claude / codex / kimi / grok）上跑 Claude Code 风格的 workflow 脚本（如 review-gate 的 3-gate PR review）。捆绑零依赖 Node runner：`agent()` 落到各家 headless 模式，schema 强制统一走 validate+retry，`--route` 可把不同 gate 分流到不同家的模型。四家 headless 机制差异矩阵见 [references/cli-matrix.md](workflow-run/references/cli-matrix.md)。

  ```
  npx skills@latest add chasey-myagi/skills/workflow-run
  ```

## License

[MIT](./LICENSE)
