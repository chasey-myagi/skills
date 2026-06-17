# Skills

我日常在 Claude Code 里用的 skill，按需平铺在这个仓库里——拿你想要的，留下你不想要的。

灵感来自 [mattpocock/skills](https://github.com/mattpocock/skills)。安装用 [`skills`](https://github.com/vercel-labs/skills) CLI——每个 skill 下方都给了 `npx skills@latest add <owner>/<repo>/<skill>` 一行命令。

## Review

派一个**全新 agent** 当审查员：它不继承你的会话历史、不知道代码是谁写的——这正是在自己代码上自查最缺的东西。评分带置信度门（不确定不报）和 **N/A 维度**（不适用的维度诚实标 N/A、权重重分配，不硬凑分污染 PASS 结论）。

- **code-review** — 代码评审：6 维加权评分 + 优先级问题清单 + PASS/FAIL 质量门。[看真实报告 →](code-review/examples/sample-pass.md)

  ```
  npx skills@latest add chasey-myagi/skills/code-review
  ```

- **test-review** — 测试评审：6 维评分 + 具体缺失场景清单。TDD 实施前的质量门。[看真实报告 →](test-review/examples/sample-report.md)

  ```
  npx skills@latest add chasey-myagi/skills/test-review
  ```

- **linus-review** — Linus 老爷子风格的毒舌 review：不留情面，但每句吐槽都指向真问题、给可执行的 fix。[看真实报告 →](linus-review/examples/sample-report.md)

  ```
  npx skills@latest add chasey-myagi/skills/linus-review
  ```

## License

[MIT](./LICENSE)
