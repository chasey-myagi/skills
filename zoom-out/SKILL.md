---
name: zoom-out
description: >
  让 agent 拉高一层抽象，给出当前代码区域的模块地图和调用关系。
  适合刚接手不熟的代码块、想看大图而不是细节时。
  Use when user says "zoom out", "拉远点", "拉高一层", "给我个地图",
  "我不熟这块代码", or invokes /zoom-out.
disable-model-invocation: true
---

I don't know this area of code well. Go up a layer of abstraction. Give me a map of all the relevant modules and callers.

我对这块代码不熟。请拉高一层抽象，给我所有相关模块和调用方的地图：

- 这个模块在系统里的位置（属于哪一层 / 哪个 bounded context）
- 它的对外接口（公开函数 / 类型 / 事件）
- 谁在调它（callers），它在调谁（dependencies）
- 数据流向：输入从哪来，输出去哪
- 任何隐含约束 / invariants（不读源码看不出来的）

不要贴大段源码，画一个 mental model。
