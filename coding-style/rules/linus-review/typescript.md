# linus-review / typescript

Rules for this gate when the change includes typescript. These win over common where they say so. Repository policy wins over both.

### TS-4 · No interface or abstract class for one implementation

Wrong: `interface IUserService` + `class UserServiceImpl`; an abstract base with one subclass; a DI container or factory that builds one class.
Right: export the function or class directly; introduce a type when a second implementation appears. Structural typing lets tests pass a plain object.

### TS-8 · Use the platform

No hand-written deep clone (`structuredClone`), `sleep` promise duplicated per file, array flattening, URL or path parsing, or a utility already provided by an imported dependency.

### TS-9 · Naming

No `I` prefix on interfaces, no `Impl` suffix, no `utils.ts`/`helpers.ts`/`*Manager` grab-bags. camelCase values, PascalCase types, UPPER_SNAKE only for true module constants. Idiomatic short names allowed: `i` in loops, `e`/`error` in catch, `props`, `ref`.
