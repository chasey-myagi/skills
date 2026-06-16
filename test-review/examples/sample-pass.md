# 样例：充分覆盖的测试套件 → 稳健 PASS

> 这是 **test-review** 的一次真实运行产物（未编辑）。它和 [sample-fail.md](sample-fail.md) 是
> **同一个 `slugify` 函数**：那份只有 5 个测试、漏了 8 类场景，FAIL 5.32；这份 15 个测试补齐了
> 其中 7 类，PASS 8.35。同函数 before/after 这一对，就是这把尺子的校准夹具——
> 改 rubric 后重跑它们，确认 FAIL 的仍 FAIL、PASS 的仍 PASS。

## 输入

`src/slugify.test.ts`，15 个测试。无状态纯函数，无 spec。

```ts
describe("slugify", () => {
  test("converts spaces to hyphens", () => expect(slugify("hello world")).toBe("hello-world"));
  test("lowercases input", () => expect(slugify("Hello World")).toBe("hello-world"));
  test("strips punctuation", () => expect(slugify("hello, world!")).toBe("hello-world"));
  test("collapses consecutive spaces", () => expect(slugify("a   b")).toBe("a-b"));
  test("trims surrounding whitespace", () => expect(slugify("  hi there  ")).toBe("hi-there"));
  test("keeps digits", () => expect(slugify("Top 10 Tips")).toBe("top-10-tips"));
  test("empty string returns empty", () => expect(slugify("")).toBe(""));
  test("whitespace-only returns empty", () => expect(slugify("   ")).toBe(""));
  test("punctuation-only returns empty", () => expect(slugify("!!!")).toBe(""));
  test("no leading/trailing hyphen from edge punctuation", () => expect(slugify("!hello world!")).toBe("hello-world"));
  test("punctuation next to space doesn't double-hyphen", () => expect(slugify("a , b")).toBe("a-b"));
  test("collapses pre-existing hyphens", () => expect(slugify("a--b")).toBe("a-b"));
  test("tabs and newlines treated as separators", () => expect(slugify("a\tb\nc")).toBe("a-b-c"));
  test("output only ever contains [a-z0-9-]", () => { /* property over several inputs */ });
  test("never has leading or trailing hyphen", () => { /* property over several inputs */ });
});
```

## 输出（reviewer 报告）

### Scores

| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Quantity Adequacy | 9.0 | 15% → 17.65% | 1.59 |
| Scenario Coverage | 8.5 | 20% → 23.53% | 2.00 |
| Boundary Exploration | 7.5 | 20% → 23.53% | 1.76 |
| Error Path Coverage | 8.0 | 15% → 17.65% | 1.41 |
| State Combination | N/A | — | — |
| Test Quality | 9.0 | 15% → 17.65% | 1.59 |
| **Weighted Total** | | | **8.35** |
| E2E Bonus | 0 | | |
| **Final Score** | | | **8.35** |

> **State Combination → N/A**：无状态纯函数，无状态转换/并发/生命周期可评估。15% 权重按 ÷0.85 归一化重分配。
> **Error Path 保留为适用维度**：纯函数虽不抛异常，但退化输入（空串/纯空白/纯标点 → 空串）是真实失败模式契约，本套件已显式覆盖，给适用区间高分而非 N/A。

### Result: PASS ✅

- 所有适用维度 ≥ 7.5（最低 Boundary 7.5，刚好达标）。
- Final 8.35 ≥ 8.0。

### Missing Scenarios（唯一实质缺口）

1. **Unicode / 重音字母 / emoji** —— 功能描述声明"输出只含 `[a-z0-9-]`"，但所有输入都是 ASCII，这条收窄契约从未被真正触发。补 `slugify("Café déjà 🎉")` 明确 `é`/emoji 是去掉、保留还是转译，并把非 ASCII 输入加进字符集不变量。

### Suggestions（不阻塞）

1. 两条不变量测试用 `test.each` 替代 `for...of`，失败时能定位到具体输入。
2. 补一条"无连续连字符"不变量（`.not.toMatch(/--/)`）。
3. 加一条"规则全叠加"的长标题烟雾测试。

---

> reviewer 没给满分也没放水：Boundary 卡在 7.5（缺 unicode 契约验证），诚实指出"再多漏一两个
> 格式边界就会 FAIL"。PASS 是"合格"，不是"完美"——这正是校准夹具该有的样子。
