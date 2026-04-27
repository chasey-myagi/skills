# Research Report HTML Template Reference

Minimal template for generating single-file HTML research/analysis reports with dark/light mode support, scroll animations, and strong visual hierarchy.

## Design Principles

1. **Single file** — All CSS/JS inline, no external dependencies (no Google Fonts)
2. **Dark/light dual mode** — `prefers-color-scheme` auto + manual toggle
3. **System fonts** — `system-ui, -apple-system, 'Segoe UI', sans-serif` for body, `'SF Mono', ui-monospace, monospace` for code/labels
4. **Strong hierarchy** — Section numbers (large, accent, semi-transparent), bold headings, muted body text
5. **Content-first** — Max line width 65ch for readability, generous section padding
6. **Scroll rhythm** — Alternating section backgrounds, staggered reveal animations
7. **Responsive** — Works on mobile, no horizontal scroll
8. **Accessible** — `prefers-reduced-motion` respected, focus-visible states, sufficient contrast

## CSS Variable System

```css
/* Light theme (default) */
:root {
  --bg:       #f4f0ec;     /* warm cream page */
  --bg-alt:   #eae4dd;     /* alternating section bg */
  --bg-code:  #1e1b18;     /* code block bg */
  --fg:       #1c1917;     /* headings, strong */
  --fg-2:     #44403c;     /* body text */
  --fg-3:     #78716c;     /* muted labels, captions */
  --accent:   #dc4a1a;     /* primary accent (warm red-orange) */
  --accent-2: #9a3412;     /* darker accent variant */
  --green:    #15803d;     /* positive/pro items */
  --green-bg: #ecfdf5;     /* positive callout bg */
  --red-bg:   #fef2f2;     /* negative callout bg */
  --border:   #d6d0c8;     /* dividers */
  --tag-bg:   rgba(220,74,26,0.08);
  --tag-fg:   var(--accent-2);
  --quote-bg: rgba(28,25,23,0.03);
}

/* Dark theme */
[data-theme="dark"] {
  --bg:       #0c0a09;
  --bg-alt:   #1c1917;
  --bg-code:  #0a0908;
  --fg:       #e7e5e4;
  --fg-2:     #a8a29e;
  --fg-3:     #78716c;
  --accent:   #fb923c;     /* warmer orange for dark bg */
  --accent-2: #fdba74;
  --green:    #4ade80;
  --green-bg: rgba(74,222,128,0.08);
  --red-bg:   rgba(248,113,113,0.08);
  --border:   #292524;
  --tag-bg:   rgba(251,146,60,0.12);
  --tag-fg:   var(--accent);
  --quote-bg: rgba(255,255,255,0.03);
}
```

## Component Inventory

### Layout Containers
- `.wrap` — max-width 780px, centered (main content)
- `.wrap-wide` — max-width 960px, centered (tables, wide grids)

### Section Structure
```html
<section id="section-id">
  <div class="wrap">
    <div class="sn reveal">01</div>
    <h2 class="reveal">Section Title</h2>
    <p class="reveal">Content...</p>
    <!-- components here -->
  </div>
</section>
```
Sections use alternating backgrounds (odd: `--bg`, even: `--bg-alt`).

### Hero
```html
<header class="hero">
  <div class="wrap">
    <div class="hero-tag">CATEGORY &middot; DATE</div>
    <h1>Title with <span class="highlight">Accent Word</span></h1>
    <p class="hero-deck">Subtitle / deck paragraph</p>
    <div class="hero-meta">
      <span><b>Label</b> Value</span>
      ...
    </div>
  </div>
</header>
```
Hero elements have staggered entrance animation (0.1s - 0.5s delay).

### Stats Bar
```html
<div class="stats reveal">
  <div class="stat">
    <div class="stat-val">~700</div>
    <div class="stat-lbl">Label Here</div>
  </div>
  ...
</div>
```
- Values use accent color, font-size 2.2rem, weight 900
- Counter animation on scroll into view
- Hover: scale(1.08) on value

### Flow Diagram (Vertical Steps)
```html
<div class="flow reveal">
  <div class="flow-step">
    <div class="flow-rail"><div class="flow-dot"></div><div class="flow-line"></div></div>
    <div class="flow-body">
      <div class="flow-title">Step Name</div>
      <div class="flow-desc">Description</div>
    </div>
  </div>
  <!-- Last step: no flow-line in rail -->
</div>
```
Fork display for yes/no branches:
```html
<div class="flow-fork">
  <div class="flow-fork-item fork-yes"><strong>Yes</strong> — action</div>
  <div class="flow-fork-item fork-no"><strong>No</strong> — action</div>
</div>
```

### Quote / Blockquote
```html
<div class="quote reveal">
  <p>"Quoted text here."</p>
  <cite>Attribution</cite>
</div>
```
Quotes slide in from left on reveal.

### Callout Box
```html
<div class="callout callout-green reveal">
  <strong>Label:</strong> Content text.
</div>
```
Variants: `callout-green` (positive), `callout-accent` (warning/highlight).

### Comparison Table
```html
<div class="table-wrap reveal">
  <table>
    <thead><tr><th>Col 1</th><th>Col 2</th>...</tr></thead>
    <tbody>
      <tr><td>Data</td><td>Data</td>...</tr>
      <tr class="row-hl"><td>Highlighted Row</td>...</tr>
    </tbody>
  </table>
</div>
```
Use `.wrap-wide` container for wide tables.

### Card Grid (2-column)
```html
<div class="card-grid reveal">
  <div class="card">
    <div class="card-name"><a href="...">Name</a></div>
    <div class="card-sub">Metadata</div>
    <div class="card-desc">Description</div>
  </div>
  ...
</div>
```

### Timeline
```html
<div class="timeline reveal">
  <div class="tl">
    <div class="tl-date">2024.08</div>
    <div class="tl-body">
      <div class="tl-label">Event Title</div>
      <div class="tl-text">Description</div>
    </div>
  </div>
  ...
</div>
```

### Pros/Cons Two-Column
```html
<div class="two-col reveal">
  <div class="col pros">
    <h4>Strengths</h4>
    <ul><li>Point with + marker</li>...</ul>
  </div>
  <div class="col cons">
    <h4>Weaknesses</h4>
    <ul><li>Point with - marker</li>...</ul>
  </div>
</div>
```

### Media List
```html
<div class="media-list reveal">
  <div class="media-item">
    <div class="media-src">Source Name</div>
    <div class="media-body">
      <div class="media-title"><a href="...">Article Title</a></div>
      <div class="media-note">Brief description</div>
    </div>
  </div>
  ...
</div>
```

### Verdict Box
```html
<div class="verdict reveal">
  <h3>Verdict Title</h3>
  <p>Conclusion paragraph.</p>
</div>
```
Uses accent border (2px) for emphasis.

### Three-File Display
```html
<div class="files reveal">
  <div class="file">
    <div class="file-name">filename.ext</div>
    <div class="file-desc">Description</div>
  </div>
  ...
</div>
```

## Interactive Features

### Theme Toggle
Fixed button, top-right corner. Toggles `data-theme="dark"` on `<html>`.

### Sticky Nav
```html
<nav class="nav">
  <div class="nav-inner">
    <a href="#section-id">Label</a>
    ...
  </div>
</nav>
```
Active section highlighted via IntersectionObserver.

### Scroll Progress Bar
2px accent-colored bar at very top of viewport, scales with scroll position.

### Scroll Reveal
Elements with `.reveal` class animate in (opacity 0.08 -> 1, translateY 20px -> 0) when scrolled into view. Stagger delay on nth-child.

### Stat Counter Animation
`.stat-val` elements animate from 0 to target number using ease-out-quart curve on scroll.

## Typography Scale

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| h1 | clamp(2.6rem, 6vw, 4rem) | 900 | --fg |
| h2 | clamp(1.7rem, 3.5vw, 2.3rem) | 800 | --fg |
| h3 | 1.08rem | 700 | --fg |
| h4 (label) | 0.68rem uppercase mono | 600 | --accent |
| body | 17px base | 400 | --fg-2 |
| .sn (section #) | 4.5rem | 900 | --accent @ 0.35 opacity |
| .stat-val | 2.2rem | 900 | --accent |
| code/mono | 0.62-0.82rem | 400-600 | varies |

## Spacing Scale

- Section padding: 4rem top, 3.5rem bottom
- Between components: 1.5-2rem
- Inside cards/stats: 1-1.3rem
- Between list items: 0.25-0.45rem
- Hero top padding: 6rem

## Color Usage Rules

- **--accent** for: section numbers, stat values, links, callout strong text, active nav, flow dots, hero highlight
- **--fg** for: headings, strong text, table first column
- **--fg-2** for: body paragraphs, table cells, quote text
- **--fg-3** for: labels, captions, meta text, descriptions
- **--green** for: positive items (pros, success callouts)
- Never use pure black (#000) or pure white (#fff)
