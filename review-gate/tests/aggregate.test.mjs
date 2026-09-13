import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeRepo,
  commitRel,
  writeRel,
  gitC,
  sha,
  freshRunDir,
  scriptedAgent,
  gateReport,
  failReport,
  finding,
  loadCore,
  rt,
} from "./helpers.mjs";

async function review(core, agent) {
  const repo = makeRepo();
  const base = commitRel(repo, "src/app.js", "v1\n", "base");
  writeRel(repo, "src/app.js", "v2\n");
  gitC(repo, ["commit", "-am", "head"]);
  return core.runReviewGate({
    repoDir: repo,
    mode: "diff",
    base,
    head: sha(repo),
    runDir: freshRunDir(),
    repro: false,
  }, rt(agent));
}

test("identical behavioral claims merge; source local IDs are preserved", async () => {
  const core = await loadCore();
  const claim = finding({ id: "C1", title: "code title" });
  const result = await review(core, scriptedAgent({
    "code-review": failReport("code-review", [claim]),
    "linus-review": failReport("linus-review", [
      finding({ id: "L1", title: "linus wording differs", priority: "P1" }),
    ], {
      assessment: {
        blockingReasons: ["null input"],
        rating: "Please fix and resend.",
        scores: [],
      },
    }),
  }));
  const merged = result.findings.filter((f) => f.path === "src/app.js" && f.expected === "throw TypeError");
  assert.equal(merged.length, 1);
  assert.match(merged[0].id, /^F[0-9a-f]{16}$/);
  assert.ok(merged[0].sources.some((s) => s.gate === "code-review" && s.id === "C1"));
  assert.ok(merged[0].sources.some((s) => s.gate === "linus-review" && s.id === "L1"));
});

test("case differences in path or expected stay distinct claims", async () => {
  const core = await loadCore();
  const result = await review(core, scriptedAgent({
    "code-review": failReport("code-review", [
      finding({ id: "C1", expected: "TRUE" }),
      finding({ id: "C2", expected: "true", title: "other case" }),
    ]),
  }));
  const ids = new Set(result.findings.map((f) => f.id));
  assert.equal(ids.size >= 2, true);
  assert.notEqual(
    result.findings.find((f) => f.expected === "TRUE").id,
    result.findings.find((f) => f.expected === "true").id,
  );
});

test("title equality does not merge different triggers", async () => {
  const core = await loadCore();
  const result = await review(core, scriptedAgent({
    "code-review": failReport("code-review", [
      finding({ id: "C1", title: "same title", trigger: "foo(null)" }),
      finding({ id: "C2", title: "same title", trigger: "foo(undefined)", actual: "returns 1" }),
    ]),
  }));
  assert.equal(result.findings.length, 2);
});

test("finding ids are claim fingerprints, not encounter-order F1/F2", async () => {
  const core = await loadCore();
  const a = finding({ id: "C1", title: "first" });
  const b = finding({ id: "C2", title: "second", trigger: "bar()", expected: "ok", actual: "throws" });
  const first = await review(core, scriptedAgent({
    "code-review": failReport("code-review", [a, b]),
  }));
  const second = await review(core, scriptedAgent({
    "code-review": failReport("code-review", [b, a]),
  }));
  const idOf = (result, trigger) => result.findings.find((f) => f.trigger === trigger).id;
  assert.equal(idOf(first, "foo(null)"), idOf(second, "foo(null)"));
  assert.equal(idOf(first, "bar()"), idOf(second, "bar()"));
  assert.equal(first.findings.some((f) => f.id === "F1" || f.id === "F2"), false);
});

test("an unrelated later finding does not change an existing fingerprint", async () => {
  const core = await loadCore();
  const stable = finding({ id: "C1" });
  const extra = finding({
    id: "C2",
    path: "src/other.js",
    trigger: "baz()",
    expected: "1",
    actual: "2",
    evidence: "off-by-one",
    title: "unrelated",
  });
  const only = await review(core, scriptedAgent({
    "code-review": failReport("code-review", [stable]),
  }));
  const both = await review(core, scriptedAgent({
    "code-review": failReport("code-review", [stable, extra]),
  }));
  const stableId = only.findings.find((f) => f.trigger === "foo(null)").id;
  assert.equal(both.findings.find((f) => f.trigger === "foo(null)").id, stableId);
  assert.equal(both.findings.length, 2);
});
