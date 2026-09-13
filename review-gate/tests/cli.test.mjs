import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  makeRepo,
  commitRel,
  writeRel,
  gitC,
  sha,
  freshRunDir,
  scoresFor,
} from "./helpers.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CLI = join(ROOT, "..", "scripts", "run.mjs");
const NODE = process.execPath;

function writeExecutable(dir, name, source) {
  const path = join(dir, name);
  writeFileSync(path, source);
  chmodSync(path, 0o755);
  return path;
}

function isolatedPath(binDir) {
  return [binDir, dirname(NODE), "/usr/bin", "/bin"].join(":");
}

function passEnvelope(gate) {
  const linus = gate === "linus-review";
  const test = gate === "test-review";
  const structured_output = {
    gate,
    verdict: "PASS",
    summary: `${gate} ok`,
    findings: [],
    humanCallouts: [],
    assessment: {
      blockingReasons: [],
      scores: linus ? [] : scoresFor(gate),
      finalScore: linus ? undefined : 9.0,
      rating: linus ? "Looks reasonable." : undefined,
    },
  };
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    result: JSON.stringify(structured_output),
    structured_output,
  };
}

function claudeFake() {
  return `#!/usr/bin/env node
const fs = require("fs");
let prompt = "";
process.stdin.on("data", (d) => { prompt += d; });
process.stdin.on("end", () => {
  const m = prompt.match(/GATE_ID:\\s*(\\S+)/);
  const gate = m ? m[1] : "code-review";
  if (gate === "repro" || /^repro:/.test(gate)) {
    process.stdout.write(JSON.stringify({ type: "result", is_error: false, structured_output: { id: "x", verdict: "NOT_TESTABLE", summary: "skip" } }) + "\\n");
    process.exit(0);
  }
  const linus = gate === "linus-review";
  const test = gate === "test-review";
  const dims = (gate === "test-review"
    ? ["Quantity Adequacy","Scenario Coverage","Boundary Exploration","Error Path Coverage","State Combination","Test Quality"]
    : ["Correctness","Security","Architecture","Error Handling","Maintainability","Requirements Fit"]
  ).map((dimension) => ({ dimension, score: 9, na: false }));
  const structured_output = {
    gate,
    verdict: "PASS",
    summary: gate + " ok",
    findings: [],
    humanCallouts: [],
    assessment: {
      blockingReasons: [],
      scores: linus ? [] : dims,
      finalScore: linus ? undefined : 9.0,
      rating: linus ? "Looks reasonable." : undefined,
    },
  };
  process.stdout.write(JSON.stringify({
    type: "result", subtype: "success", is_error: false,
    result: JSON.stringify(structured_output),
    structured_output,
  }) + "\\n");
  process.exit(0);
});
`;
}

function runCli(args, { binDir, timeoutMs = 20_000, extraEnv = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(NODE, [CLI, ...args], {
      env: {
        ...process.env,
        PATH: binDir ? isolatedPath(binDir) : process.env.PATH,
        ...extraEnv,
      },
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`cli timed out\n${stderr}`));
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

test("--print-workflow adapter imports the same engine", async () => {
  const r = await runCli(["--print-workflow"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /export const meta/);
  assert.match(r.stdout, /runReviewGate/);
  assert.match(r.stdout, /await import\(/);
  const url = r.stdout.match(/await import\((['"])(.+?)\1\)/);
  assert.ok(url, r.stdout);
  const imported = await import(url[2]);
  const local = await import(pathToFileURL(join(ROOT, "..", "scripts", "core.mjs")).href);
  assert.equal(imported.runReviewGate, local.runReviewGate);
  assert.equal(typeof imported.runReviewGate, "function");
});

test("CLI routes through the existing workflow-run runner", async () => {
  const repo = makeRepo();
  const base = commitRel(repo, "src/app.js", "v1\n", "base");
  writeRel(repo, "src/app.js", "v2\n");
  gitC(repo, ["add", "src/app.js"]);
  gitC(repo, ["commit", "-m", "head"]);
  const head = sha(repo);
  const dir = mkdtempSync(join(tmpdir(), "rgate-cli-"));
  const binDir = join(dir, "bin");
  mkdirSync(binDir);
  writeExecutable(binDir, "claude", claudeFake());
  const statusFile = join(dir, "status.json");
  const runDir = freshRunDir();
  const argsJson = JSON.stringify({
    repoDir: repo,
    mode: "diff",
    base,
    head,
    runDir,
    repro: false,
  });
  const r = await runCli(
    ["--backend", "claude", "--args", argsJson, "--status-file", statusFile, "--timeout", "15"],
    { binDir, timeoutMs: 25_000 },
  );
  assert.equal(r.code, 0, r.stderr + "\n" + r.stdout);
  assert.match(r.stderr, /workflow-run:/);
  const out = JSON.parse(r.stdout);
  assert.equal(out.passed, true);
  assert.equal(out.total, 3);
  const status = JSON.parse(readFileSync(statusFile, "utf8"));
  assert.equal(status.status, "completed");
  assert.equal(status.agents.length, 3);
});
