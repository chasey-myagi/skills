#!/usr/bin/env node
// Public-CLI contract tests for workflow-run.
// Fake executables on an isolated PATH. No paid model, no real network.
// These cover the mocked CLI contract only — not live-provider integration.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(ROOT, "..", "scripts", "run.mjs");
const NODE = process.execPath;

const REVIEW_SCHEMA = {
  type: "object",
  required: ["verdict"],
  properties: { verdict: { type: "string" } },
};

const FILTER_FAIL_WORKFLOW = `
const review = await agent("SECRET_PROMPT_DO_NOT_LEAK review the change", {
  label: "code-review",
  schema: ${JSON.stringify(REVIEW_SCHEMA)},
});
const reviews = [review].filter(Boolean);
return { overall: "FAIL", reviews };
`;

function tmpWorkspace(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeExecutable(dir, name, source) {
  const path = join(dir, name);
  writeFileSync(path, source);
  chmodSync(path, 0o755);
  return path;
}

function nodeFake(body) {
  return `#!/usr/bin/env node\n${body}\n`;
}

function writeWorkflow(dir, name, body) {
  const path = join(dir, name);
  writeFileSync(path, `export const meta = { name: ${JSON.stringify(name)} };\n${body}\n`);
  return path;
}

function isolatedPath(binDir) {
  return [binDir, dirname(NODE), "/usr/bin", "/bin"].join(":");
}

function runRunner({ binDir, workflow, args = [], extraEnv = {}, timeoutMs = 15_000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(NODE, [RUNNER, workflow, ...args], {
      env: { ...process.env, PATH: isolatedPath(binDir), ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`test helper timed out after ${timeoutMs}ms\n${stderr}`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function claudeEnvelopeFake({ envelope, exit = 0, logPath = null, delayMs = 0, hang = false, counterPath = null, bodies = null }) {
  return nodeFake(`
const fs = require("fs");
${logPath ? `fs.appendFileSync(${JSON.stringify(logPath)}, "invoked\\n");` : ""}
${hang ? "setTimeout(() => {}, 60000); return;" : ""}
${delayMs ? `const _delay = Date.now() + ${delayMs}; while (Date.now() < _delay) {}` : ""}
${counterPath ? `
let n = fs.existsSync(${JSON.stringify(counterPath)}) ? Number(fs.readFileSync(${JSON.stringify(counterPath)}, "utf8")) : 0;
n += 1;
fs.writeFileSync(${JSON.stringify(counterPath)}, String(n));
const bodies = ${JSON.stringify(bodies)};
const envelope = bodies[Math.min(n - 1, bodies.length - 1)];
process.stdout.write(JSON.stringify(envelope) + "\\n");
process.exit(${exit});
` : `
process.stdout.write(JSON.stringify(${JSON.stringify(envelope)}) + "\\n");
process.exit(${exit});
`}
`);
}

function successEnvelope(verdict = "FAIL", extra = {}) {
  const structured_output = { verdict, ...extra };
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    result: JSON.stringify(structured_output),
    structured_output,
  };
}

function authEnvelope() {
  return {
    type: "result",
    subtype: "error",
    is_error: true,
    result: "Please run /login",
  };
}

function setupClaude(dir, fakeOpts) {
  const binDir = join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
  writeExecutable(binDir, "claude", claudeEnvelopeFake(fakeOpts));
  return binDir;
}

function readStatus(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertNoLeak(obj, tokens) {
  const blob = JSON.stringify(obj);
  for (const token of tokens) {
    assert.equal(blob.includes(token), false, `sidecar leaked ${token}`);
  }
}

test("auth failure is execution failure, not a review FAIL verdict", async () => {
  const dir = tmpWorkspace("wfrun-auth-");
  const binDir = setupClaude(dir, { envelope: authEnvelope() });
  const workflow = writeWorkflow(dir, "auth-vs-verdict.js", FILTER_FAIL_WORKFLOW);
  const statusFile = join(dir, "status.json");
  const r = await runRunner({
    binDir,
    workflow,
    args: ["--backend", "claude", "--status-file", statusFile, "--timeout", "10"],
  });

  assert.equal(r.code, 2, `stderr:\n${r.stderr}`);
  assert.deepEqual(JSON.parse(r.stdout), { overall: "FAIL", reviews: [] });
  const status = readStatus(statusFile);
  assert.equal(status.schema_version, 1);
  assert.equal(status.status, "blocked");
  assert.equal(status.task_id, null);
  assert.equal(status.agents.length, 1);
  assert.equal(status.agents[0].status, "blocked");
  assert.equal(status.agents[0].error_code, "AUTH_REQUIRED");
  assert.equal(status.agents[0].backend, "claude");
  assert.equal(status.agents[0].model, null);
  assertNoLeak(status, ["SECRET_PROMPT_DO_NOT_LEAK", "Please run /login"]);
});

test("successful review verdict FAIL is a completed run", async () => {
  const dir = tmpWorkspace("wfrun-verdict-");
  const binDir = setupClaude(dir, {
    envelope: successEnvelope("FAIL", { blocking: ["Please run /login"] }),
  });
  const workflow = writeWorkflow(
    dir,
    "verdict-fail.js",
    `
const review = await agent("SECRET_PROMPT_DO_NOT_LEAK review the change", {
  label: "code-review",
  schema: ${JSON.stringify(REVIEW_SCHEMA)},
});
return { overall: review.verdict, reviews: [review] };
`,
  );
  const statusFile = join(dir, "status.json");
  const r = await runRunner({
    binDir,
    workflow,
    args: ["--backend", "claude", "--status-file", statusFile, "--task-id", "t-123"],
  });

  assert.equal(r.code, 0, `stderr:\n${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.overall, "FAIL");
  assert.equal(out.reviews[0].verdict, "FAIL");
  const status = readStatus(statusFile);
  assert.equal(status.status, "completed");
  assert.equal(status.task_id, "t-123");
  assert.equal(status.agents.length, 1);
  assert.equal(status.agents[0].status, "completed");
  assert.equal(status.agents[0].error_code, null);
  assert.equal(typeof status.finished_at, "string");
  assertNoLeak(status, ["SECRET_PROMPT_DO_NOT_LEAK", "Please run /login"]);
});

test("nonzero process exit is execution failure even with a valid-looking envelope", async () => {
  const dir = tmpWorkspace("wfrun-exit-");
  const binDir = setupClaude(dir, { envelope: successEnvelope("FAIL"), exit: 1 });
  const workflow = writeWorkflow(dir, "nonzero-exit.js", FILTER_FAIL_WORKFLOW);
  const statusFile = join(dir, "status.json");
  const r = await runRunner({
    binDir,
    workflow,
    args: ["--backend", "claude", "--status-file", statusFile],
  });

  assert.equal(r.code, 2, `stderr:\n${r.stderr}`);
  assert.deepEqual(JSON.parse(r.stdout), { overall: "FAIL", reviews: [] });
  const status = readStatus(statusFile);
  assert.equal(status.status, "failed");
  assert.equal(status.agents.length, 1);
  assert.notEqual(status.agents[0].status, "completed");
  assert.equal(status.agents[0].status, "failed");
  assert.equal(status.agents[0].error_code, "PROCESS_EXIT");
});

test("missing backend is BACKEND_UNAVAILABLE and blocked", async () => {
  const dir = tmpWorkspace("wfrun-missing-");
  const binDir = join(dir, "bin");
  mkdirSync(binDir);
  const workflow = writeWorkflow(dir, "missing.js", FILTER_FAIL_WORKFLOW);
  const statusFile = join(dir, "status.json");
  const r = await runRunner({
    binDir,
    workflow,
    args: ["--backend", "claude", "--status-file", statusFile],
  });

  assert.equal(r.code, 2, `stderr:\n${r.stderr}`);
  assert.deepEqual(JSON.parse(r.stdout), { overall: "FAIL", reviews: [] });
  const status = readStatus(statusFile);
  assert.equal(status.status, "blocked");
  assert.equal(status.agents[0].status, "blocked");
  assert.equal(status.agents[0].error_code, "BACKEND_UNAVAILABLE");
});

test("timeout is TIMEOUT failed", { timeout: 20_000 }, async () => {
  const dir = tmpWorkspace("wfrun-timeout-");
  const binDir = setupClaude(dir, { envelope: successEnvelope("PASS"), hang: true });
  const workflow = writeWorkflow(dir, "timeout.js", FILTER_FAIL_WORKFLOW);
  const statusFile = join(dir, "status.json");
  const r = await runRunner({
    binDir,
    workflow,
    args: ["--backend", "claude", "--status-file", statusFile, "--timeout", "1"],
    timeoutMs: 15_000,
  });

  assert.equal(r.code, 2, `stderr:\n${r.stderr}`);
  const status = readStatus(statusFile);
  assert.equal(status.status, "failed");
  assert.equal(status.agents[0].status, "failed");
  assert.equal(status.agents[0].error_code, "TIMEOUT");
});

test("exhausted invalid schema is INVALID_OUTPUT failed", async () => {
  const dir = tmpWorkspace("wfrun-schema-");
  const bad = {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "not-json",
    structured_output: { nope: true },
  };
  const binDir = setupClaude(dir, { envelope: bad });
  const workflow = writeWorkflow(dir, "schema-exhausted.js", FILTER_FAIL_WORKFLOW);
  const statusFile = join(dir, "status.json");
  const r = await runRunner({
    binDir,
    workflow,
    args: ["--backend", "claude", "--status-file", statusFile],
  });

  assert.equal(r.code, 2, `stderr:\n${r.stderr}`);
  const status = readStatus(statusFile);
  assert.equal(status.status, "failed");
  assert.equal(status.agents[0].status, "failed");
  assert.equal(status.agents[0].error_code, "INVALID_OUTPUT");
  assert.equal(status.agents[0].status === "completed", false);
});

test("recovered schema retry is a successful execution", async () => {
  const dir = tmpWorkspace("wfrun-retry-");
  const counterPath = join(dir, "n");
  const binDir = setupClaude(dir, {
    counterPath,
    bodies: [
      { type: "result", is_error: false, result: "oops", structured_output: { nope: true } },
      { type: "result", is_error: false, result: '{"verdict":"PASS"}', structured_output: { verdict: "PASS" } },
    ],
    envelope: { type: "result", is_error: false, result: "oops" },
  });
  const workflow = writeWorkflow(
    dir,
    "schema-retry.js",
    `
const review = await agent("retry me", {
  label: "code-review",
  schema: ${JSON.stringify(REVIEW_SCHEMA)},
});
return { overall: review ? "PASS" : "FAIL", review };
`,
  );
  const statusFile = join(dir, "status.json");
  const r = await runRunner({
    binDir,
    workflow,
    args: ["--backend", "claude", "--status-file", statusFile],
  });

  assert.equal(r.code, 0, `stderr:\n${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).overall, "PASS");
  const status = readStatus(statusFile);
  assert.equal(status.status, "completed");
  assert.equal(status.agents[0].status, "completed");
  assert.equal(status.agents[0].error_code, null);
});

test("existing status file is refused without dispatching agents", async () => {
  const dir = tmpWorkspace("wfrun-exists-");
  const logPath = join(dir, "invoked.log");
  const binDir = setupClaude(dir, { envelope: successEnvelope("PASS"), logPath });
  const workflow = writeWorkflow(dir, "exists.js", FILTER_FAIL_WORKFLOW);
  const statusFile = join(dir, "status.json");
  writeFileSync(statusFile, "KEEP-ME-SENTINEL\n");
  const r = await runRunner({
    binDir,
    workflow,
    args: ["--backend", "claude", "--status-file", statusFile],
  });

  assert.equal(r.code, 1, `stderr:\n${r.stderr}`);
  assert.equal(readFileSync(statusFile, "utf8"), "KEEP-ME-SENTINEL\n");
  assert.equal(existsSync(logPath), false);
});

test("dangling symlink status path is refused without dispatching agents", async () => {
  const dir = tmpWorkspace("wfrun-symlink-");
  const logPath = join(dir, "invoked.log");
  const binDir = setupClaude(dir, { envelope: successEnvelope("PASS"), logPath });
  const workflow = writeWorkflow(dir, "symlink.js", FILTER_FAIL_WORKFLOW);
  const statusFile = join(dir, "status.json");
  symlinkSync(join(dir, "missing-target"), statusFile);
  const r = await runRunner({
    binDir,
    workflow,
    args: ["--backend", "claude", "--status-file", statusFile],
  });

  assert.equal(r.code, 1, `stderr:\n${r.stderr}`);
  assert.equal(lstatSync(statusFile).isSymbolicLink(), true);
  assert.equal(existsSync(logPath), false);
});

test("concurrent agents all appear in the sidecar without leaking prompts or output", async () => {
  const dir = tmpWorkspace("wfrun-parallel-");
  const binDir = setupClaude(dir, {
    envelope: successEnvelope("PASS", { note: "SECRET_OUTPUT_DO_NOT_LEAK" }),
    delayMs: 50,
  });
  const workflow = writeWorkflow(
    dir,
    "parallel.js",
    `
const [a, b] = await parallel([
  () => agent("SECRET_PROMPT_A do not leak", { label: "gate-a", schema: ${JSON.stringify(REVIEW_SCHEMA)} }),
  () => agent("SECRET_PROMPT_B do not leak", { label: "gate-b", schema: ${JSON.stringify(REVIEW_SCHEMA)} }),
]);
return { a, b };
`,
  );
  const statusFile = join(dir, "status.json");
  const r = await runRunner({
    binDir,
    workflow,
    args: ["--backend", "claude", "--status-file", statusFile, "--concurrency", "2"],
  });

  assert.equal(r.code, 0, `stderr:\n${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.a.verdict, "PASS");
  assert.equal(out.b.verdict, "PASS");
  const status = readStatus(statusFile);
  assert.equal(status.status, "completed");
  assert.equal(status.agents.length, 2);
  const labels = status.agents.map((a) => a.label).sort();
  assert.deepEqual(labels, ["gate-a", "gate-b"]);
  for (const agent of status.agents) {
    assert.equal(agent.status, "completed");
    assert.equal(agent.error_code, null);
  }
  assertNoLeak(status, ["SECRET_PROMPT_A", "SECRET_PROMPT_B", "SECRET_OUTPUT_DO_NOT_LEAK"]);
});

test("grok uses effort, max-turns, and prompt-enforced schema instead of --json-schema", async () => {
  const dir = tmpWorkspace("wfrun-grok-");
  const binDir = join(dir, "bin");
  mkdirSync(binDir);
  const dumpPath = join(dir, "grok-dump.json");
  writeExecutable(
    binDir,
    "grok",
    nodeFake(`
const fs = require("fs");
const argv = process.argv.slice(2);
let prompt = "";
const i = argv.indexOf("--prompt-file");
if (i !== -1) prompt = fs.readFileSync(argv[i + 1], "utf8");
fs.writeFileSync(${JSON.stringify(dumpPath)}, JSON.stringify({ argv, prompt }));
process.stdout.write(JSON.stringify({ text: JSON.stringify({ verdict: "PASS" }) }) + "\\n");
process.exit(0);
`),
  );
  const workflow = writeWorkflow(
    dir,
    "grok-schema.js",
    `
const review = await agent("SECRET_PROMPT_GROK review", {
  label: "linus-review",
  schema: ${JSON.stringify(REVIEW_SCHEMA)},
});
return review;
`,
  );
  const statusFile = join(dir, "status.json");
  const r = await runRunner({
    binDir,
    workflow,
    args: ["--backend", "grok", "--effort", "high", "--status-file", statusFile],
  });

  assert.equal(r.code, 0, `stderr:\n${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).verdict, "PASS");
  const dump = JSON.parse(readFileSync(dumpPath, "utf8"));
  assert.equal(dump.argv.includes("--max-turns"), true);
  const turnsIdx = dump.argv.indexOf("--max-turns");
  assert.equal(dump.argv[turnsIdx + 1], "40");
  assert.equal(dump.argv.includes("--reasoning-effort"), true);
  assert.equal(dump.argv[dump.argv.indexOf("--reasoning-effort") + 1], "high");
  assert.equal(dump.argv.includes("--json-schema"), false);
  assert.match(dump.prompt, /OUTPUT FORMAT/);
  assert.match(dump.prompt, /JSON Schema/);
  const status = readStatus(statusFile);
  assert.equal(status.status, "completed");
  assert.equal(status.agents[0].backend, "grok");
  assert.equal(status.agents[0].model, null);
});

test("workflow exception marks sidecar failed and exits 1", async () => {
  const dir = tmpWorkspace("wfrun-throw-");
  const binDir = setupClaude(dir, { envelope: successEnvelope("PASS") });
  const workflow = writeWorkflow(
    dir,
    "throws.js",
    `
await agent("ok", { label: "code-review", schema: ${JSON.stringify(REVIEW_SCHEMA)} });
throw new Error("workflow boom");
`,
  );
  const statusFile = join(dir, "status.json");
  const r = await runRunner({
    binDir,
    workflow,
    args: ["--backend", "claude", "--status-file", statusFile],
  });

  assert.equal(r.code, 1, `stderr:\n${r.stderr}`);
  const status = readStatus(statusFile);
  assert.equal(status.status, "failed");
  assert.equal(status.agents[0].status, "completed");
  assertNoLeak(status, ["workflow boom"]);
});

test("successful result text mentioning login is not AUTH_REQUIRED", async () => {
  const dir = tmpWorkspace("wfrun-kimi-login-text-");
  const binDir = join(dir, "bin");
  mkdirSync(binDir);
  writeExecutable(
    binDir,
    "kimi",
    nodeFake(`
process.stdout.write(JSON.stringify({
  role: "assistant",
  content: JSON.stringify({ verdict: "PASS", note: "Please run /login is review commentary" }),
}) + "\\n");
process.exit(0);
`),
  );
  const workflow = writeWorkflow(
    dir,
    "kimi-login-text.js",
    `return await agent("review", { label: "code-review", schema: ${JSON.stringify(REVIEW_SCHEMA)} });`,
  );
  const statusFile = join(dir, "status.json");
  const r = await runRunner({
    binDir,
    workflow,
    args: ["--backend", "kimi", "--status-file", statusFile],
  });
  assert.equal(r.code, 0, `stderr:\n${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).verdict, "PASS");
  const status = readStatus(statusFile);
  assert.equal(status.status, "completed");
  assert.equal(status.agents[0].status, "completed");
  assert.equal(status.agents[0].error_code, null);
});

test("grok native error envelope with exit 0 is still an execution failure", async () => {
  const dir = tmpWorkspace("wfrun-grok-env-");
  const binDir = join(dir, "bin");
  mkdirSync(binDir);
  writeExecutable(
    binDir,
    "grok",
    nodeFake(`
process.stdout.write(JSON.stringify({ type: "error", message: "Please run /login" }) + "\\n");
process.exit(0);
`),
  );
  const workflow = writeWorkflow(dir, "grok-auth.js", FILTER_FAIL_WORKFLOW);
  const statusFile = join(dir, "status.json");
  const r = await runRunner({
    binDir,
    workflow,
    args: ["--backend", "grok", "--status-file", statusFile],
  });
  assert.equal(r.code, 2, `stderr:\n${r.stderr}`);
  const status = readStatus(statusFile);
  assert.equal(status.status, "blocked");
  assert.equal(status.agents[0].error_code, "AUTH_REQUIRED");
  assert.notEqual(status.agents[0].status, "completed");
});

test("quota envelope is QUOTA_EXCEEDED and blocked", async () => {
  const dir = tmpWorkspace("wfrun-quota-");
  const binDir = setupClaude(dir, {
    envelope: { type: "result", subtype: "error", is_error: true, result: "quota exceeded for this organization" },
  });
  const workflow = writeWorkflow(dir, "quota.js", FILTER_FAIL_WORKFLOW);
  const statusFile = join(dir, "status.json");
  const r = await runRunner({
    binDir,
    workflow,
    args: ["--backend", "claude", "--status-file", statusFile],
  });
  assert.equal(r.code, 2, `stderr:\n${r.stderr}`);
  const status = readStatus(statusFile);
  assert.equal(status.status, "blocked");
  assert.equal(status.agents[0].error_code, "QUOTA_EXCEEDED");
  assertNoLeak(status, ["quota exceeded for this organization"]);
});

test("mixed blocked and failed execution is overall failed", async () => {
  const dir = tmpWorkspace("wfrun-mixed-");
  const binDir = setupClaude(dir, { envelope: successEnvelope("FAIL"), exit: 1 });
  const workflow = writeWorkflow(
    dir,
    "mixed.js",
    `
const [a, b] = await parallel([
  () => agent("one", { label: "gate-a", backend: "claude", schema: ${JSON.stringify(REVIEW_SCHEMA)} }),
  () => agent("two", { label: "gate-b", backend: "grok", schema: ${JSON.stringify(REVIEW_SCHEMA)} }),
]);
return { overall: "FAIL", reviews: [a, b].filter(Boolean) };
`,
  );
  const statusFile = join(dir, "status.json");
  const r = await runRunner({
    binDir,
    workflow,
    args: ["--backend", "claude", "--status-file", statusFile, "--concurrency", "2"],
  });
  assert.equal(r.code, 2, `stderr:\n${r.stderr}`);
  const status = readStatus(statusFile);
  assert.equal(status.status, "failed");
  const byLabel = Object.fromEntries(status.agents.map((a) => [a.label, a]));
  assert.equal(byLabel["gate-a"].status, "failed");
  assert.equal(byLabel["gate-a"].error_code, "PROCESS_EXIT");
  assert.equal(byLabel["gate-b"].status, "blocked");
  assert.equal(byLabel["gate-b"].error_code, "BACKEND_UNAVAILABLE");
});

test("requested model is recorded; CLI default stays null", async () => {
  const dir = tmpWorkspace("wfrun-model-");
  const binDir = setupClaude(dir, { envelope: successEnvelope("PASS") });
  const workflow = writeWorkflow(
    dir,
    "model.js",
    `return await agent("ok", { label: "code-review", schema: ${JSON.stringify(REVIEW_SCHEMA)} });`,
  );
  const withModel = join(dir, "with-model.json");
  const withoutModel = join(dir, "without-model.json");
  const r1 = await runRunner({
    binDir,
    workflow,
    args: ["--backend", "claude", "--model", "sonnet", "--status-file", withModel],
  });
  const r2 = await runRunner({
    binDir,
    workflow,
    args: ["--backend", "claude", "--status-file", withoutModel],
  });
  assert.equal(r1.code, 0, r1.stderr);
  assert.equal(r2.code, 0, r2.stderr);
  assert.equal(readStatus(withModel).agents[0].model, "sonnet");
  assert.equal(readStatus(withoutModel).agents[0].model, null);
});

test("task-id without a sidecar is harmless metadata", async () => {
  const dir = tmpWorkspace("wfrun-task-");
  const binDir = setupClaude(dir, { envelope: successEnvelope("PASS") });
  const workflow = writeWorkflow(
    dir,
    "task-only.js",
    `return { ok: true };`,
  );
  const r = await runRunner({
    binDir,
    workflow,
    args: ["--backend", "claude", "--task-id", "orphan-task"],
  });
  assert.equal(r.code, 0, `stderr:\n${r.stderr}`);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true });
  assert.match(r.stderr, /task=orphan-task/);
});
