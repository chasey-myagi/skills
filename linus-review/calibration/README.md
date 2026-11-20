# Linus review calibration

Original forward judgments for this gate. A fresh reviewer saw only the rubric and these inputs. These are static model judgments, not executed test results. Original reports are preserved.

| Case | Actual result |
|---|---|
| A: small port default change | Applied; changed defaults remain informational |
| B: unchanged SQL interpolation in a diff | Applied; baseline flaw does not become an introduced blocker |
| C: parameter binding replaced by interpolation | NAK for introduced SQL injection |
| F: current SQL interpolation in a snapshot | NAK; existing defect is in the selected snapshot scope |

Inputs: [raw cases](cases.json). Actual outputs: [Linus](linus-report.md), [clarification](linus-clarified.md).

The same source texts are also reviewed by code-review under that gate's own calibration. This directory keeps the Linus judgments only.

The Linus report identified wording that conflated severity with the size of a repair. The rubric now states that severity does not require a large change. The clarification pass left B/C/F and the Linus outcomes unchanged.

`examples/` reports are format illustrations. The wording edit that tells standalone calls to use the mail-style report and composite mode to use the parent JSON schema does not change the five ratings. These saved judgments were not re-run.

Coding-style cases [H, J, and L](coding-style.json) are expected outcomes, not new model transcripts. H is a non-blocking single-implementation interface (`GO-2`). J is an advisory Python abbreviation (`PY-16`); that used to be cited as `CS-NAME-1` before full words moved to the Python pack. L cites repository policy for `cfg` and `svc` and reports no name finding. A–F were not re-run.
