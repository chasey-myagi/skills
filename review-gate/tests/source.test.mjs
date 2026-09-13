import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  makeRepo,
  commitRel,
  writeRel,
  gitC,
  sha,
  freshRunDir,
  passingAgent,
  loadCore,
  assertOfficialPass,
} from "./helpers.mjs";

test("diff reviews committed blobs, not dirty live files", async () => {
  const core = await loadCore();
  const repo = makeRepo();
  const base = commitRel(repo, "src/app.js", "const n = 1;\n", "base");
  writeRel(repo, "src/app.js", "const n = 2;\n");
  gitC(repo, ["add", "src/app.js"]);
  gitC(repo, ["commit", "-m", "head"]);
  const head = sha(repo);
  writeRel(repo, "src/app.js", "LIVE-DIRTY-SHOULD-NOT-BE-REVIEWED\n");

  const { result } = await (async () => {
    const rt = {
      agent: passingAgent(),
      parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
      phase() {},
      log() {},
    };
    return { result: await core.runReviewGate({
      repoDir: repo,
      mode: "diff",
      base,
      head,
      runDir: freshRunDir(),
      repro: false,
    }, rt) };
  })();

  assertOfficialPass(result);
  const snap = readFileSync(join(result.artifacts.snapshotDir, "src/app.js"), "utf8");
  assert.equal(snap.includes("LIVE-DIRTY"), false);
  assert.equal(snap.includes("const n = 2"), true);
  assert.equal(result.scope.head, head);
  assert.equal(result.scope.base.length, 40);
  assert.equal(result.scope.mergeBase.length, 40);
  assert.ok(result.scope.paths.includes("src/app.js"));
});

test("mode defaults to diff when base and head are supplied", async () => {
  const core = await loadCore();
  const repo = makeRepo();
  const base = commitRel(repo, "a.txt", "a\n", "a");
  writeRel(repo, "a.txt", "b\n");
  gitC(repo, ["commit", "-am", "b"]);
  const head = sha(repo);
  const result = await core.runReviewGate({
    repoDir: repo,
    base,
    head,
    runDir: freshRunDir(),
    repro: false,
  }, {
    agent: passingAgent(),
    parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
    phase() {},
    log() {},
  });
  assert.equal(result.scope.mode, "diff");
  assertOfficialPass(result);
});

test("working-tree captures staged, unstaged, and new files including paths with spaces", async () => {
  const core = await loadCore();
  const repo = makeRepo();
  commitRel(repo, "keep.js", "keep\n", "init");
  commitRel(repo, "tracked.js", "TRACKED-BASE\n", "tracked");
  writeRel(repo, "tracked.js", "UNSTAGED-TRACKED\n");
  writeRel(repo, "staged.js", "STAGED\n");
  gitC(repo, ["add", "staged.js"]);
  writeRel(repo, "unstaged.js", "UNTRACKED-NEW\n");
  writeRel(repo, "file with spaces.txt", "SPACED\n");

  const agent = async (prompt) => {
    assert.match(prompt, /STAGED/);
    assert.match(prompt, /UNSTAGED-TRACKED/);
    assert.match(prompt, /UNTRACKED-NEW/);
    assert.match(prompt, /SPACED/);
    assert.match(prompt, /file with spaces\.txt/);
    assert.match(prompt, /tracked\.js/);
    return (await import("./helpers.mjs")).gateReport(
      /GATE_ID:\s*(\S+)/.exec(prompt)[1],
    );
  };

  const result = await core.runReviewGate({
    repoDir: repo,
    mode: "working-tree",
    runDir: freshRunDir(),
  }, {
    agent,
    parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
    phase() {},
    log() {},
  });

  assert.ok(result.scope.paths.includes("staged.js"));
  assert.ok(result.scope.paths.includes("tracked.js"));
  assert.ok(result.scope.paths.includes("unstaged.js"));
  assert.ok(result.scope.paths.includes("file with spaces.txt"));
  assert.equal(readFileSync(join(result.artifacts.snapshotDir, "tracked.js"), "utf8"), "UNSTAGED-TRACKED\n");
  assert.equal(readFileSync(join(result.artifacts.snapshotDir, "file with spaces.txt"), "utf8"), "SPACED\n");
});

test("working-tree paths filter intersects the change set", async () => {
  const core = await loadCore();
  const repo = makeRepo();
  commitRel(repo, "keep.js", "keep\n", "init");
  writeRel(repo, "a.js", "A\n");
  writeRel(repo, "b.js", "B\n");
  const result = await core.runReviewGate({
    repoDir: repo,
    mode: "working-tree",
    paths: ["a.js"],
    runDir: freshRunDir(),
    repro: false,
  }, {
    agent: passingAgent(),
    parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
    phase() {},
    log() {},
  });
  assert.deepEqual(result.scope.paths, ["a.js"]);
});

test("snapshot includes existing unchanged files", async () => {
  const core = await loadCore();
  const repo = makeRepo();
  commitRel(repo, "lib/util.js", "export const x = 1;\n", "init");
  const result = await core.runReviewGate({
    repoDir: repo,
    mode: "snapshot",
    paths: ["lib/util.js"],
    runDir: freshRunDir(),
  }, {
    agent: passingAgent(),
    parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
    phase() {},
    log() {},
  });
  assert.deepEqual(result.scope.paths, ["lib/util.js"]);
  assert.equal(readFileSync(join(result.artifacts.snapshotDir, "lib/util.js"), "utf8"), "export const x = 1;\n");
});

test("invalid refs are rejected and do not review HEAD~1", async () => {
  const core = await loadCore();
  const repo = makeRepo();
  commitRel(repo, "a.txt", "a\n", "only");
  await assert.rejects(
    () => core.runReviewGate({
      repoDir: repo,
      mode: "diff",
      base: "no-such-base",
      head: "HEAD",
      runDir: freshRunDir(),
    }, {
      agent: passingAgent(),
      parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
      phase() {},
      log() {},
    }),
    /no-such-base|invalid ref|unknown revision|bad revision|needed a single revision/i,
  );
});

test("empty working-tree is rejected instead of reviewing the last commit", async () => {
  const core = await loadCore();
  const repo = makeRepo();
  commitRel(repo, "a.txt", "a\n", "only");
  await assert.rejects(
    () => core.runReviewGate({
      repoDir: repo,
      mode: "working-tree",
      runDir: freshRunDir(),
    }, {
      agent: passingAgent(),
      parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
      phase() {},
      log() {},
    }),
    /empty/i,
  );
});

test("repoDir without mode or base/head is rejected", async () => {
  const core = await loadCore();
  const repo = makeRepo();
  commitRel(repo, "a.txt", "a\n", "only");
  await assert.rejects(
    () => core.runReviewGate({
      repoDir: repo,
      runDir: freshRunDir(),
    }, {
      agent: passingAgent(),
      parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
      phase() {},
      log() {},
    }),
    /mode/i,
  );
});

test("escaping paths and outside-repo symlinks are rejected", async () => {
  const core = await loadCore();
  const repo = makeRepo();
  commitRel(repo, "ok.txt", "ok\n", "init");
  const rt = {
    agent: passingAgent(),
    parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
    phase() {},
    log() {},
  };
  await assert.rejects(
    () => core.runReviewGate({
      repoDir: repo,
      mode: "snapshot",
      paths: ["../secret"],
      runDir: freshRunDir(),
    }, rt),
    /travers|escape|\.\./i,
  );

  const outside = join(tmpdir(), `rgate-outside-${Date.now()}`);
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "SECRET\n");
  symlinkSync(join(outside, "secret.txt"), join(repo, "link.txt"));
  await assert.rejects(
    () => core.runReviewGate({
      repoDir: repo,
      mode: "snapshot",
      paths: ["link.txt"],
      runDir: freshRunDir(),
    }, rt),
    /symlink|escape|outside/i,
  );
});

test("policy files come from the target source, not session cwd", async () => {
  const core = await loadCore();
  const repo = makeRepo();
  const base = commitRel(repo, "src/app.js", "v1\n", "base");
  writeRel(repo, "AGENTS.md", "TARGET-ROOT-POLICY\n");
  writeRel(repo, "src/AGENTS.md", "NESTED-POLICY\n");
  writeRel(repo, "src/app.js", "v2\n");
  gitC(repo, ["add", "-A"]);
  gitC(repo, ["commit", "-m", "head"]);
  const head = sha(repo);

  const prompts = [];
  const result = await core.runReviewGate({
    repoDir: repo,
    mode: "diff",
    base,
    head,
    runDir: freshRunDir(),
    repro: false,
  }, {
    agent: async (prompt, opts) => {
      prompts.push(prompt);
      return (await import("./helpers.mjs")).gateReport(opts.label);
    },
    parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
    phase() {},
    log() {},
  });

  assert.ok(prompts.length === 3);
  for (const p of prompts) {
    assert.match(p, /TARGET-ROOT-POLICY/);
    assert.match(p, /NESTED-POLICY/);
    assert.equal(p.includes("SECRET_CONVERSATION_HISTORY"), false);
  }
  assert.ok(result.scope.policy.some((x) => x.path === "AGENTS.md"));
  assert.ok(result.scope.policy.some((x) => x.path === "src/AGENTS.md"));
});

test("drift of a working-tree target invalidates PASS", async () => {
  const core = await loadCore();
  const repo = makeRepo();
  commitRel(repo, "a.js", "one\n", "init");
  writeRel(repo, "a.js", "two\n");
  const result = await core.runReviewGate({
    repoDir: repo,
    mode: "working-tree",
    runDir: freshRunDir(),
    repro: false,
  }, {
    agent: async (prompt, opts) => {
      writeRel(repo, "a.js", "DRIFTED\n");
      return (await import("./helpers.mjs")).gateReport(opts.label);
    },
    parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
    phase() {},
    log() {},
  });
  assert.equal(result.drift.detected, true);
  assert.equal(result.overall, "INVALID");
  assert.equal(result.passed, false);
});

test("working-tree drift includes a newly added task file not in the original capture", async () => {
  const core = await loadCore();
  const repo = makeRepo();
  commitRel(repo, "a.js", "one\n", "init");
  writeRel(repo, "a.js", "two\n");
  const result = await core.runReviewGate({
    repoDir: repo,
    mode: "working-tree",
    runDir: freshRunDir(),
    repro: false,
  }, {
    agent: async (_prompt, opts) => {
      writeRel(repo, "new-task.js", "NEW\n");
      return (await import("./helpers.mjs")).gateReport(opts.label);
    },
    parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
    phase() {},
    log() {},
  });
  assert.equal(result.drift.detected, true);
  assert.equal(result.passed, false);
});

test("diff paths filter does not silently widen to other changed files", async () => {
  const core = await loadCore();
  const repo = makeRepo();
  const base = commitRel(repo, "keep.txt", "k\n", "base");
  writeRel(repo, "a.js", "A\n");
  writeRel(repo, "b.js", "B\n");
  gitC(repo, ["add", "-A"]);
  gitC(repo, ["commit", "-m", "head"]);
  const head = sha(repo);
  const result = await core.runReviewGate({
    repoDir: repo,
    mode: "diff",
    base,
    head,
    paths: ["a.js"],
    runDir: freshRunDir(),
    repro: false,
  }, {
    agent: passingAgent(),
    parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
    phase() {},
    log() {},
  });
  assert.deepEqual(result.scope.paths, ["a.js"]);
  assert.equal(result.scope.paths.includes("b.js"), false);
});

test("unknown mode is rejected rather than widening scope", async () => {
  const core = await loadCore();
  const repo = makeRepo();
  commitRel(repo, "a.txt", "a\n", "only");
  await assert.rejects(
    () => core.runReviewGate({
      repoDir: repo,
      mode: "pr",
      paths: ["a.txt"],
      runDir: freshRunDir(),
    }, {
      agent: passingAgent(),
      parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
      phase() {},
      log() {},
    }),
    /mode/i,
  );
});

test("runDir inside the source repo is rejected", async () => {
  const core = await loadCore();
  const repo = makeRepo();
  commitRel(repo, "a.txt", "a\n", "only");
  writeRel(repo, "a.txt", "dirty\n");
  await assert.rejects(
    () => core.runReviewGate({
      repoDir: repo,
      mode: "working-tree",
      runDir: join(repo, "review-out"),
    }, {
      agent: passingAgent(),
      parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
      phase() {},
      log() {},
    }),
    /inside|source|repo/i,
  );
});

test("existing runDir is rejected", async () => {
  const core = await loadCore();
  const repo = makeRepo();
  commitRel(repo, "a.txt", "a\n", "only");
  writeRel(repo, "a.txt", "dirty\n");
  const runDir = freshRunDir();
  mkdirSync(runDir);
  await assert.rejects(
    () => core.runReviewGate({
      repoDir: repo,
      mode: "working-tree",
      runDir,
    }, {
      agent: passingAgent(),
      parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
      phase() {},
      log() {},
    }),
    /exist/i,
  );
});

test("manifest metadata lives outside the source snapshot namespace", async () => {
  const core = await loadCore();
  const repo = makeRepo();
  commitRel(repo, "manifest.json", "{\"src\":true}\n", "init");
  writeRel(repo, "manifest.json", "{\"src\":true,\"dirty\":1}\n");
  const result = await core.runReviewGate({
    repoDir: repo,
    mode: "working-tree",
    runDir: freshRunDir(),
    repro: false,
  }, {
    agent: passingAgent(),
    parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
    phase() {},
    log() {},
  });
  const snapManifest = readFileSync(join(result.artifacts.snapshotDir, "manifest.json"), "utf8");
  assert.match(snapManifest, /"src":\s*true/);
  assert.equal(result.artifacts.manifestPath.startsWith(result.artifacts.snapshotDir + "/"), false);
  const meta = JSON.parse(readFileSync(result.artifacts.manifestPath, "utf8"));
  assert.equal(meta.mode, "working-tree");
  assert.ok(meta.manifestHash);
});

test("mutating the frozen snapshot after capture invalidates a committed PASS", async () => {
  const core = await loadCore();
  const repo = makeRepo();
  const base = commitRel(repo, "src/app.js", "v1\n", "base");
  writeRel(repo, "src/app.js", "v2\n");
  gitC(repo, ["commit", "-am", "head"]);
  const head = sha(repo);
  const result = await core.runReviewGate({
    repoDir: repo,
    mode: "diff",
    base,
    head,
    runDir: freshRunDir(),
    repro: false,
  }, {
    agent: async (_prompt, opts) => {
      const { readFileSync: read, writeFileSync: write } = await import("node:fs");
      const { join: j } = await import("node:path");
      // agent cannot see runDir easily; mutate via prompt snapshot path
      const m = _prompt.match(/SNAPSHOT_DIR:\s*(.+)$/m);
      if (m) write(j(m[1].trim(), "src/app.js"), "TAMPERED-SNAPSHOT\n");
      return (await import("./helpers.mjs")).gateReport(opts.label);
    },
    parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
    phase() {},
    log() {},
  });
  assert.equal(result.drift.detected, true);
  assert.equal(result.passed, false);
});
