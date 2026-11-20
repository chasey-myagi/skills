#!/usr/bin/env node
import { existsSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateWorkflowAdapter } from "./core.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = pathToFileURL(join(HERE, "core.mjs")).href;
const RUNNER = join(HERE, "..", "..", "workflow-run", "scripts", "run.mjs");

export function missingRunnerMessage(runner) {
  return `review-gate: optional workflow-run runner was not found at ${runner}. Use scripts/prepare.mjs, dispatch three read-only sub-agents on this host's own model, then scripts/finalize.mjs. Do not default to the claude or codex CLI.`;
}

function isDirectRun() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  const forwarded = process.argv.slice(2);
  const printIndex = forwarded.indexOf("--print-workflow");
  const printWorkflow = printIndex !== -1;
  if (printWorkflow) forwarded.splice(printIndex, 1);
  if (printWorkflow) {
    process.stdout.write(generateWorkflowAdapter(CORE));
    process.exit(0);
  }
  if (!existsSync(RUNNER)) {
    console.error(missingRunnerMessage(RUNNER));
    process.exit(1);
  }

  const tmp = mkdtempSync(join(tmpdir(), "review-gate-wf-"));
  const adapter = join(tmp, "review-gate.js");
  writeFileSync(adapter, generateWorkflowAdapter(CORE));

  const r = spawnSync(process.execPath, [RUNNER, adapter, ...forwarded], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
  unlinkSync(adapter);
  rmdirSync(tmp);
  process.exit(r.status == null ? 1 : r.status);
}
