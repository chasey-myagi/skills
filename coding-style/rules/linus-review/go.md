# linus-review / go

Rules for this gate when the change includes go. These win over common where they say so. Repository policy wins over both.

### GO-2 · Interfaces belong to the consumer

Wrong: a producer package declares `type UserStore interface` next to its only implementation; constructors return interfaces.
Right: accept interfaces, return structs. Declare a small interface in the package that consumes it, when a second implementation or a test seam actually exists.

### GO-6 · Go naming

Package names: short, lowercase, one word, no `util`, `common`, `helpers`, `base`, `models`. No stutter (`user.User` is fine, `user.UserService` is not). Short receivers, `ctx`, `err`, `i`, `n`, `r`, `w` are idiomatic and exempt from CS-NAME-1. Initialisms keep case (`userID`, `HTTPClient`). No `Get` prefix on getters.
