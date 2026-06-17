# 真实 TDD session：parseDuration

> 这是用本 skill 的方法**真跑出来**的红绿重构记录（未编辑）。被测对象 `parseDuration`
> 把 `"1h30m15s"` 这样的时长字符串解析成总秒数。每个 cycle 的测试输出都是
> `node --test`（Node 内置 test runner，零依赖）真实跑出来的——任何人 clone 下来
> `node --test` 都能复现。
>
> 看点：① 每个 cycle 都是**一个测试 → 一个实现**（垂直切片），不是先写完 5 个测试；
> ② 实现是被测试一步步**逼**出来的，每次只写够过当前测试的代码；③ 5 个测试全在测
> **行为**（输入 → 输出），没有一个碰内部实现，所以最后的重构没动任何测试。

---

## Cycle 1 — tracer bullet：`'1h' → 3600`

先写测试，再写一个故意未实现的桩，确认测试**真的会红**（证明测试有效）：

```js
// duration.test.mjs
test("解析小时：'1h' → 3600", () => assert.equal(parseDuration("1h"), 3600));
```

**RED**（实现还返回 undefined）：

```
✖ 解析小时：'1h' → 3600
  actual: undefined,
  expected: 3600,
ℹ tests 1  ℹ pass 0  ℹ fail 1
```

写**最少**的代码让它过——只够处理 `'1h'`：

```js
export function parseDuration(input) {
  const m = input.match(/^(\d+)h$/);
  return Number(m[1]) * 3600;
}
```

**GREEN**：`ℹ tests 1  ℹ pass 1  ℹ fail 0` ✅

> 注意没有"未雨绸缪"去处理分钟、秒——那些是后面测试的事。

## Cycle 2 — `'30m' → 1800`

加一个测试，逼出"不止小时"这个行为：

**RED**（当前实现只认 `h`）：`✖ 解析分钟：'30m' → 1800` ｜ `tests 2  pass 1  fail 1`

泛化到单个单位 h/m/s：

```js
const UNIT = { h: 3600, m: 60, s: 1 };
export function parseDuration(input) {
  const m = input.match(/^(\d+)([hms])$/);
  return Number(m[1]) * UNIT[m[2]];
}
```

**GREEN**：`tests 2  pass 2  fail 0` ✅

## Cycle 3 — 组合：`'1h30m' → 5400`

**RED**（单单位正则不匹配组合）：`tests 3  pass 2  fail 1`

改成逐 token 累加：

```js
const UNIT = { h: 3600, m: 60, s: 1 };
export function parseDuration(input) {
  let total = 0;
  for (const [, n, u] of input.matchAll(/(\d+)([hms])/g)) {
    total += Number(n) * UNIT[u];
  }
  return total;
}
```

**GREEN**：`tests 3  pass 3  fail 0` ✅

## Cycle 4 — 错误路径：空串 / `'abc'` 应报错

之前的实现对非法输入会**默默返回 0**——危险。用测试钉死"非法输入要抛错"：

```js
test("空串报错", () => assert.throws(() => parseDuration("")));
test("非法输入报错：'abc'", () => assert.throws(() => parseDuration("abc")));
```

**RED**（两个用例没抛）：`tests 5  pass 3  fail 2`

先校验格式再解析：

```js
const UNIT = { h: 3600, m: 60, s: 1 };
export function parseDuration(input) {
  if (!/^(\d+[hms])+$/.test(input)) {
    throw new Error(`无法解析时长: ${JSON.stringify(input)}`);
  }
  let total = 0;
  for (const [, n, u] of input.matchAll(/(\d+)([hms])/g)) {
    total += Number(n) * UNIT[u];
  }
  return total;
}
```

**GREEN**：`tests 5  pass 5  fail 0` ✅

## REFACTOR — 全绿之后才动

现在代码里"哪些单位合法"（`[hms]`）在**三处**重复：校验正则、解析正则、UNIT 表。把单位列表做成唯一真理来源——加新单位只改一处：

```js
const UNIT = { h: 3600, m: 60, s: 1 };
const UNITS = Object.keys(UNIT).join("");            // "hms"
const FORMAT = new RegExp(`^(\\d+[${UNITS}])+$`);
const TOKEN = new RegExp(`(\\d+)([${UNITS}])`, "g");

export function parseDuration(input) {
  if (!FORMAT.test(input)) {
    throw new Error(`无法解析时长: ${JSON.stringify(input)}`);
  }
  let total = 0;
  for (const [, n, u] of input.matchAll(TOKEN)) {
    total += Number(n) * UNIT[u];
  }
  return total;
}
```

**重构后立刻重跑测试——必须仍全绿**：

```
✔ 解析小时：'1h' → 3600
✔ 解析分钟：'30m' → 1800
✔ 组合：'1h30m' → 5400
✔ 空串报错
✔ 非法输入报错：'abc'
ℹ tests 5  ℹ pass 5  ℹ fail 0
```

行为一字没变，结构更干净。**这就是"测行为不测实现"的回报**：5 个测试没有一个碰内部正则或 UNIT 表，所以重构内部时它们纹丝不动，还顺手证明了重构没破坏任何行为。

---

## 接质量门

到这里 TDD 给了你测试 + 实现。往下游走：
- `/test-review` 会指出这套测试还缺什么（比如 `'1h30m15s'` 三段组合、`'0s'`、超大数值、`'1H'` 大写）——它确实缺，这正是 test-review 的活；
- `/code-review` 审实现的正确性与边界；
- `/linus-review` 看还有没有能消除的特殊情况。
