#!/usr/bin/env node
import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateWorkflowAdapter } from "./core.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = pathToFileURL(join(HERE, "core.mjs")).href;
const RUNNER = join(HERE, "..", "..", "workflow-run", "scripts", "run.mjs");

const BOOLEAN = new Set(["--print-workflow", "--help", "-h", "--verbose"]);
const VALUE = new Set([
  "--args", "--backend", "--model", "--concurrency", "--timeout",
  "--cwd", "--effort", "--status-file", "--task-id",
]);
const REPEAT = new Set(["--route"]);

function usage() {
  process.stderr.write(`review-gate: portable 3-gate review engine
usage: node run.mjs [--print-workflow] [--args '<json>'] [--backend ...]
       [--model ...] [--route ...] [--concurrency N] [--timeout S]
       [--cwd DIR] [--effort E] [--status-file PATH] [--task-id ID] [--verbose]
`);
}

const argv = process.argv.slice(2);
const forwarded = [];
let printWorkflow = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--print-workflow") {
    printWorkflow = true;
    continue;
  }
  if (a === "--help" || a === "-h") {
    usage();
    process.exit(0);
  }
  if (REPEAT.has(a) || VALUE.has(a)) {
    const v = argv[++i];
    if (v == null) {
      process.stderr.write(`review-gate: missing value for ${a}\n`);
      process.exit(1);
    }
    if (a === "--args") {
      const raw = String(v).trim();
      if (raw) {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          process.stderr.write(`review-gate: --args is not valid JSON: ${err.message}\n`);
          process.exit(1);
        }
        if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
          process.stderr.write("review-gate: --args must be a JSON object\n");
          process.exit(1);
        }
      }
    }
    forwarded.push(a, v);
    continue;
  }
  if (BOOLEAN.has(a)) {
    forwarded.push(a);
    continue;
  }
  process.stderr.write(`review-gate: unexpected argument ${a}\n`);
  process.exit(1);
}

if (printWorkflow) {
  process.stdout.write(generateWorkflowAdapter(CORE));
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), "review-gate-wf-"));
const adapter = join(tmp, "review-gate.js");
writeFileSync(adapter, generateWorkflowAdapter(CORE));

const r = spawnSync(process.execPath, [RUNNER, adapter, ...forwarded], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: process.env,
});
process.exit(r.status == null ? 1 : r.status);
