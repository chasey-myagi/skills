# 样例：架构类 finding → NOT-TESTABLE(non-behavioral)（枚举不被滥用）

> 这是 **repro** 的一次真实运行产物（独立 repro agent 实际输出；仅把冗长的临时目录前缀缩写为 `…/`，其余未编辑）。
> NOT-TESTABLE 是四态里最容易被滥用的出口——它可能变成「懒得测」的倾倒场。这份样例为它立标杆：(1) 判定附**真实尝试记录**（跑了 suite、验了公共行为、试探了两条可断言路径），不是「我觉得测不了」；(2) 论证为什么**唯二可写的断言都落在实现结构层**、按「测行为不测实现」铁律必须拒写——钉死模块路径的测试会在拆分重构时反过来冤枉 fix；(3) **severity 保持 Important 不降级**——不可测 ≠ 不成立，架构意见交还人审。
> 注意：这类 finding 正常应被主控的路由规则（SKILL.md「适用范围」）在 dispatch 前拦下，根本不该到 agent 手上。此样例演示的是漏网之后 agent 端的正确兜底。

## 输入

被审代码同 [sample-confirmed.md](sample-confirmed.md)（`src/pricing.js`，含 `splitBill` 计算与 `formatMoney` 格式化两个导出）。

Finding（来自 code-review 报告）：

- id: M3 / `src/pricing.js:14-16` / 可维护性 / Important
- 声称：`pricing.js` 混合金额计算与展示格式化两种职责，`formatMoney` 属 presentation 层，应拆分到独立模块；后续加汇率、本地化需求时该文件会持续膨胀，修改半径失控。
- 复现思路：（无——来源报告未给出行为层面的复现场景）

## 输出（repro agent 报告）

**Finding**: M3 `pricing.js` 混合金额计算与展示格式化两种职责，`formatMoney` 应拆分到独立 presentation 模块
**Location**: `src/pricing.js:14-16`（实际代码中 `formatMoney` 位于 `src/pricing.js:12-14`）
**Category / Severity**: 可维护性 / Important
**Verdict**: NOT-TESTABLE(non-behavioral) ⚪

### Oracle

- **README.md（API 契约，仓库根目录）第 5-18 节**：契约只定义两个函数的**行为**——`splitBill(totalCents, n)` 的份额语义与 `formatMoney(cents)` → `"¥12.34"` 的格式化语义。契约通篇**不涉及模块划分**：没有任何条款规定 `formatMoney` 必须（或不得）与 `splitBill` 同文件。
- **邻近既有测试 `tests/pricing.test.js:3`**：`import { splitBill, formatMoney } from "../src/pricing.js"`——现存契约恰恰把 `formatMoney` 绑定在 `src/pricing.js` 的导出面上。若写一个断言「`formatMoney` 不应从 `pricing.js` 导出」或「应存在 `src/format.js`」的测试，它不是在捍卫 spec，而是在**对抗**现有 oracle。

结论：finding 声称的不是行为偏差（没有「预期 X，实际 Y」），而是模块组织/修改半径的架构意见。来源报告自己也承认「无行为层面的复现场景」。

### Predicted vs Observed

N/A——finding 未声称任何公共接口层面的行为偏差，无失败签名可预注册。

### Evidence（尝试记录）

1. **既有 suite 全绿，环境健康**（排除 BLOCKED）：
   ```
   $ node --test
   ✔ splits an evenly divisible bill
   ✔ single person pays the whole bill
   ✔ formats cents as yuan string
   ℹ tests 3  pass 3  fail 0
   ```
2. **`formatMoney` 公共行为逐条符合 README 契约**（不存在可红的行为偏差）：
   ```
   formatMoney(1234) = "¥12.34"   ← README 第 18 行原例
   formatMoney(5)    = "¥0.05"
   formatMoney(0)    = "¥0.00"
   ```
3. **M3 唯一可断言的形式全部落在实现结构层**：
   - `ls src/` → 仅 `pricing.js`；`import('./src/format.js')` → `ERR_MODULE_NOT_FOUND`。断言「format.js 应存在」= 测文件布局，README 无此要求；
   - 断言「pricing.js 不应导出 formatMoney」直接与既有测试 `tests/pricing.test.js:3` 的现存契约冲突。

   两者均属「mock 内部/钉死实现结构」一类的实现级测试——按 tdd 铁律禁止：修复（拆模块）本身就是重构，任何钉死当前或未来模块路径的测试都会在重构时产生假红/假绿。故无法在公共接口层面构造合法红灯。未新增任何测试文件。

### 判定说明

- 不可测 ≠ 不成立：**severity 保持 Important**。「拆分 `formatMoney` 到独立模块」作为架构改进意见由人工裁量，不进入行为复现门禁。
- 边界提示：本判定仅针对 M3 的职责混合声称。测试过程中观察到 `splitBill` 存在疑似余数丢失的行为问题（`Array(n).fill(share)` 未分配 remainder），不属于 M3 范围，未在本报告展开——若该问题对应其他 finding，应由对应 repro 任务裁定。

## 主控机械验收与处置

```
$ git status --porcelain          # 越界核查
                                  # ✅ 工作树干净——agent 没有为交差硬凹任何测试文件
```

处置：M3 保持 Important、保持原审查路径（人工裁量架构改进），repro 对它**沉默而非否决**。同时记一笔流程债：这条 finding 本不该进 repro 队列——回头检查主控路由为什么放行了可维护性类 finding（参照 SKILL.md「失败模式」：单轮 NOT-TESTABLE 过多是路由失灵的信号）。
