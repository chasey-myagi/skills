import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runReviewGate } from "../scripts/core.mjs";
import { loadCompanionSet, siblingRootFrom } from "../scripts/companions.mjs";
import { sha256 } from "../scripts/schema.mjs";
import { makeRepo, commitRel, writeRel, gitC, sha, freshRunDir, rt, gateReport } from "./helpers.mjs";

const PACKAGE = dirname(dirname(fileURLToPath(import.meta.url)));
const REAL_ROOT = dirname(PACKAGE);

function copyCompanions(destRoot) {
  const manifest = JSON.parse(readFileSync(join(PACKAGE, "companions.json"), "utf8"));
  for (const rel of manifest.required) {
    const dest = join(destRoot, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(REAL_ROOT, rel), dest);
  }
  return manifest.required;
}

function changed() {
  const repo = makeRepo();
  const base = commitRel(repo, "app.js", "ORIGINAL_BASE\n", "base");
  writeRel(repo, "app.js", "CURRENT_CHANGE\n");
  gitC(repo, ["commit", "-am", "head"]);
  return { repo, base, head: sha(repo) };
}

test("a missing sibling fails once, before any reviewer is dispatched", async () => {
  const root = mkdtempSync(join(tmpdir(), "rgate-kit-"));
  const required = copyCompanions(root);
  const dropped = required[0];
  rmSync(join(root, dropped));
  const runDir = freshRunDir();
  const { repo, base, head } = changed();
  let calls = 0;
  await assert.rejects(
    runReviewGate({ repoDir: repo, mode: "diff", base, head, runDir }, { ...rt(async () => { calls += 1; }), skillsRoot: root }),
    (err) => {
      assert.match(err.message, /missing companion files/);
      assert.match(err.message, new RegExp(dropped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      return true;
    },
  );
  assert.equal(calls, 0);
  assert.equal(existsSync(runDir), false);
});

test("every missing sibling is named in the one pre-dispatch error", async () => {
  const root = mkdtempSync(join(tmpdir(), "rgate-kit-"));
  const { repo, base, head } = changed();
  await assert.rejects(
    runReviewGate({ repoDir: repo, mode: "diff", base, head }, { ...rt(), skillsRoot: root }),
    (err) => {
      for (const rel of JSON.parse(readFileSync(join(PACKAGE, "companions.json"), "utf8")).required) {
        assert.match(err.message, new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }
      return /missing companion files/.test(err.message);
    },
  );
});

test("a symlinked install resolves siblings next to the real skill directory", () => {
  const root = mkdtempSync(join(tmpdir(), "rgate-link-"));
  const realSkills = join(root, "agents", "skills");
  const linkParent = join(root, "claude", "skills");
  mkdirSync(join(realSkills, "review-gate"), { recursive: true });
  mkdirSync(linkParent, { recursive: true });
  const realRubric = join(realSkills, "code-review", "code-reviewer.md");
  mkdirSync(dirname(realRubric), { recursive: true });
  writeFileSync(realRubric, "REAL_RUBRIC\n");
  const decoy = join(linkParent, "code-review", "code-reviewer.md");
  mkdirSync(dirname(decoy), { recursive: true });
  writeFileSync(decoy, "DECOY_RUBRIC\n");
  symlinkSync(join(realSkills, "review-gate"), join(linkParent, "review-gate"));
  const resolved = siblingRootFrom(join(linkParent, "review-gate"));
  assert.equal(resolved, realpathSync(realSkills));
  writeFileSync(join(realSkills, "review-gate", "companions.json"), JSON.stringify({ required: ["code-review/code-reviewer.md"] }));
  const loaded = loadCompanionSet({ reviewGateDir: join(linkParent, "review-gate"), skillsRoot: resolved });
  assert.equal(loaded.files[0].text, "REAL_RUBRIC\n");
  assert.equal(loaded.files[0].hash, sha256("REAL_RUBRIC\n"));
});

test("frozen kit hashes match the bytes that were read, and a later edit is not source drift", async () => {
  const root = mkdtempSync(join(tmpdir(), "rgate-freeze-"));
  copyCompanions(root);
  const rubricPath = join(root, "code-review", "code-reviewer.md");
  const original = readFileSync(rubricPath);
  const { repo, base, head } = changed();
  const result = await runReviewGate({ repoDir: repo, mode: "diff", base, head, repro: false }, {
    ...rt(async (prompt, opts) => {
      if (opts.label === "code-review") writeFileSync(rubricPath, Buffer.concat([original, Buffer.from("\nMUTATION_SENTINEL\n")]));
      assert.equal(prompt.includes("MUTATION_SENTINEL"), false);
      return gateReport(opts.label);
    }),
    skillsRoot: root,
  });
  assert.equal(result.drift.detected, false);
  assert.equal(result.passed, true);
  const frozen = readFileSync(join(result.artifacts.kitDir, "code-review", "code-reviewer.md"));
  assert.deepEqual(frozen, original);
  const recorded = result.scope.kit.files.find((file) => file.path === "code-review/code-reviewer.md");
  assert.equal(recorded.hash, sha256(original));
  assert.equal(recorded.hash, sha256(frozen));

  writeFileSync(rubricPath, Buffer.concat([original, Buffer.from("\nSECOND_RUN\n")]));
  const again = await runReviewGate({ repoDir: repo, mode: "diff", base, head, repro: false }, {
    ...rt(async (_prompt, opts) => gateReport(opts.label)),
    skillsRoot: root,
  });
  assert.equal(again.scope.manifestHash, result.scope.manifestHash);
  assert.notEqual(
    again.scope.kit.files.find((file) => file.path === "code-review/code-reviewer.md").hash,
    recorded.hash,
  );
});
