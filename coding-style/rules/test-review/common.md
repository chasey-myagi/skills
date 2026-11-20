# test-review / common

Language-independent rules for this gate. A language file wins where it names a conflict. Repository policy wins over both.

### CS-TEST-1 · Every case can turn red

Each case answers "which future diff to the code turns this red?" A case whose only failure mode is an edit to the test is deleted: assertions that restate the implementation's formula, read back a constant with no consumer, test the language or a library, or only exercise their own fake. A new or changed test must fail when the code change it guards is rolled back.

### CS-TEST-2 · Never weaken a case to pass

No dropped assertions, stubbed code under test, widened tolerances or added skips to make a case green or faster. A changed contract gets a rewritten case.

### CS-TEST-3 · Test the contract, not the layout

Assert inputs to outputs, state changes and errors through the public surface. Mock only external or slow boundaries, and only when the assertion still checks a result. Do not snapshot internal encodings that can change without changing behavior.

### CS-TEST-4 · Deterministic and dense

No timed waits for ordering; force interleavings with events, barriers or fake clocks. Fold repetitive cases into one table-driven or parametrized case; keep a row only if it guards a failure no other row guards. Put a new case next to its suite instead of a new one-case file.
