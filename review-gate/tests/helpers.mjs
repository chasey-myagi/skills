import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export const CODE_DIMS = [
  "Correctness",
  "Security",
  "Architecture",
  "Error Handling",
  "Maintainability",
  "Requirements Fit",
];
export const TEST_DIMS = [
  "Quantity Adequacy",
  "Scenario Coverage",
  "Boundary Exploration",
  "Error Path Coverage",
  "State Combination",
  "Test Quality",
];

export function gitC(repo, args, opts = {}) {
  const r = spawnSync("git", ["-C", repo, ...args], {
    encoding: opts.encoding || "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "review-gate-test",
      GIT_AUTHOR_EMAIL: "rgate@test.local",
      GIT_COMMITTER_NAME: "review-gate-test",
      GIT_COMMITTER_EMAIL: "rgate@test.local",
    },
    maxBuffer: 20 * 1024 * 1024,
  });
  if (!opts.allowFail && r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${r.status}): ${r.stderr || r.stdout}`);
  }
  return r;
}

export function makeRepo(prefix = "rgate-repo-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  gitC(dir, ["init", "-b", "main"]);
  gitC(dir, ["config", "user.email", "rgate@test.local"]);
  gitC(dir, ["config", "user.name", "review-gate-test"]);
  gitC(dir, ["config", "commit.gpgsign", "false"]);
  return realpathSync(dir);
}

export function writeRel(repo, rel, content) {
  const abs = join(repo, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

export function commitRel(repo, rel, content, message) {
  writeRel(repo, rel, content);
  gitC(repo, ["add", "--", rel]);
  gitC(repo, ["commit", "-m", message]);
  return gitC(repo, ["rev-parse", "HEAD"]).stdout.trim();
}

export function sha(repo, ref = "HEAD") {
  return gitC(repo, ["rev-parse", ref]).stdout.trim();
}

export function freshRunDir(prefix = "rgate-run-") {
  return join(tmpdir(), `${prefix}${Date.now()}-${randomUUID()}`);
}

export function runtime(agentFn, { logs = [] } = {}) {
  return {
    agent: agentFn,
    parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
    phase: (title) => logs.push(["phase", title]),
    log: (msg) => logs.push(["log", msg]),
    logs,
  };
}

export function rt(agentFn) {
  return runtime(typeof agentFn === "function" ? agentFn : passingAgent());
}

export const CODE_WEIGHTS = {
  Correctness: 0.25,
  Security: 0.15,
  Architecture: 0.2,
  "Error Handling": 0.15,
  Maintainability: 0.15,
  "Requirements Fit": 0.1,
};
export const TEST_WEIGHTS = {
  "Quantity Adequacy": 0.15,
  "Scenario Coverage": 0.2,
  "Boundary Exploration": 0.2,
  "Error Path Coverage": 0.15,
  "State Combination": 0.15,
  "Test Quality": 0.15,
};

export function scoresFor(gate, score = 9) {
  const weights = gate === "test-review" ? TEST_WEIGHTS : CODE_WEIGHTS;
  return Object.entries(weights).map(([dimension, weight]) => ({
    dimension,
    score,
    na: false,
    weight,
    weighted: Number((score * weight).toFixed(4)),
  }));
}

export function finding(partial = {}) {
  return {
    id: "C1",
    priority: "P1",
    category: "correctness",
    blocking: true,
    path: "src/app.js",
    line: 4,
    title: "null input returns 0",
    trigger: "foo(null)",
    expected: "throw TypeError",
    actual: "returns 0",
    evidence: "no null check before arithmetic",
    suggestedFix: "reject null",
    ...partial,
  };
}

export function callout(partial = {}) {
  return {
    kind: "migration",
    summary: "renames users table",
    locations: ["db/migrate.sql:1"],
    ...partial,
  };
}

export function gateReport(gate, overrides = {}) {
  const linus = gate === "linus-review";
  const test = gate === "test-review";
  const assessment = {
    blockingReasons: [],
    scores: linus ? [] : scoresFor(gate),
    finalScore: linus ? undefined : 9.0,
    e2eBonus: test ? 0 : undefined,
    rating: linus ? "Looks reasonable." : undefined,
  };
  return JSON.parse(JSON.stringify({
    gate,
    verdict: "PASS",
    summary: `${gate} ok`,
    findings: [],
    humanCallouts: [],
    assessment: { ...assessment, ...(overrides.assessment || {}) },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== "assessment")),
  }));
}

export function failReport(gate, findings, extra = {}) {
  const base = gateReport(gate);
  return gateReport(gate, {
    verdict: "FAIL",
    summary: "blocking issues",
    findings,
    assessment: {
      ...base.assessment,
      blockingReasons: findings.filter((f) => f.blocking).map((f) => f.title),
    },
    ...extra,
  });
}

export function passingAgent() {
  return async (_prompt, opts) => gateReport(opts.label);
}

export function scriptedAgent(script) {
  const calls = [];
  const fn = async (prompt, opts) => {
    calls.push({ prompt, opts });
    const spec = script[opts.label];
    if (typeof spec === "function") return spec(prompt, opts, calls);
    if (spec === null) return null;
    if (spec === undefined) return gateReport(opts.label);
    return spec;
  };
  fn.calls = calls;
  return fn;
}

export function loadCore() {
  return import(new URL("../scripts/core.mjs", import.meta.url));
}

export function exists(p) {
  return existsSync(p);
}

export function assertOfficialFail(result) {
  if (result.overall !== "FAIL" || result.passed !== false) {
    throw new Error(`expected official FAIL, got overall=${result.overall} passed=${result.passed}`);
  }
}

export function assertOfficialPass(result) {
  if (result.executionStatus !== "completed" || result.overall !== "PASS" || result.passed !== true) {
    throw new Error(`expected official PASS, got status=${result.executionStatus} overall=${result.overall} passed=${result.passed}`);
  }
  if (result.drift?.detected) {
    throw new Error("expected no drift on official PASS");
  }
}

export function parseWorktree(prompt) {
  const m = prompt.match(/^WORKTREE:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

export function parseBuildDir(prompt) {
  const m = prompt.match(/^BUILD_DIR:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

export function parseFindingId(prompt) {
  const m = prompt.match(/^FINDING_ID:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}
