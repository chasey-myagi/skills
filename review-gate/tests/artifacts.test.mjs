import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  makeRepo,
  commitRel,
  writeRel,
  gitC,
  sha,
  freshRunDir,
  scriptedAgent,
  failReport,
  finding,
  gateReport,
  loadCore,
  rt,
} from "./helpers.mjs";

test("handoff and result retain every original finding and raw report", async () => {
  const core = await loadCore();
  const repo = makeRepo();
  const base = commitRel(repo, "src/app.js", "v1\n", "base");
  writeRel(repo, "src/app.js", "v2\n");
  gitC(repo, ["commit", "-am", "head"]);
  const f1 = finding({ id: "C1", title: "null bug" });
  const f2 = finding({
    id: "C2",
    title: "second bug",
    trigger: "foo(-1)",
    expected: "error",
    actual: "returns 0",
    evidence: "missing negative guard",
    path: "src/app.js",
    line: 8,
  });
  const result = await core.runReviewGate({
    repoDir: repo,
    mode: "diff",
    base,
    head: sha(repo),
    runDir: freshRunDir(),
    repro: false,
    constraints: "do not weaken tests",
  }, rt(scriptedAgent({
    "code-review": failReport("code-review", [f1, f2]),
    "test-review": gateReport("test-review"),
    "linus-review": gateReport("linus-review"),
  })));

  assert.equal(existsSync(result.artifacts.resultJson), true);
  assert.equal(existsSync(result.artifacts.handoffMd), true);
  const json = JSON.parse(readFileSync(result.artifacts.resultJson, "utf8"));
  const titles = json.findings.map((f) => f.title).sort();
  assert.deepEqual(titles, ["null bug", "second bug"]);
  const cr = json.reviews.find((r) => r.raw.gate === "code-review" || r.gate === "code-review");
  assert.equal(cr.raw.findings.length, 2);
  const md = readFileSync(result.artifacts.handoffMd, "utf8");
  assert.match(md, /null bug/);
  assert.match(md, /second bug/);
  assert.match(md, /do not weaken tests/);
  assert.match(md, /C1/);
  assert.match(md, /C2/);
  assert.equal(result.scope.sourceRoot, repo);
});

test("source checkout files stay unchanged after review", async () => {
  const core = await loadCore();
  const repo = makeRepo();
  const base = commitRel(repo, "src/app.js", "v1\n", "base");
  writeRel(repo, "src/app.js", "v2\n");
  gitC(repo, ["commit", "-am", "head"]);
  const before = readFileSync(join(repo, "src/app.js"), "utf8");
  await core.runReviewGate({
    repoDir: repo,
    mode: "diff",
    base,
    head: sha(repo),
    runDir: freshRunDir(),
    repro: false,
  }, rt(scriptedAgent({})));
  assert.equal(readFileSync(join(repo, "src/app.js"), "utf8"), before);
});
