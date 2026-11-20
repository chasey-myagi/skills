# Independent calibration under clarified rubric

**Static model evaluation, not runtime execution.** Only the updated rubric and original input file were read. No tests, database calls, reviewers, services, or other sources were used. Earlier report preserved. Line numbers below are supplied post-image snippet-relative, not verified absolute source positions; SHAs were absent.

Tables retain base weights and normalize contributions over applicable dimensions. No UNKNOWN dimension: no task-required external contract is missing.

## 🔍 Code Review Report — A

**Target:** src/config.ts.
**Feature:** Port defaults and range validation.
**Scope:** diff; declared +11/-3.
**Language:** TypeScript.

### Scores

|Dimension|Score|Weight|Weighted|
|---|---:|---:|---:|
|Correctness|8.0|25%|2.35|
|Security|N/A|15%|—|
|Architecture|8.0|20%|1.88|
|Error Handling|8.0|15%|1.41|
|Maintainability|8.0|15%|1.41|
|Requirements Fit|8.0|10%|0.94|
|**Final Score**|||**8.00**|

Correctness: explicit absent/blank/NaN/range branches. Architecture: single-purpose parser. Error handling: deterministic local fallback. Maintainability: concise guards. Security N/A: no demonstrated security operation or trust boundary. Requirements **changed from N/A to 8.0**: the independently supplied instruction to add defaults and range validation is an assessable high-level behavioral requirement, despite “no spec.” The implementation supplies both; no independent exact-default or lexical-validation requirement was given.

### Result: PASS ✅

### Strengths

src/config.ts:2–7 implements the stated additions directly.

### Issues

Critical / Important / Minor: none established. Prefix acceptance such as "80junk" → 80 is baseline behavior, not a demonstrated new defect.

### Recommendations

None required.

### Assessment

**Ready to merge?** Yes within supplied scope. Total and verdict unchanged; Requirements Fit now participates.

### Human Callouts（知情提示，不阻塞）

src/config.ts:1–7 broadens input to undefined and introduces fallback 3000 for absent/blank/invalid/out-of-range values.

## 🔍 Code Review Report — B

**Target:** src/users.ts.
**Feature:** Extract interpolated SQL into a variable.
**Scope:** diff; +2/-1.
**Language:** TypeScript.

### Scores

|Dimension|Score|Weight|Weighted|
|---|---:|---:|---:|
|Correctness|9.0|25%|3.75|
|Security|N/A|15%|—|
|Architecture|8.0|20%|2.67|
|Error Handling|N/A|15%|—|
|Maintainability|8.0|15%|2.00|
|Requirements Fit|N/A|10%|—|
|**Final Score**|||**8.42**|

Correctness: equivalent SQL for declared string input. Architecture/maintainability: straightforward variable without abstraction burden. Security/error handling N/A: those behaviors are unchanged. Requirements N/A: input origin describes exposure, not an independently required behavior; no particular unavailable contract is requested.

### Result: PASS ✅

### Strengths

src/users.ts:2–3 preserves the call and return.

### Issues

No in-scope Critical / Important / Minor findings.

**Informational baseline observation:** src/users.ts:2 allows SQL injection in both versions. Input "' OR '1'='1" generates an always-true predicate. It is neither introduced nor aggravated, so cannot reduce diff scores.

### Recommendations

None required for this diff.

### Assessment

**Ready to merge?** Yes for this diff; no assertion that baseline security is sound. Scores/verdict unchanged.

### Human Callouts（知情提示，不阻塞）

None newly introduced.

## 🔍 Code Review Report — C

**Target:** src/users.ts.
**Feature:** Replace bound lookup with SQL interpolation.
**Scope:** diff; +2/-1.
**Language:** TypeScript / PostgreSQL.

### Scores

|Dimension|Score|Weight|Weighted|
|---|---:|---:|---:|
|Correctness|2.0|25%|0.59|
|Security|1.0|15%|0.18|
|Architecture|8.0|20%|1.88|
|Error Handling|N/A|15%|—|
|Maintainability|8.0|15%|1.41|
|Requirements Fit|2.0|10%|0.24|
|**Final Score**|||**4.29**|

Correctness/security/requirements fail under C1 and the independently supplied exact-lookup contract. Architecture/maintainability remain straightforward. Error handling N/A: propagation mechanism unchanged; query corruption is assessed under correctness.

### Result: FAIL ❌

### Strengths

src/users.ts:3 directly propagates query results.

### Issues

**[C1] Introduced SQL injection — Critical**
- File: src/users.ts:2.
- Issue/impact: raw HTTP name can change SQL semantics and expose unrelated users.
- Fix: restore $1 and [name] binding.
- Repro: "' OR '1'='1" should match literally; instead it produces SELECT * FROM users WHERE name = '' OR '1'='1', matching every row.

Important / Minor: none independently established.

### Recommendations

Restore binding.

### Assessment

**Ready to merge?** No. C1 and three failing dimensions block approval. Scores/verdict unchanged.

### Human Callouts（知情提示，不阻塞）

None separate from C1.

## 🔍 Code Review Report — F

**Target:** src/users.ts.
**Feature:** Exact-name lookup.
**Scope:** snapshot.
**Language:** TypeScript / SQL.

### Scores

|Dimension|Score|Weight|Weighted|
|---|---:|---:|---:|
|Correctness|2.0|25%|0.50|
|Security|1.0|15%|0.15|
|Architecture|8.0|20%|1.60|
|Error Handling|8.0|15%|1.20|
|Maintainability|8.0|15%|1.20|
|Requirements Fit|2.0|10%|0.20|
|**Final Score**|||**4.85**|

Correctness/security/requirements fail under C1 and the supplied exact-lookup contract. Architecture/maintainability: concise helper. Error handling: async return preserves database rejection; no additional recovery obligation supplied. Snapshot includes existing defects; all dimensions apply.

### Result: FAIL ❌

### Strengths

src/users.ts:3 propagates results and rejections.

### Issues

**[C1] SQL injection in snapshot — Critical**
- File: src/users.ts:2.
- Issue/impact: raw HTTP input can select unrelated users.
- Fix: use supported driver parameter binding.
- Repro: "' OR '1'='1" should be a literal name; the generated predicate is always true, as derived in C.

Important / Minor: none independently established.

### Recommendations

Parameterize lookup.

### Assessment

**Ready to merge?** No. C1 blocks approval. Scores/verdict unchanged.

### Human Callouts（知情提示，不阻塞）

None separate from C1.

## Rubric consistency

No operative contradiction. The clarification changes A's requirement applicability, not its verdict. Attribution still excludes B's baseline defect and includes C/F. All reproductions are static derivations.
