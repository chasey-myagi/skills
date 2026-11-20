# Code review calibration

Original forward judgments for this gate. A fresh reviewer saw only the rubric and these inputs: no example reports, historical verdicts, author discussion, or implementation history. These are static model judgments, not executed test results. Numerical judgments can vary; this calibration checks attribution, evidence handling, and useful outcomes. Original reports are preserved; publication copies redact local checkout paths only.

| Case | Actual result |
|---|---|
| A: small port default change | PASS; changed defaults remain informational |
| B: unchanged SQL interpolation in a diff | PASS; baseline flaw does not become an introduced blocker |
| C: parameter binding replaced by interpolation | FAIL for introduced SQL injection |
| F: current SQL interpolation in a snapshot | FAIL; existing defect is in the selected snapshot scope |

Inputs: [raw cases](cases.json). Actual outputs: [code](code-report.md), [clarification](code-clarified.md).

`examples/` reports are format illustrations, not assertions that current inputs must pass. In particular, no independent contract being part of a task is different from a contract required by the task but unavailable to the reviewer. The former can make Requirements Fit inapplicable; the latter is UNKNOWN. The code rubric states this distinction explicitly. Historical scores were not rewritten to agree with new results.

Final wording check: [code clarification](code-clarified.md). A's Requirements Fit changed from N/A to 8.0 because the user-supplied behavior is an independent requirement; its verdict stayed PASS. The original output and this adjustment are both retained. B/C/F judgments stayed unchanged.

The wording edit that tells standalone calls to use Markdown and composite mode to use the parent JSON schema does not change weights, thresholds, or what counts as a finding. These saved judgments were not re-run.
