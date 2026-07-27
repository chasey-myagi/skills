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
//                [--concurrency N] [--timeout SECONDS] [--cwd DIR] [--verbose]
//
// Contract: stdout carries EXACTLY ONE JSON document (the workflow's return value).
// All progress/log lines go to stderr. Exit 0 on success, 1 on failure.
//
// Prior art (validated 2026-07): six-ddc/codex-dynamic-workflows (multi-backend, Bun IPC),
// scasella/claude-dynamic-workflows-codex (codex app-server). This implementation is
// intentionally smaller: 4 CLI adapters, unified schema validate+retry, no viewer/resume.

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
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
       [--concurrency N] [--timeout SECONDS] [--cwd DIR] [--verbose]`);
}

const DEFAULT_BACKEND = flags.backend || process.env.WORKFLOW_RUN_BACKEND || "claude";
const DEFAULT_TIMEOUT_MS = (flags.timeout || 1200) * 1000;
const CONCURRENCY = flags.concurrency || 6;
const BASE_CWD = flags.cwd || process.cwd();

function err(...a) { process.stderr.write(a.join(" ") + "\n"); }
function die(msg) { err(`workflow-run: ${msg}`); process.exit(1); }
function trunc(s, n = 600) { s = String(s ?? ""); return s.length > n ? s.slice(0, n) + ` …[${s.length} chars]` : s; }
function now() { return Date.now(); }

// ---------------------------------------------------------------- subprocess
function sh(cmd, args, { stdinData, cwd, timeoutMs, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: cwd || BASE_CWD,
      env: { ...process.env, ...(env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", timedOut = false, settled = false;
    const t = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 10_000);
    }, timeoutMs || DEFAULT_TIMEOUT_MS);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => { if (!settled) { settled = true; clearTimeout(t); resolve({ code: -1, stdout, stderr: String(e), timedOut }); } });
    child.on("close", (code) => { if (!settled) { settled = true; clearTimeout(t); resolve({ code, stdout, stderr, timedOut }); } });
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

// ---------------------------------------------------------------- backends
// Each adapter: run(prompt, {schema, model, cwd, timeoutMs}) -> {text, json?}
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
      if (r.timedOut) throw new Error("claude: timed out");
      const env = lastJsonObject(r.stdout);
      if (!env) throw new Error(`claude: unparseable output (exit ${r.code}): ${trunc(r.stdout || r.stderr)}`);
      if (env.is_error) throw new Error(`claude: ${trunc(env.result || env.subtype || r.stderr)}`);
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
        if (r.timedOut) throw new Error("codex: timed out");
        let text = "";
        try { text = readFileSync(outFile, "utf8").trim(); } catch {}
        if (!text) {
          if (r.code !== 0) throw new Error(`codex: exit ${r.code}: ${trunc(r.stderr || r.stdout)}`);
          throw new Error(`codex: empty last-message (turn may have ended on a non-agent_message item)`);
        }
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
        if (r.timedOut) throw new Error("kimi: timed out");
        let text = "";
        for (const line of r.stdout.split("\n")) {
          const j = tryParse(line);
          if (j && j.role === "assistant" && typeof j.content === "string" && j.content.trim()) text = j.content;
        }
        if (!text) throw new Error(`kimi: no assistant message (exit ${r.code}): ${trunc(r.stderr || r.stdout)}`);
        return { text };
      } finally { if (tmp) rmSync(tmp, { recursive: true, force: true }); }
    },
  },

  // grok -p: prompt via --prompt-file (no stdin); JSON envelope in stdout;
  // native --json-schema (inline) constrains the model, result JSON is in .text.
  grok: {
    async run(prompt, o) {
      const tmp = mkdtempSync(join(tmpdir(), "wfrun-grok-"));
      try {
        const pf = join(tmp, "prompt.md");
        writeFileSync(pf, prompt);
        const args = ["--prompt-file", pf, "--output-format", "json",
          "--permission-mode", "bypassPermissions", "--no-auto-update", "--cwd", o.cwd || BASE_CWD];
        if (o.model) args.push("-m", o.model);
        if (o.schema) args.push("--json-schema", JSON.stringify(o.schema));
        const r = await sh("grok", args, { timeoutMs: o.timeoutMs });
        if (r.timedOut) throw new Error("grok: timed out");
        const env = lastJsonObject(r.stdout);
        if (!env) throw new Error(`grok: unparseable output (exit ${r.code}): ${trunc(r.stdout || r.stderr)}`);
        if (env.type === "error") throw new Error(`grok: ${trunc(env.message)}`);
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

async function agentCall(prompt, opts = {}) {
  const label = opts.label || `agent#${++agentCounter}`;
  const phaseTag = opts.phase || currentPhase || "-";
  // Model names are per-backend namespaces — never leak one backend's model to another.
  // Precedence: script's explicit opts.backend (trust its opts.model too) > --route match
  // (route's own :model or backend default) > default backend (--model flag; a script-side
  // opts.model is honored only on claude, where CC aliases like 'haiku' are meaningful).
  const route = pickBackend(label);
  let backendName, model;
  if (opts.backend && BACKENDS[opts.backend]) {
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
  const runOpts = { schema, model, cwd: BASE_CWD, timeoutMs: DEFAULT_TIMEOUT_MS };

  await sem.acquire();
  const t0 = now();
  err(`[${phaseTag}] ${label} → ${backendName}${model ? `(${model})` : ""} …`);
  try {
    // Backends without a (usable) native schema flag get the instruction in the prompt:
    // kimi has no flag at all; codex's flag is strict-mode-only (see adapter comment).
    const needsInstruction = schema && (backendName === "kimi" || backendName === "codex");
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
      if (errors.length) throw new Error(`schema validation failed after retries: ${errors.join("; ")}`);
      err(`[${phaseTag}] ${label} ✓ ${(Math.round((now() - t0) / 100) / 10).toFixed(1)}s`);
      return obj;
    }
    err(`[${phaseTag}] ${label} ✓ ${(Math.round((now() - t0) / 100) / 10).toFixed(1)}s`);
    return out.text;
  } catch (e) {
    // Match Claude Code Workflow semantics: a dead agent resolves to null, not a rejection.
    err(`[${phaseTag}] ${label} ✗ ${e.message}`);
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

const t0 = now();
err(`workflow-run: ${scriptPath} | backend=${DEFAULT_BACKEND}${flags.model ? ` model=${flags.model}` : ""} | concurrency=${CONCURRENCY} | cwd=${BASE_CWD}`);
try {
  const result = await fn(runtime.agent, runtime.parallel, runtime.pipeline, runtime.phase, runtime.log, runtime.args, runtime.budget, runtime.workflow);
  err(`\nworkflow-run: done in ${Math.round((now() - t0) / 1000)}s`);
  process.stdout.write(JSON.stringify(result ?? null, null, 2) + "\n");
  process.exit(0);
} catch (e) {
  err(`\nworkflow-run: FAILED after ${Math.round((now() - t0) / 1000)}s: ${e.stack || e.message}`);
  process.exit(1);
}
