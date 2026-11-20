# code-review / typescript

Rules for this gate when the change includes typescript. These win over common where they say so. Repository policy wins over both.

### TS-1 · No `any`, casts or non-null assertions to silence the checker

Wrong: `const user = res.data as User`; `config!.port`; `// @ts-ignore`; `function parse(input: any)`.
Right: boundary values (`JSON.parse`, `fetch().json()`, `process.env`, message payloads) are `unknown`, narrowed by a type guard or schema parse once; internal code receives the narrowed type. `@ts-expect-error` only with a reason and a tracking test. In tests, build a partial value with fromPartial rather than a cast. An assertion that can fail for more than one reason says which reason.

### TS-2 · Optional chaining and `??` do not hide broken contracts

Wrong: optional chaining or a nullish default on a field the type already requires. Right: read required fields directly. Use optional chaining and nullish defaults only where the type is genuinely optional.

### TS-3 · No silent catch or fabricated fallback

Wrong: an empty catch, a catch that returns an empty list or null and then continues as success, or a catch that only logs and then treats the call as successful. Right: let the failure propagate, or return a discriminated result the caller has to check. Rethrow with the original cause when you add context.

### TS-6 · Literal unions for closed sets

`type Status = "idle" | "running" | "failed"` or an `as const` object; `switch` ends with a `never` exhaustiveness check. Follow the repository if it already uses `enum`.

### TS-7 · Ban the empty shapes, trust inference

Do not annotate with Function, object, {}, or Record<string, any>. Inferred locals do not need an annotation. Name a real shape when a signature crosses a module boundary.

### TS-10 · Library modules have no import-time effects

No top-level `fetch`, timers, listener registration or global mutation in library modules. Read `process.env`/`import.meta.env` once in a config module and pass values down. A heavy module may be imported inside the branch that uses it.

### TS-11 · Narrow try blocks

Wrap the call that can fail, not the whole handler. Do not `catch` only to log and rethrow at every layer; one boundary logs. Keep `cause` when wrapping.

### TS-15 · Do not drop a promise

A promise that can reject is awaited, returned, or given an error handler. Calling an async function and discarding the promise hides the failure. When the repository enables no-floating-promises, this rule leaves the prompt.
