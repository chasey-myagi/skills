# Review evidence and handoff

The executable schema lives in this package's scripts. This document explains decisions that a schema alone cannot establish.

## Admit a finding

A behavior finding identifies a concrete trigger, expected behavior with an independent source, actual behavior, affected location and evidence. Source inspection is evidence for a code claim; it is not a test execution. A test-gap finding identifies the requirement and the regression the existing tests cannot detect. A structure finding identifies a concrete cost and a simpler alternative. Personal preference or a confidence percentage alone is insufficient for a blocker.

Diff and working-tree reviews attribute findings to the selected changes. Snapshot reviews permit existing issues. Context reads do not enlarge the task's scope. Project guidelines come from the source being reviewed, while permissions and the selected task remain governed by the caller's authorization.

Priority describes urgency. `blocking` says whether the current checkpoint can pass. Human callouts describe relevant changes without asserting a defect. A migration can therefore be a callout while an independently established data-loss bug in that migration is a finding. Keep both records; do not turn the callout itself into an instruction to remove the migration.

## Preserve judgment and evidence separately

Three successful CLI calls do not prove three valid review gates. Match each result to its assigned gate, retain every original report and require coherent verdicts. Scores, weights, N/A explanations, final score and concrete threshold failures must survive aggregation. A human summary cannot silently revise them.

Conservative grouping reuses work only for the same behavioral claim. Keep each originating gate and local ID. Different trigger conditions, expected behaviors or effects remain separate even when their locations match. Repro routing follows behavioral falsifiability, not which reviewer happened to find the issue.

| State | Interpretation | Required next action |
|---|---|---|
| Unverified finding | Reviewer's evidenced claim | Verify or address it within the task's scope |
| Candidate CONFIRMED | Repro agent reports a valid red test | Parent reruns and accepts the test, control and source integrity |
| Candidate REFUTED | Agent reports green behavior plus redability proof | Parent verifies evidence and exact scenario before withdrawal and re-review |
| NOT-TESTABLE | A supported reason prevents behavioral testing | Keep severity and use the human review path |
| BLOCKED / skipped / over cap | No conclusion was established | Keep pending and state why |

No oracle means the expected behavior has not been independently justified. No red test means no confirmation; it does not establish refutation. Missing credentials, setup failures, time limits and a dirty target are execution or scope facts, not code verdicts.

After accepted refutation, retain the original report and attach the accepted evidence. Re-review the affected gates at the current source; do not mutate their historical FAIL to PASS. Tests and worktrees stay available until the parent has preserved and accepted the evidence and has authorization for cleanup.

## Handoff

The saved structured result is the source for the handoff. Preserve the scope, original reports, finding IDs and source gates, priority and blocking decisions, evidence locations, candidate proof status, constraints and unrun checks. Separate actionable fixes, optional improvements, informational callouts and matters requiring human judgment. Lack of a repro harness does not make an ordinary test gap or structural fix require user approval. Invalid gate reports returned by the host are retained for correction/rerun and cannot dispatch write-capable verification. If the host rejects output before returning it, no raw report is available. In particular, workflow-run returns null after exhausting schema retries; review-gate records incomplete execution and INVALID, and the parent needs host diagnostics to rerun.

An authorized implementation task continues from that handoff without asking for the same permission again. A review-only task does not become an implementation task because a fix queue exists. CI, acceptance, review and permission to publish retain their own outcomes.

## Acceptance scenarios

Use these scenarios when changing the composition. Controlled responses can test mechanics; actual reviewer behavior needs independent forward-testing.

| Given / when | Observable outcome |
|---|---|
| Committed review while the checkout has extra edits | Evidence uses the frozen head and does not silently include the edits |
| Task files include staged, unstaged and new files, including partial staging | Working-tree scope preserves HEAD, index and working bytes, including paths with spaces |
| A selected change renames a file | Both rename paths remain in the frozen delta; unchanged lines do not become additions |
| Snapshot directory contains ignored dependencies or credentials | They are excluded unless an ignored file was explicitly named |
| Source file or diff exceeds the prompt budget | Complete bytes remain in artifacts and the prompt points to them |
| Snapshot includes a previously committed bug | The reviewer may report it without pretending it is newly introduced |
| All gates return only human callouts | Callouts are preserved; no bug or fix task is invented |
| Linus or test-review finds a behavior bug | It can reach repro under the same rules as code-review |
| Two gates identify the same behavior | Verification can be shared, with both original judgments retained |
| Two claims at one location have different triggers | They remain distinct; disproving one does not withdraw the other |
| A gate is missing, misidentified, inconsistent or the scope drifts | No valid overall PASS is emitted |
| Repro reports REFUTED without parent acceptance | Original blockers and gate verdicts remain, evidence is available to inspect |
| The review finishes or an execution fails | Available findings, pending work and evidence survive in artifacts |
