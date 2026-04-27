# Skills

我日常在 Claude Code 里用的 skill，按需平铺在这个仓库里——拿你想要的，留下你不想要的。

灵感来自 [mattpocock/skills](https://github.com/mattpocock/skills)。

## Review

独立 reviewer agent 把质量门关上，避免在自己写的代码上自查偏盲。

- **code-review** — 代码评审：6 维评分 + 优先级排序的问题清单。

  ```
  npx skills@latest add chasey-myagi/skills/code-review
  ```

- **test-review** — 测试评审：6 维评分 + 缺失场景清单。TDD 实施前的质量门。

  ```
  npx skills@latest add chasey-myagi/skills/test-review
  ```

- **linus-review** — Linus 老爷子风格的毒舌 review：不留情面，但每句吐槽都指向真问题。

  ```
  npx skills@latest add chasey-myagi/skills/linus-review
  ```

## Output

- **research-report** — 把 research findings 编排成单文件 HTML 报告：专业排版、暗/亮主题、可分享。

  ```
  npx skills@latest add chasey-myagi/skills/research-report
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
