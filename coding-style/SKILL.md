---
name: coding-style
description: >
  Reference rules for agent-written code, sliced by review gate and language.
  Read it while writing or reviewing code. It does not score, block, or replace
  a review workflow. Repository policy overrides these rules.
---

# coding-style

This is a reference, not a review. It does not emit a verdict. `review-gate` and the three reviewer skills may inline the slice that matches the change. A coding agent can read the same files while writing.

## How to read it

1. `rules.json` is the registry: id, gate, tier, languages, sources, evidence, and `enforcedBy`.
2. Prose lives in `rules/<gate>/<lang>.md`. `gate` is `code-review`, `linus-review`, or `test-review`. `lang` is `common`, `python`, `typescript`, `go`, or `rust`.
3. Read `common.md` for that gate, then the language file for the code you are touching. A language file wins where it names a conflict. The target repository's own policy wins over both.
4. `local-rules.md` is not loaded unless that repository adopts an entry.

Tier is the only strength signal. The words in a rule do not add a second one. `evidence: derived` is never higher than advisory. A rule with `enforcedBy` stays in the prompt until the repository actually runs that linter; then review-gate drops it and names the linter in the handoff.

## What belongs where

| Gate | Owns |
|---|---|
| linus-review | abstraction, scope, comments, names, smells |
| code-review | errors, types, config, logs, security placement |
| test-review | whether a test can fail for the reason it claims |
