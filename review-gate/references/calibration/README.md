# Calibration index

Per-gate forward calibration lives in the skill that owns the rubric. Installing one reviewer does not depend on review-gate, and review-gate does not keep a second copy of those judgments.

- `code-review/calibration/` — cases A, B, C, F, plus the original code reports
- `test-review/calibration/` — cases D, E, plus the original test report
- `linus-review/calibration/` — cases A, B, C, F, plus the original Linus reports

Paths are package names, not links out of this skill. A checkout that contains only review-gate cannot see the other packages, which is the point of moving the cases.

This directory does not hold a model-forward corpus of its own. Composite behavior — cross-gate dedup, aggregation, repro routing, and drift — is locked by the tests under `review-gate/tests/`.

Saved per-gate reports stay the original model outputs. Later edits that distinguish standalone Markdown from the composite JSON schema do not change weights, thresholds, or ratings, so those judgments were not re-run.
