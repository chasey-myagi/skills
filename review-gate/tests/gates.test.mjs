import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeRepo,
  commitRel,
  writeRel,
  gitC,
  sha,
  freshRunDir,
  passingAgent,
  scriptedAgent,
  gateReport,
  failReport,
  finding,
  callout,
  loadCore,
  rt,
  scoresFor,
} from "./helpers.mjs";

async function committed(core, agent, extra = {}) {
  const repo = makeRepo();
  const base = commitRel(repo, "src/app.js", "v1\n", "base");
  writeRel(repo, "src/app.js", "v2\n");
  gitC(repo, ["commit", "-am", "head"]);
  const head = sha(repo);
  return core.runReviewGate({
    repoDir: repo,
    mode: "diff",
    base,
    head,
    runDir: freshRunDir(),
    repro: false,
    ...extra,
  }, rt(agent));
}

test("dispatches exactly the three gates without overriding caller model and with inlined rubrics", async () => {
  const core = await loadCore();
  const agent = scriptedAgent({});
  const result = await committed(core, agent);
  const labels = agent.calls.map((c) => c.opts.label).sort();
  assert.deepEqual(labels, ["code-review", "linus-review", "test-review"]);
  assert.equal(agent.calls.every((c) => c.opts.model === undefined), true);
  assert.equal(agent.calls.every((c) => c.opts.schema && c.opts.schema.required.includes("gate")), true);
  const byGate = Object.fromEntries(agent.calls.map((c) => [c.opts.label, c.prompt]));
  assert.match(byGate["code-review"], /独立的代码审核专家/);
  assert.match(byGate["test-review"], /独立的测试用例审核专家/);
  assert.match(byGate["linus-review"], /Talk is cheap/);
  assert.match(byGate["code-review"], /GATE_ID:\s*code-review/);
  for (const p of agent.calls.map((c) => c.prompt)) {
    assert.match(p, /read-only|只读/i);
    assert.equal(/sandbox/i.test(p) && /OS sandbox|operating-system sandbox/i.test(p), false);
  }
  assert.equal(result.total, 3);
  assert.equal(result.passed, true);
});

test("missing gate identity cannot PASS", async () => {
  const core = await loadCore();
  const agent = scriptedAgent({ "linus-review": null });
  const result = await committed(core, agent);
  assert.equal(result.executionStatus, "incomplete");
  assert.equal(result.passed, false);
  assert.equal(result.overall, "INVALID");
  assert.deepEqual(result.diagnostics.missingGates, ["linus-review"]);
  assert.equal(result.diagnostics.agentFailures.length, 1);
  assert.equal(result.diagnostics.identityFailures.length, 0);
  assert.equal(result.diagnostics.schemaFailures.length, 0);
});

test("duplicate or wrong gate identity cannot PASS", async () => {
  const core = await loadCore();
  const agent = scriptedAgent({
    "test-review": gateReport("code-review"),
  });
  const result = await committed(core, agent);
  assert.equal(result.passed, false);
  assert.ok(result.diagnostics.identityFailures.length > 0);
  assert.equal(result.reviews.find((r) => r.gate === "test-review" || r.identityOk === false).identityOk, false);
});

test("callout-only PASS creates no fix-queue tasks", async () => {
  const core = await loadCore();
  const agent = scriptedAgent({
    "code-review": gateReport("code-review", { humanCallouts: [callout()] }),
    "test-review": gateReport("test-review", { humanCallouts: [callout({ kind: "dependency", summary: "bumps left-pad", locations: ["package.json:3"] })] }),
    "linus-review": gateReport("linus-review"),
  });
  const result = await committed(core, agent);
  assert.equal(result.passed, true);
  assert.equal(result.fixQueue.length, 0);
  assert.equal(result.humanCallouts.length, 2);
  assert.deepEqual(result.humanCallouts.flatMap(c => c.locations).sort(), ["db/migrate.sql:1", "package.json:3"]);
  assert.equal(result.findings.filter((f) => f.blocking).length, 0);
});

test("PASS below code-review threshold is rejected without rescoring", async () => {
  const core = await loadCore();
  const low = gateReport("code-review", {
    assessment: {
      blockingReasons: [],
      scores: scoresFor("code-review", 9).map((s) => s.dimension === "Correctness" ? { ...s, score: 6.0, weighted: 1.5 } : s),
      finalScore: 8.25,
    },
  });
  const agent = scriptedAgent({ "code-review": low });
  const result = await committed(core, agent);
  assert.equal(result.passed, false);
  assert.deepEqual(result.diagnostics.semanticFailures[0].errors, ["applicable dimension below threshold"]);
  const cr = result.reviews.find((r) => r.raw && (r.raw.gate === "code-review" || r.gate === "code-review"));
  assert.equal(cr.raw.assessment.finalScore, 8.25);
  assert.equal(cr.raw.assessment.scores.find((s) => s.dimension === "Correctness").score, 6.0);
});

test("PASS with blockingReasons is rejected", async () => {
  const core = await loadCore();
  const agent = scriptedAgent({
    "code-review": gateReport("code-review", {
      assessment: { blockingReasons: ["final score 6 < 7.5"], scores: scoresFor("code-review"), finalScore: 9 },
    }),
  });
  const result = await committed(core, agent);
  assert.equal(result.passed, false);
  assert.ok(result.diagnostics.semanticFailures.length > 0);
});

test("FAIL without a blocking reason cannot green", async () => {
  const core = await loadCore();
  const agent = scriptedAgent({
    "code-review": gateReport("code-review", {
      verdict: "FAIL",
      findings: [],
      assessment: { blockingReasons: [], scores: scoresFor("code-review"), finalScore: 9 },
    }),
  });
  const result = await committed(core, agent);
  assert.equal(result.passed, false);
  assert.ok(result.diagnostics.semanticFailures.length > 0);
});

test("finding missing path or evidence is not admitted as a blocker", async () => {
  const core = await loadCore();
  const agent = scriptedAgent({
    "code-review": failReport("code-review", [
      finding({ path: "", evidence: "x", title: "anonymous" }),
    ]),
  });
  const result = await committed(core, agent);
  assert.equal(result.passed, false);
  assert.equal(result.findings.some((f) => f.title === "anonymous"), false);
  assert.ok(result.diagnostics.schemaFailures.length + result.diagnostics.semanticFailures.length > 0);
});

test("agent null is execution incomplete, distinct from review FAIL", async () => {
  const core = await loadCore();
  const fail = await committed(core, scriptedAgent({
    "code-review": failReport("code-review", [finding()]),
  }));
  assert.equal(fail.executionStatus, "completed");
  assert.equal(fail.overall, "FAIL");
  assert.equal(fail.passed, false);

  const incomplete = await committed(core, scriptedAgent({ "code-review": null }));
  assert.equal(incomplete.executionStatus, "incomplete");
  assert.equal(incomplete.overall, "INVALID");
  assert.ok(incomplete.diagnostics.agentFailures.length > 0);
});

test("priority and blocking stay orthogonal; P2 may block", async () => {
  const core = await loadCore();
  const result = await committed(core, scriptedAgent({
    "code-review": failReport("code-review", [finding({ priority: "P2", blocking: true })]),
  }));
  assert.equal(result.passed, false);
  assert.equal(result.findings[0].priority, "P2");
  assert.equal(result.findings[0].blocking, true);
  assert.ok(result.fixQueue.length >= 1);
});

test("UNKNOWN dimensions yield INCONCLUSIVE with null finalScore, not a process failure", async () => {
  const core = await loadCore();
  const scores = scoresFor("code-review").map((s) =>
    s.dimension === "Requirements Fit"
      ? { dimension: s.dimension, unknown: true, weight: s.weight, reason: "no independent spec in the captured target" }
      : s,
  );
  const result = await committed(core, scriptedAgent({
    "code-review": gateReport("code-review", {
      verdict: "INCONCLUSIVE",
      summary: "need spec",
      assessment: { blockingReasons: [], scores, finalScore: null },
    }),
  }));
  assert.equal(result.passed, false);
  assert.equal(result.overall, "INCONCLUSIVE");
  assert.equal(result.executionStatus, "completed");
  const cr = result.reviews.find((r) => r.raw.gate === "code-review" || r.gate === "code-review");
  assert.equal(cr.verdict, "INCONCLUSIVE");
  assert.equal(cr.semanticOk, true);
  assert.equal(cr.raw.assessment.finalScore, null);
  assert.equal(result.diagnostics.semanticFailures.length, 0);
  assert.equal(result.diagnostics.agentFailures.length, 0);
});

test("confirmed blocker with partial scores is a legitimate FAIL", async () => {
  const core = await loadCore();
  const scores = scoresFor("code-review").map((s) =>
    s.dimension === "Requirements Fit"
      ? { dimension: s.dimension, unknown: true, weight: s.weight, reason: "spec not in snapshot" }
      : s,
  );
  const result = await committed(core, scriptedAgent({
    "code-review": failReport("code-review", [finding()], {
      assessment: {
        blockingReasons: ["null input returns 0"],
        scores,
        finalScore: null,
      },
    }),
  }));
  assert.equal(result.executionStatus, "completed");
  assert.equal(result.overall, "FAIL");
  assert.equal(result.passed, false);
  const cr = result.reviews.find((r) => r.raw.gate === "code-review" || r.gate === "code-review");
  assert.equal(cr.verdict, "FAIL");
  assert.equal(cr.semanticOk, true);
  assert.ok(result.findings.some((f) => f.blocking));
});

test("more than two justified N/A can still PASS", async () => {
  const core = await loadCore();
  const na = (dimension, weight, reason) => ({ dimension, na: true, weight, reason });
  const scored = (dimension, weight) => ({
    dimension, score: 9, na: false, weight, weighted: Number((9 * weight / 0.6).toFixed(4)),
  });
  const scores = [
    scored("Correctness", 0.25),
    na("Security", 0.15, "no untrusted input in this diff"),
    scored("Architecture", 0.2),
    na("Error Handling", 0.15, "no new error paths"),
    scored("Maintainability", 0.15),
    na("Requirements Fit", 0.1, "this delta does not affect requirements-facing behavior"),
  ];
  const result = await committed(core, scriptedAgent({
    "code-review": gateReport("code-review", {
      assessment: { blockingReasons: [], scores, finalScore: 9 },
    }),
  }));
  assert.equal(result.passed, true);
  const cr = result.reviews.find((r) => r.raw.gate === "code-review" || r.gate === "code-review");
  assert.equal(cr.raw.assessment.scores.filter((s) => s.na).length, 3);
});

test("all N/A is INCONCLUSIVE and cannot fabricate a numerical PASS", async () => {
  const core = await loadCore();
  const scores = scoresFor("code-review").map((s) => ({
    dimension: s.dimension,
    na: true,
    weight: s.weight,
    reason: `${s.dimension} has no evaluable content in this lens`,
  }));
  const result = await committed(core, scriptedAgent({
    "code-review": gateReport("code-review", {
      verdict: "INCONCLUSIVE",
      summary: "lens has no object",
      assessment: { blockingReasons: [], scores, finalScore: null },
    }),
  }));
  assert.equal(result.passed, false);
  const cr = result.reviews.find((r) => r.raw.gate === "code-review" || r.gate === "code-review");
  assert.equal(cr.verdict, "INCONCLUSIVE");
  assert.equal(cr.semanticOk, true);
  assert.equal(cr.raw.assessment.finalScore, null);
  assert.equal(result.diagnostics.semanticFailures.length, 0);
});
