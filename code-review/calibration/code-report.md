# Independent forward calibration

This is **static model evaluation, not runtime execution**. Only the supplied rubric and calibration inputs were read; no tests, database queries, external reviewers, or services were run. Locations are post-image snippet-relative lines; absolute source lines and SHAs were not supplied. Judgments cover the demonstrated scope, not undisclosed callers.

Tables preserve base weights. Contributions redistribute N/A weights proportionally; totals use unrounded values. No necessary unresolved evidence gap was identified for these bounded judgments, so no dimension is UNKNOWN.

## 🔍 Code Review Report — A

**Target:** src/config.ts.
**Feature:** Port defaults and range handling.
**Scope:** diff, declared +11/-3; no SHAs.
**Language:** TypeScript.

### Scores

|Dimension|Score|Weight|Weighted|
|---|---:|---:|---:|
|Correctness|8.0|25%|2.67|
|Security|N/A|15%|—|
|Architecture|8.0|20%|2.13|
|Error Handling|8.0|15%|1.60|
|Maintainability|8.0|15%|1.60|
|Requirements Fit|N/A|10%|—|
|**Final Score**|||**8.00**|

Correctness: new guards deterministically handle undefined, blank, NaN, and out-of-range parsed values. Architecture: one small, single-purpose parser. Error handling: explicit local fallback, without catching or losing external failures. Maintainability: readable guards. Security N/A: no demonstrated security boundary or operation in this local conversion. Requirements N/A: explicitly no independent spec; the change description is not an independent acceptance contract.

### Result: PASS ✅

### Strengths

src/config.ts:2–7 makes the added branches explicit.

### Issues

Critical / Important / Minor: none established. Prefix parsing such as "80junk" → 80 already follows from baseline parseInt; no supplied contract or demonstrated regression makes it a new finding.

### Recommendations

None required by demonstrated defects.

### Assessment

**Ready to merge?** Yes, within this static scope. Thresholds pass; no evidenced blocker.

### Human Callouts（知情提示，不阻塞）

src/config.ts:1–7: input type now accepts undefined; absent, blank, invalid, or out-of-range values default to 3000. These observable contract/default changes are informational.

## 🔍 Code Review Report — B

**Target:** src/users.ts.
**Feature:** Extract SQL construction into a variable.
**Scope:** diff, +2/-1; no SHAs.
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

Correctness: concatenation and interpolation produce identical SQL for declared string inputs; call and return remain equivalent. Architecture/maintainability: straightforward local variable without abstraction burden. Security N/A: security behavior is unchanged; the existing exposure is neither introduced nor aggravated. Error handling N/A: query-rejection propagation is unchanged. Requirements N/A: no independent contract supplied.

### Result: PASS ✅

### Strengths

src/users.ts:2–3 preserves the operation with clear structure.

### Issues

Critical / Important / Minor within this diff: none.

**Baseline observation, not a finding or blocker:** src/users.ts:2 embeds raw HTTP input in SQL. Input "' OR '1'='1" produces an always-true predicate in both versions. This serious existing defect must not reduce this diff's scores.

### Recommendations

No required change for this diff.

### Assessment

**Ready to merge?** Yes, for the diff. PASS does not certify baseline security.

### Human Callouts（知情提示，不阻塞）

None: no demonstrated new callout-category change.

## 🔍 Code Review Report — C

**Target:** src/users.ts.
**Feature:** Replace parameter binding with interpolation.
**Scope:** diff, +2/-1; no SHAs.
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

Correctness/security/requirements: C1 changes exact lookup into executable SQL, violating the independently supplied contract. Architecture/maintainability: the helper remains concise and structurally straightforward. Error handling N/A: query-return propagation is unchanged; newly malformed query behavior is assessed under correctness.

### Result: FAIL ❌

### Strengths

src/users.ts:3 retains direct result propagation.

### Issues

**[C1] Raw HTTP input becomes executable SQL — Critical**
- File: src/users.ts:2.
- Issue: replacing binding lets name alter the predicate.
- Impact: GET /users callers can receive unrelated records.
- Fix: restore the $1 query and [name] parameters.
- Repro: name "' OR '1'='1" should match literally; the new query is SELECT * FROM users WHERE name = '' OR '1'='1', matching every row. This is static derivation, not database execution.

Important / Minor: none independently established.

### Recommendations

Restore parameter binding.

### Assessment

**Ready to merge?** No. C1 and three sub-threshold dimensions block approval.

### Human Callouts（知情提示，不阻塞）

None separate from C1.

## 🔍 Code Review Report — F

**Target:** src/users.ts.
**Feature:** Exact-name lookup.
**Scope:** snapshot of supplied function.
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

Correctness/security/requirements fail under C1 and the supplied exact-lookup contract. Architecture/maintainability: concise, single-purpose helper. Error handling: async return preserves database rejection without swallowing it; no additional recovery obligation is supplied. Snapshot mode includes existing defects. All dimensions have evaluable content.

### Result: FAIL ❌

### Strengths

src/users.ts:3 propagates results and rejections directly.

### Issues

**[C1] SQL interpolation violates literal lookup — Critical**
- File: src/users.ts:2.
- Issue: raw HTTP input is embedded in a quoted SQL expression.
- Impact: /users can return unrelated records.
- Fix: use the database driver's supported parameter binding.
- Repro: name "' OR '1'='1" should match literally; it instead produces the always-true predicate shown in C. Snapshot scope makes the defect directly reportable.

Important / Minor: none independently established.

### Recommendations

Parameterize the lookup.

### Assessment

**Ready to merge?** No. C1 violates the contract and blocks approval.

### Human Callouts（知情提示，不阻塞）

None separate from C1.

## Rubric consistency

No operative contradiction found. The blanket instruction to classify real bugs as Critical is qualified by explicit attribution rules: B's baseline defect is excluded, while C's introduced defect and F's snapshot defect are included. Missing independent requirements yield N/A in A/B, not invented specifications or penalties. No runtime validation is claimed.
