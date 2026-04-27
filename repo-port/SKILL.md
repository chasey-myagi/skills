---
name: repo-port
description: >
  Faithfully port an open source repository to a new language or ecosystem, module by module,
  using a five-phase multi-agent pipeline with a mandatory consolidation pass before writing any code.
  Use when: (1) user says /repo-port, (2) user wants to rewrite or port a GitHub/open source repo
  in a different language (especially Rust), (3) user says "migrate from X", "port this codebase",
  "rewrite in Rust", "extract the core logic from", (4) user wants a clean, accurate base
  implementation before layering their own optimizations on top.
  Pipeline: Map (Haiku, parallel per module) → Analyze (Haiku, parallel per file) →
  Consolidate (Sonnet, single unified plan) → Port (Sonnet, plan-driven) → Review (Opus).
  Trigger on: "port", "migrate", "rewrite", "extract from", "copy logic from", "base from open source",
  or any context where an existing codebase is the reference for a new implementation.
---

# Repo Port

Five-phase multi-agent pipeline for faithfully porting an open source repo to a new language.

**The rule**: see everything before writing anything. All modules are fully analyzed and issues are merged into a single unified plan before a single line of target code is written.

## Why Consolidate First

Without a consolidation pass, each file gets ported in isolation. You end up fixing the same class of bug five times, making inconsistent architectural choices, and missing cross-module patterns that could be solved once. The consolidation step reads every issue and optimization across every module, finds what can be batched, and produces a single ordered plan. Phase 3 then executes that plan top-down.

## Workspace Structure

```
{port-workspace}/
├── port-brief.md                   # Phase 0: source → target mapping
├── {module-a}/
│   ├── checklist.md               # Phase 1: files enumerated
│   ├── .analysis/                 # Phase 2: per-file reports (temp)
│   │   ├── {file-a}.md
│   │   └── {file-b}.md
│   ├── issue-found.md             # Merged from .analysis/
│   └── optimization-found.md     # Merged from .analysis/
├── {module-b}/
│   └── ...
├── unified-plan.md                # Phase 2.5: consolidated fix + opt plan
└── review.md                      # Phase 4: final verdict
```

## Phase 0: Brief

Before spawning any agent, establish:

| Input | Required |
|---|---|
| Source repo (URL or local path) | Yes |
| Target language / ecosystem | Yes |
| Module list (names + source paths) | Yes |
| Target project path | Yes |
| Priority order (which modules matter most) | Recommended |

Write `port-brief.md` with this information. All agents will reference it.

## Phase 1: Map

**Model: Haiku — one agent per module, all in parallel.**

Read `agents/mapper.md` and dispatch one mapper per module simultaneously.

Each mapper writes `{port-workspace}/{module}/checklist.md`.

After all mappers finish:
- Review every checklist — remove misclassified files (tests, generated code, config)
- Add any missed files
- Confirm with user before proceeding

## Phase 2: Analyze

**Model: Haiku — one agent per file.**

Read `agents/analyzer.md`. For each `[ ]` entry in each checklist, dispatch a Haiku analyzer.

Each analyzer writes **only** to `{port-workspace}/{module}/.analysis/{safe-filename}.md` — one file per analyzer, no shared writes, no concurrent conflicts. Analyzers do not touch `checklist.md`.

Parallelism: up to 8 concurrent agents. Different modules can run fully in parallel. Within a module, files can run in parallel since each writes its own output file.

After all analyzers finish, session leader does two things:

**Step 1 — Update checklists (safe, sequential):** Mark all dispatched entries `[x]` in each module's `checklist.md`. Do this after all agents are done, not during.

**Step 2 — Merge analysis files:** Run the merge script for each module:
```bash
python skills/repo-port/scripts/merge_analysis.py {port-workspace}/{module}
```
This extracts Issues sections from all `.analysis/*.md` into `issue-found.md` and Optimizations sections into `optimization-found.md`, grouped by source file.

## Phase 2.5: Consolidate

**Model: Sonnet — session leader handles this.**

Read `agents/consolidator.md`. This is the most important planning step.

Read ALL `issue-found.md` and `optimization-found.md` files across every module. Produce `unified-plan.md` — a single ordered implementation plan that:
- Groups issues that share a root cause (fix once, not five times)
- Identifies cross-module patterns (shared utilities, common error types, trait designs)
- Sequences the work (what must be built first to unblock others)
- Marks what can be skipped or deferred

**Do not begin Phase 3 until `unified-plan.md` is reviewed and approved by the user.**

## Phase 3: Port

**Model: Sonnet — session leader orchestrates; sub-agents implement.**

Read `agents/porter.md`.

Execute `unified-plan.md` in two steps:

**Step 1 — Foundation + Cross-Module Work (session leader, sequential):** Implement the Foundation Work and Cross-Module Batches sections directly. These are small but block everything else — shared error types, utility traits, crate-level structure. Do this before dispatching module agents.

**Step 2 — Per-module Work (Sonnet agents, parallel):** Once foundation is in place, dispatch one Sonnet agent per module. Each agent receives its module's section of `unified-plan.md`, the relevant source files, analysis files, and target project path. Independent modules run in parallel; within a module, files are processed in dependency order.

Fidelity rule: replicate source behavior exactly. If the source has a bug, replicate it and mark it `(source bug, preserved)`. Clever additions belong in a follow-up pass.

## Phase 4: Review

**Model: Opus — one agent.**

Read `agents/reviewer.md` and dispatch one Opus reviewer. It reads source files, ported files, all issue/optimization files, and the `unified-plan.md`.

Output: `review.md` with per-module scores and overall verdict.

## Agent Files

- `agents/mapper.md` — Phase 1: enumerate source files
- `agents/analyzer.md` — Phase 2: per-file analysis
- `agents/consolidator.md` — Phase 2.5: merge all findings into unified plan
- `agents/porter.md` — Phase 3: write target code from unified plan
- `agents/reviewer.md` — Phase 4: verify correctness and completeness

## References

- `references/analysis-criteria.md` — universal criteria for Haiku analyzers (any target language)
- `references/rust-criteria.md` — Rust-specific criteria: ownership, traits, error types, async, dependency mappings
- `scripts/merge_analysis.py` — merges `.analysis/*.md` into `issue-found.md` and `optimization-found.md`

When dispatching Haiku analyzers, tell them which criteria file(s) to read based on target language. For Rust: read both `analysis-criteria.md` and `rust-criteria.md`. For other targets: read `analysis-criteria.md` only, plus any language-specific reference if one exists.
