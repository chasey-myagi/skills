# code-review / rust

Rules for this gate when the change includes rust. These win over common where they say so. Repository policy wins over both.

### RS-1 · No `unwrap`/`expect` on fallible input

Wrong: `s.parse::<u16>().unwrap()` on user or file input in library code; `.expect("failed")` on I/O.
Right: propagate with `?`. `expect("reason the invariant holds")` is allowed for invariants the code guarantees (a regex literal, a just-checked index). Tests and examples may unwrap. A detected program bug may panic. Input and I/O still return Result. When the repository denies clippy::unwrap_used, this rule leaves the prompt and the linter reports it.

### RS-2 · `?` keeps typed errors

Wrong: `.map_err(|e| e.to_string())?`; `Box<dyn Error>` or `anyhow` in a library's public API; a new error variant per call site; `map_err` that discards the source.
Right: libraries define an error enum (e.g. with `thiserror`) with `#[from]` or `#[source]`; binaries may use `anyhow` with `.context("…")`. Add context once, where it helps the caller.

### RS-3 · No silent discard of `Result`

Wrong: `let _ = write_all(…)`; `.ok()` dropping an error then continuing; `.unwrap_or_default()` that turns a parse failure into `0`; `if let Ok(v) = … { … }` with no `else` on a required operation.
Right: handle or propagate; a deliberate discard states why in a comment.

### RS-6 · clone is a local choice

Cloning to satisfy the borrow checker has a cost. Prefer a borrow when the lifetime is local. There is no sourced ban on clone; treat this as a hint.

### RS-7 · `unsafe` states its invariant

Every `unsafe` block has a `// SAFETY:` comment naming the invariant that makes it sound. Avoid `unsafe` when a safe API exists.

### RS-11 · No global mutable state

Prefer `std::sync::LazyLock`/`OnceLock` over `lazy_static!`; pass configuration in rather than reading a global.

### RS-12 · Match your own enums exhaustively

Match an enum this crate defined without a wildcard arm. A wildcard hides a new variant. A wildcard is fine for a type you do not own.
