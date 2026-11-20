# code-review / common

Language-independent rules for this gate. A language file wins where it names a conflict. Repository policy wins over both.

### CS-ERR-1 · Never swallow an error

No empty catch, ignored error return, or catch-all that neither logs with a reason nor propagates. Catch the specific failure you handle.

### CS-ERR-2 · Never fabricate success

A failure does not become an empty list, zero, `null`, default object or `ok` status that callers read as a valid result. Propagate it or return an explicit failure value the caller must inspect.

### CS-ERR-3 · Trust established contracts

Access fields of known types directly. No impossible null checks, attribute probing, fallback field lookups or redundant coercion on values whose type already guarantees them. Validate untrusted input once at its boundary, then pass a narrowed type onward. A missing required field fails visibly.

### CS-ERR-4 · Error handling earns its place

Every guard and catch answers "what breaks if I delete this?" Remove debugging-only guards once the contract is established. Do not wrap large blocks to defend against speculative failures. Wrap an error only to add context the caller needs, and keep the original cause. An error that is already returned is not also logged.

### CS-TYPE-1 · No type-checker escape hatches inside the codebase

Internal signatures name concrete types. No dynamic/any types, unchecked casts, non-null assertions or ignore pragmas to silence a checker. The only loose type is an untrusted boundary value, narrowed before its first field read and never passed onward loose.

### CS-TYPE-2 · Closed sets are types

A closed set of values is an enum or literal union, not bare strings compared ad hoc. Match exhaustively where the language supports it. Avoid a wildcard match on a set this code defined.

### CS-TYPE-3 · No parameters accepted to be discarded

Remove a parameter the function does not use and update callers. When an established interface requires it, keep it and make that constraint explicit.

### CS-CFG-1 · No embedded deployment values

No hardcoded URLs, hostnames or absolute paths. Name magic numbers at module scope; an empirical constant states where it was measured. A default lives at one layer and is passed down; lower layers do not re-declare it.

### CS-CFG-2 · One mechanism, no import side effects

One config mechanism, one logging setup, one entry-point mechanism per repository, following the existing choice. Importing a library module has no side effects: no environment mutation, global registration or I/O at import time.

### CS-LOG-1 · Logs use the logger

Use the project logger and its levels, not hand-written `[INFO]`/`[step 3]` prefixes. Library code does not print; only CLI output for the user does.

### CS-TYPE-4 · Do not delete behavior to satisfy the checker

Do not delete behavior, weaken a type, or drop a check so the type checker or linter goes quiet. Fix the type or the call. A narrower type that still expresses the real contract is a fix, not a deletion.

### CS-LOG-2 · Logs carry ids, not payloads

Logs and error text record a type, a count, or an id — not user input, model output, or request bodies. Oversized payloads in logs are a readability and cost problem.

### CS-ERR-5 · Errors say what failed

An error message says what failed and includes the value or type a reader needs to find it. "failed" with no subject is not enough.

### CS-SEC-1 · Permission checks stay visible

A permission check sits in the route or handler a reader can see. Do not hide it in config or another file. This is a placement hint, not a claim that the check is missing.

### CS-SEC-2 · No credentials or secrets in logs or errors

A credential, token, key, or secret must never appear in a log line, error message, or exception payload — not even partially or "temporarily". Redact at the source, never downstream. A secret in a log is a blocking security finding.
