# 样例：过度抽象 + 两个真 bug → "Please fix and resend."

> 这是 **linus-review** 的一次真实运行产物（Linus 审查员 agent 实际输出，未编辑）。
> 它展示这个 skill 的承诺：毒舌是手段，但每句吐槽都钉在真实技术问题上——这里精准
> 抓到了 `<=` 越界导致全程返回 `NaN`、空数组除零，以及一个名字比函数体还长的过度抽象，
> 并给出可直接替换的改写和评级。

## 输入

`src/average.ts`，+13 行。

```ts
class AverageCalculatorStrategyProvider {
  private readonly nums: number[];
  constructor(nums: number[]) { this.nums = nums; }
  compute(): number {
    let sum = 0;
    for (let i = 0; i <= this.nums.length; i++) {
      sum += this.nums[i];
    }
    return sum / this.nums.length;
  }
}
export function average(nums: number[]): number {
  return new AverageCalculatorStrategyProvider(nums).compute();
}
```

## 输出（Linus 审查员报告）

### 总体印象

13 行代码，一个类，俩 bug。这是什么效率？`AverageCalculatorStrategyProvider`——**求个平均数**。名字里有 "Strategy" 和 "Provider" 两个企业级废话词，但代码里既没有 strategy（没有任何可替换的算法），也没有 provider（它不提供任何东西，就是个加法循环）。名字比函数体还长。

### 具体问题

**average.ts:6 — 经典 off-by-one，直接读越界**

`for (let i = 0; i <= this.nums.length; i++)` —— `<=`。数组下标从 `0` 到 `length - 1`，你循环到了 `length`，最后一次访问 `this.nums[length]` 是 `undefined`，`sum += undefined` 让 `sum` 变成 `NaN`。所以这个"平均数计算器"对**任何**非空输入都返回 `NaN`。不是边界出错，是全错。改：`i < this.nums.length`，一个字符。

**average.ts:9 — 空数组返回 NaN，没人管**

`average([])` → `0 / 0` → `NaN`。空输入是真实存在的输入。要么明确抛异常，要么文档说清返回什么。`NaN` 会传染——它流过后面所有算术，不报错，只是让结果悄悄变成垃圾。

**average.ts:1 — 为求和包了一个类，过度抽象的标本**

这个类的全部价值，就是把"把参数传给函数"改写成"把参数存进字段，再从字段读出来调方法"。它没有第二个方法、没有子类、没有任何"策略"切换。好的抽象是你用了但注意不到它的存在；你这个抽象，我隔着屏幕都能闻到味。整个东西应该是：

```ts
export function average(nums: number[]): number {
  if (nums.length === 0) {
    throw new Error("average() of empty array is undefined");
  }
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}
```

一个函数。没有类，没有手写下标（`reduce` 从根上消除了"下标写错"这个错误类别——这正是该用它的原因），空数组也明确处理了。

### 还行的部分

`private readonly nums`——字段标了 `readonly`，说明你至少知道这个数据不该被改。可惜这是唯一值得夸的决定，而它服务的那个类本身就不该存在。

### Linus 说

你把一个**一行 reduce 能解决**的问题，写成了 13 行、带一个莫名其妙的类、还内置两个返回 `NaN` 的 bug。最难受的不是 bug——是这个组合：你有精力想 "Strategy Provider" 这种唬人的名字，却没精力跑一次 `average([1,2,3])` 看它是不是返回 `2`。装饰的功夫花在门面上，地基是塌的。

按优先级：(1) 修 off-by-one（`<=`→`<`），阻塞项；(2) 处理空数组，明确抛异常；(3) 删掉整个类，用 `reduce`；(4) 写测试，`average([1,2,3]) === 2`、`average([])` 抛异常，两行就能拦下今天所有问题。

代码不是按行数卖钱的。最好的那行代码，是你没写的那行。

**评级：Please fix and resend.**

    Linus
