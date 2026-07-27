# 样例：误报 → REFUTED（可红性证明 + 场景边界声明）

> 这是 **repro** 的一次真实运行产物（独立 repro agent 实际输出；仅把冗长的临时目录前缀缩写为 `…/`，其余未编辑）。
> 它展示 REFUTED 的证据纪律：(1) 反驳需要**正向证据**——期望行为测试在当前代码上为绿，不是「写不出红灯」的默认值；(2) **可红性证明**——临时断言 finding 声称的错误行为、观察测试变红（且失败栈帧直指目标代码行），证明观察点真的在看这个行为，不是没打到代码路径的假绿；(3) **场景边界声明**——只反驳测过的具体输入，顺带发现的真 bug（C1）如实记录但不越权裁定。
> 这条 finding 是 LLM reviewer 的典型误报形态：**看漏了别处的 guard**。执行一次就击穿。

## 输入

被审代码同 [sample-confirmed.md](sample-confirmed.md)（`src/pricing.js`，入口有 `n <= 0` 的 RangeError guard）。

Finding（来自 code-review 报告）：

- id: C2 / `src/pricing.js:1-7` / 正确性 / Critical
- 声称：`splitBill` 未防护 `n = 0`：`splitBill(1000, 0)` 会发生除以零，返回空数组或 `Infinity` 份额，下游 `formatMoney` 输出 `"¥Infinity"`，账单页崩溃。预期 `n = 0` 时抛 `RangeError`。

## 输出（repro agent 报告）

**Finding**: C2 `splitBill` 未防护 `n = 0`，`splitBill(1000, 0)` 除以零泄漏 `Infinity` 到 `formatMoney`
**Location**: `src/pricing.js:1-7`
**Category / Severity**: 正确性 / Critical
**Verdict**: REFUTED ❌

### Oracle

README.md（仓库根目录，API 契约）第 14 行：「`totalCents` 必须是非负整数，`n` 必须是正整数，否则抛 `RangeError`」。即 spec 期望 `splitBill(1000, 0)` 抛 `RangeError`——这正是 finding 也认同的预期行为，双方 oracle 一致，分歧只在「当前代码是否已实现该防护」。

### Predicted vs Observed

- Predicted（按 finding 声称预注册）：`splitBill(1000, 0)` **不抛异常**，返回 `[]` 或含 `Infinity` 的数组；`formatMoney` 输出 `"¥Infinity"`。
- Observed（真实运行）：`THREW: RangeError - n must be a positive integer`——抛异常，与 finding 预测**不匹配**。`src/pricing.js:5-7` 存在显式防护 `if (!Number.isInteger(n) || n <= 0) throw new RangeError(...)`，`n = 0` 命中 `n <= 0` 分支。

### Evidence

测试文件：`…/billsplit-c2/tests/repro/repro_c2_split_bill_zero_participants.test.js`
运行命令：仓库根目录 `node --test tests/repro/repro_c2_split_bill_zero_participants.test.js` 及全量 `node --test`

**1. 期望行为测试为绿**（`splitBill throws RangeError when n is 0`）：

```
✔ splitBill throws RangeError when n is 0 (0.708541ms)
✔ control: splitBill splits an evenly divisible bill across 2 people (0.603375ms)
ℹ pass 2  ℹ fail 0
```

**2. 可红性证明**——临时文件 `tmp_flip_check_c2.test.js` 断言 finding 声称的行为（`assert.doesNotThrow(() => splitBill(1000, 0))`）→ 变红：

```
✖ FLIP: splitBill does NOT throw when n is 0 (finding's claim)
  AssertionError [ERR_ASSERTION]: Got unwanted exception.
  Actual message: "n must be a positive integer"
    actual: RangeError: n must be a positive integer
        at splitBill (.../src/pricing.js:6:11)
EXIT=1
```

红灯的 `actual` 栈帧直指 `src/pricing.js:6`，证明观察点真实执行了 `splitBill(1000, 0)` 并看到了该防护，不是没打到代码路径的假绿。

**3. 恢复后（删除翻转文件）全 suite 重跑为绿**：

```
✔ splits an evenly divisible bill
✔ single person pays the whole bill
✔ formats cents as yuan string
✔ splitBill throws RangeError when n is 0
✔ control: splitBill splits an evenly divisible bill across 2 people
ℹ pass 5  ℹ fail 0
EXIT=0
```

另附直接观测（写测试前）：`node -e "...splitBill(1000, 0)..."` → `THREW: RangeError - n must be a positive integer`。

### Scope

- **已反驳的场景**：`splitBill(1000, 0)`（finding 给出的唯一复现输入）。当前代码对 `n = 0` 抛 `RangeError`，与 spec 一致；不存在除以零、`Infinity` 份额或 `"¥Infinity"` 下游泄漏。`src/pricing.js:5-7` 的防护 `n <= 0` 同时覆盖负数 `n`，但负数与非整数 `n` 未单独运行验证，不在本次反驳范围内。
- **未覆盖 / 不外推**：本反驳仅针对 C2 的「缺 n=0 防护」声称。运行期望行为测试时顺带观察到 `splitBill` 存在**另一个真实缺陷**——余数未分配（`splitBill(1000, 3)` 返回 `[333, 333, 333]`，和为 999，违反 README.md:11-13 的「份额之和必须恰好等于 totalCents」）；该缺陷属于另一条 finding（C1，由 repro-c1 负责）的范畴，不影响 C2 的 REFUTED 判定。

**改动清单**（供主控 diff 核查）：仅新增 `tests/repro/repro_c2_split_bill_zero_participants.test.js`（已保留，翻绿即为正式回归测试）；临时翻转文件 `tests/repro/tmp_flip_check_c2.test.js` 用后已删除。未触碰实现代码、既有测试与任何配置。

## 主控机械验收与处置

```
$ git status --porcelain          # 越界核查
?? tests/repro/                   # ✅ 仅新增期望行为测试，翻转临时文件已清理

$ node --test                     # 全 suite
ℹ pass 5 ℹ fail 0                # ✅ 期望行为测试留档为绿
```

处置：C2 解除 blocking（视同 withdrawn），本报告回写审查报告作证据留档。**不替 reviewer 改分**——若 C2 是「正确性」维度低分的主因，带证据重新 dispatch code-review round 2 让 reviewer 自己修正。期望行为测试直接留在 suite 里，白赚一个边界回归测试。
