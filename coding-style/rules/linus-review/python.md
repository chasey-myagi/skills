# linus-review / python

Rules for this gate when the change includes python. These win over common where they say so. Repository policy wins over both.

### PY-1 · Use the standard library

Reach for `itertools`, `functools`, `collections`, `pathlib`, `dataclasses` and already-imported dependencies before writing a helper.
Wrong: a three-line wrapper around `functools.lru_cache`; a hand-rolled `chunked()` when `itertools.batched` (3.12+) is available.

### PY-2 · No ABC or registry for one class

No `ABC`, `Protocol`, registry dict or plugin loader with a single concrete implementation. A `Protocol` that types a callback is allowed (see PY-4).

### PY-10 · Underscore is the exception

A leading `_` marks a name that would be a mistake to call from outside its module or class. Attributes read by other methods, module constants and booleans (`is_ready`) are public. A leading underscore, or a name marked internal, means callers outside the module would be wrong to use it. Do not add that marker, or export everything, out of habit.

### PY-13 · Suppressions carry a reason

`# noqa: E501  reason`, never bare `# noqa`; `# type: ignore[code]` only with a reason and only at an untrusted boundary.

### PY-16 · Python identifiers use full words

In Python, spell the role in full words. Clipped forms such as tmp, cnt, req, and cb are this rule, not CS-NAME-1. A name required by repository policy, and a short loop index, stay as they are.
