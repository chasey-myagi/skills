import { test } from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  runtime,
  parseWorktree,
  parseBuildDir,
  parseFindingId,
} from "./helpers.mjs";
import { proofValidity, inspectIntegrity } from "../scripts/repro.mjs";

const REPRO_SRC = "test('red', () => { throw new Error('red') })\n";

function reproClaim(id, verdict, extra = {}) {
  const testPath = extra.testPath || "tests/repro/repro.test.js";
  const testContent = extra.testContent || REPRO_SRC;
  return {
    id,
    verdict,
    summary: `${verdict} claim`,
    oracle: { source: "src/app.js", statement: "foo(null) throws" },
    evidence: {
      testPath,
      testContent,
      commands: [{ cmd: "node --test tests/repro/repro.test.js", output: extra.cmdOutput || "fail", exitCode: extra.exitCode ?? 1 }],
      redRuns: extra.redRuns || [
        { output: "expected throw", exitCode: 1 },
        { output: "expected throw", exitCode: 1 },
        { output: "expected throw", exitCode: 1 },
      ],
      controlRuns: extra.controlRuns || [{ output: "ok", exitCode: 0 }],
      redabilityProof: extra.redabilityProof,
    },
    ...extra.rest,
  };
}

function writeReproTest(wt, content = REPRO_SRC) {
  mkdirSync(join(wt, "tests/repro"), { recursive: true });
  const rel = "tests/repro/repro.test.js";
  writeFileSync(join(wt, rel), content);
  return rel;
}

// Controlled reviewer packets test evidence validation, not the truth of a model's claim.
function completePacket(wt, id, verdict) {
  const testPath = "tests/repro/repro.test.js";
  const testContent = "// controlled new-test fixture\n";
  mkdirSync(join(wt, "tests/repro"), { recursive: true });
  writeFileSync(join(wt, testPath), testContent);
  const red = { cmd: "node --test repro.test.js --case=red", output: "assertion: expected throw, returned 0", exitCode: 1 };
  const green = { cmd: "node --test repro.test.js --case=control", output: "one test passed", exitCode: 0 };
  return {
    id, verdict, summary: "controlled candidate packet",
    oracle: { source: "contract.md:4", statement: "null must throw" },
    predicted: "expected throw, returned 0", observed: "expected throw, returned 0",
    assertionMapping: "the null assertion exercises the reported null scenario", scope: "foo(null) only",
    evidence: {
      testPath, testContent, testHash: createHash("sha256").update(testContent).digest("hex"),
      commands: [red, green], redRuns: [red, red, red], controlRuns: [green], greenRuns: [green],
      redabilityProof: { flippedRed: red, restoredGreen: green },
    },
  };
}

async function setupDiff() {
  const repo = makeRepo();
  const base = commitRel(repo, "src/app.js", "export function foo(x){return x+1}\n", "base");
  writeRel(repo, "src/app.js", "export function foo(x){return x==null?0:x+1}\n");
  gitC(repo, ["commit", "-am", "head"]);
  return { repo, base, head: sha(repo) };
}

function reviewAgent(findingsByGate, reproHandler) {
  return async (prompt, opts) => {
    if (opts.label.startsWith("repro:")) {
      return reproHandler(prompt, opts);
    }
    const gate = opts.label;
    const findings = findingsByGate[gate] || [];
    if (!findings.length) return gateReport(gate);
    if (gate === "linus-review") {
      return failReport(gate, findings, {
        assessment: { blockingReasons: findings.map((f) => f.title), rating: "Please fix and resend.", scores: [] },
      });
    }
    if (gate === "test-review") {
      return failReport(gate, findings);
    }
    return failReport(gate, findings);
  };
}

test("falsifiable linus and test-review findings are routed", async () => {
  const core = await loadCore();
  const { repo, base, head } = await setupDiff();
  const routed = [];
  const linusF = finding({ id: "L1", title: "linus null bug" });
  const testF = finding({
    id: "T1",
    category: "correctness",
    path: "tests/app.test.js",
    line: 3,
    title: "test asserts wrong actual",
    trigger: "foo(null)",
    expected: "throw",
    actual: "assert equals 0",
    evidence: "assertion encodes the bug",
    suggestedFix: "assert throw",
  });
  const result = await core.runReviewGate({
    repoDir: repo, mode: "diff", base, head, repro: true, runDir: freshRunDir(), reproCap: 3,
  }, runtime(reviewAgent(
    { "linus-review": [linusF], "test-review": [testF] },
    async (prompt, opts) => {
      routed.push(opts.label);
      const id = parseFindingId(prompt);
      const wt = parseWorktree(prompt);
      writeReproTest(wt);
      return reproClaim(id, "CONFIRMED");
    },
  )));
  assert.ok(routed.length >= 2, `routed ${routed.join(",")}`);
  assert.equal(result.verification.ran, true);
  assert.equal(result.passed, false);
});

test("architecture / test-gap without behavior fields are not routed", async () => {
  const core = await loadCore();
  const { repo, base, head } = await setupDiff();
  let reproCalls = 0;
  const result = await core.runReviewGate({
    repoDir: repo, mode: "diff", base, head, repro: true, runDir: freshRunDir(),
  }, runtime(reviewAgent(
    {
      "code-review": [finding({
        id: "A1",
        category: "architecture",
        trigger: "",
        expected: "",
        actual: "",
        evidence: "god object in src/app.js",
        title: "too much in one function",
        suggestedFix: "split",
      })],
      "test-review": [finding({
        id: "G1",
        category: "test-gap",
        path: "tests/app.test.js",
        line: 1,
        trigger: "",
        expected: "",
        actual: "",
        evidence: "no test for foo(-1)",
        title: "missing negative case",
        suggestedFix: "add test",
        blocking: true,
      })],
    },
    async () => {
      reproCalls += 1;
      return reproClaim("x", "CONFIRMED");
    },
  )));
  assert.equal(reproCalls, 0);
  assert.equal(result.verification.ran, false);
  assert.equal(result.pendingHumanDecisions.length, 0);
  assert.equal(result.fixQueue.length, 2);
  assert.deepEqual(result.fixQueue.flatMap(f => f.sources.map(s => s.id)).sort(), ["A1", "G1"]);
  assert.equal(result.passed, false);
});

test("over-cap and skipped remain unresolved, never REFUTED", async () => {
  const core = await loadCore();
  const { repo, base, head } = await setupDiff();
  const mk = (id, n) => finding({
    id,
    trigger: `foo(${n})`,
    expected: "ok",
    actual: "throws",
    evidence: `path ${n}`,
    title: `bug ${n}`,
    path: "src/app.js",
    line: n,
  });
  const result = await core.runReviewGate({
    repoDir: repo, mode: "diff", base, head, repro: true, runDir: freshRunDir(), reproCap: 1,
  }, runtime(reviewAgent(
    { "code-review": [mk("C1", 1), mk("C2", 2), mk("C3", 3)] },
    async (prompt) => {
      const id = parseFindingId(prompt);
      const wt = parseWorktree(prompt);
      writeReproTest(wt);
      return reproClaim(id, "CONFIRMED");
    },
  )));
  const over = result.verification.findings.filter((f) => f.acceptance === "over-cap");
  assert.ok(over.length >= 2);
  assert.equal(over.every((f) => f.claimed !== "REFUTED" && f.officialStatus !== "refuted"), true);
  assert.equal(result.passed, false);
});

test("candidate REFUTED does not authorize official PASS", async () => {
  const core = await loadCore();
  const { repo, base, head } = await setupDiff();
  const result = await core.runReviewGate({
    repoDir: repo, mode: "diff", base, head, repro: true, runDir: freshRunDir(),
  }, runtime(reviewAgent(
    { "code-review": [finding()] },
    async (prompt) => {
      const id = parseFindingId(prompt);
      const wt = parseWorktree(prompt);
      return completePacket(wt, id, "REFUTED");
    },
  )));
  assert.equal(result.passed, false);
  assert.equal(result.overall, "FAIL");
  assert.equal("candidateOverall" in result, false);
  const v = result.verification.findings[0];
  assert.equal(v.claimed, "REFUTED");
  assert.equal(v.accepted, false);
  assert.equal(v.acceptance, "awaiting-parent");
  assert.equal(v.proof.valid, true);
  assert.equal(v.raw.evidence.greenRuns[0].exitCode, 0);
  assert.notEqual(v.officialStatus, "withdrawn");
  const wt = v.worktree;
  assert.equal(existsSync(wt), true);
});

test("tampered repro source invalidates proof; worktree is kept", async () => {
  const core = await loadCore();
  const { repo, base, head } = await setupDiff();
  const result = await core.runReviewGate({
    repoDir: repo, mode: "diff", base, head, repro: true, runDir: freshRunDir(),
  }, runtime(reviewAgent(
    { "code-review": [finding()] },
    async (prompt) => {
      const id = parseFindingId(prompt);
      const wt = parseWorktree(prompt);
      const claim = completePacket(wt, id, "REFUTED");
      assert.equal(proofValidity(claim, wt, id, [claim.evidence.testPath]).valid, true);
      writeFileSync(join(wt, "src/app.js"), "TAMPER\n");
      return claim;
    },
  )));
  const v = result.verification.findings[0];
  assert.equal(v.proof.valid, false);
  assert.deepEqual(v.proof.reasons, ["tamper: source change src/app.js"]);
  assert.equal(v.acceptance, "rejected-invalid-proof");
  assert.equal(existsSync(v.worktree), true);
  assert.equal(result.passed, false);
});

test("owned build-dir artifacts are not treated as source edits", async () => {
  const core = await loadCore();
  const { repo, base, head } = await setupDiff();
  const result = await core.runReviewGate({
    repoDir: repo, mode: "diff", base, head, repro: true, runDir: freshRunDir(),
  }, runtime(reviewAgent(
    { "code-review": [finding()] },
    async (prompt) => {
      const id = parseFindingId(prompt);
      const wt = parseWorktree(prompt);
      const build = parseBuildDir(prompt);
      assert.ok(build, "BUILD_DIR must be in the repro prompt");
      assert.equal(build.includes(wt), false);
      mkdirSync(join(build, "target"), { recursive: true });
      writeFileSync(join(build, "target", "out.o"), "obj");
      return completePacket(wt, id, "CONFIRMED");
    },
  )));
  const v = result.verification.findings[0];
  assert.equal(v.claimed, "CONFIRMED");
  assert.ok(v.buildDir);
  assert.equal(v.proof.valid, true);
  assert.equal(v.accepted, false);
  assert.equal(result.passed, false);
});

test("working-tree skips repro instead of verifying a different HEAD", async () => {
  const core = await loadCore();
  const repo = makeRepo();
  commitRel(repo, "src/app.js", "v1\n", "init");
  writeRel(repo, "src/app.js", "v2\n");
  let reproCalls = 0;
  const result = await core.runReviewGate({
    repoDir: repo, mode: "working-tree", repro: true, runDir: freshRunDir(),
  }, runtime(async (prompt, opts) => {
    if (opts.label.startsWith("repro:")) {
      reproCalls += 1;
      return reproClaim("x", "CONFIRMED");
    }
    if (opts.label === "code-review") return failReport("code-review", [finding()]);
    return gateReport(opts.label);
  }));
  assert.equal(reproCalls, 0);
  assert.equal(result.verification.skipped, true);
  assert.ok(result.verification.parentReproPath);
  assert.equal(result.passed, false);
});

for (const kind of ['wrong-id', 'missing-hash', 'green-as-red', 'source-build', 'committed-source', 'committed-test', 'ignored-file']) {
  test(`candidate proof rejects ${kind}`, async () => {
    const core = await loadCore();
    const { repo, base } = await setupDiff();
    commitRel(repo, ".gitignore", "cache/\n", "ignore cache");
    const head = sha(repo);
    const result = await core.runReviewGate({ repoDir: repo, mode: "diff", base, head, repro: true }, runtime(reviewAgent(
      { "code-review": [finding()] },
      async (prompt) => {
        const id = parseFindingId(prompt);
        const wt = parseWorktree(prompt);
        const packet = completePacket(wt, id, "CONFIRMED");
        if (kind === 'wrong-id') packet.id = 'another-finding';
        if (kind === 'missing-hash') delete packet.evidence.testHash;
        if (kind === 'green-as-red') packet.evidence.redRuns = packet.evidence.redRuns.map(run => ({ ...run, exitCode: 0 }));
        if (kind === 'ignored-file') writeRel(wt, 'cache/injected.js', 'ignored behavior change');
        if (kind === 'committed-test') {
          gitC(wt, ['add', '--', packet.evidence.testPath]);
          gitC(wt, ['commit', '-m', 'forbidden test commit']);
        }
        if (kind === 'source-build') writeRel(wt, 'build/implementation.js', 'unapproved source');
        if (kind === 'committed-source') {
          writeRel(wt, 'src/app.js', 'committed tamper');
          gitC(wt, ['add', '--', 'src/app.js']);
          gitC(wt, ['commit', '-m', 'tamper']);
        }
        return packet;
      },
    )));
    const packet = result.verification.findings[0];
    assert.equal(packet.proof.valid, false);
    assert.equal(packet.accepted, false);
    assert.equal(packet.acceptance, 'rejected-invalid-proof');
    assert.equal(result.passed, false);
    assert.ok(packet.raw, 'original claim survives rejection');
    const reasons = { 'wrong-id': /claim ID/, 'missing-hash': /testHash/,
      'green-as-red': /three failing assertion runs/, 'source-build': /source change build/,
      'committed-source': /source change src/, 'committed-test': /HEAD changed/,
      'ignored-file': /source change cache/ };
    assert.match(packet.proof.reasons.join('\n'), reasons[kind]);
  });
}

const evidenceMutations = [
  ["REFUTED", "redability", p => delete p.evidence.redabilityProof, /red then restored-green/],
  ["REFUTED", "scope", p => delete p.scope, /explicit scenario boundary/],
  ["REFUTED", "green runs", p => delete p.evidence.greenRuns, /passing behavior test/],
  ["CONFIRMED", "third red run", p => p.evidence.redRuns.pop(), /three failing assertion runs/],
  ["CONFIRMED", "control", p => delete p.evidence.controlRuns, /successful controls/],
  ...["predicted", "observed", "assertionMapping"].map(key => ["CONFIRMED", key, p => delete p[key], /predicted\/observed assertion mapping/]),
  ["CONFIRMED", "oracle", p => delete p.oracle, /independent oracle/],
  ["CONFIRMED", "test content", p => p.evidence.testContent += "tamper", /testContent must match/],
  ["CONFIRMED", "commands", p => p.evidence.commands = [], /command execution records/],
];
for (const [verdict, label, mutate, reason] of evidenceMutations) {
  test(`proof rejects only missing or mismatched ${label}`, () => {
    const wt = makeRepo();
    const packet = completePacket(wt, "F1", verdict);
    const tests = [packet.evidence.testPath];
    assert.equal(proofValidity(packet, wt, "F1", tests).valid, true);
    mutate(packet);
    const result = proofValidity(packet, wt, "F1", tests);
    assert.equal(result.valid, false);
    assert.match(result.reasons.join("\n"), reason);
  });
}
test("a declared existing test cannot qualify as new evidence", () => {
  const wt = makeRepo();
  const packet = completePacket(wt, "F1", "CONFIRMED");
  const result = proofValidity(packet, wt, "F1", []);
  assert.match(result.reasons.join("\n"), /declared test must be a newly created test file/);
});

for (const outcome of ["null", "throw", "BLOCKED", "NOT_TESTABLE", "setup-failure"]) {
  test(`repro ${outcome} preserves unresolved source claim and execution evidence`, async () => {
    const core = await loadCore();
    const { repo, base, head } = await setupDiff();
    const runDir = freshRunDir();
    const inner = reviewAgent({ "code-review": [finding()] }, async prompt => {
      if (outcome === "null") return null;
      if (outcome === "throw") throw new Error("backend unavailable");
      return { id: parseFindingId(prompt), verdict: outcome, summary: "required harness unavailable" };
    });
    let reproCalls = 0;
    const result = await core.runReviewGate({ repoDir: repo, mode: "diff", base, head, repro: true, runDir }, runtime(async (prompt, opts) => {
      if (outcome === "setup-failure" && !opts.label.startsWith("repro:")) writeFileSync(join(runDir, "worktrees"), "cannot create worktree here");
      if (opts.label.startsWith("repro:")) reproCalls++;
      return inner(prompt, opts);
    }));
    const v = result.verification.findings[0];
    assert.equal(reproCalls, outcome === "setup-failure" ? 0 : 1);
    assert.equal(v.accepted, false);
    assert.equal(v.officialStatus, "blocking");
    assert.equal(v.acceptance, outcome === "NOT_TESTABLE" ? "not-testable" : "blocked");
    assert.deepEqual(v.sources, [{ gate: "code-review", id: "C1" }]);
    assert.ok(result.unrunChecks.some(x => x.includes(v.id)));
    assert.equal(result.overall, "FAIL");
    assert.equal(result.fixQueue.length, 1);
    const stored = JSON.parse(readFileSync(result.artifacts.resultJson));
    assert.deepEqual(stored.verification.findings[0].raw, v.raw);
  });
}

test("identical cross-gate claims dispatch one repro and retain both sources", async () => {
  const core = await loadCore();
  const { repo, base, head } = await setupDiff();
  let calls = 0;
  const result = await core.runReviewGate({ repoDir: repo, mode: "diff", base, head, repro: true }, runtime(reviewAgent(
    { "code-review": [finding()], "test-review": [finding({ id: "T1" })] },
    async prompt => { calls++; return completePacket(parseWorktree(prompt), parseFindingId(prompt), "CONFIRMED"); },
  )));
  assert.equal(calls, 1);
  assert.deepEqual(result.verification.findings[0].sources, [{ gate: "code-review", id: "C1" }, { gate: "test-review", id: "T1" }]);
});
for (const kind of ["invalid-report", "advisory", "performance-without-harness", "performance-with-harness"]) {
  test(`repro routing: ${kind}`, async () => {
    const core = await loadCore();
    const { repo, base, head } = await setupDiff();
    let calls = 0;
    const f = finding({ category: kind.startsWith("performance") ? "performance" : "correctness", blocking: kind !== "advisory" });
    const report = kind === "advisory" ? gateReport("code-review", { findings: [f] }) : failReport("code-review", [f]);
    if (kind === "invalid-report") report.assessment.finalScore = 0;
    await core.runReviewGate({ repoDir: repo, mode: "diff", base, head, repro: true,
      ...(kind === "performance-with-harness" ? { benchmarkHarness: "bench: fixed workload and timing oracle" } : {}) }, runtime(async (prompt, opts) => {
      if (opts.label.startsWith("repro:")) { calls++; return completePacket(parseWorktree(prompt), parseFindingId(prompt), "CONFIRMED"); }
      return opts.label === "code-review" ? report : gateReport(opts.label);
    }));
    assert.equal(calls, kind === "performance-with-harness" ? 1 : 0);
  });
}

for (const rel of ["tests/repro_null.rs", "internal/foo/repro_null_test.go"]) {
  test(`language-native new test ${rel} is included in integrity evidence`, () => {
    const wt = makeRepo();
    const head = commitRel(wt, "source.txt", "protected", "base");
    writeRel(wt, rel, "new test");
    const result = inspectIntegrity(wt, undefined, head);
    assert.deepEqual(result.tamper, []);
    assert.deepEqual(result.newTests, [rel]);
  });
}

test("unexpected source checkout edits invalidate otherwise valid isolated evidence", async () => {
  const core = await loadCore();
  const { repo, base, head } = await setupDiff();
  writeRel(repo, 'user-notes.txt', 'preexisting user work');
  const result = await core.runReviewGate({ repoDir: repo, mode: 'diff', base, head, repro: true }, runtime(reviewAgent(
    { 'code-review': [finding()] },
    async prompt => {
      const packet = completePacket(parseWorktree(prompt), parseFindingId(prompt), 'CONFIRMED');
      writeRel(repo, 'src/app.js', 'unexpected source mutation');
      return packet;
    },
  )));
  const v = result.verification.findings[0];
  assert.equal(result.drift.detected, true);
  assert.equal(result.overall, 'INVALID');
  assert.equal(v.proof.valid, false);
  assert.equal(v.accepted, false);
  assert.match(v.proof.reasons.join('\n'), /source checkout changed/);
  assert.equal(readFileSync(join(repo, 'user-notes.txt'), 'utf8'), 'preexisting user work');
  assert.equal(readFileSync(join(repo, 'src/app.js'), 'utf8'), 'unexpected source mutation');
  assert.ok(v.raw.evidence.testHash);
});
