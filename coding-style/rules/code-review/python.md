# code-review / python

Rules for this gate when the change includes python. These win over common where they say so. Repository policy wins over both.

### PY-3 · No bare or silent except

Wrong: `except:`; `except Exception: pass`; `except Exception: return []`.
Right: catch the specific exception you handle; a broad catch at a process boundary logs with a reason or re-raises.

### PY-4 · No escape-hatch types internally

Annotate every parameter and return. Use `X | None`, parameterized containers (`dict[str, int]`), dataclasses, `TypedDict`, `Literal`, `Enum`. Do not use `Any`, bare `dict`/`list`, `cast()` or `# type: ignore` to quiet the checker. A callback is a `Protocol` with a named `__call__` signature. Decoded json and raw request bodies may enter as `object` or `Mapping[str, object]` and are narrowed with `isinstance` before use.

### PY-5 · No attribute probing on known types

Wrong: `getattr(config, "max_batch_size", 8)` or `if hasattr(model, "encoder")` on a type that declares the attribute.
Right: `config.max_batch_size`; let a missing attribute raise.

### PY-6 · No mutable default arguments

Wrong: `def collect(items=[])`, `= {}`. Right: `None` sentinel, or `field(default_factory=list)` in dataclasses. Category: correctness.

### PY-7 · One structure per role

Internal value objects are `@dataclass` (prefer `kw_only=True`); validated cross-boundary schemas use the project's validation library (e.g. `pydantic.BaseModel`). Do not hand-roll validators the library provides, and do not model one concept both ways.

### PY-8 · assert for invariants, raise for input

`assert` checks internal invariants you control (shapes, dtypes, preconditions). User input and environment errors raise `ValueError`, `RuntimeError`, `FileNotFoundError`. Never validate user input with `assert`; `python -O` strips it.

### PY-9 · Imports at module scope

Group stdlib / third-party / local. Import at module scope; break a cycle by moving the shared type to the module that constructs it. No `sys.path` patching, no wildcard imports, explicit `__all__` on re-exporting packages, and repository-internal imports from the defining module. An optional dependency may be imported inside the function that uses it so a missing extra does not break import of the package.

### PY-11 · One logger per module

`logger = logging.getLogger(__name__)`; no second logging library; `print` only for CLI output the user reads.

### PY-12 · Entry points own side effects

`if __name__ == "__main__":`, environment mutation, global registration and logging configuration only in entry-point modules. Library imports are side-effect free.
