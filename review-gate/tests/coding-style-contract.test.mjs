import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runReviewGate } from "../scripts/core.mjs";
import { evaluateGate, GATE_NAMES, isRoutable } from "../scripts/schema.mjs";
import { renderHandoff } from "../scripts/handoff.mjs";
import { commitRel, failReport, finding, freshRunDir, gateReport, gitC, makeRepo, rt, sha, writeRel } from "./helpers.mjs";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const registry = JSON.parse(readFileSync(join(ROOT, "coding-style", "rules.json"), "utf8"));
const GATES = ["code-review", "linus-review", "test-review"];
const LANGS = ["common", "python", "typescript", "go", "rust"];

function files() {
  const out = new Map();
  for (const gate of GATES) {
    for (const lang of LANGS) out.set(`${gate}/${lang}`, readFileSync(join(ROOT, "coding-style", "rules", gate, `${lang}.md`), "utf8"));
  }
  return out;
}

function styleFor(languages, { ts = true } = {}) {
  const chosen = registry.rules.filter((rule) => {
    const inLang = rule.langs.includes("*") || rule.langs.some((lang) => languages.includes(lang));
    if (!inLang) return false;
    if (rule.tsOnly && !ts) return false;
    return true;
  });
  return {
    mode: "auto",
    missing: false,
    catalog: registry.rules.map((rule) => ({ id: rule.id, tier: rule.tier, gate: rule.gate, categories: rule.categories })),
    allowed: Object.fromEntries(GATES.map((gate) => [gate, chosen.filter((rule) => rule.gate === gate).map((rule) => rule.id)])),
  };
}

function diffRepo(path, content) {
  const repo = makeRepo();
  const base = commitRel(repo, path, "old\n", "base");
  writeRel(repo, path, content);
  gitC(repo, ["commit", "-am", "head"]);
  return { repoDir: repo, mode: "diff", base, head: sha(repo), repro: false, runDir: freshRunDir() };
}

test("rules.json is a closed registry and each id lives in one gate file", () => {
  const seen = new Set();
  const prose = files();
  for (const rule of registry.rules) {
    assert.equal(seen.has(rule.id), false, rule.id);
    seen.add(rule.id);
    assert.ok(["hard", "structural", "advisory"].includes(rule.tier));
    assert.ok(GATES.includes(rule.gate));
    assert.ok(Array.isArray(rule.langs) && rule.langs.length);
    assert.ok(["strong", "some", "single", "derived"].includes(rule.evidence));
    assert.ok(Array.isArray(rule.sources) && rule.sources.length);
    assert.ok(Array.isArray(rule.enforcedBy));
    if (rule.evidence === "derived") assert.equal(rule.tier, "advisory");
    if (rule.implements) assert.ok(registry.rules.some((item) => item.id === rule.implements));
    assert.doesNotMatch(rule.text, /\bMUST\b/);
    const lang = rule.langs.includes("*") ? "common" : rule.langs[0];
    for (const [key, text] of prose) {
      const heading = new RegExp(`^### ${rule.id} · `, "m");
      if (key === `${rule.gate}/${lang}`) assert.match(text, heading);
      else assert.doesNotMatch(text, heading);
    }
  }
  for (const id of ["TS-5", "GO-9", "CS-NAME-3"]) assert.equal(registry.rules.some((rule) => rule.id === id), false);
  assert.ok(registry.rules.some((rule) => rule.id === "PY-16" && rule.langs[0] === "python"));
  assert.equal(registry.rules.filter((rule) => rule.id.startsWith("CS-SMELL-")).length, 6);
});

test("each gate prompt contains only that gate's rules", async () => {
  const repo = makeRepo();
  const base = commitRel(repo, "app.py", "print(0)\n", "base");
  writeRel(repo, "app.py", "print(1)\n");
  gitC(repo, ["commit", "-am", "head"]);
  const { prepareReview } = await import("../scripts/prepare.mjs");
  const state = await prepareReview({ repoDir: repo, mode: "diff", base, head: sha(repo), repro: false, runDir: freshRunDir() });
  const byGate = Object.fromEntries(GATE_NAMES.map((gate, index) => [gate, state.prompts[index]]));
  assert.match(byGate["linus-review"], /### CS-ABS-1 \[structural\] ·/);
  assert.doesNotMatch(byGate["linus-review"], /### CS-ERR-1 \[hard\] ·/);
  assert.match(byGate["code-review"], /### CS-ERR-1 \[hard\] ·/);
  assert.doesNotMatch(byGate["code-review"], /### CS-NAME-1 \[advisory\] ·/);
  assert.match(byGate["test-review"], /### CS-TEST-1 \[hard\] ·/);
  assert.match(byGate["test-review"], /### PY-14 \[structural\] ·/);
  assert.doesNotMatch(byGate["test-review"], /### CS-ABS-1 \[structural\] ·/);
  assert.doesNotMatch(byGate["code-review"], /### PY-14 \[structural\] ·/);
});

test("rule field violations are invalid and a finding without a rule is unchanged", () => {
  const style = styleFor(["typescript", "go"]);
  const ts = styleFor(["typescript"]);
  const bad = (gate, partial, use = style) => evaluateGate(gate, failReport(gate, [finding(partial)]), { style: use });
  assert.match(bad("linus-review", { rule: "CS-NAME-1", category: "style", blocking: true, priority: "P3" }).semanticErrors.join("\n"), /advisory and cannot block/);
  assert.match(evaluateGate("code-review", failReport("code-review", [finding({ category: "style", blocking: true, priority: "P3" })])).semanticErrors.join("\n"), /category style cannot block/);
  assert.match(bad("code-review", { rule: "NO-SUCH" }).semanticErrors.join("\n"), /rule NO-SUCH is unknown/);
  assert.match(bad("code-review", { rule: "CS-NAME-1", category: "style", blocking: false, priority: "P3" }).semanticErrors.join("\n"), /belongs to linus-review/);
  assert.match(bad("code-review", { rule: "GO-1" }, ts).semanticErrors.join("\n"), /not loaded for this run/);
  assert.match(bad("code-review", { rule: "CS-ERR-2", category: "style", blocking: true }).semanticErrors.join("\n"), /does not allow category style/);

  const plain = finding({ id: "C9" });
  const before = evaluateGate("code-review", failReport("code-review", [plain]));
  const after = evaluateGate("code-review", failReport("code-review", [plain]), { style });
  assert.equal(before.verdict, "FAIL");
  assert.equal(after.verdict, "FAIL");
  assert.equal(before.findings[0].rule, undefined);
  assert.equal(after.semanticOk, true);
});

test("finding priority must match the cited rule's tier", () => {
  const style = styleFor(["python"]);
  const bad = (gate, partial, use = style) =>
    evaluateGate(gate, failReport(gate, [finding(partial)]), { style: use }).semanticErrors.join("\n");
  // PY-9 is advisory (P3 only); PY-15 is structural (P2/P3); PY-3 is hard (P0–P2).
  assert.match(bad("code-review", { rule: "PY-9", priority: "P1", blocking: false, category: "style" }), /advisory.*expects.*P3/);
  assert.match(bad("test-review", { rule: "PY-15", priority: "P1", blocking: false, category: "test-gap" }), /structural.*expects.*P2\/P3/);
  assert.match(bad("code-review", { rule: "PY-3", priority: "P3", category: "correctness" }), /hard.*expects.*P0\/P1\/P2/);
  // Correct pairings produce no tier error.
  assert.doesNotMatch(bad("code-review", { rule: "PY-9", priority: "P3", blocking: false, category: "style" }), /expects/);
  assert.equal(bad("code-review", { rule: "PY-3", priority: "P1", category: "correctness" }), "");
});

test("a missing registry still catches rule citations instead of skipping checks", () => {
  const missing = { mode: "auto", missing: true, catalog: styleFor(["python"]).catalog, allowed: {} };
  const err = evaluateGate("code-review", failReport("code-review", [finding({ rule: "PY-3", category: "correctness" })]), { style: missing }).semanticErrors.join("\n");
  assert.match(err, /registry is missing/);
});

test("a hard error is routable, a structural architecture block is only a fix, and advisories group by rule", async () => {
  const hard = finding({ category: "error-handling", rule: "CS-ERR-2" });
  assert.equal(isRoutable(hard), true);
  const structural = finding({ id: "L1", category: "architecture", rule: "CS-ABS-2", priority: "P2" });
  assert.equal(isRoutable(structural), false);

  const repo = diffRepo("src/app.js", "next\n");
  let reproCalls = 0;
  const blocked = await runReviewGate({ ...repo, repro: true }, rt(async (_prompt, opts) => {
    if (opts.phase === "Verify") reproCalls += 1;
    if (opts.label === "linus-review") return failReport("linus-review", [structural]);
    return gateReport(opts.label);
  }));
  assert.equal(blocked.overall, "FAIL");
  assert.equal(reproCalls, 0);
  assert.equal(blocked.fixQueue.some((item) => item.title === structural.title), true);

  const advisory = finding({
    id: "L2", priority: "P3", category: "style", blocking: false, rule: "CS-NAME-1", title: "empty-role-name",
  });
  const named = await runReviewGate(diffRepo("app.py", "print(1)\n"), rt(async (_prompt, opts) => {
    if (opts.label !== "linus-review") return gateReport(opts.label);
    return gateReport("linus-review", { findings: [advisory, { ...advisory, id: "L3", path: "app/other.py" }] });
  }));
  assert.equal(named.overall, "PASS");
  assert.equal(named.fixQueue.some((item) => item.title === "empty-role-name"), false);
  const handoff = renderHandoff(named);
  assert.doesNotMatch(handoff.split("## Advisory findings")[1].split("\n\n## ")[0], /empty-role-name/);
  assert.match(handoff, /## Optional improvements \(coding style\)/);
  assert.match(handoff, /### CS-NAME-1 \(2\)/);
});

test("two gates keep both rules when the behavior is the same", async () => {
  const shared = {
    path: "src/app.js", category: "maintainability", blocking: false, priority: "P3",
    trigger: "one behavior", expected: "one implementation", actual: "two implementations", title: "same-claim",
  };
  const result = await runReviewGate(diffRepo("src/app.js", "next\n"), rt(async (_prompt, opts) => {
    if (opts.label === "code-review") return gateReport("code-review", { findings: [finding({ ...shared, id: "C1", rule: "CS-TYPE-1" })] });
    if (opts.label === "linus-review") return gateReport("linus-review", { findings: [finding({ ...shared, id: "L1", rule: "CS-ABS-5" })] });
    return gateReport(opts.label);
  }));
  assert.equal(result.overall, "PASS");
  assert.equal(result.findings.length, 1);
  const rules = result.findings[0].sources.map((source) => source.rule).sort();
  assert.deepEqual(rules, ["CS-ABS-5", "CS-TYPE-1"]);
});

test("an enabled lint drops that rule from the prompt and leaves it when the lint is absent", async () => {
  const { prepareReview } = await import("../scripts/prepare.mjs");
  const off = diffRepo("app.py", "print(1)\n");
  const absent = await prepareReview(off);
  assert.match(absent.prompts[0], /### PY-3 \[hard\] ·/);

  const repo = makeRepo();
  const base = commitRel(repo, "app.py", "print(0)\n", "base");
  writeRel(repo, "pyproject.toml", "[tool.ruff]\nselect = [\"E722\", \"BLE001\", \"S110\"]\n");
  writeRel(repo, "app.py", "print(1)\n");
  gitC(repo, ["commit", "-am", "head"]);
  const present = await prepareReview({ repoDir: repo, mode: "diff", base, head: sha(repo), repro: false, runDir: freshRunDir() });
  assert.doesNotMatch(present.prompts[0], /### PY-3 \[hard\] ·/);
  assert.match(present.prompts[0], /### CS-ERR-2 \[hard\] ·/);
  assert.ok(present.result.scope.codingStyle.suppressed.some((rule) => rule.id === "PY-3"));
});
