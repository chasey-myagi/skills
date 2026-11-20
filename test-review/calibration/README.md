# Test review calibration

Original forward judgments for this gate. A fresh reviewer saw only the rubric and these inputs. These are static model judgments, not executed test results. Original reports are preserved.

| Case | Actual result |
|---|---|
| D: five assertions accept the same constant result | FAIL; constant implementation survives |
| E: nominal fifteen-test suite with empty property callbacks | FAIL; observed test defects remain blocking, unknown dimensions keep total null |

Inputs: [raw cases](cases.json). Actual output: [test](test-report.md).

`examples/` reports are historical format illustrations, not executable fixtures. The two property tests in the fifteen-test example contain only placeholder comments; an honest review reports the empty assertions instead of copying the historical PASS. Forward calibration shows the real input, the spec, and the checkpoint, and hides historical scores.

The wording edit that tells standalone calls to use Markdown and composite mode to use the parent JSON schema does not change weights or thresholds. These saved judgments were not re-run.
