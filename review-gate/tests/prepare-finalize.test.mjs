import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runReviewGate } from "../scripts/core.mjs";
import { finalizeRun } from "../scripts/finalize.mjs";
import { prepareReview } from "../scripts/prepare.mjs";
import { reviewerPrompt } from "../scripts/prompt.mjs";
import { GATE_NAMES } from "../scripts/schema.mjs";
import { missingRunnerMessage } from "../scripts/run.mjs";
import { commitRel, freshRunDir, gateReport, gitC, makeRepo, rt, sha, writeRel } from "./helpers.mjs";

const PREPARE = fileURLToPath(new URL("../scripts/prepare.mjs", import.meta.url));
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function runNode(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (buf) => { stdout += buf; });
    child.stderr.on("data", (buf) => { stderr += buf; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function changed() {
  const repo = makeRepo();
  const base = commitRel(repo, "src/app.js", "v1\n", "base");
  writeRel(repo, "src/app.js", "v2\n");
  gitC(repo, ["commit", "-am", "head"]);
  return { repoDir: repo, mode: "diff", base, head: sha(repo), repro: false };
}

test("prepare --check validates companions and creates no run", async () => {
  const before = freshRunDir();
  const result = await runNode([PREPARE, "--check"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^companions ok \(\d+\)\n$/);
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(before), false);
});

test("prepare prompts match reviewerPrompt and the prompts runReviewGate dispatches", async () => {
  const args = { ...changed(), runDir: freshRunDir() };
  let calls = 0;
  const state = await prepareReview(args, { agent: () => { calls += 1; } });
  assert.equal(calls, 0);
  assert.equal(state.prompts.length, 3);
  for (let i = 0; i < GATE_NAMES.length; i++) {
    const gate = GATE_NAMES[i];
    const onDisk = readFileSync(join(state.runDir, "prompts", `${gate}.md`), "utf8");
    const again = reviewerPrompt(gate, state.rubrics[gate], state.captured, state.snapshotDir, state.promptArgs);
    assert.equal(onDisk, state.prompts[i]);
    assert.equal(again, state.prompts[i]);
  }
  const schema = JSON.parse(readFileSync(join(state.runDir, "prompts", "schema.json"), "utf8"));
  assert.ok(schema.required.includes("gate"));

  const dispatched = { ...changed(), runDir: freshRunDir() };
  const seen = new Map();
  await runReviewGate(dispatched, rt(async (prompt, opts) => {
    seen.set(opts.label, prompt);
    const onDisk = readFileSync(join(dispatched.runDir, "prompts", `${opts.label}.md`), "utf8");
    assert.equal(prompt, onDisk);
    return gateReport(opts.label);
  }));
  function norm(text, repo, runDir) {
    return text.split(runDir).join("$RUN").split(repo).join("$REPO").replace(/\b[0-9a-f]{40}\b/g, "$SHA").replace(/\b[0-9a-f]{64}\b/g, "$HASH");
  }
  for (const gate of GATE_NAMES) {
    assert.equal(
      norm(seen.get(gate), dispatched.repoDir, dispatched.runDir),
      norm(state.prompts[GATE_NAMES.indexOf(gate)], args.repoDir, args.runDir),
    );
  }
});

test("finalize treats a missing report, a wrong gate and source drift as INVALID", async () => {
  const args = { ...changed(), runDir: freshRunDir() };
  const state = await prepareReview(args);
  mkdirSync(join(state.runDir, "reports"));
  writeFileSync(join(state.runDir, "reports", "code-review.json"), JSON.stringify(gateReport("code-review")));
  writeFileSync(join(state.runDir, "reports", "linus-review.json"), JSON.stringify(gateReport("code-review")));
  const missing = await finalizeRun(state.runDir);
  assert.equal(missing.overall, "INVALID");
  assert.equal(missing.passed, false);
  assert.ok(missing.diagnostics.missingGates.includes("test-review"));
  assert.ok(missing.diagnostics.identityFailures.some((item) => item.gate === "linus-review"));

  const driftArgs = { ...changed(), runDir: freshRunDir() };
  await prepareReview(driftArgs);
  mkdirSync(join(driftArgs.runDir, "reports"));
  for (const gate of GATE_NAMES) {
    writeFileSync(join(driftArgs.runDir, "reports", `${gate}.json`), JSON.stringify(gateReport(gate)));
  }
  writeFileSync(join(driftArgs.runDir, "snapshot", "src", "app.js"), "tampered after prepare\n");
  const drifted = await finalizeRun(driftArgs.runDir);
  assert.equal(drifted.drift.detected, true);
  assert.equal(drifted.overall, "INVALID");
  assert.equal(drifted.passed, false);
});

test("a missing workflow-run runner explains the optional path", () => {
  const message = missingRunnerMessage("/absent/workflow-run/scripts/run.mjs");
  assert.match(message, /optional workflow-run/);
  assert.match(message, /prepare\.mjs/);
  assert.match(message, /finalize\.mjs/);
  assert.match(message, /claude or codex CLI/);
});
