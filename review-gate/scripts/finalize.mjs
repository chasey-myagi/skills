#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { persist } from "./prepare.mjs";
import { reproPrompt } from "./prompt.mjs";
import { GATE_NAMES, REPRO_SCHEMA, aggregateCallouts, aggregateFindings, evaluateGate, sha256 } from "./schema.mjs";
import { checkoutFingerprint, detectDrift } from "./source.mjs";
import { createWorktree, inspectIntegrity, parentReproPath, proofValidity, routeFindings } from "./repro.mjs";

function noop() {}

export function capturedFromState(saved) {
  const fileContents = saved.files.map((file) => ({
    path: file.path,
    hash: file.hash,
    status: file.status,
    bytes: file.hash === "deleted" || file.status === "deleted" ? null : Buffer.alloc(0),
    baseHash: file.baseHash || null,
    baseBytes: file.baseHash ? Buffer.alloc(0) : null,
    indexHash: file.indexHash,
    indexBytes: file.indexHash && file.indexHash !== "deleted" ? Buffer.alloc(0) : null,
  }));
  return {
    mode: saved.mode,
    repo: saved.repo,
    baseSha: saved.baseSha,
    headSha: saved.headSha,
    mergeBase: saved.mergeBase,
    manifestHash: saved.manifestHash,
    baseRef: saved.baseRef,
    headRef: saved.headRef,
    pathFilter: saved.pathFilter,
    policy: saved.policy,
    policyContents: saved.policyContents || [],
    files: saved.files.map(({ path, hash, status, indexHash }) => ({ path, hash, status, ...(indexHash ? { indexHash } : {}) })),
    fileContents,
  };
}

export function loadPreparedState(runDir) {
  const saved = JSON.parse(readFileSync(join(runDir, "meta", "prepare-state.json"), "utf8"));
  const result = JSON.parse(readFileSync(join(runDir, "review-result.json"), "utf8"));
  return {
    args: saved.args,
    repo: saved.repo,
    runDir,
    result,
    captured: capturedFromState(saved.captured),
    snapshotDir: saved.snapshotDir,
    diffPath: saved.diffPath,
    diffHash: saved.diffHash,
    reproRubric: readFileSync(join(runDir, "meta", "kit", "repro", "repro-agent.md"), "utf8"),
    style: saved.style || null,
  };
}

export function readGateReport(runDir, gate) {
  const path = join(runDir, "reports", `${gate}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { gate, verdict: "PASS", summary: "report is not JSON", findings: "not-json", humanCallouts: [], assessment: {} };
  }
}

export async function finalizeReview(state, reviews, runtime = {}) {
  const agent = runtime.agent;
  const parallel = runtime.parallel || (async (thunks) => Promise.all(thunks.map((t) => t())));
  const phase = runtime.phase || noop;
  const { args, repo, runDir, result, captured, snapshotDir, diffPath, diffHash, reproRubric } = state;

  if (!Array.isArray(reviews) || reviews.length !== GATE_NAMES.length) {
    throw new Error("runtime returned an invalid gate count");
  }
  result.reviews = reviews;

  for (const r of reviews) {
    if (r.raw == null) {
      if (!result.diagnostics.agentFailures.some(f => f.gate === r.gate)) result.diagnostics.agentFailures.push({ gate: r.gate, returned: null });
      result.diagnostics.missingGates.push(r.gate);
    } else if (!r.identityOk) {
      result.diagnostics.identityFailures.push({ gate: r.gate, returned: r.raw.gate });
    } else if (r.schemaErrors?.length) {
      result.diagnostics.schemaFailures.push({ gate: r.gate, errors: r.schemaErrors });
    } else if (!r.semanticOk) {
      result.diagnostics.semanticFailures.push({ gate: r.gate, errors: r.semanticErrors });
    }
  }
  result.executionStatus = result.diagnostics.agentFailures.length ? "incomplete" : "completed";

  const validReviews = reviews.filter(r => r.semanticOk);
  const findings = aggregateFindings(validReviews);
  const humanCallouts = aggregateCallouts(validReviews);
  result.findings = findings;
  result.humanCallouts = humanCallouts;

  const compatibleDiff = captured.mode === "diff" && captured.headSha;
  const routed = routeFindings(findings, { reproCap: args.reproCap, benchmarkHarness: args.benchmarkHarness });
  for (const r of reviews.filter(r => r.verdict === "INCONCLUSIVE")) {
    result.pendingHumanDecisions.push({ gate: r.gate, reason: r.summary });
  }
  persist(runDir, result);
  let sourceBeforeRepro = null;
  let fingerprintError = null;
  if (args.repro && compatibleDiff && routed.taken.length && typeof agent === "function") {
    try { sourceBeforeRepro = checkoutFingerprint(repo); }
    catch (err) { fingerprintError = `cannot fingerprint source checkout: ${err.message}`; }
  }
  result.verification.enabled = args.repro;
  if (!args.repro) {
    result.verification.skipped = true;
    result.verification.skipReason = "repro disabled";
  } else if (!compatibleDiff) {
    result.verification.skipped = true;
    result.verification.skipReason = `${captured.mode} cannot be faithfully isolated at a frozen HEAD`;
    result.verification.parentReproPath = parentReproPath();
    result.unrunChecks.push("repro skipped for non-diff target");
  } else if (typeof agent !== "function") {
    result.verification.skipped = true;
    result.verification.skipReason = "finalize has no reviewer runtime; repro stays with runReviewGate";
    result.unrunChecks.push(result.verification.skipReason);
  } else if (fingerprintError) {
    result.verification.skipped = true;
    result.verification.skipReason = fingerprintError;
    result.unrunChecks.push(fingerprintError);
  } else {
    const verFindings = [...routed.over];
    result.verification.findings = verFindings;
    if (routed.taken.length) {
      phase("Verify");
      result.verification.ran = true;
      const reproCalls = routed.taken.map((f) => async () => {
        const record = { id: f.id, sources: f.sources, claimed: null, accepted: false,
          officialStatus: "blocking", acceptance: "rejected-invalid-proof", raw: null,
          proof: { valid: false, reasons: [] }, worktree: null, buildDir: null, testFiles: [] };
        verFindings.push(record);
        try {
          const { worktree, buildDir } = createWorktree(repo, runDir, f.id, captured.headSha);
          Object.assign(record, { worktree, buildDir });
          result.artifacts.reproWorktrees.push(worktree);
          result.verification.worktrees.push({ findingId: f.id, path: worktree, head: captured.headSha, buildDir });
          persist(runDir, result);
          const prompt = reproPrompt(f, reproRubric, worktree, buildDir, captured, args);
          const claim = await agent(prompt, { label: `repro:${f.id}`, phase: "Verify", schema: REPRO_SCHEMA });
          record.raw = claim;
          if (claim == null) throw new Error("repro agent returned null");
          record.claimed = claim?.verdict || null;
          persist(runDir, result);
          const integrity = inspectIntegrity(worktree, buildDir, captured.headSha);
          const proof = proofValidity(claim, worktree, f.id, integrity.newTests);
          proof.reasons.push(...integrity.tamper.map(t => `tamper: ${t}`));
          proof.valid = proof.valid && !integrity.tamper.length;
          record.proof = { valid: proof.valid, reasons: proof.reasons };
          record.testFiles = proof.testFiles;
          record.acceptance = claim?.verdict === "BLOCKED" ? "blocked"
            : claim?.verdict === "NOT_TESTABLE" ? "not-testable"
            : proof.valid ? "awaiting-parent" : "rejected-invalid-proof";
          if (["blocked", "not-testable"].includes(record.acceptance)) result.unrunChecks.push(`repro ${f.id}: ${claim.verdict} ${claim.summary}`);
        } catch (err) {
          record.proof = { valid: false, reasons: [`execution blocked: ${err.message}`] };
          record.acceptance = "blocked";
          result.unrunChecks.push(`repro ${f.id}: ${err.message}`);
        }
        persist(runDir, result);
        return record;
      });
      await parallel(reproCalls);
    }

    for (const s of routed.skipped) {
      verFindings.push({
        id: s.id,
        sources: s.sources,
        claimed: null,
        accepted: false,
        officialStatus: "unresolved",
        acceptance: "not-routed",
        proof: { valid: false, reasons: [s.why] },
        worktree: null,
        buildDir: null,
        testFiles: [],
      });
    }
    result.verification.findings = verFindings;
    if (routed.over.length) result.unrunChecks.push(`${routed.over.length} verifiable finding(s) over cap ${args.reproCap}`);
  }

  const drift = detectDrift({ ...args, repoDir: repo }, repo, captured, snapshotDir);
  if (!existsSync(diffPath) || sha256(readFileSync(diffPath)) !== diffHash) {
    drift.detected = true;
    drift.details = [drift.details, "diff artifact changed"].filter(Boolean).join("; ");
  }
  if (sourceBeforeRepro !== null) {
    let sourceDelta = null;
    try {
      if (checkoutFingerprint(repo) !== sourceBeforeRepro) sourceDelta = "source checkout changed during verification; preserve and inspect the unexpected delta";
    } catch (err) { sourceDelta = `source checkout can no longer be fingerprinted: ${err.message}`; }
    result.verification.sourceDelta = { detected: sourceDelta !== null, details: sourceDelta };
    if (sourceDelta) {
      result.unrunChecks.push(sourceDelta);
      for (const record of result.verification.findings.filter(v => v.worktree)) {
        record.proof.valid = false;
        record.proof.reasons.push(sourceDelta);
        record.acceptance = "rejected-invalid-proof";
      }
    }
  }
  result.drift = drift;

  result.passCount = reviews.filter(r => r.verdict === "PASS").length;
  result.passed = result.executionStatus === "completed" && result.passCount === GATE_NAMES.length && !drift.detected;
  result.overall = drift.detected || reviews.some(r => r.verdict === "INVALID") ? "INVALID"
    : reviews.some(r => r.verdict === "FAIL") ? "FAIL"
    : result.passed ? "PASS" : "INCONCLUSIVE";
  result.fixQueue = findings.filter(f => f.blocking).map(f => ({
    id: f.id, title: f.title, path: f.path, priority: f.priority, sources: f.sources,
    verification: result.verification.findings.find(v => v.id === f.id)?.acceptance || "not-run",
  }));
  result.gateBlockingReasons = validReviews.filter(r => r.verdict === "FAIL").map(r => ({ gate: r.gate, reasons: r.assessment.blockingReasons }));
  for (const r of validReviews.filter(r => r.verdict === "FAIL" && !r.findings.some(f => f.blocking))) {
    result.fixQueue.push({ id: `gate:${r.gate}`, gate: r.gate, title: r.assessment.blockingReasons.join("; "), verification: "requires-review-followup" });
  }
  persist(runDir, result);
  return result;
}

export async function finalizeRun(runDir, runtime = {}) {
  const state = loadPreparedState(runDir);
  const reviews = GATE_NAMES.map((gate) => evaluateGate(gate, readGateReport(runDir, gate), { style: state.style }));
  return finalizeReview(state, reviews, runtime);
}

function isDirectRun() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

async function main(argv) {
  const index = argv.indexOf("--run-dir");
  if (index < 0 || !argv[index + 1]) throw new Error("review-gate: finalize requires --run-dir <runDir>");
  const result = await finalizeRun(argv[index + 1]);
  process.stdout.write(`${result.overall}\n`);
}

if (isDirectRun()) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
