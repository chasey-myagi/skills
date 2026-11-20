# test-review / rust

Rules for this gate when the change includes rust. These win over common where they say so. Repository policy wins over both.

### RS-10 · Tests check values

Wrong: `assert!(result.is_ok())` as the only assertion; `#[should_panic]` without `expected = "…"`; `thread::sleep` for ordering.
Right: `assert_eq!` on the value or the error variant (`matches!(err, Error::NotFound { .. })`).
