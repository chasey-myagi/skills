# Analysis Criteria (Universal)

Reference for Haiku analyzer agents in Phase 2. Apply all relevant criteria when analyzing a source file. This is a checklist to think through, not a template to fill out — only report what actually applies to the file being analyzed.

For target-language-specific criteria, read the appropriate file:
- Rust: `references/rust-criteria.md`

---

## Implicit Language Behavior

Things the source language does silently that the target must make explicit:

- **Integer arithmetic**: Python `int` is unbounded; most typed languages use fixed-width types and overflow. Check any math that could exceed typical 32/64-bit bounds.
- **Null/None/undefined**: Dynamic languages allow implicit null anywhere. Statically typed targets need explicit nullable types or null checks at every call site.
- **Implicit conversions**: JS numeric coercions (`"5" + 3`), Python duck typing, implicit bool conversions. Every one of these is a potential `ISSUE [HIGH]` — the target type system will not silently coerce.
- **Default mutable arguments**: Python's `def f(x=[])` is a classic bug — the list is shared across calls. Flag as `ISSUE [HIGH]` (it's a bug in the source, not just a porting concern).
- **Exception flow**: Which exceptions can escape this function? The target must handle all of them, explicitly. Unhandled exceptions that silently become no-ops in dynamic languages are `ISSUE [HIGH]`.

## External Dependencies

For every imported library:
1. Name it and what it does in the source
2. Identify the equivalent in the target language/ecosystem
3. If no equivalent exists → `ISSUE [BLOCKER]`
4. If the equivalent has a meaningfully different API shape → `ISSUE [MEDIUM]`

Note the library name and your recommended equivalent in the analysis file. The Consolidator will aggregate these and plan the dependency setup in Foundation Work.

## Shared and Mutable State

- Global variables or module-level state → how does the target language thread-safely access this?
- Class-level state shared across instances → may require synchronization primitives
- Mutable arguments (function modifies its input) → the target may require explicit mutation annotations (e.g., `&mut` in Rust, pass-by-reference in other languages) — callers must know

## Concurrency

- Does this file use threads, async/await, or parallel primitives?
- How does the source's concurrency model map to the target's runtime?
- Does shared state across concurrent tasks require synchronization?
- Are there race conditions in the source? (These should be replicated in the port unless flagged as bugs)

## Issue vs Optimization Decision Table

Use this table when you're unsure how to classify something:

| Situation | Classification |
|---|---|
| Logic produces wrong output without fix | `ISSUE [HIGH]` |
| No equivalent library exists in target | `ISSUE [BLOCKER]` |
| Implicit null can propagate to target | `ISSUE [HIGH]` |
| Integer overflow risk | `ISSUE [HIGH]` |
| Mutable default argument (source bug) | `ISSUE [HIGH]` |
| Missing exception handler → silent failure | `ISSUE [HIGH]` |
| Library with different API shape | `ISSUE [MEDIUM]` |
| Minor semantic difference, negligible risk | `ISSUE [LOW]` |
| Better type safety available in target | `OPT [SAFETY]` |
| Measurable allocation/copy reduction possible | `OPT [PERF]` |
| Cleaner API shape available in target | `OPT [ERGONOMICS]` |
| More idiomatic pattern exists in target | `OPT [IDIOM]` |
