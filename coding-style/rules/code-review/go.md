# code-review / go

Rules for this gate when the change includes go. These win over common where they say so. Repository policy wins over both.

### GO-1 · Never drop an error

Wrong: `_ = f.Close()` on a written file; `data, _ := io.ReadAll(r)`; `if err != nil { return nil }` in a function returning `error` (returns success); `if err != nil { log.Println(err) }` then continuing with a zero value.
Right: return the error, or handle it and state why continuing is correct. `defer` closes on write paths check the error.

### GO-3 · Named types are a hint

Prefer a named type at an internal boundary. This is a hint covered by CS-TYPE-1; no Go source bans any outright.

### GO-4 · Wrap with context, check with `errors.Is/As`

Wrap with `fmt.Errorf("load config %s: %w", path, err)` when the caller benefits from the context; `%v` when the cause must stay opaque. Compare with `errors.Is`/`errors.As`, never string matching. Log or return, not both. Do not wrap the same error at every frame with no new information. Do not change a wrapped error verb from %w to %v.

### GO-5 · panic only for a startup failure

panic belongs in main or init, for a startup failure that cannot continue. An expected failure returns error. Treating a recovered panic as success is CS-ERR-2.

### GO-7 · Context is a parameter

`ctx context.Context` is the first parameter, never stored in a struct, never `nil` (use `context.TODO()`). Goroutines started by the change have a cancellation path through that context or a done channel. Category: correctness when the leak is reachable. A context parameter has to be passed to the calls that need it, not accepted and dropped.

### GO-8 · No `init()` side effects or mutable globals in libraries

`init()` limited to registering with the standard library where unavoidable. Configuration is passed in, not read from package-level vars.

### GO-11 · Goroutines finish, map output is ordered

Every goroutine has an exit it can actually reach. When map iteration becomes output, sort the keys first. Prefer the current standard library (slices, maps, slog) over a hand-rolled equivalent.
