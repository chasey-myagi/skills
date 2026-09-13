import { mkdirSync, readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { isRoutable, nonempty, sha256, REPRO_SCHEMA, validateSchema } from "./schema.mjs";
import { git, resolveCommit, resolveInRepo } from "./source.mjs";

function splitZ(bytes) { return bytes.toString().split("\0").filter(Boolean); }

function isNewTestPath(path) {
  return path.startsWith("tests/repro/") || /^tests\/repro_[^/]+\.rs$/.test(path)
    || /(^|\/)repro_[^/]+_test\.go$/.test(path);
}

export function inspectIntegrity(worktree, buildDir, head) {
  const base = head || resolveCommit(worktree, "HEAD");
  const tamper = [];
  if (resolveCommit(worktree, "HEAD") !== base) tamper.push("HEAD changed from frozen source");
  const existing = new Set(splitZ(git(worktree, ["ls-tree", "-r", "-z", "--name-only", base]).stdout));
  const changed = splitZ(git(worktree, ["diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z", base]).stdout);
  const fresh = splitZ(git(worktree, ["ls-files", "--others", "-z", "--exclude-standard"]).stdout);
  const ignored = splitZ(git(worktree, ["ls-files", "--others", "-i", "-z", "--exclude-standard"]).stdout);
  const newTests = [];
  for (const path of new Set([...changed, ...fresh, ...ignored])) {
    if (existing.has(path) || !isNewTestPath(path)) {
      tamper.push(`source change ${path}`);
      continue;
    }
    try {
      const { abs } = resolveInRepo(worktree, path, { mustExist: true, follow: false });
      if (!lstatSync(abs).isFile()) throw new Error("not a regular test file");
      newTests.push(path);
    } catch (err) { tamper.push(`${path}: ${err.message}`); }
  }
  return { tamper, newTests: newTests.sort() };
}

function runOK(run, passes) {
  return run && nonempty(run.cmd) && nonempty(run.output) && Number.isInteger(run.exitCode)
    && (passes ? run.exitCode === 0 : run.exitCode > 0 && run.exitCode <= 255);
}

export function proofValidity(claim, worktree, expectedId, newTests = []) {
  const reasons = validateSchema(REPRO_SCHEMA, claim);
  const testFiles = [];
  if (!claim || typeof claim !== "object") return { valid: false, reasons, testFiles };
  if (claim.id !== expectedId) reasons.push("claim ID does not match assigned finding");
  if (!["CONFIRMED", "REFUTED"].includes(claim.verdict)) {
    reasons.push("no behavioral proof established");
    return { valid: false, reasons, testFiles };
  }
  const oracle = claim.oracle || {};
  if (!nonempty(oracle.source) || !nonempty(oracle.statement)) reasons.push("missing independent oracle");
  const ev = claim.evidence || {};
  if (!newTests.includes(ev.testPath)) reasons.push("declared test must be a newly created test file");
  for (const path of newTests) {
    const { abs } = resolveInRepo(worktree, path, { mustExist: true, follow: false });
    const bytes = readFileSync(abs);
    testFiles.push({ path, hash: sha256(bytes), content: bytes.toString("utf8") });
  }
  const disk = testFiles.find(test => test.path === ev.testPath);
  if (!disk || !nonempty(ev.testContent) || ev.testContent !== disk.content) reasons.push("testContent must match declared test on disk");
  if (!disk || ev.testHash !== disk.hash) reasons.push("testHash must match declared test on disk");
  if (!Array.isArray(ev.commands) || !ev.commands.length || ev.commands.some(run => !runOK(run, run?.exitCode === 0))) reasons.push("missing command execution records");
  if (claim.verdict === "CONFIRMED") {
    if (!nonempty(claim.predicted) || !nonempty(claim.observed) || !nonempty(claim.assertionMapping)) reasons.push("missing predicted/observed assertion mapping");
    if (!Array.isArray(ev.redRuns) || ev.redRuns.length < 3 || ev.redRuns.some(run => !runOK(run, false))) reasons.push("CONFIRMED needs three failing assertion runs");
    if (!Array.isArray(ev.controlRuns) || !ev.controlRuns.length || ev.controlRuns.some(run => !runOK(run, true))) reasons.push("CONFIRMED needs successful controls");
  } else {
    if (!nonempty(claim.scope)) reasons.push("REFUTED needs an explicit scenario boundary");
    if (!Array.isArray(ev.greenRuns) || !ev.greenRuns.length || ev.greenRuns.some(run => !runOK(run, true))) reasons.push("REFUTED needs a passing behavior test");
    if (!runOK(ev.redabilityProof?.flippedRed, false) || !runOK(ev.redabilityProof?.restoredGreen, true)) reasons.push("REFUTED needs red then restored-green proof");
  }
  return { valid: reasons.length === 0, reasons, testFiles };
}

export function createWorktree(repo, runDir, findingId, headSha) {
  const worktree = join(runDir, "worktrees", findingId);
  const buildDir = join(runDir, "build", findingId);
  mkdirSync(join(runDir, "worktrees"), { recursive: true });
  mkdirSync(buildDir, { recursive: true });
  git(repo, ["worktree", "add", "--detach", "--", worktree, headSha]);
  return { worktree, buildDir };
}

export function routeFindings(aggregated, { reproCap, benchmarkHarness }) {
  const queue = [];
  const skipped = [];
  for (const f of aggregated) {
    if (!f.blocking) continue;
    if (!isRoutable(f, { benchmarkHarness })) {
      const why = f.category === "performance" ? "performance without benchmarkHarness" : `not a reproducible behavioral claim: ${f.category}`;
      skipped.push({ id: f.id, sources: f.sources, why, officialStatus: "blocking" });
      continue;
    }
    queue.push(f);
  }
  const cap = reproCap;
  const taken = queue.slice(0, cap);
  const over = queue.slice(cap).map((f) => ({
    id: f.id,
    sources: f.sources,
    claimed: null,
    accepted: false,
    officialStatus: "unresolved",
    acceptance: "over-cap",
    proof: { valid: false, reasons: [`over cap (${cap})`] },
    worktree: null,
    buildDir: null,
    testFiles: [],
  }));
  return { taken, over, skipped };
}

export function parentReproPath() {
  return "Commit the reviewed work onto a dedicated review branch and rerun review-gate in mode=diff at those frozen SHAs. Do not stash or reset the live checkout.";
}
