# linus-review / rust

Rules for this gate when the change includes rust. These win over common where they say so. Repository policy wins over both.

### RS-4 · No trait or generic for one type

No trait with one implementor, generic parameter instantiated once, or builder for a struct with two or three fields. Add the trait when the second type arrives.

### RS-5 · `Box<dyn Trait>` and shared mutability need a reason

On a public API, do not expose Arc<Mutex<_>>, Rc<RefCell<_>>, or Box as the type callers must name. Keep that wrapper inside the crate. Private code may use it when the borrow requires it.

### RS-8 · Rust naming

Rust names stay short: at most a couple of short words, and an established abbreviation is fine. Do not use Service, Manager, or Factory. This pack wins over CS-NAME-1 for Rust names.

### RS-9 · Lint allowances carry a reason

Prefer `#[expect(lint, reason = "…")]` over `#[allow(lint)]`; crate-wide `#![allow(…)]` added by the change needs a stated reason. When a lint says the code is dead, delete the code instead of expecting the lint.

### RS-13 · Do not port another language's shape

When porting, do not copy the source language's habits: null-check helpers, factories, or class hierarchies. Use the Rust shape. A public framework interface is the exception in CS-ABS-2.
