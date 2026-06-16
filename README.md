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

## Output

- **research-report** — 把 research findings 编排成单文件 HTML 报告：专业排版、暗/亮主题、可分享。

  ```
  npx skills@latest add chasey-myagi/skills/research-report
  ```

- **pdf-html** — 写一份打印为 A4 PDF 时分页干净、带真实页码的单文件 HTML 报告。Sheet-stack 布局 + `@page` margin boxes（Chrome 原生支持）+ 纯 `window.print()` 导出，不用 paged.js polyfill。模板里不预设配色 / 字体，开工前先问用户。

  ```
  npx skills@latest add chasey-myagi/skills/pdf-html
  ```

## Migration

- **repo-port** — 把开源仓库忠实移植到另一种语言/生态。五阶段多 agent 流水线（Map → Analyze → Consolidate → Port → Review），写代码前强制一次 consolidation。适合把现成实现作为 base，再叠你自己的优化。

  ```
  npx skills@latest add chasey-myagi/skills/repo-port
  ```

## Communication

- **caveman** — 极简通信模式：砍 ~75% token，丢冠词、客套、废话，技术细节一字不少。多 agent batch dispatch 时省 context。改编自 [mattpocock/skills/caveman](https://github.com/mattpocock/skills/tree/main/caveman)。

  ```
  npx skills@latest add chasey-myagi/skills/caveman
  ```

- **zoom-out** — 一行 trigger，让 agent 拉高一层抽象，给出当前代码区域的模块地图和调用关系。适合接手不熟的代码块。改编自 [mattpocock/skills/zoom-out](https://github.com/mattpocock/skills/tree/main/zoom-out)。

  ```
  npx skills@latest add chasey-myagi/skills/zoom-out
  ```

## License

[BUSL-1.1](./LICENSE)
