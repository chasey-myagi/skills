# 样例：纯函数测试套件 → FAIL（附具体缺失场景）

> 这是 **test-review** 的一次真实运行产物（独立 reviewer agent 实际输出，未编辑）。
> 它展示两件事：(1) 对无状态纯函数，「状态组合」维度被正确标 N/A，不会被硬扣低分；
> (2) N/A **不**被滥用——纯函数虽不抛异常，但退化输入（空串/纯标点）的行为契约是真实
> 的「缺失场景」，reviewer 让「错误路径」留在适用维度并判低分，最终 FAIL，并给出 8 条
> 可直接落地的缺失用例。

## 输入

被测：`slugify(input: string): string` —— 标题转 URL slug（转小写、空格转连字符、折叠连续空格、去标点、去首尾空格）。无状态纯函数。无 spec。

```ts
import { slugify } from "./slugify";

test("converts spaces to hyphens", () => { expect(slugify("hello world")).toBe("hello-world"); });
test("lowercases input",        () => { expect(slugify("Hello World")).toBe("hello-world"); });
test("strips punctuation",      () => { expect(slugify("hello, world!")).toBe("hello-world"); });
test("collapses multiple spaces", () => { expect(slugify("hello   world")).toBe("hello-world"); });
test("trims leading and trailing spaces", () => { expect(slugify("  hello world  ")).toBe("hello-world"); });
```

## 输出（reviewer 报告）

### Scores

| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Quantity Adequacy | 7.0 | 15% → 17.65% | 1.24 |
| Scenario Coverage | 6.0 | 20% → 23.53% | 1.41 |
| Boundary Exploration | 3.5 | 20% → 23.53% | 0.82 |
| Error Path Coverage | 2.0 | 15% → 17.65% | 0.35 |
| State Combination | N/A | — | — |
| Test Quality | 8.5 | 15% → 17.65% | 1.50 |
| **Weighted Total** | | | **5.32** |
| E2E Bonus | 0 | | |
| **Final Score** | | | **5.32** |

> **State Combination → N/A**：被测对象是无状态纯函数，无内部状态/生命周期/状态转换，该维度检查清单（状态矩阵、并发修改、交错操作）没有可评估内容。其 15% 权重按 ÷0.85 归一化重分配给其余 5 个适用维度。

### Result: FAIL ❌

- **Boundary 3.5**（需 ≥7.5）：除"多空格"外无任何边界输入。
- **Error Path 2.0**（需 ≥7.5）：退化输入（空串/全标点/全空白）会产出什么完全没覆盖——这是 slugify 最易出 bug 处。
- **Scenario 6.0**（需 ≥7.5）：只测 5 条规则各自的 happy path，规则组合与"输出退化为空"没测。
- **Final 5.32**（需 ≥8.0）。

### Missing Scenarios（实现前必须补充）

1. **空字符串** — `expect(slugify("")).toBe("")`。
2. **纯空白** — `expect(slugify("   ")).toBe("")`，验证不留孤立连字符。
3. **纯标点** — `expect(slugify("!!!")).toBe("")`，验证不产出空 slug / 多余连字符。
4. **首尾标点产生的边界连字符** — `slugify("!hello world!")` 是否产出 `"-hello-world-"`？slug 最常见的 bug。
5. **标点紧邻空格的折叠** — `slugify("hello , world")` 是否留多余空格/双连字符（规则交互）。
6. **Unicode / 重音 / emoji** — `slugify("Café déjà 🎉")`：非 ASCII 字母怎么处理？契约真空地带。
7. **数字与已有连字符** — `slugify("Top 10 Tips")`、`slugify("a-b")`：数字是否保留、连字符是否重复折叠。
8. **制表符/换行等非空格空白** — `slugify("hello\tworld")`：`\t`/`\n` 算不算"空格"？

### Suggestions（不阻塞）

1. 用 `describe` 分组 + `test.each` 表驱动。
2. 补"输出契约"不变量断言：结果只含 `[a-z0-9-]`、无前导/尾随连字符、无连续连字符。
3. 补一个"规则叠加"的长标题组合用例。
