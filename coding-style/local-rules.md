# Repository-local rules

These are not loaded automatically. A target repository adopts one by naming it in its own policy file. Reviewers then treat that policy as authority and do not also cite the generalized rule.

| Local preference | What the shared rules do instead |
|---|---|
| Every name states its physical unit | CS-NAME-1 includes the unit only when the value has one |
| One prose paragraph per line | Not shared |
| Signed comments | Not shared |
| Every branch has an else | Not shared |
| Logs always use f-strings | Not shared |
| pop instead of del | Not shared |
| A ban list of typing helpers | Narrowed into PY-4 and CS-ABS-2 |
| Heavy imports always at module scope | PY-9 is advisory and allows an optional dependency |
| No backticks in comments | Not shared |
| English-only comments | Follow the repository's language |
| Project paths and tool commands | Not shared |
