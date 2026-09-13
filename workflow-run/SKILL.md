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
  [--concurrency N] [--timeout SECONDS] [--cwd DIR] [--effort E] \
  [--status-file PATH] [--task-id ID]
```

- **stdout = 唯一一份 JSON**（workflow 的返回值）；所有进度都在 stderr。程序化消费只读 stdout。agent 执行失败时该次 `agent()` 仍返回 `null`（脚本里的 `.filter(Boolean)` 可继续用）。
- **退出码**（和 stdout 里的 review verdict 是两件事）：
  - `0`：workflow 跑完，每个 agent 都真正执行成功——**包括**合法的 review `verdict: FAIL`
  - `1`：用法错误，或 workflow 脚本自己抛错
  - `2`：至少一次 agent CLI 执行失败（未登录、缺二进制、超时、进程非 0、schema 耗尽等）。脚本仍可能合成 `{overall:'FAIL', reviews:[]}`——那是脚本在过滤 `null`，不是审查结论
- `--backend` / `--model` / `--route` / 脚本 `opts.backend`+`opts.model`：显式绑定。**模型名是各家自己的命名空间**，runner 不会把一家的模型名传给另一家，也不会因为当前宿主是另一家 CLI 就改派。选定 grok 就跑 grok；不要为了「我在 codex 里」而改掉脚本或路由已经指定的后端。
- 解析优先级：脚本 `opts.backend`（配 `opts.model`）→ 首个匹配的 `--route`（用该 route 的模型）→ 默认 backend。显式后端不受支持时记 `BACKEND_UNAVAILABLE`，不回退。在默认 Claude 下 `opts.model` 优先于 `--model`；其他默认 backend 使用 `--model`，不会解释脚本里的 Claude 模型别名。需要固定某次调用的模型时，给完整 `opts.backend` + `opts.model`，并核对 sidecar 的解析结果，不把孤立的 `model:'opus'` 当成跨后端约束。
- `--cwd`：**agent 会话工作目录**。它可以和 workflow `--args` 里的 `repoDir` 不同，也和 source review 冻结的 `base`/`head` 不同——审查范围由脚本参数决定，会话 cwd 只影响 CLI 在哪棵树上读文件、跑命令。
- `--timeout`：单个 agent 的墙钟上限（秒，默认 1200），runner 自己 SIGTERM/SIGKILL，四家 CLI 都没有内建超时。
- `--effort`：有推理档位的后端（目前 grok 的 `--reasoning-effort`）的默认档；脚本里 `opts.effort` 优先。没有该 flag 的后端会忽略，而不是报错。
- `--status-file PATH`：本 run 独占创建的 JSON sidecar（路径已存在——含悬空 symlink——则拒绝，不改内容、不派 agent）。schema 见下。
- `--task-id ID`：写入 sidecar 的 `task_id`。没有 `--status-file` 时只作为 stderr 上的 harmless metadata，不报错。

## 组合审查：review-gate

同仓库的 `review-gate` skill 提供范围准备、三门组合、结构化 finding、人类提示和修复交接。本 skill 只负责执行 workflow，保留通用 `agent()` / 路由 / 状态契约，不内置审查判断。

```bash
node <review-gate skill 目录>/scripts/run.mjs \
  --args '{"repoDir":"<源码绝对路径>","mode":"diff","base":"<base ref>","head":"<head ref>","context":"<需求与已观测事实>"}' \
  --backend <脚本或 --route 选定的后端> \
  --cwd <agent 会话目录> \
  --status-file <本次运行独有的新文件路径>
```

结果解释以 `review-gate` 的 schema 和 skill 为准。保留各门原始报告、finding ID、知情提示、scope 和产物路径；不能只报 PASS/FAIL。Repro 候选结论需要父任务机械验收，不能由 workflow 自动改写原始 gate 的判定。

先看 runner 退出码和 sidecar：exit 2 表示有 agent 没真正跑成，review-gate 的 `overall: INVALID` 不能当成有效审查结论。exit 0 和 `completed` 只证明已调用的 agent 执行成功；还要核对预期三个 gate 的名称、结果数量和各自 verdict，不能从 runner 状态推断脚本实际调用了哪些 gate。

## sidecar（`--status-file`）

独占创建，随后只由这一次 run 更新。不含 prompt、模型原文、异常消息或密钥。
更新前核对文件身份和 `run_id`；路径被替换或写入失败时退出 1，保留外来文件。写入按序执行并以临时文件原子替换。状态写入失败后停止继续写入，最后有效快照可能仍为 `running`；此时退出码 1 和 stderr 是失败证据，不声称终态已经落盘。不要让其他进程写本 run 的状态路径。runner 在收尾前等待已启动的 `agent()` 调用完成；脚本自身仍应 `await` 其异步工作。强制杀进程或主机崩溃也可能留下 `running`，它不能代替进程存活检测。

```json
{
  "schema_version": 1,
  "run_id": "<uuid>",
  "task_id": "<string or null>",
  "status": "running|completed|blocked|failed",
  "started_at": "<iso>",
  "finished_at": "<iso or null>",
  "agents": [
    {
      "id": "<uuid>",
      "label": "code-review",
      "backend": "claude",
      "model": null,
      "status": "running|completed|blocked|failed",
      "error_code": null
    }
  ]
}
```

- `model` 是**解析后请求的模型**。CLI 默认模型未知，记 `null`，不要猜实际跑了哪个。
- 最终 `status`：只有 blocked 类执行失败 → `blocked`；任一 `failed` 执行失败 → `failed`；没有执行失败 → `completed`。workflow 脚本抛错 → `failed` 且 exit 1。
- agent `error_code`：`AUTH_REQUIRED` / `QUOTA_EXCEEDED` / `BACKEND_UNAVAILABLE`（blocked）；`TIMEOUT` / `PROCESS_EXIT` / `INVALID_OUTPUT`（failed）。这是诊断分类，**不会**因此自动换后端或重试登录。合法 review 正文里出现 “login”/“quota” 不会单独被当成这类错误。进程非 0 即使 stdout 看起来像成功信封，该 agent 也不是 `completed`。原生错误信封（claude `is_error`、grok `type=error`）在进程退出码为 0 时仍会检出。schema 重试救回算成功；两次重试仍失败算 `INVALID_OUTPUT`。

## 各家宿主怎么调

任何一家都是「用你的 shell/终端工具执行上面的 node 命令」。差异只在你怎么被唤起。后端以脚本 / `--backend` / `--route` 的显式绑定为准，不随宿主改写。

| 宿主 | 你被唤起的方式 |
|---|---|
| Claude Code | `/workflow-run`（更好的选择是原生 Workflow 工具，本 skill 是给无 Workflow 工具的环境用的） |
| codex | `$workflow-run` 或隐式触发 |
| kimi CLI | `/skill:workflow-run` |
| grok CLI | `/workflow-run` |

## 后端能力差异（runner 已抹平，但你要知道的）

- **schema 强制**：claude 用原生 `--json-schema`；codex、kimi、grok 走 prompt 注入。Grok 带工具的 workflow 曾在本机遇到原生 schema 提前产出占位结果，因此沿用本地已验证的 prompt 方式；这不是对所有 CLI 版本的能力断言。四家统一经过 runner 的本地校验（支持 type/required/properties/items/enum，允许额外字段，非完整 JSON Schema 引擎），失败带错误重试 2 次，耗尽后返回 null、记 `INVALID_OUTPUT` 并 exit 2。
- **成本计量**：claude/grok/codex 可从输出取 usage；kimi 的 headless 模式不吐 usage，计量列 N/A。
- **权限**：runner 默认放行（claude `bypassPermissions` / codex `workspace-write` / grok `bypassPermissions` / kimi 固定 auto）——workflow 的子 agent 需要读仓库、跑 git、必要时建 worktree 写测试。**只在你信任 workflow 脚本内容时才跑**；跑之前扫一眼脚本里的 agent prompt 是不是只做声称的事。

## 失败模式与安全边界

- **某家 CLI 未登录/额度耗尽/二进制不在 PATH**：该 agent 返回 null，sidecar 记 `AUTH_REQUIRED` / `QUOTA_EXCEEDED` / `BACKEND_UNAVAILABLE`（blocked），runner exit 2。三 gate 场景下缺一个 gate 时脚本常会给出 `overall: FAIL` 且 `reviews.length !== 3`——如实报告是哪家没跑成，别把 transport 失败当 review FAIL 转述。
- **runner 退出码 1**：workflow 脚本自身抛错（语法/逻辑），或状态文件创建/更新失败；stderr 有原因。先处理具体问题，不把它当评审结论，也不覆盖已有 run 的记录。
- **长 prompt**：kimi 只能 argv 传参（无 stdin），超 150KB 时 runner 自动落临时文件让 agent 自读；其余三家走 stdin/prompt-file 无此限制。
- **安全边界**：runner 启动本机 CLI，由 CLI 按自身配置与模型服务通信；调用 CLI 不意味着数据只留在本机。子 agent 的文件与外部操作权限受用户授权、项目规则和 CLI 设置约束，reviewer 保持只读。repro 等写入步骤必须有明确目标与已有授权；临时 worktree 的创建和清理仍需遵守项目资源保护。sidecar 不含 prompt 和模型原文。

## Notes

- 在源码仓库运行 `node --test workflow-run/tests/*.test.mjs` 验证公开 CLI 契约。测试使用临时 fake CLI，不调用付费模型；不代表四家真实服务的端到端验收。

- 设计依据与四家 headless 机制的完整差异矩阵（含各 flag 实测记录、prior art 项目对比）见 [references/cli-matrix.md](references/cli-matrix.md)。
- Prior art：[six-ddc/codex-dynamic-workflows](https://github.com/six-ddc/codex-dynamic-workflows)（多后端，Bun IPC）、[scasella/claude-dynamic-workflows-codex](https://github.com/scasella/claude-dynamic-workflows-codex)（codex app-server，最成熟）。本实现刻意更小：4 个 CLI adapter + 统一 schema 层，无 viewer/resume。反向路线（Claude Code 换模型跑 workflow）见 cc-fleet / claude-code-router，解决的是「换模型」不是「换宿主」。
- 与 Claude Code Workflow 工具的差异：不支持 `workflow()` 嵌套、`budget` 是 stub（total=null）、`isolation:'worktree'` 选项忽略。需要隔离源码的 workflow 自己管理目标与资源，不能把该选项当成已建立隔离的证据。
