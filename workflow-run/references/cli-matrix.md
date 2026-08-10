# 四家 agent CLI headless 机制矩阵（2026-07 实测）

> runner adapter 层的工程依据。实测环境：claude 2.1.207 / codex-cli 0.144.1 / kimi 0.29.2 / grok 0.2.112（macOS）。
> 改 adapter 前先用 `<cli> --help` 复核 flag 是否仍存在——四家都在快速迭代。

## 总表

| | claude | codex | kimi | grok |
|---|---|---|---|---|
| headless 入口 | `claude -p` | `codex exec` | `kimi -p` | `grok -p` / `--prompt-file` |
| prompt 传递 | **stdin** 或 argv | **stdin**（`-`）或 argv | **仅 argv**（ARG_MAX 风险） | argv 或 `--prompt-file`（**不读 stdin**；`-p` 必须带内联值） |
| 结构化输出 flag | `--json-schema`（内联） | `--output-schema`（文件路径；strict-mode-only，**弃用**，走 prompt 注入） | 无 | `--json-schema`（内联，implies json） |
| 最终文本提取 | `--output-format json` 信封 `.result`；schema 结果在 `.structured_output` | `-o <file>`（--output-last-message）文件内容 | `--output-format stream-json` JSONL 里最后一条 `role=assistant` 且有 `content` 的行 | json 信封 `.text`（schema 时需二次 `JSON.parse`） |
| usage/cost | `.usage` / `.total_cost_usd` | `--json` 事件流 turn.completed.usage | **无** | `.usage` / `.total_cost_usd`（`cost_is_partial` 时整体省略） |
| 权限 flag | `--permission-mode bypassPermissions`（或 `--allowedTools` 白名单） | `-s read-only\|workspace-write\|danger-full-access` | 无（print 模式固定 auto policy） | `--permission-mode bypassPermissions`；另有 `--tools`/`--deny` 细粒度 |
| 免落盘 session | `--no-session-persistence` | `--ephemeral` | 无 | 无 |
| resume | `--resume <session_id>` | `codex exec resume <id>` | `-r <sessionId>`（stream-json 的 resume_hint meta 行给 id） | `--resume <sessionId>` |
| 内建超时 | 无 | 无 | 无 | 无（runner 自管 SIGTERM→SIGKILL） |
| 退出码 | 0/非0 + 信封 `is_error` | 0/1 | 0/1；信号 129/130/143 | 0/1/130/143；错误输出 `{"type":"error",...}` |

## Adapter 命令模板（run.mjs 实际使用）

```bash
# claude — stdin 传 prompt
claude -p --output-format json --no-session-persistence \
  --permission-mode bypassPermissions [--model M] [--json-schema '<inline>'] < prompt

# codex — stdin 传 prompt（'-'），-o 文件取最终文本；schema 走 prompt 注入
codex exec --skip-git-repo-check --ephemeral -s workspace-write \
  -o /tmp/last.txt -C <cwd> [-m M] - < prompt

# kimi — 仅 argv；>150KB 时 runner 落临时文件让 agent 自读；schema 走 prompt 注入
kimi -p "<prompt>" --output-format stream-json [-m M]

# grok — --prompt-file（不与 -p 组合；-p 是 --single 必须带内联值）
grok --prompt-file <f> --output-format json --permission-mode bypassPermissions \
  --no-auto-update --cwd <cwd> [-m M] [--json-schema '<inline>']
```

## 实测踩过的坑（冒烟记录，2026-07-27）

1. **codex `--output-schema` 400**：`invalid_json_schema — 'additionalProperties' is required to be supplied and to be false`。OpenAI strict structured outputs 要求每层 object 都带 `additionalProperties:false` 且全字段进 `required`（可选字段要改 `type:[T,"null"]`）。叠加「MCP 工具活跃时被静默忽略」（openai/codex #15451）和 gpt-5 系限定——弃用原生 flag，codex 统一 prompt 注入 + runner 校验重试。
2. **grok `-p --prompt-file` 组合报错**：`a value is required for '--single <PROMPT>'`。`-p` 就是 `--single`，必须内联值；`--prompt-file` 是独立 flag，二者不组合。
   另：grok 的 `--output-format` 合法值是 `plain|json|streaming-json|streaming-messages-json`——**没有 `text`**，传错直接 exit 2。
3. **模型名跨后端泄漏**：全局 `--model haiku` 一度被传给路由到 grok/kimi 的 agent（`unknown model id` / `not configured in config.toml`）。模型名是各家命名空间——runner 现规则：`opts.backend` 显式指定时信任 `opts.model`；`--route` 匹配用 route 自带 `:model`；默认后端用 `--model`，且脚本侧 `opts.model`（CC 别名如 sonnet/haiku）只在 claude 后端生效。
4. **kimi 的 text 模式不可解析**（输出带 `• ` 装饰 + 按终端宽折行）——必须 `stream-json`。thinking 在 stream-json 中被丢弃，tool progress 走 stderr。
5. **只解析 stdout**：grok 的更新提示、kimi 的工具进度、RUST_LOG 都走 stderr；stdout 保持干净是四家共同承诺（kimi 除外——它 stdout 是 JSONL 多行，逐行 tryParse）。

## Prior art（2026-07 调研）

| 项目 | 是什么 | 为什么没直接用 |
|---|---|---|
| [six-ddc/codex-dynamic-workflows](https://github.com/six-ddc/codex-dynamic-workflows) | 多后端（Codex/Gemini/pi）workflow runner，Bun 子进程 + JSONL IPC，schema retry，React viewer | 架构同款、可参考；但不支持 kimi/grok，12 star 早期项目，vendor 成本 > 自写 400 行 |
| [scasella/claude-dynamic-workflows-codex](https://github.com/scasella/claude-dynamic-workflows-codex) | codex-only runner，走 codex app-server 协议，扩展 human() 门控 / 长活 worker，299 star | 单后端且协议耦合 codex app-server，移植面大 |
| [ethanhq/cc-fleet](https://github.com/ethanhq/cc-fleet) | 反向路线：Claude Code 的 workflow 原样跑，模型换成第三方（Kimi/GLM/…） | 解决「换模型」不是「换宿主 CLI」；Codex 订阅接入属非官方（ToS 风险） |
| [musistudio/claude-code-router](https://github.com/musistudio/claude-code-router) | 36k star 模型网关，Kimi 官方赞助 | 同上——换模型不换 harness |
| agent-runbook（awesome-agent-orchestrators 收录） | YAML runbook 编译成 SKILL.md | 「纯 skill 教学」路线的最近似先例，只能表达顺序流程——恰好证明 parallel/schema/barrier 必须要 runner |

结论：「独立 runner + skill 只做入口」是被生态验证过的唯一可行架构；纯 prompt/skill 模拟编排语义没有成功先例。
