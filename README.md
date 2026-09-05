# Skills

我日常在 Coding Agent 中使用的 Skills，按需平铺在这个仓库里。公共流程放在这里；各项目的环境、模型分工、资源保护和审批政策留在项目适配层。

灵感来自 [mattpocock/skills](https://github.com/mattpocock/skills)。安装用 [`skills`](https://github.com/vercel-labs/skills) CLI——每个 skill 下方都给了 `npx skills@latest add <owner>/<repo>/<skill>` 一行命令。

## 多 Agent 安装与维护

源码改动回到本仓库；安装目录是分发产物。先把安装目录中的独有修改回收到源码，再更新整个包（包括 reviewer、scripts 和 references），避免只同步 `SKILL.md`。

本地候选版本可用固定版本 CLI 按包和 runtime 安装，源码路径替换为自己的 checkout：

```bash
npx --yes skills@1.5.23 add /absolute/path/to/skills \
  --global --skill issue-fix tdd code-review test-review linus-review repro workflow-run \
  --agent claude-code grok codex cursor --yes
```

在这个 CLI 版本下，多目标默认将包复制到 `~/.agents/skills/<name>`，再为 Claude/Grok 建立链接；canonical 内容不依赖源码 checkout 保留。Codex/Cursor 使用 universal 目录，因此 CLI 不会清除它们专属目录中的旧副本。已有同名副本时，先备份到 Skills 发现目录以外，再统一到 canonical；需要专属入口时只建立指向 canonical 的链接。其他名称的 Skill 保留。

安装后检查完整包哈希、所有入口的实际指向和无关 Skills 是否变化。记录源码 commit、未提交 diff（若有）、CLI 版本与安装时间。**本地路径安装不写官方来源 lock**，应保留单独安装记录；发布后从明确的远端 ref 安装，再使用 CLI 的来源追踪。不要把本地候选称作已发布版本。

项目约束仍由项目 `AGENTS.md` / Skills 承载：公共 Skill 不指定个人路径、固定模型分工或资源名称，也不替项目增加 commit、发布、merge 或验收权限。

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

- **test-review** — 测试评审：6 维评分 + 具体缺失场景清单。在父流程指定的检查点评估测试质量；与垂直 TDD 配合时审当前切片或完整套件。[看真实报告 →](test-review/examples/sample-fail.md)

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
