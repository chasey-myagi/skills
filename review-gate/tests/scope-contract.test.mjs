import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runReviewGate } from '../scripts/core.mjs';
import { makeRepo, commitRel, writeRel, gitC, sha, rt, gateReport, scriptedAgent } from './helpers.mjs';

function changed() {
  const repo = makeRepo();
  const base = commitRel(repo, 'src/app.js', 'old\n', 'base');
  const head = commitRel(repo, 'src/app.js', 'new\n', 'head');
  return { repoDir: repo, base, head, mode: 'diff', repro: false };
}

test('directory snapshots omit ignored files, explicit ignored files opt in, and ignored churn does not drift', async () => {
  const repo = makeRepo();
  commitRel(repo, '.gitignore', '.env\nnode_modules/\n', 'ignore');
  writeRel(repo, 'src/app.js', 'review me');
  writeRel(repo, '.env', 'SENTINEL_IGNORED_CREDENTIAL');
  writeRel(repo, 'node_modules/private.js', 'SENTINEL_IGNORED_DEPENDENCY');
  const calls = [];
  const result = await runReviewGate({ repoDir: repo, mode: 'snapshot', paths: ['.'] }, rt(async (prompt, opts) => {
    calls.push(prompt);
    writeRel(repo, '.env', 'changed ignored content');
    writeRel(repo, 'node_modules/new.js', 'new ignored file');
    return gateReport(opts.label);
  }));
  assert.deepEqual(result.scope.paths, ['.gitignore', 'src/app.js']);
  assert.equal(result.passed, true);
  assert.ok(calls.every(p => !p.includes('SENTINEL_IGNORED')));
  const explicit = await runReviewGate({ repoDir: repo, mode: 'snapshot', paths: ['.env'] }, rt());
  assert.deepEqual(explicit.scope.paths, ['.env']);
});

test('a selected pure rename retains both paths and a rename-only delta', async () => {
  const repo = makeRepo();
  const base = commitRel(repo, 'src/old.js', 'preexisting flaw\nunchanged line\n', 'base');
  gitC(repo, ['mv', 'src/old.js', 'src/new.js']);
  const head = commitRel(repo, 'unrelated.js', 'UNRELATED', 'rename');
  const agent = scriptedAgent({});
  const result = await runReviewGate({ repoDir: repo, mode: 'diff', base, head, paths: ['src/new.js'] }, rt(agent));
  assert.deepEqual(result.scope.paths, ['src/new.js', 'src/old.js']);
  const patch = readFileSync(result.artifacts.diffPath, 'utf8');
  assert.match(patch, /similarity index 100%/);
  assert.match(patch, /rename from src\/old.js/);
  assert.match(patch, /rename to src\/new.js/);
  assert.doesNotMatch(patch, /new file mode|\+preexisting flaw|UNRELATED/);
});

test('large files remain complete on disk while each reviewer prompt is bounded', async () => {
  const args = changed();
  const large = 'UNIQUE_LARGE_CONTENT\n'.repeat(20000);
  args.head = commitRel(args.repoDir, 'large.txt', large, 'large');
  const agent = scriptedAgent({});
  const result = await runReviewGate(args, rt(agent));
  assert.equal(readFileSync(join(result.scope.snapshotDir, 'large.txt'), 'utf8'), large);
  assert.match(readFileSync(result.artifacts.diffPath, 'utf8'), /UNIQUE_LARGE_CONTENT/);
  assert.ok(agent.calls.every(c => Buffer.byteLength(c.prompt) < 256 * 1024));
  assert.ok(agent.calls.every(c => !c.prompt.includes('UNIQUE_LARGE_CONTENT')));
  assert.ok(agent.calls.every(c => c.prompt.includes(result.artifacts.diffPath)));
});

test('oversized policy/context fails before any reviewer dispatch', async () => {
  const agent = scriptedAgent({});
  await assert.rejects(runReviewGate({ ...changed(), context: 'x'.repeat(256 * 1024) }, rt(agent)), /prompt exceeds 256 KiB/);
  assert.equal(agent.calls.length, 0);
});

test('working-tree preserves index-only changes and detects index drift', async () => {
  const repo = makeRepo();
  commitRel(repo, 'src/app.js', 'HEAD_BYTES\n', 'base');
  writeRel(repo, 'src/app.js', 'INDEX_ONLY_DEFECT\n');
  gitC(repo, ['add', 'src/app.js']);
  writeRel(repo, 'src/app.js', 'HEAD_BYTES\n');
  const agent = scriptedAgent({});
  const result = await runReviewGate({ repoDir: repo, mode: 'working-tree' }, rt(agent));
  assert.match(readFileSync(result.artifacts.diffPath, 'utf8'), /INDEX_ONLY_DEFECT/);
  assert.equal(readFileSync(join(result.artifacts.runDir, 'snapshot-index/src/app.js'), 'utf8'), 'INDEX_ONLY_DEFECT\n');
  assert.ok(agent.calls.every(c => c.prompt.includes('INDEX_ONLY_DEFECT')));
  const drifted = await runReviewGate({ repoDir: repo, mode: 'working-tree' }, rt(async (_prompt, opts) => {
    gitC(repo, ['add', 'src/app.js']);
    return gateReport(opts.label);
  }));
  assert.equal(drifted.passed, false);
  assert.equal(drifted.drift.detected, true);
});

test('advancing a branch does not change the reviewed immutable commit', async () => {
  const args = changed();
  const frozen = args.head;
  args.head = 'main';
  let advanced = false;
  const result = await runReviewGate(args, rt(async (_prompt, opts) => {
    if (!advanced) { advanced = true; commitRel(args.repoDir, 'later.js', 'later', 'later'); }
    return gateReport(opts.label);
  }));
  assert.notEqual(sha(args.repoDir), frozen);
  assert.equal(result.scope.head, frozen);
  assert.equal(result.passed, true);
});
