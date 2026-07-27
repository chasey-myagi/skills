---
name: workflow-run
description: >
  Run Claude Code-style workflow scripts (agent()/parallel()/pipeline() orchestration — e.g. the
  review-gate 3-gate PR review) from ANY agent CLI: claude, codex, kimi, or grok. The bundled
  zero-dependency Node runner provides the workflow runtime and dispatches each agent() call to a
  headless CLI backend with unified JSON-schema enforcement. Use whenever the user wants to run a
  workflow / review-gate / multi-agent orchestration script and the current host is codex, kimi, grok,
  or a headless environment — or wants gates fanned out across different vendors' models.
  Triggers on: "跑 review-gate", "run the review gate", "用 workflow 审这个 PR", "run workflow",
  "跨 CLI workflow", or any request to execute a *.workflow.js / ~/.claude/workflows/*.js script.
---

# workflow-run — 在任意 agent CLI 上跑 workflow 脚本

Workflow 脚本（`export const meta` + `agent()/parallel()/pipeline()/phase()/log()/args`，async body，顶层 `return`）原生只有 Claude Code 的 Workflow 工具能执行。本 skill 捆绑了一个**零依赖 Node runner**（`scripts/run.mjs`，Node ≥ 18），把这套运行时抽出来：`agent()` 落到本机任意一家 agent CLI 的 headless 模式，其余原语（并发、schema 强制、超时、错误→null 语义）由 runner 用确定性代码实现。

**不要试图自己模拟 agent()/parallel() 的语义**（手动串行派子代理、口头保证 JSON 格式）——并发 barrier、schema validate+retry、错误降级这些必须是代码，不是自觉。你的工作只是：拼好命令行、执行、把结果 JSON 转述给用户。

## 用法

```
node <本 skill 目录>/scripts/run.mjs <workflow.js> \
  [--args '<json>'] [--backend claude|codex|kimi|grok] [--model <m>] \
  [--route '<label-glob>=<backend>[:<model>]']... \
  [--concurrency N] [--timeout SECONDS] [--cwd DIR]
```

- **stdout = 唯一一份 JSON**（workflow 的返回值）；所有进度都在 stderr。程序化消费只读 stdout。
- `--backend`：所有 `agent()` 默认落到哪家 CLI（默认 claude；环境变量 `WORKFLOW_RUN_BACKEND` 可改默认）。**建议选宿主自己**——你是 codex 就用 `--backend codex`，避免跨家认证/额度意外。
- `--route`：按 agent label 分流到不同后端，如 `--route 'linus-review=grok' --route 'repro:*=codex:gpt-5.6-sol'`。先匹配先赢；模型名是**各家自己的命名空间**，runner 不会跨后端传递。
- `--cwd`：workflow 里 agent 的工作目录（review-gate 场景 = 被审仓库根）。
- `--timeout`：单个 agent 的墙钟上限（秒，默认 1200），runner 自己 SIGTERM/SIGKILL，四家 CLI 都没有内建超时。

## 现成示例：跑 review-gate

```bash
node <本 skill 目录>/scripts/run.mjs ~/.claude/workflows/review-gate.js \
  --args '{"repoDir":".","base":"main","head":"HEAD","context":"<一句话说明这个 PR 做了什么>"}' \
  --backend <宿主自己> --cwd <被审仓库根>
```

结果 JSON 的关键字段：`overall`（PASS/FAIL）、`reviews[]`（三个 gate 各自的 verdict/blocking/nonBlocking/summary）、`verification`（若 code-review FAIL 触发了 repro 验证：per-finding 的 CONFIRMED/REFUTED/NOT_TESTABLE，`effectiveBlocking`，advisory 的 `passedAfterVerification`）。**逐条转述给用户，不要只报一个 PASS/FAIL**；CONFIRMED finding 的 `testContent` 是修复验收契约，提醒用户落盘。

## 各家宿主怎么调

任何一家都是「用你的 shell/终端工具执行上面的 node 命令」。差异只在你怎么被唤起：

| 宿主 | 你被唤起的方式 | backend 建议 |
|---|---|---|
| Claude Code | `/workflow-run`（更好的选择是原生 Workflow 工具，本 skill 是给无 Workflow 工具的环境用的） | claude |
| codex | `$workflow-run` 或隐式触发 | codex |
| kimi CLI | `/skill:workflow-run` | kimi |
| grok CLI | `/workflow-run` | grok |

## 后端能力差异（runner 已抹平，但你要知道的）

- **schema 强制**：claude/grok 有原生 flag；codex 的原生 flag 是 strict-mode-only（要求 additionalProperties:false + 全字段 required，还有 MCP 冲突 bug），kimi 完全没有——所以 codex/kimi 走 prompt 注入。四家统一再过 runner 的本地校验，失败自动带错误重试 2 次，仍失败该 agent 返回 null（与 Claude Code Workflow 语义一致，脚本里的 `.filter(Boolean)` 会处理）。
- **成本计量**：claude/grok/codex 可从输出取 usage；kimi 的 headless 模式不吐 usage，计量列 N/A。
- **权限**：runner 默认放行（claude `bypassPermissions` / codex `workspace-write` / grok `bypassPermissions` / kimi 固定 auto）——workflow 的子 agent 需要读仓库、跑 git、必要时建 worktree 写测试。**只在你信任 workflow 脚本内容时才跑**；跑之前扫一眼脚本里的 agent prompt 是不是只做声称的事。

## 失败模式与安全边界

- **某家 CLI 未登录/额度耗尽**：该 agent 返回 null 并在 stderr 留错误。三 gate 场景下缺一个 gate 整体判 FAIL（`reviews.length !== 3`）——如实报告是哪家挂了，别把 transport 失败当 review FAIL 转述。
- **runner 整体退出码 1**：workflow 脚本自身抛错（语法/逻辑），stderr 有 stack，修脚本而不是重试。
- **长 prompt**：kimi 只能 argv 传参（无 stdin），超 150KB 时 runner 自动落临时文件让 agent 自读；其余三家走 stdin/prompt-file 无此限制。
- **安全边界**：runner 只派子进程跑本机已装的 CLI，不直连任何 API、不上传代码；子 agent 的权限即各家 CLI 的 headless 权限（见上），审查类 workflow 的 agent prompt 都要求只读。本 skill 不替用户 merge、不落盘修改被审仓库（repro verify 用后即删的临时 worktree 除外）。

## Notes

- 设计依据与四家 headless 机制的完整差异矩阵（含各 flag 实测记录、prior art 项目对比）见 [references/cli-matrix.md](references/cli-matrix.md)。
- Prior art：[six-ddc/codex-dynamic-workflows](https://github.com/six-ddc/codex-dynamic-workflows)（多后端，Bun IPC）、[scasella/claude-dynamic-workflows-codex](https://github.com/scasella/claude-dynamic-workflows-codex)（codex app-server，最成熟）。本实现刻意更小：4 个 CLI adapter + 统一 schema 层，无 viewer/resume。反向路线（Claude Code 换模型跑 workflow）见 cc-fleet / claude-code-router，解决的是「换模型」不是「换宿主」。
- 与 Claude Code Workflow 工具的差异：不支持 `workflow()` 嵌套、`budget` 是 stub（total=null）、`isolation:'worktree'` 选项忽略（review-gate 的 verify stage 在 agent prompt 里自建 worktree，不受影响）。
