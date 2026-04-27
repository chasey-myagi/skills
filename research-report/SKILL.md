---
name: research-report
description: >
  Generate a single-file HTML research report with professional design, dark/light theme support,
  and interactive features. Use when: (1) user asks for a research report, analysis report, or
  deep dive document, (2) user says /research-report, (3) user wants to compile research findings
  into a readable, shareable format, (4) user asks to write findings as HTML.
  Triggers on: "write a report", "research report", "analysis report", "deep dive",
  "compile findings", "write up the research", or any context where structured research
  needs to be presented as a polished document.
---

# Research Report

Generate a single-file HTML research/analysis report with strong visual design, dual theme support, and interactive scroll features.

## When to Use

- User has research data / analysis findings to present
- User wants a sharable, readable HTML document
- User explicitly requests a report or deep dive

## Flow

```
1. Gather content — what sections, what data, what quotes
2. Plan structure — pick which components suit each section
3. Generate HTML — using the template system
4. Verify — screenshot and check both themes
5. Polish — if user requests, use impeccable skills
```

## Step 1: Gather Content

Before writing any HTML, understand:

| Input | Source | Required? |
|---|---|---|
| **Topic / subject** | User request | Yes |
| **Research data** | Prior agent results, user files, web research | Yes |
| **Key stats / numbers** | Extracted from research | Strongly recommended |
| **Quotes / citations** | From sources | Recommended |
| **Output path** | User-specified or infer from context | Yes |

If the user hasn't provided research data yet, help them gather it first (dispatch research agents, web search, etc.) before generating the report.

## Step 2: Plan Structure

A report typically has 4-8 sections. Pick from these patterns:

| Content Type | Best Component |
|---|---|
| Core metrics / numbers | **Stats bar** (accent-colored, large numbers) |
| Step-by-step process | **Flow diagram** (vertical dots + lines) |
| Comparison across items | **Comparison table** (with highlight row) |
| Timeline of events | **Timeline** (date + label + description) |
| Ecosystem / related items | **Card grid** (2-column with name/desc) |
| Pros vs cons | **Two-column** (+ / - markers) |
| Expert quotes | **Quote block** (left border, italic) |
| Key insight or warning | **Callout** (green for positive, accent for warning) |
| External sources / links | **Media list** (source + title + note) |
| Final assessment | **Verdict box** (accent-bordered, conclusion) |
| File/component overview | **Files display** (3-column mono names) |

**Structure rules:**
- Start with a **Hero** (title, subtitle, key metadata)
- First section: "What is it" — explain the subject
- Middle sections: analysis, data, comparisons
- Last section: "Verdict" — conclusions and takeaways
- End with quotes that resonate

## Step 3: Generate HTML

Read the template reference at `skills/research-report/template.md` for the complete CSS variable system, component HTML patterns, and design specifications.

**Critical implementation rules:**

1. **Single file** — All CSS and JS inline, no external dependencies
2. **Theme system** — Include both `prefers-color-scheme` media query AND `[data-theme]` attribute styles. Include theme toggle button.
3. **Scroll features** — Include: progress bar, reveal animations, stat counter, nav active tracking
4. **Accessibility** — Include `prefers-reduced-motion` media query that disables all animations
5. **Typography** — Use system fonts only. Create hierarchy through size/weight contrast, not font variety.
6. **Colors** — Use CSS variables for ALL colors. Never hardcode. Accent color on key data, not decorative.
7. **Content width** — Body text max 65ch. Tables and grids can use wider container (960px).
8. **Language** — Match user's language. Default to Chinese if the user's CLAUDE.md specifies it.

**Section backgrounds** alternate between `--bg` (odd) and `--bg-alt` (even) to create visual rhythm.

**Every content element** inside sections should have the `reveal` class for scroll animation.

## Step 4: Verify

After generating the HTML:

1. Open it in a browser (or use `agent-browser` for screenshots)
2. Check **light mode** — readability, contrast, layout
3. Check **dark mode** — switch theme, verify all elements adapt
4. Check **mobile** — verify no horizontal scroll, text readable
5. Fix any issues found

## Step 5: Polish (Optional)

If the user wants higher quality, suggest using impeccable skills in this order:

1. `/critique` — Find issues
2. `/bolder` — Increase visual impact if too safe
3. `/animate` — Enhance scroll experience
4. `/polish` — Final detail pass

## Notes

- This skill generates the report. It does NOT do the research. If the user needs research first, gather it via agents/web search before invoking this workflow.
- The template is a **reference**, not a rigid constraint. Adapt the design to fit the content. Add new component types if needed.
- Stats counter animation only works for simple patterns like `~700`, `$34`, `11%`. Complex values should be static.
- For very long reports (10+ sections), consider adding a "back to top" button.
- Reports should be saved as `index.html` inside a descriptive directory (e.g., `learning/topic-name/index.html`).
