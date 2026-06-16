# 样例：无 bug，但坏品味 —— 可消除的特殊情况

> 这是 **linus-review** 的一次真实运行产物（classic 档，未编辑）。
> 这段 `joinNames` **没有 bug、没有安全问题、没有过度抽象的类**——只盯这三栏的 reviewer
> 会干净放行它。但它埋了一个本不该存在的特殊情况（`if (i === 0)`）。这正是 linus-review
> 的绝活：好品味不是把边界情况处理对，而是重构到边界情况根本不存在。

## 输入

`src/joinNames.ts`，+10 行。

```ts
function joinNames(names: string[]): string {
  let result = "";
  for (let i = 0; i < names.length; i++) {
    if (i === 0) {
      result = names[i];
    } else {
      result = result + ", " + names[i];
    }
  }
  return result;
}
```

## 输出（Linus 审查员报告，classic 档）

### 总体印象

又一个手写 `for` 循环拼字符串的，里面还塞了个 `if (i === 0)`。你想要的是 `"a, b, c"` 这种逗号分隔吧？这功能 JavaScript 在你出生之前就内置了，叫 `Array.prototype.join`。一行。你写了十行，还在循环里加了个分支来特判第一个元素。代码"能跑"——但"能跑"是我对洗衣机的要求，不是对工程师的要求。

### 具体问题

**joinNames.ts:3-9 — 那个 `if (i === 0)` 是可以彻底消除的**

这是这次审查的核心。你在特判"第一个元素"，因为第一个元素前面不该有逗号。这就是那个经典的"边界情况"——和删链表头节点要特判 `head` 指针是同一类病。

**好品味的做法是让这个 `if` 根本不存在，而不是把它处理对。** 这里甚至不需要指向指针的指针那种花活，标准库早替你想好了：

```ts
function joinNames(names: string[]): string {
  return names.join(", ");
}
```

`join` 的语义天生就是"在元素之间插分隔符"，N 个元素插 N-1 个，第一个前面、最后一个后面都不插。"第一个元素特殊"这个情况在 `join` 的世界里**压根不存在**。你那个 `if` 不是被处理对了，是被**蒸发**了。

记住这个区别：把边界情况处理对，你以后每改一次这函数都得重新想一遍"第一个元素对不对"；把边界情况消除掉，你永远不用再想它。坏品味会持续生产 bug，这才是它真正的代价。

### 还行的部分

类型签名是对的：`(names: string[]): string`，没有 `any`。空数组返回 `""` 行为也正确——虽然这正确性是那堆样板"碰巧"凑对的，不是设计出来的。

### Linus 说

这段代码没有 bug，没有安全洞，也没有 `AbstractNameJoinerFactory` 式的过度抽象——它的病不在那三个常规维度里。它的病是**品味**：用十行带分支的样板，去做一行标准库调用就该做完的事。

```ts
return names.join(", ");
```

方向是对的（它确实在 join names），细节是错的（用了最笨的方式，还把可消除的特殊情况留在那）。

    Close, but no cigar.

    Linus

---

> 同一段代码换 `--tone=civil` 跑，会去掉"洗衣机""大学生"这类人身挖苦，但问题
> （`if` 可消除）、修复（`join`）、评级（Close, but no cigar.）三项技术判断一字不变——
> 档位只改语气强度，不改结论。
