# Forward calibration evidence

Three independent reviewers received the supplied inputs and one rubric each, without example reports, historical verdicts, author discussion or implementation history. These are static model judgments, not executed test results. Numerical judgments can vary; this calibration checks attribution, evidence handling and useful outcomes. Original reports are preserved; publication copies redact local checkout paths only.

| Cases | Lens | Actual result |
|---|---|---|
| A: small port default change | Code / Linus | PASS / Applied; changed defaults remain informational |
| B: unchanged SQL interpolation in a diff | Code / Linus | PASS / Applied; baseline flaw does not become an introduced blocker |
| C: parameter binding replaced by interpolation | Code / Linus | FAIL / NAK for introduced SQL injection |
| D: five assertions accept the same constant result | Test | FAIL; constant implementation survives |
| E: nominal fifteen-test suite with empty property callbacks | Test | FAIL; observed test defects remain blocking, unknown dimensions keep total null |
| F: current SQL interpolation in a snapshot | Code / Linus | FAIL / NAK; existing defect is in the selected snapshot scope |

Inputs: [raw cases](inputs.json). Actual outputs: [code](code-report.md), [test](test-report.md), [Linus](linus-report.md).

The historical `examples/sample-pass.md` reports are format illustrations, not assertions that current inputs must pass. In particular, no independent contract being part of a task is different from a contract required by the task but unavailable to the reviewer. The former can make Requirements Fit inapplicable; the latter is UNKNOWN. The code rubric states this distinction explicitly. Historical scores were not rewritten to agree with new results.

The Linus report identified wording that conflated severity with the size of a repair. The rubric now states that severity does not require a large change.

Final wording checks: [code clarification](code-clarified.md), [Linus clarification](linus-clarified.md). A's Requirements Fit changed from N/A to 8.0 because the user-supplied behavior is an independent requirement; its verdict stayed PASS. The original output and this adjustment are both retained. B/C/F judgments and the Linus outcomes stayed unchanged.
