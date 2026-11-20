# test-review / typescript

Rules for this gate when the change includes typescript. These win over common where they say so. Repository policy wins over both.

### TS-12 · Tests assert outcomes, not mocks

Wrong: the only assertion is `expect(mock).toHaveBeenCalled()` on a replaced dependency; `expect(fn()).toBeDefined()`; a snapshot of internal state.
Right: assert the returned value, emitted output, persisted state or thrown error. Call assertions are allowed when skipping or performing that call is the contract.

### TS-13 · Fake time, table cases

No `setTimeout`/`await sleep(…)` to wait for ordering; use fake timers or explicit resolution. Fold repeated cases into `test.each` / a table loop.

### TS-14 · Partial test data uses fromPartial

Build partial test values with a typed fromPartial helper. Do not use a cast or a double cast to invent the missing fields.
