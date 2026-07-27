# 样例：真 bug → CONFIRMED（红灯即验收契约）

> 这是 **repro** 的一次真实运行产物（独立 repro agent 实际输出；仅把冗长的临时目录前缀缩写为 `…/`，其余未编辑）。
> 它展示协议的完整闭环：(1) **预注册失败签名**与真实观测逐字节匹配——agent 在写测试前先预测了 buggy 代码的具体返回值；(2) 同文件 **control test** 为绿，排除环境性假红；(3) 3 连跑全红杀 flaky；(4) 红灯精确局限于 finding 声称的代码路径（全 suite 其余测试仍绿）；(5) 主控**亲自重跑**机械验收，不采信 agent 转述。

## 输入

被审代码 `src/pricing.js`（AA 分账工具；README 契约要求「份额之和必须恰好等于 totalCents，余数按前 remainder 份各多 1 分」）：

```js
export function splitBill(totalCents, n) {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new RangeError("totalCents must be a non-negative integer");
  }
  if (!Number.isInteger(n) || n <= 0) {
    throw new RangeError("n must be a positive integer");
  }
  const share = Math.floor(totalCents / n);
  return Array(n).fill(share);
}
```

既有测试只覆盖整除场景（`splitBill(1000, 2)`、`splitBill(999, 1)`），全绿——bug 藏在盲区里。

Finding（来自 code-review 报告）：

- id: C1 / `src/pricing.js:8-9` / 正确性（数据丢失）/ Critical
- 声称：`Math.floor` 均分且从不分配余数，不整除时份额之和 < totalCents。预期 `splitBill(1000, 3)` = `[334, 333, 333]`，实际 `[333, 333, 333]`（丢 1 分）。

## 输出（repro agent 报告）

**Finding**: C1 `splitBill` 用 `Math.floor` 均分且从不分配余数，不整除时份额之和 < `totalCents`（丢分）
**Location**: `…/billsplit-c1/src/pricing.js:8-9`
**Category / Severity**: 正确性（数据丢失）/ Critical
**Verdict**: CONFIRMED ✅

### Oracle

README.md（仓库根目录，API 契约）`splitBill(totalCents, n)` 节，第 11-13 行：

- 第 11 行：「**份额之和必须恰好等于 `totalCents`**——一分钱都不允许丢。」
- 第 12-13 行：「不能整除时，余数按『前 remainder 份各多 1 分』分配。例：`splitBill(1000, 3)` → `[334, 333, 333]`。」

oracle 独立于 finding 且给出了逐字节的期望输出（README 自带 worked example），无循环论证风险。

### Predicted vs Observed

- Predicted（写测试前预注册）：`splitBill(1000, 3)` 实际返回 `[333, 333, 333]`（`Array(3).fill(Math.floor(1000/3))`），`deepEqual` 断言以 actual `[333, 333, 333]` vs expected `[334, 333, 333]` 失败；和为 999，丢 1 分。
- Observed：`AssertionError [ERR_ASSERTION] ... actual: [ 333, 333, 333 ], expected: [ 334, 333, 333 ], operator: 'deepStrictEqual'`；第二个红灯 `actual: 1000, expected: 1001`（`splitBill(1001, 4)` 份额之和丢 1 分）。**与预测完全匹配。**

### Evidence

测试文件：`…/billsplit-c1/tests/repro/repro_c1_split_bill_remainder.test.js`

测试名：
- RED `splitBill(1000, 3) gives the remainder cent to the first share per README example`
- RED `splitBill(1001, 4) shares sum to exactly totalCents when not evenly divisible`
- CONTROL `control: splitBill(1000, 4) splits an evenly divisible bill into equal shares summing to totalCents`

运行命令：仓库根目录 `node --test tests/repro/repro_c1_split_bill_remainder.test.js`（×3）及全 suite `node --test`（×1）。

失败输出节选（三次运行完全一致）：

```
✖ splitBill(1000, 3) gives the remainder cent to the first share per README example
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
    actual: [ 333, 333, 333 ],
    expected: [ 334, 333, 333 ],
    operator: 'deepStrictEqual'

✖ splitBill(1001, 4) shares sum to exactly totalCents when not evenly divisible
  AssertionError [ERR_ASSERTION]: 1000 !== 1001
    actual: 1000, expected: 1001, operator: 'strictEqual'
```

3 次运行记录：RUN 1 / RUN 2 / RUN 3 全部 `fail 2, pass 1`（两红灯均为测试体内断言失败，非编译错/超时/setup 崩溃），exit=1。

Control 结果：同文件 control 测试 3 次运行全绿，排除环境/import 路径问题导致的假红。

全 suite（`node --test`）：6 tests，pass 4（既有 3 个测试 + control 全绿），fail 2（仅两个红灯），说明失败精确局限于 finding 声称的代码路径。

写权限核查：`git status --short` 仅显示 `?? tests/repro/`——未修改实现代码、既有测试或任何配置。

### Assertion ↔ Finding 映射

| 失败断言 | finding 声称的偏差 |
|---|---|
| `deepEqual(splitBill(1000, 3), [334, 333, 333])` → actual `[333, 333, 333]` | 与 finding 的复现例逐字节一致：违反 README 第 12-13 行「余数按前 remainder 份各多 1 分」及其 worked example |
| `sum(splitBill(1001, 4)) === 1001` → actual `1000` | finding 声称「份额之和 < totalCents，丢分」，违反 README 第 11 行；在第二个非整除输入上同样成立，确认非单点巧合 |

结论：finding C1 属实。`src/pricing.js:8-9` 只做 `Math.floor` 均分、从不分配余数，任何非整除输入都会丢 `totalCents % n` 分。红灯测试已按回归测试质量标准编写（文件头含 `acceptance contract — do not modify`），修复落地翻绿后可直接晋升为正式回归测试。

## 主控机械验收（SKILL.md Step 3，亲自重跑）

```
$ git status --porcelain          # 越界核查
?? tests/repro/                   # ✅ 仅新增约定目录

$ node --test tests/repro/repro_c1_split_bill_remainder.test.js   # ×3
ℹ pass 1 ℹ fail 2 (run 1)
ℹ pass 1 ℹ fail 2 (run 2)
ℹ pass 1 ℹ fail 2 (run 3)        # ✅ 3 连跑稳定红，control 绿

✖ ... AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
    actual: [ 333, 333, 333 ], expected: [ 334, 333, 333 ]
                                  # ✅ 失败类型 = 测试体内断言失败，observed 与 predicted 匹配
```

验收通过 → 红灯测试落独立 commit 作验收基线，交 fix agent（prompt 硬约束：不许改 `tests/repro/**`）。

> 一个值得记录的插曲：主控第一次验收时用了 `node --test tests/repro/`（裸目录参数），在 Node 25 下得到的是 runner 的 MODULE_NOT_FOUND，不是断言失败——按「编译错/环境错不算红灯」规则被正确拒收，换成具体文件路径重跑后才确认。这正是失败类型核查存在的意义：**任何红都算数是假确认的温床**。
