#!/usr/bin/env node
// workflow-run — standalone runtime for Claude Code-style workflow scripts.
//
// Runs a workflow script (export const meta + agent()/parallel()/pipeline()/phase()/log()/args,
// async body, top-level return) OUTSIDE Claude Code, dispatching agent() calls to any of the
// four locally installed agent CLIs in headless mode: claude / codex / kimi / grok.
//
// Zero npm dependencies. Node >= 18.
//
// Usage:
//   node run.mjs <workflow.js> [--args '<json>'] [--backend claude|codex|kimi|grok]
//                [--model <m>] [--route '<label-glob>=<backend>[:<model>]']...
//                [--concurrency N] [--timeout SECONDS] [--cwd DIR] [--effort E]
//                [--status-file PATH] [--task-id ID] [--verbose]
//
// Contract: stdout carries EXACTLY ONE JSON document (the workflow's return value).
// All progress/log lines go to stderr.
// Exit 0: workflow fully executed (including a legitimate review verdict of FAIL).
// Exit 1: usage error or the workflow script threw.
// Exit 2: an agent CLI execution failed (even if the script synthesizes a FAIL verdict).
//
// Prior art (validated 2026-07): six-ddc/codex-dynamic-workflows (multi-backend, Bun IPC),
// scasella/claude-dynamic-workflows-codex (codex app-server). This implementation is
// intentionally smaller: 4 CLI adapters, unified schema validate+retry, no viewer/resume.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, lstatSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------- args
const argvIn = process.argv.slice(2);
const flags = { route: [] };
let scriptPath = null;
for (let i = 0; i < argvIn.length; i++) {
  const a = argvIn[i];
  if (a === "--args") flags.args = argvIn[++i];
  else if (a === "--backend") flags.backend = argvIn[++i];
  else if (a === "--model") flags.model = argvIn[++i];
  else if (a === "--route") flags.route.push(argvIn[++i]);
  else if (a === "--concurrency") flags.concurrency = parseInt(argvIn[++i], 10);
  else if (a === "--timeout") flags.timeout = parseInt(argvIn[++i], 10);
  else if (a === "--cwd") flags.cwd = argvIn[++i];
  else if (a === "--effort") flags.effort = argvIn[++i];
  else if (a === "--status-file") flags.statusFile = argvIn[++i];
  else if (a === "--task-id") flags.taskId = argvIn[++i];
  else if (a === "--verbose") flags.verbose = true;
  else if (a === "--help" || a === "-h") { usage(); process.exit(0); }
  else if (!scriptPath) scriptPath = a;
  else die(`unexpected argument: ${a}`);
}
if (!scriptPath) { usage(); process.exit(1); }

function usage() {
  err(`workflow-run: run a Claude Code-style workflow script on any agent CLI backend.
usage: node run.mjs <workflow.js> [--args '<json>'] [--backend claude|codex|kimi|grok]
       [--model <m>] [--route '<label-glob>=<backend>[:<model>]']...
       [--concurrency N] [--timeout SECONDS] [--cwd DIR] [--effort E]
       [--status-file PATH] [--task-id ID] [--verbose]

--effort is the reasoning tier for backends whose CLI exposes one (grok today).
A script's per-agent opts.effort wins over it; backends without the flag ignore
both rather than failing, so one script runs unchanged on every backend.

--status-file is created exclusively (refuses an existing path, including a
dangling symlink) and updated only by this run. --task-id is stored in that
sidecar; without --status-file it is harmless metadata on stderr.`);
}

const DEFAULT_BACKEND = flags.backend || process.env.WORKFLOW_RUN_BACKEND || "claude";
const DEFAULT_TIMEOUT_MS = (flags.timeout || 1200) * 1000;
const CONCURRENCY = flags.concurrency || 6;
// Turn budget for grok's single-turn headless modes; see the grok adapter.
const GROK_MAX_TURNS = Number(process.env.WORKFLOW_RUN_GROK_MAX_TURNS) || 40;
const BASE_CWD = flags.cwd || process.cwd();
const TASK_ID = flags.taskId || null;

function err(...a) { process.stderr.write(a.join(" ") + "\n"); }
function die(msg) { err(`workflow-run: ${msg}`); process.exit(1); }
function trunc(s, n = 600) { s = String(s ?? ""); return s.length > n ? s.slice(0, n) + ` …[${s.length} chars]` : s; }
function now() { return Date.now(); }
function isoNow() { return new Date().toISOString(); }

// ---------------------------------------------------------------- subprocess
function sh(cmd, args, { stdinData, cwd, timeoutMs, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: cwd || BASE_CWD,
      env: { ...process.env, ...(env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", timedOut = false, settled = false, stdinError;
    const t = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 10_000);
    }, timeoutMs || DEFAULT_TIMEOUT_MS);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => { if (!settled) { settled = true; clearTimeout(t); resolve({ code: -1, signal: null, stdout, stderr: String(e), timedOut, spawnErr: e }); } });
    child.on("close", (code, signal) => { if (!settled) { settled = true; clearTimeout(t); resolve({ code, signal, stdout, stderr, timedOut, stdinError, spawnErr: undefined }); } });
    // Early authentication exits can close the pipe before a long prompt is written.
    child.stdin.on("error", (e) => { stdinError = e; });
    if (stdinData != null) child.stdin.write(stdinData);
    child.stdin.end();
  });
}

// ---------------------------------------------------------------- json helpers
function tryParse(s) { try { return JSON.parse(s); } catch { return undefined; } }

// Extract the first balanced JSON object from arbitrary model text (strips ``` fences).
function extractJson(text) {
  if (text == null) return undefined;
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const direct = tryParse(s);
  if (direct !== undefined && typeof direct === "object") return direct;
  const start = s.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { if (inStr) esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return tryParse(s.slice(start, i + 1)); }
  }
  return undefined;
}

// Parse the last JSON object envelope from stdout that may contain stray non-JSON lines.
function lastJsonObject(stdout) {
  const s = String(stdout).trim();
  const direct = tryParse(s);
  if (direct !== undefined) return direct;
  const lines = s.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const j = tryParse(lines[i]);
    if (j !== undefined && typeof j === "object") return j;
  }
  return extractJson(s);
}

// Minimal JSON Schema validator: type/required/properties/items/enum. Extra props tolerated.
function validate(schema, value, path = "$") {
  const errors = [];
  if (!schema || typeof schema !== "object") return errors;
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value)))
    errors.push(`${path}: not in enum [${schema.enum.join(", ")}]`);
  const t = schema.type;
  if (t) {
    const ok =
      (t === "object" && value !== null && typeof value === "object" && !Array.isArray(value)) ||
      (t === "array" && Array.isArray(value)) ||
      (t === "string" && typeof value === "string") ||
      (t === "number" && typeof value === "number") ||
      (t === "integer" && Number.isInteger(value)) ||
      (t === "boolean" && typeof value === "boolean") ||
      (t === "null" && value === null);
    if (!ok) { errors.push(`${path}: expected ${t}, got ${Array.isArray(value) ? "array" : value === null ? "null" : typeof value}`); return errors; }
  }
  if (t === "object" || (schema.properties && typeof value === "object" && value)) {
    for (const req of schema.required || [])
      if (!(req in value)) errors.push(`${path}: missing required "${req}"`);
    for (const [k, sub] of Object.entries(schema.properties || {}))
      if (k in value) errors.push(...validate(sub, value[k], `${path}.${k}`));
  }
  if (t === "array" && schema.items)
    value.forEach((v, i) => errors.push(...validate(schema.items, v, `${path}[${i}]`)));
  return errors;
}

function schemaInstruction(schema) {
  return `\n\n---\nOUTPUT FORMAT (mandatory): your FINAL reply must be ONLY a single JSON object that validates against this JSON Schema — no markdown fences, no commentary, nothing before or after the JSON:\n${JSON.stringify(schema)}`;
}

// ---------------------------------------------------------------- execution classification
// Diagnostic only: never fallback, never retry auth, never mine a successful review body.
const BLOCKED = new Set(["AUTH_REQUIRED", "QUOTA_EXCEEDED", "BACKEND_UNAVAILABLE"]);
const AUTH_RE = /failed to authenticate|not logged in|please (?:run |use )?\/login|login required|unauthoriz(?:ed|ation)|unauthenticated|authentication (?:required|failed|error)|invalid (?:api[ -]?key|token)|not authenticated|no credentials|missing (?:api[ -]?key|credentials)|please log in|run [`'"]?codex login|auth(?:entication)? required/i;
const QUOTA_RE = /quota exceeded|exceeded your quota|rate limit(?:ed| exceeded)?|usage limit|out of credits|insufficient credits|billing quota|resource exhausted/i;

function failRun(errorCode, message) {
  const e = new Error(message);
  e.errorCode = errorCode;
  e.agentStatus = BLOCKED.has(errorCode) ? "blocked" : "failed";
  return e;
}

function isNativeError(backendName, envelope) {
  if (!envelope || typeof envelope !== "object") return false;
  if (backendName === "claude" && envelope.is_error) return true;
  if (backendName === "grok" && envelope.type === "error") return true;
  return false;
}

function nativeErrorText(backendName, envelope) {
  if (!isNativeError(backendName, envelope)) return "";
  if (backendName === "claude") return String(envelope.result || envelope.subtype || "");
  if (backendName === "grok") return String(envelope.message || "");
  return "";
}

function matchAuthQuota(text) {
  const s = String(text || "");
  if (AUTH_RE.test(s)) return "AUTH_REQUIRED";
  if (QUOTA_RE.test(s)) return "QUOTA_EXCEEDED";
  return null;
}

function isUnavailable(r) {
  if (r.spawnErr && r.spawnErr.code === "ENOENT") return true;
  if (r.code === -1 && /ENOENT/.test(r.stderr || "")) return true;
  return false;
}

function throwIfCliFailed(backendName, r, envelope) {
  if (r.timedOut) throw failRun("TIMEOUT", `${backendName}: timed out`);
  if (isUnavailable(r)) throw failRun("BACKEND_UNAVAILABLE", `${backendName}: executable not found`);
  const nativeErr = isNativeError(backendName, envelope);
  const nativeText = nativeErrorText(backendName, envelope);
  if (!nativeErr && r.code === 0) {
    if (r.stdinError) throw failRun("PROCESS_EXIT", `${backendName}: could not deliver prompt (${r.stdinError.code || "stdin error"})`);
    return;
  }
  // AUTH/QUOTA come from CLI diagnostics, never from a review body on stdout.
  const haystack = [r.stderr, nativeText].filter(Boolean).join("\n");
  const aq = matchAuthQuota(haystack);
  if (aq) throw failRun(aq, `${backendName}: ${aq}`);
  if (r.code !== 0) throw failRun("PROCESS_EXIT", `${backendName}: exit ${r.code}: ${trunc(r.stderr || r.stdout)}`);
  throw failRun("INVALID_OUTPUT", `${backendName}: ${trunc(nativeText || "error envelope")}`);
}

// ---------------------------------------------------------------- backends
// Each adapter: run(prompt, {schema, model, cwd, timeoutMs, effort}) -> {text, json?}
// Throws on process/transport failure. Schema validation is the caller's job (unified layer).

const BACKENDS = {
  // claude -p: prompt via stdin; JSON envelope; native --json-schema -> .structured_output
  claude: {
    async run(prompt, o) {
      const args = ["-p", "--output-format", "json", "--no-session-persistence",
        "--permission-mode", "bypassPermissions"];
      if (o.model) args.push("--model", o.model);
      if (o.schema) args.push("--json-schema", JSON.stringify(o.schema));
      const r = await sh("claude", args, { stdinData: prompt, cwd: o.cwd, timeoutMs: o.timeoutMs });
      const env = lastJsonObject(r.stdout);
      throwIfCliFailed("claude", r, env);
      if (!env) throw failRun("INVALID_OUTPUT", `claude: unparseable output (exit ${r.code}): ${trunc(r.stdout || r.stderr)}`);
      return { text: env.result ?? "", json: env.structured_output };
    },
  },

  // codex exec: prompt via stdin ('-'); final text via --output-last-message file.
  // Deliberately NOT using native --output-schema: OpenAI strict mode rejects schemas without
  // additionalProperties:false + all-fields-required, it's gpt-5-family-only, and it is silently
  // ignored when MCP tools are active (openai/codex #15451). Schema rides in the prompt instead,
  // enforced by the unified validate+retry layer.
  codex: {
    async run(prompt, o) {
      const tmp = mkdtempSync(join(tmpdir(), "wfrun-codex-"));
      try {
        const outFile = join(tmp, "last.txt");
        const args = ["exec", "--skip-git-repo-check", "--ephemeral",
          "-s", "workspace-write", "-o", outFile, "-C", o.cwd || BASE_CWD];
        if (o.model) args.push("-m", o.model);
        args.push("-");
        const r = await sh("codex", args, { stdinData: prompt, timeoutMs: o.timeoutMs });
        throwIfCliFailed("codex", r);
        let text = "";
        try { text = readFileSync(outFile, "utf8").trim(); } catch {}
        if (!text) throw failRun("INVALID_OUTPUT", "codex: empty last-message (turn may have ended on a non-agent_message item)");
        return { text };
      } finally { rmSync(tmp, { recursive: true, force: true }); }
    },
  },

  // kimi -p: prompt via argv ONLY (no stdin); stream-json JSONL; no native schema flag.
  // ARG_MAX guard: very long prompts go through a temp file the agent is told to read.
  kimi: {
    async run(prompt, o) {
      let p = prompt, tmp = null;
      if (p.length > 150_000) {
        tmp = mkdtempSync(join(tmpdir(), "wfrun-kimi-"));
        const pf = join(tmp, "prompt.md");
        writeFileSync(pf, prompt);
        p = `Read the file ${pf} in full and treat its entire contents as your task instructions. Follow them exactly, including any output-format requirements stated inside.`;
      }
      try {
        const args = ["-p", p, "--output-format", "stream-json"];
        if (o.model) args.push("-m", o.model);
        const r = await sh("kimi", args, { cwd: o.cwd, timeoutMs: o.timeoutMs });
        throwIfCliFailed("kimi", r);
        let text = "";
        for (const line of r.stdout.split("\n")) {
          const j = tryParse(line);
          if (j && j.role === "assistant" && typeof j.content === "string" && j.content.trim()) text = j.content;
        }
        if (!text) throw failRun("INVALID_OUTPUT", `kimi: no assistant message (exit ${r.code}): ${trunc(r.stderr || r.stdout)}`);
        return { text };
      } finally { if (tmp) rmSync(tmp, { recursive: true, force: true }); }
    },
  },

  // grok -p: prompt via --prompt-file (no stdin); JSON envelope in stdout.
  // --json-schema is not used: it shapes the first message before any tool call, so a
  // review agent returns a schema-valid placeholder instead of a verdict. --max-turns
  // is required because --prompt-file is a single-turn prompt without it.
  grok: {
    async run(prompt, o) {
      const tmp = mkdtempSync(join(tmpdir(), "wfrun-grok-"));
      try {
        const pf = join(tmp, "prompt.md");
        writeFileSync(pf, prompt);
        const args = ["--prompt-file", pf, "--output-format", "json",
          "--permission-mode", "bypassPermissions", "--no-auto-update",
          "--max-turns", String(GROK_MAX_TURNS), "--cwd", o.cwd || BASE_CWD];
        if (o.model) args.push("-m", o.model);
        if (o.effort) args.push("--reasoning-effort", o.effort);
        const r = await sh("grok", args, { timeoutMs: o.timeoutMs });
        const env = lastJsonObject(r.stdout);
        throwIfCliFailed("grok", r, env);
        if (!env) throw failRun("INVALID_OUTPUT", `grok: unparseable output (exit ${r.code}): ${trunc(r.stdout || r.stderr)}`);
        const text = env.text ?? "";
        return { text, json: o.schema ? extractJson(text) : undefined };
      } finally { rmSync(tmp, { recursive: true, force: true }); }
    },
  },
};

// ---------------------------------------------------------------- routing
// --route 'code-review=codex' / --route 'repro:*=grok:grok-4-fast' — first match on label wins.
const routes = flags.route.map((spec) => {
  const eq = spec.indexOf("=");
  if (eq === -1) die(`bad --route spec: ${spec}`);
  const glob = spec.slice(0, eq);
  const [backend, model] = spec.slice(eq + 1).split(":");
  if (!BACKENDS[backend]) die(`unknown backend in --route: ${backend}`);
  const re = new RegExp("^" + glob.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  return { re, backend, model };
});

function pickBackend(label) {
  for (const r of routes) if (r.re.test(label)) return { name: r.backend, model: r.model, matched: true };
  return { name: DEFAULT_BACKEND, model: undefined, matched: false };
}
if (!BACKENDS[DEFAULT_BACKEND]) die(`unknown backend: ${DEFAULT_BACKEND}`);

// ---------------------------------------------------------------- status sidecar
const execCounts = { failed: 0, blocked: 0 };

function persistSidecar(path, snapshot, owner) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  let fd;
  try {
    const current = lstatSync(path);
    if (!current.isFile() || current.dev !== owner.dev || current.ino !== owner.ino ||
        tryParse(readFileSync(path, "utf8"))?.run_id !== snapshot.run_id) {
      throw new Error("status file is no longer owned by this run");
    }
    fd = openSync(tmp, "wx", 0o600);
    writeFileSync(fd, JSON.stringify(snapshot, null, 2) + "\n");
    renameSync(tmp, path);
    return lstatSync(path);
  } catch (e) {
    e.statusWriteFailure = true;
    throw e;
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
      rmSync(tmp, { force: true });
    }
  }
}

function createSidecar(path, taskId) {
  const snapshot = {
    schema_version: 1,
    run_id: randomUUID(),
    task_id: taskId || null,
    status: "running",
    started_at: isoNow(),
    finished_at: null,
    agents: [],
  };
  let fd;
  try {
    fd = openSync(path, "wx");
  } catch (e) {
    if (e.code === "EEXIST") die(`status file already exists: ${path}`);
    die(`cannot create status file ${path}: ${e.message}`);
  }
  try {
    writeFileSync(fd, JSON.stringify(snapshot, null, 2) + "\n");
  } finally {
    closeSync(fd);
  }
  return snapshot;
}

function makeStatusTracker(path, taskId) {
  const noop = {
    async beginAgent() {},
    async endAgent() {},
    async finish() {},
  };
  if (!path) return noop;
  const snapshot = createSidecar(path, taskId);
  let owner = lstatSync(path);
  let chain = Promise.resolve();
  function enqueue(mut) {
    chain = chain.then(() => {
      mut();
      owner = persistSidecar(path, snapshot, owner);
    });
    return chain;
  }
  return {
    beginAgent(rec) {
      return enqueue(() => snapshot.agents.push(rec));
    },
    endAgent(id, fields) {
      return enqueue(() => {
        const a = snapshot.agents.find((x) => x.id === id);
        if (a) Object.assign(a, fields);
      });
    },
    finish(overall) {
      return enqueue(() => {
        snapshot.status = overall;
        snapshot.finished_at = isoNow();
      });
    },
  };
}

function overallFromAgents() {
  if (execCounts.failed) return "failed";
  if (execCounts.blocked) return "blocked";
  return "completed";
}

let tracker = makeStatusTracker(null, null);

// ---------------------------------------------------------------- runtime primitives
let agentCounter = 0;
let currentPhase = "";
const sem = (() => {
  let active = 0; const q = [];
  return {
    async acquire() { if (active < CONCURRENCY) { active++; return; } await new Promise((r) => q.push(r)); active++; },
    release() { active--; const n = q.shift(); if (n) n(); },
  };
})();

const pendingAgents = new Set();
function agentCall(prompt, opts = {}) {
  const job = executeAgentCall(prompt, opts);
  pendingAgents.add(job);
  job.then(() => pendingAgents.delete(job), () => pendingAgents.delete(job));
  return job;
}

async function drainAgents() {
  let failure;
  while (pendingAgents.size) {
    for (const result of await Promise.allSettled([...pendingAgents])) {
      if (result.status === "rejected") failure ??= result.reason;
    }
  }
  if (failure) throw failure;
}

async function executeAgentCall(prompt, opts = {}) {
  const label = opts.label || `agent#${++agentCounter}`;
  const phaseTag = opts.phase || currentPhase || "-";
  // Model names are per-backend namespaces — never leak one backend's model to another.
  // Precedence: script's explicit opts.backend (trust its opts.model too) > --route match
  // (route's own :model or backend default) > default backend (--model flag; a script-side
  // opts.model is honored only on claude, where CC aliases like 'haiku' are meaningful).
  const route = pickBackend(label);
  let backendName, model;
  if (opts.backend) {
    backendName = opts.backend;
    model = opts.model;
  } else if (route.matched) {
    backendName = route.name;
    model = route.model;
  } else {
    backendName = DEFAULT_BACKEND;
    model = (DEFAULT_BACKEND === "claude" && opts.model) || flags.model;
  }
  const backend = BACKENDS[backendName];
  const schema = opts.schema;
  // Reasoning tier travels the same route as model: the script may set it per
  // agent, --effort is the run-wide default. Backends whose CLI has no such flag
  // drop it in their adapter, so a script written for one backend still runs on
  // the others instead of failing on an unknown argument.
  const effort = opts.effort || flags.effort;
  const runOpts = { schema, model, effort, cwd: BASE_CWD, timeoutMs: DEFAULT_TIMEOUT_MS };
  const agentId = randomUUID();

  await sem.acquire();
  const t0 = now();
  err(`[${phaseTag}] ${label} → ${backendName}${model ? `(${model})` : ""} …`);
  try {
    await tracker.beginAgent({
      id: agentId,
      label,
      backend: backendName,
      model: model ?? null,
      status: "running",
      error_code: null,
    });
    if (!Object.hasOwn(BACKENDS, backendName)) {
      throw failRun("BACKEND_UNAVAILABLE", `unsupported backend: ${backendName}`);
    }
    // Backends without a (usable) native schema flag get the instruction in the prompt:
    // kimi has no flag at all; codex's flag is strict-mode-only (see adapter comment);
    // grok's flag is usable only for single-shot answers — see the grok adapter.
    const needsInstruction =
      schema && (backendName === "kimi" || backendName === "codex" || backendName === "grok");
    let out = await backend.run(needsInstruction ? prompt + schemaInstruction(schema) : prompt, runOpts);

    if (schema) {
      let obj = out.json !== undefined ? out.json : extractJson(out.text);
      let errors = obj === undefined ? ["no JSON object found in output"] : validate(schema, obj);
      let tries = 0;
      while (errors.length && tries < 2) {
        tries++;
        err(`[${phaseTag}] ${label}: schema validation failed (${trunc(errors.join("; "), 200)}) — retry ${tries}/2`);
        const fixPrompt =
          `${prompt}\n\n---\nA previous attempt produced this output:\n${trunc(out.text, 4000)}\n\n` +
          `It FAILED JSON Schema validation: ${errors.join("; ")}\n` +
          `Redo the task if needed and output ONLY a corrected JSON object matching the schema.` +
          schemaInstruction(schema);
        out = await backend.run(fixPrompt, runOpts);
        obj = out.json !== undefined ? out.json : extractJson(out.text);
        errors = obj === undefined ? ["no JSON object found in output"] : validate(schema, obj);
      }
      if (errors.length) throw failRun("INVALID_OUTPUT", `schema validation failed after retries: ${errors.join("; ")}`);
      err(`[${phaseTag}] ${label} ✓ ${(Math.round((now() - t0) / 100) / 10).toFixed(1)}s`);
      await tracker.endAgent(agentId, { status: "completed", error_code: null });
      return obj;
    }
    err(`[${phaseTag}] ${label} ✓ ${(Math.round((now() - t0) / 100) / 10).toFixed(1)}s`);
    await tracker.endAgent(agentId, { status: "completed", error_code: null });
    return out.text;
  } catch (e) {
    if (e.statusWriteFailure) throw e;
    // Match Claude Code Workflow semantics: a dead agent resolves to null, not a rejection.
    const agentStatus = e.agentStatus || "failed";
    const errorCode = e.errorCode || "INVALID_OUTPUT";
    if (agentStatus === "failed") execCounts.failed++;
    else if (agentStatus === "blocked") execCounts.blocked++;
    err(`[${phaseTag}] ${label} ✗ ${e.message}`);
    await tracker.endAgent(agentId, { status: agentStatus, error_code: errorCode });
    return null;
  } finally {
    sem.release();
  }
}

async function parallelCall(thunks) {
  return Promise.all(thunks.map(async (t) => { try { return await t(); } catch (e) { err(`[parallel] thunk failed: ${e.message}`); return null; } }));
}

async function pipelineCall(items, ...stages) {
  return Promise.all(items.map(async (item, i) => {
    let val = item;
    for (const stage of stages) {
      try { val = await stage(val, item, i); } catch (e) { err(`[pipeline] item ${i} dropped at a stage: ${e.message}`); return null; }
    }
    return val;
  }));
}

const runtime = {
  agent: agentCall,
  parallel: parallelCall,
  pipeline: pipelineCall,
  phase: (t) => { currentPhase = t; err(`\n== ${t} ==`); },
  log: (m) => err(`[log] ${m}`),
  args: flags.args ? (tryParse(flags.args) ?? flags.args) : undefined,
  budget: { total: null, spent: () => 0, remaining: () => Infinity },
  workflow: () => { throw new Error("workflow(): nested workflows are not supported by workflow-run"); },
};

// ---------------------------------------------------------------- load & execute
let src;
try { src = readFileSync(scriptPath, "utf8"); } catch (e) { die(`cannot read ${scriptPath}: ${e.message}`); }
// `export const meta` -> plain const; script body runs inside an async function (top-level return OK).
const body = src.replace(/^\s*export\s+const\s+meta\s*=/m, "const meta =");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let fn;
try {
  fn = new AsyncFunction("agent", "parallel", "pipeline", "phase", "log", "args", "budget", "workflow", body);
} catch (e) { die(`script syntax error: ${e.message}`); }

tracker = makeStatusTracker(flags.statusFile, TASK_ID);

const t0 = now();
err(`workflow-run: ${scriptPath} | backend=${DEFAULT_BACKEND}${flags.model ? ` model=${flags.model}` : ""}${TASK_ID ? ` task=${TASK_ID}` : ""} | concurrency=${CONCURRENCY} | cwd=${BASE_CWD}`);
try {
  const result = await fn(runtime.agent, runtime.parallel, runtime.pipeline, runtime.phase, runtime.log, runtime.args, runtime.budget, runtime.workflow);
  await drainAgents();
  const overall = overallFromAgents();
  await tracker.finish(overall);
  err(`\nworkflow-run: done in ${Math.round((now() - t0) / 1000)}s`);
  process.stdout.write(JSON.stringify(result ?? null, null, 2) + "\n");
  process.exit(overall === "completed" ? 0 : 2);
} catch (e) {
  try { await drainAgents(); } catch {}
  try { await tracker.finish("failed"); }
  catch (statusError) { err(`workflow-run: status update failed: ${statusError.message}`); }
  err(`\nworkflow-run: FAILED after ${Math.round((now() - t0) / 1000)}s: ${e.stack || e.message}`);
  process.exit(1);
}
