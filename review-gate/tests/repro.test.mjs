import { test } from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
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
  assert.ok(result.pendingHumanDecisions.length >= 1);
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

test("empty run objects are not valid REFUTED proof", async () => {
  const core = await loadCore();
  const { repo, base, head } = await setupDiff();
  const result = await core.runReviewGate({
    repoDir: repo, mode: "diff", base, head, repro: true, runDir: freshRunDir(),
  }, runtime(reviewAgent(
    { "code-review": [finding()] },
    async (prompt) => {
      const id = parseFindingId(prompt);
      const wt = parseWorktree(prompt);
      writeReproTest(wt, "x");
      return {
        id,
        verdict: "REFUTED",
        summary: "nope",
        oracle: { source: "x", statement: "y" },
        evidence: {
          testPath: "tests/repro/repro.test.js",
          testContent: "x",
          commands: [],
          redRuns: [{}],
          controlRuns: [{}],
          redabilityProof: { flippedRed: {}, restoredGreen: {} },
        },
      };
    },
  )));
  const v = result.verification.findings[0];
  assert.equal(v.claimed, "REFUTED");
  assert.equal(v.proof.valid, false);
  assert.equal(v.acceptance, "rejected-invalid-proof");
  assert.equal(result.passed, false);
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
      writeReproTest(wt);
      writeFileSync(join(wt, "src/app.js"), "TAMPER\n");
      return reproClaim(id, "REFUTED", {
        redabilityProof: {
          flippedRed: { output: "red", exitCode: 1 },
          restoredGreen: { output: "green", exitCode: 0 },
        },
      });
    },
  )));
  const v = result.verification.findings[0];
  assert.equal(v.proof.valid, false);
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

for (const kind of ['wrong-id', 'missing-hash', 'green-as-red', 'source-build', 'committed-source']) {
  test(`candidate proof rejects ${kind}`, async () => {
    const core = await loadCore();
    const { repo, base, head } = await setupDiff();
    const result = await core.runReviewGate({ repoDir: repo, mode: "diff", base, head, repro: true }, runtime(reviewAgent(
      { "code-review": [finding()] },
      async (prompt) => {
        const id = parseFindingId(prompt);
        const wt = parseWorktree(prompt);
        const packet = completePacket(wt, id, "CONFIRMED");
        if (kind === 'wrong-id') packet.id = 'another-finding';
        if (kind === 'missing-hash') delete packet.evidence.testHash;
        if (kind === 'green-as-red') packet.evidence.redRuns = packet.evidence.redRuns.map(run => ({ ...run, exitCode: 0 }));
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
  });
}
