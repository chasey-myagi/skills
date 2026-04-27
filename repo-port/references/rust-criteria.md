# Analysis Criteria (Rust-Specific)

Rust-specific criteria for Haiku analyzer agents. Read this alongside `references/analysis-criteria.md` when the porting target is Rust.

---

## Common Source → Rust Dependency Mappings

### Python → Rust

| Python | Rust crate |
|---|---|
| `requests` | `reqwest` (sync: `reqwest::blocking`) |
| `httpx` | `reqwest` (async) |
| `json` / `orjson` | `serde_json` |
| `asyncio` | `tokio` |
| `threading` | `std::thread` / `tokio::spawn` |
| `dataclasses` | `struct` + `#[derive(...)]` |
| `typing.Protocol` | `trait` |
| `collections.defaultdict` | `HashMap` + `.entry().or_insert_with(...)` |
| `pathlib.Path` | `std::path::PathBuf` |
| `datetime` | `chrono` |
| `logging` | `tracing` |
| `argparse` | `clap` |
| `pydantic` | `serde` + custom validation |
| `pytest` | `#[test]` + `rstest` |
| `contextlib.contextmanager` | `Drop` trait or RAII wrapper |
| `functools.lru_cache` | `once_cell` / `memoize` crate |

### TypeScript → Rust

| TypeScript | Rust |
|---|---|
| `Promise<T>` | `impl Future<Output = T>` via `tokio` |
| `interface Foo` | `trait Foo` |
| `type X = A \| B` | `enum X { A(..), B(..) }` |
| `null \| T` | `Option<T>` |
| `Map<K, V>` | `HashMap<K, V>` |
| `Array<T>` | `Vec<T>` |
| `readonly T` | `&T` or newtype wrapper |
| `axios` / `fetch` | `reqwest` |
| `zod` schema | `serde` + custom `TryFrom` |
| `EventEmitter` | `tokio::sync::broadcast` or custom trait |

---

## Ownership & Borrowing

- Does this function consume its argument or borrow it? Recommend which, and why.
- Are there self-referential structures (linked list nodes, trees with parent pointers)? These are genuinely hard in Rust — flag as `ISSUE [HIGH]` with a suggested approach (arena allocation, index-based references, `Rc<RefCell<T>>`).
- Does the source store a pointer/reference to something it doesn't own? → lifetimes will be needed → flag the complexity.
- Large data passed by value everywhere in source → should be borrowed in Rust to avoid unnecessary copies.

## Error Type Design

- Does this module define its own exception hierarchy?
  → Design a Rust error enum with `thiserror`; flag as `OPT [SAFETY]` with suggested variants
- Does this function raise multiple unrelated exception types?
  → Consider `anyhow::Error` for application code, typed errors for library/API boundaries
- Does the source silently swallow errors (`except: pass`, `.catch(() => null)`)?
  → Flag as `ISSUE [HIGH]` — Rust requires explicit handling; dropped errors become compiler warnings

## Standard Trait Opportunities

For each type defined in the file, note which standard traits to derive or implement:

| Trait | Derive when |
|---|---|
| `Debug` | Almost always (unless fields contain non-Debug types) |
| `Clone` | Data-like types without exclusive ownership |
| `Copy` | Small, POD types (no heap allocation, no `Drop`) |
| `Display` | Type has a meaningful user-facing string representation |
| `From<T>` / `Into<T>` | Common conversion from another type |
| `TryFrom<T>` | Conversion that can fail |
| `Default` | Type has a sensible zero/empty value |
| `PartialEq` / `Eq` | Needs equality comparison |
| `Hash` | Used as a `HashMap` or `HashSet` key |
| `Iterator` | Type is a sequence or produces values lazily |
| `Serialize` / `Deserialize` | Type crosses an I/O boundary (API, file, database) |

Flag missing obvious derives as `OPT [IDIOM]`.

## Performance Opportunities

Only flag if the improvement is real and concrete, not theoretical:

- **Unnecessary allocation**: function returns `String` but callers only read it → could return `&str` with a lifetime annotation
- **Clone-heavy loops**: cloning large data on every iteration → can ownership be transferred instead?
- **Manual index loops**: `for i in 0..vec.len()` where an iterator chain does the same work at zero cost
- **Format strings in hot paths**: repeated `format!()` inside a loop → `String::with_capacity` + `push_str`
- **Double hash lookups**: `if map.contains_key(k) { map.get(k) }` → `.entry()` API avoids the second lookup

## Async Translation

If the source file is async:

- Python `asyncio` → Tokio (`tokio::spawn`, `tokio::sync::*`, `tokio::time::*`)
- JS/TS Promises → `async`/`await` with Tokio runtime
- Go goroutines → `tokio::spawn` for I/O-bound, `rayon` for CPU-bound
- Note: Rust Futures are lazy — they do nothing until `await`ed. Source code that creates a coroutine and then schedules it must be restructured.
- Does the async function capture references? → requires lifetime bounds + `Send` — flag as `ISSUE [MEDIUM]`
- Are there `spawn` calls? → captured values must be `'static + Send` — flag any captures of borrowed data as `ISSUE [HIGH]`
- Timeouts or cancellation in source? → `tokio::time::timeout` / `tokio_util::sync::CancellationToken`

---

## Porter Guidance (Rust)

Read this section when you are the porter agent writing Rust implementations.

Express source behavior the way a skilled Rust developer would write it from scratch:

- `Result<T, E>` with `?` for error propagation — never use `unwrap()` in library code
- `Option<T>` for nullable values — no raw null, no sentinel values
- Derive standard traits where sensible: `Debug`, `Clone`, `PartialEq`, `Hash`
- Use iterator chains over explicit index loops where they express the same intent
- Use `thiserror` for defined error types; `anyhow` for application-level code
- Small, immutable, POD types should be `Copy` — don't force callers to clone
- Avoid unnecessary `Arc<Mutex<T>>` — transfer ownership when the design allows it
- Prefer `&str` over `String` for function parameters that only read string data
- Use `impl Trait` in argument position to avoid unnecessary monomorphization boilerplate
