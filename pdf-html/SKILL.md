---
name: pdf-html
description: >
  写一份打印为 A4 PDF 时分页干净、带真实页码的单文件 HTML 报告。
  核心配方：sheet-stack 布局 + @page margin boxes（Chrome 原生支持）+ 纯
  window.print() 导出，不用 paged.js polyfill。模板里不预设配色 / 字体——
  开工前先问用户。
  Use when: 用户要写单文件 HTML 报告、白皮书、客户简报、研究报告，
  并希望"导出 PDF"或打印 A4 时分页好看、有页码。
  Triggers: "html 报告", "pdf 报告", "html for pdf", "打印简报",
  "/pdf-html", "客户简报", "白皮书", "research report html",
  "single-file html report"。
---

# pdf-html

写一份**屏幕浏览像一摞 A4 纸、打印或另存为 PDF 时分页干净、页码自动**的最小配方。

## 开工前先问用户

模板里**不预设**这些，逐项问清楚再开始：

1. **配色基调** — 暖奶油 / 工业灰白 / 学术深色 / 客户品牌色（要 hex 或 oklch 都行）
2. **字体偏好** — 系统字体（不联网）/ Google Fonts（DM Sans、Playfair、JetBrains Mono 等）/ 客户指定品牌字
3. **页面尺寸** — A4 portrait（默认）/ A4 landscape / US Letter
4. **章节预估** — 多少主章节、是否要封面、是否要 TOC
5. **页码风格** — `P. 3 / 12` / `第 3 页 / 共 12 页` / 仅 `3` / 不要页码
6. **暗色主题** — 是否需要屏幕浏览的明暗切换（PDF 一律亮色）

回答之后再开始填模板。**不要给默认配色擅自填上**。

## 核心结构：sheet-stack

每个章节是一个 `.sheet`。屏幕上是一摞纸卡片；打印时每个 `.sheet` 自动断到新页：

```html
<main class="sheet-wrap">
  <article class="sheet cover">…封面…</article>
  <article class="sheet">…01 章节…</article>
  <article class="sheet">…02 章节…</article>
</main>
```

```css
.sheet {
  width: 100%;
  max-width: 210mm;
  margin: 0 auto 24px;
  padding: 22mm 20mm 24mm;
  background: var(--paper);
  box-shadow: var(--shadow);
}

@media print {
  .sheet {
    max-width: none;
    margin: 0; padding: 0;
    background: #fff;
    box-shadow: none; border-radius: 0;
    break-after: page;
  }
  .sheet:last-of-type { break-after: auto; }
}
```

## 真实页码：@page margin boxes（Chrome 原生）

**⚠️ 不要用 paged.js polyfill**——它会把 body 替换为 `.pagedjs_pages` 容器，
跟 sheet-stack 的 `break-after: page` 冲突，常见症状是「点导出 → 白屏 → 不弹打印对话框」。

Chrome / Edge 现代版本已经**原生支持** `@page { @bottom-left { content: ... } }`：

```css
@page {
  size: A4;
  margin: 16mm 16mm 22mm;

  @bottom-left {
    /* margin box 内不便引用 :root 变量,直接 inline 颜色 */
    content: "<报告标题> · <日期>";
    font-family: ui-monospace, monospace;
    font-size: 8pt;
    color: <由用户决定>;
    padding-top: 4mm;
    border-top: 0.5pt solid <由用户决定>;
    width: 100%;
  }

  @bottom-right {
    content: "P. " counter(page) " / " counter(pages);
    font-family: ui-monospace, monospace;
    font-size: 8pt;
    font-weight: 700;
    padding-top: 4mm;
    border-top: 0.5pt solid <由用户决定>;
  }
}

/* 封面不显示页码与底栏 */
@page :first {
  @bottom-left  { content: none; }
  @bottom-right { content: none; }
}
```

## 导出按钮：一行就够

```html
<button id="export-pdf-btn">导出 PDF</button>
<script>
  document.getElementById("export-pdf-btn")
    .addEventListener("click", () => window.print());
</script>
```

点击 → Chrome 原生打印对话框 → 选「另存为 PDF」即可。
提示用户在对话框里**取消勾选「页眉和页脚」**，避免 Chrome 默认再加一条 URL/日期。

## 分页规则（最易踩坑）

```css
@media print {
  /* 短块不要被切开 */
  .callout, .card, .chart, .pull-quote, .stat, .verdict {
    break-inside: avoid;
  }

  /* ⚠️ 长表格必须允许跨页（千万不要塞进 break-inside: avoid 列表）*/
  .table-wrap { overflow: visible; break-inside: auto; }
  table { break-inside: auto; }

  /* 表头自动在每页重复 */
  thead { display: table-header-group; }

  /* 行不切开 */
  tr { break-inside: avoid; }

  /* 标题不孤立在页底 */
  h2, h3, h4, .section-head { break-after: avoid-page; }

  /* 导言不跟标题分开 */
  .lead, .intro { break-after: avoid-page; }

  /* 屏上的浮动按钮在打印时隐藏 */
  .floating-actions { display: none !important; }
}
```

## SVG 图表小心两件事

1. **`stroke="var(--xxx)"` 在 SVG 属性上有效**，但旧浏览器可能失败——保守起见关键色可以同时写 `style="stroke: var(--xxx)"`。
2. **`font-family` 在 SVG `<text>` 里要给完整 fallback 链**，避免字体异步加载未完成时回退到错的字体（影响数字 dial 等关键视觉）。

## 验证：用 Chrome headless 跑一次

写完后用 headless 验证分页是否合理：

```bash
chrome --headless --disable-gpu --no-sandbox \
  --print-to-pdf=/tmp/out.pdf --no-pdf-header-footer \
  --virtual-time-budget=5000 \
  "file:///path/to/report.html"

# 逐页可视化
pdftoppm -png -r 70 /tmp/out.pdf /tmp/page
# 然后 Read /tmp/page-N.png 检查每页
```

理想结果：
- 章节断在该断的地方（不会一节内容跨 3 页又末尾留一大块空白）
- 表头自动重复在每个跨页
- 封面没有底栏；其他页底栏 + 页码都正确
- 卡片、图表、pull quote 都没被切开

## 模板

复制 `template.html`，按用户回答填入配色 / 字体 / 内容。
模板里所有 `<COLOR>` / `<FONT>` 占位都需要替换。

## 不要做的事

- ❌ 引入 paged.js / 任何打印 polyfill（Chrome 原生支持 @page margin boxes，polyfill 反而带来冲突）
- ❌ 默认填配色（即使是"安全的灰白"也不要——逼自己问用户）
- ❌ 把 `.table-wrap` 写进 `break-inside: avoid` 列表（长表格会无法跨页，导致整张表跑到下一页留一大块空白）
- ❌ `<button>` onclick 里写复杂的"排版中…→打印"流程（直接 window.print()）
- ❌ 在 `@page` margin box 里用 `var(--xxx)`（部分浏览器不解析，老老实实写 inline 值）
