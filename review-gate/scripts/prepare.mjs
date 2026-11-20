#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultSkillsRoot, freezeKit, loadCompanionSet, packageDir } from "./companions.mjs";
import { reviewerPrompt } from "./prompt.mjs";
import { loadCodingStyle, parseCodingStyle, styleIsRequired } from "./style.mjs";
import { renderHandoff } from "./handoff.mjs";
import { GATE_NAMES, GATE_SCHEMA, SCHEMA_VERSION, sha256 } from "./schema.mjs";
import { captureTarget, git, pathInsideRepo, unifiedDiff, writeSnapshot } from "./source.mjs";

export function parseArgs(raw) {
  let A = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) throw new Error("review-gate: --args is empty; repoDir and mode are required");
    try {
      A = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`review-gate: --args is not valid JSON: ${err.message}; prefix: ${trimmed.slice(0, 200)}`, { cause: err });
    }
  }
  if (A == null || typeof A !== "object" || Array.isArray(A)) {
    throw new Error("review-gate: args must be a JSON object");
  }
  const allowed = new Set(["repoDir", "mode", "base", "head", "paths", "context", "constraints", "repro", "reproCap", "runDir", "benchmarkHarness", "codingStyle"]);
  const unknown = Object.keys(A).filter(key => !allowed.has(key));
  if (unknown.length) throw new Error(`review-gate: unknown args: ${unknown.join(", ")}`);
  for (const key of ["context", "constraints", "benchmarkHarness"]) {
    if (A[key] !== undefined && typeof A[key] !== "string") throw new Error(`review-gate: ${key} must be a string`);
  }
  if (typeof A.repoDir !== "string" || !A.repoDir) throw new Error("review-gate: repoDir is required");
  if (A.paths !== undefined && (!Array.isArray(A.paths) || !A.paths.length || A.paths.some(p => typeof p !== "string"))) throw new Error("review-gate: paths must be a nonempty array");
  if (A.repro !== undefined && typeof A.repro !== "boolean") throw new Error("review-gate: repro must be boolean");
  if (A.runDir !== undefined && (typeof A.runDir !== "string" || !A.runDir)) throw new Error("review-gate: runDir must be a nonempty path");
  let mode = A.mode;
  if (!mode && A.base && A.head) mode = "diff";
  if (!mode) throw new Error("review-gate: mode is required unless base and head select diff (diff|working-tree|snapshot)");
  if (mode !== "diff" && mode !== "working-tree" && mode !== "snapshot") {
    throw new Error(`review-gate: unknown mode '${mode}'`);
  }
  if (mode === "diff") {
    if (!A.base || !A.head) throw new Error("review-gate: diff mode requires explicit base and head");
  }
  if (mode === "snapshot") {
    if (!Array.isArray(A.paths) || !A.paths.length) throw new Error("review-gate: snapshot mode requires paths");
  }
  let reproCap = 3;
  if (A.reproCap !== undefined) {
    if (!Number.isInteger(A.reproCap) || A.reproCap < 0) {
      throw new Error("review-gate: reproCap must be a nonnegative integer");
    }
    reproCap = A.reproCap;
  }
  const styleSelection = parseCodingStyle(A.codingStyle);
  return {
    repoDir: A.repoDir,
    mode,
    base: A.base,
    head: A.head,
    paths: A.paths,
    context: typeof A.context === "string" ? A.context : "",
    constraints: typeof A.constraints === "string" ? A.constraints : "",
    repro: A.repro === true,
    reproCap,
    runDir: A.runDir,
    benchmarkHarness: A.benchmarkHarness,
    codingStyle: A.codingStyle,
    styleSelection,
  };
}

export function createRunDir(requested, repo) {
  if (requested) {
    const abs = resolve(requested);
    if (existsSync(abs)) throw new Error(`review-gate: runDir already exists: ${abs}`);
    if (pathInsideRepo(repo, abs)) throw new Error("review-gate: runDir is inside the source repo");
    mkdirSync(dirname(abs), { recursive: true });
    mkdirSync(abs);
    return abs;
  }
  return mkdtempSync(join(tmpdir(), "review-gate-"));
}

export function emptyResult() {
  return {
    schemaVersion: SCHEMA_VERSION,
    executionStatus: "incomplete",
    overall: "INVALID",
    passed: false,
    passCount: 0,
    total: GATE_NAMES.length,
    scope: {},
    reviews: [],
    findings: [],
    humanCallouts: [],
    verification: {
      enabled: false,
      ran: false,
      skipped: false,
      skipReason: null,
      parentReproPath: null,
      findings: [],
      worktrees: [],
    },
    drift: { detected: false, details: null },
    fixQueue: [],
    pendingHumanDecisions: [],
    unrunChecks: [],
    diagnostics: {
      missingGates: [],
      identityFailures: [],
      semanticFailures: [],
      agentFailures: [],
      schemaFailures: [],
    },
    artifacts: {},
    constraints: "",
  };
}

export function persist(runDir, result) {
  if (!runDir) return;
  writeFileSync(join(runDir, "review-result.json"), JSON.stringify(result, null, 2) + "\n");
  writeFileSync(join(runDir, "handoff.md"), renderHandoff(result));
}

export function checkCompanions(runtime = {}) {
  const skillsRoot = runtime.skillsRoot ? resolve(runtime.skillsRoot) : defaultSkillsRoot();
  const companions = loadCompanionSet({ reviewGateDir: packageDir(), skillsRoot });
  return companions.files.map((file) => file.path);
}

function serializableCaptured(captured) {
  return {
    mode: captured.mode,
    repo: captured.repo,
    baseSha: captured.baseSha,
    headSha: captured.headSha,
    mergeBase: captured.mergeBase,
    manifestHash: captured.manifestHash,
    baseRef: captured.baseRef,
    headRef: captured.headRef,
    pathFilter: captured.pathFilter,
    policy: captured.policy,
    policyContents: (captured.policyContents || []).map((p) => ({
      path: p.path,
      origin: p.origin,
      reason: p.reason,
      binary: p.binary,
      text: p.text,
      hash: p.hash,
    })),
    files: captured.fileContents.map((file) => ({
      path: file.path,
      hash: file.hash,
      status: file.status,
      indexHash: file.indexHash,
      baseHash: file.baseHash || null,
    })),
  };
}

export async function prepareReview(rawArgs, runtime = {}) {
  const log = runtime.log || (() => {});
  const args = parseArgs(rawArgs);
  const repoReal = realpathSync(resolve(args.repoDir));
  const top = realpathSync(git(repoReal, ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim());
  if (repoReal !== top) throw new Error("review-gate: repoDir must be the Git repository root; use paths to select a subdirectory");
  const skillsRoot = runtime.skillsRoot ? realpathSync(resolve(runtime.skillsRoot)) : defaultSkillsRoot();
  const companions = loadCompanionSet({ reviewGateDir: packageDir(), skillsRoot });
  if (styleIsRequired(args.styleSelection)) loadCodingStyle({ skillsRoot, repo: repoReal, fileContents: [], selection: args.styleSelection });
  const runDir = createRunDir(args.runDir, repoReal);
  const result = emptyResult();
  result.constraints = args.constraints;
  result.artifacts = {
    runDir,
    resultJson: join(runDir, "review-result.json"),
    handoffMd: join(runDir, "handoff.md"),
    snapshotDir: join(runDir, "snapshot"),
    manifestPath: join(runDir, "meta", "manifest.json"),
    reproWorktrees: [],
  };
  const normalized = { ...args, repoDir: repoReal };

  try {
    const captured = captureTarget({ ...normalized, repoDir: repoReal }, repoReal);
    for (const file of captured.fileContents) {
      if (file.baseBytes != null) file.baseHash = sha256(file.baseBytes);
    }
    const { snapshotDir, manifestPath } = writeSnapshot(runDir, captured);
    result.scope = {
      mode: captured.mode,
      repoDir: repoReal,
      sourceRoot: repoReal,
      base: captured.baseSha,
      head: captured.headSha,
      mergeBase: captured.mergeBase,
      paths: captured.files.map((f) => f.path),
      snapshotDir,
      manifestPath,
      manifestHash: captured.manifestHash,
      policy: captured.policy.map(({ path, origin, reason }) => ({ path, origin, ...(reason ? { reason } : {}) })),
    };
    result.artifacts.snapshotDir = snapshotDir;
    result.artifacts.manifestPath = manifestPath;
    const diffPath = join(runDir, "meta", "review.diff");
    const diff = unifiedDiff(repoReal, captured, runDir);
    writeFileSync(diffPath, diff);
    const diffHash = sha256(diff);
    result.artifacts.diffPath = diffPath;
    result.artifacts.diffHash = diffHash;
    const codingStyle = loadCodingStyle({
      skillsRoot,
      repo: repoReal,
      fileContents: captured.fileContents,
      selection: args.styleSelection,
    });
    const kit = freezeKit(runDir, [...companions.files, ...codingStyle.kitFiles]);
    result.scope.kit = kit;
    result.scope.codingStyle = {
      mode: codingStyle.mode,
      profile: codingStyle.profile,
      missing: codingStyle.missing,
      languages: codingStyle.languages,
      generated: codingStyle.generated,
      suppressed: codingStyle.suppressed,
      files: codingStyle.kitFiles.map(({ path, hash }) => ({ path, hash })),
      tiers: codingStyle.tiers,
    };
    result.artifacts.kitDir = join(runDir, "meta", "kit");
    persist(runDir, result);

    const rubricText = Object.fromEntries(companions.files.map((file) => [file.path, file.text]));
    const rubrics = {
      "code-review": rubricText["code-review/code-reviewer.md"],
      "test-review": rubricText["test-review/test-reviewer.md"],
      "linus-review": rubricText["linus-review/linus-reviewer.md"],
    };
    const reproRubric = rubricText["repro/repro-agent.md"];
    const promptArgs = { ...normalized, diffPath, diffHash, styleSections: codingStyle.sections };
    const prompts = GATE_NAMES.map((gate) => reviewerPrompt(gate, rubrics[gate], captured, snapshotDir, promptArgs));
    if (prompts.some((prompt) => Buffer.byteLength(prompt) > 256 * 1024)) {
      throw new Error("review prompt exceeds 256 KiB; narrow the scope or reduce supplied context/policy");
    }
    const promptDir = join(runDir, "prompts");
    mkdirSync(promptDir, { recursive: true });
    for (let i = 0; i < GATE_NAMES.length; i++) writeFileSync(join(promptDir, `${GATE_NAMES[i]}.md`), prompts[i]);
    writeFileSync(join(promptDir, "schema.json"), JSON.stringify(GATE_SCHEMA, null, 2) + "\n");
    const saved = {
      args: normalized,
      repo: repoReal,
      runDir,
      snapshotDir,
      diffPath,
      diffHash,
      captured: serializableCaptured(captured),
      style: {
        mode: codingStyle.mode,
        missing: codingStyle.missing,
        catalog: codingStyle.catalog,
        allowed: codingStyle.allowed,
      },
    };
    writeFileSync(join(runDir, "meta", "prepare-state.json"), JSON.stringify(saved, null, 2) + "\n");
    return {
      args: normalized,
      repo: repoReal,
      runDir,
      result,
      captured,
      snapshotDir,
      diffPath,
      diffHash,
      prompts,
      rubrics,
      reproRubric,
      promptArgs,
      style: {
        mode: codingStyle.mode,
        missing: codingStyle.missing,
        catalog: codingStyle.catalog,
        allowed: codingStyle.allowed,
      },
    };
  } catch (err) {
    result.executionStatus = "incomplete";
    result.overall = "INVALID";
    result.passed = false;
    result.error = err.message;
    try { persist(runDir, result); } catch (saveError) { log(`could not preserve result: ${saveError.message}`); }
    throw err;
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

async function main(argv) {
  if (argv.includes("--check")) {
    const found = checkCompanions();
    process.stdout.write(`companions ok (${found.length})\n`);
    return;
  }
  const index = argv.indexOf("--args");
  if (index < 0 || !argv[index + 1]) throw new Error("review-gate: prepare requires --args '<json>' or --check");
  const state = await prepareReview(argv[index + 1]);
  process.stdout.write(`${state.runDir}\n`);
}

if (isDirectRun()) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
