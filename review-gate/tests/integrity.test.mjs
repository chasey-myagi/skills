import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runReviewGate } from '../scripts/core.mjs';
import { makeRepo, commitRel, writeRel, gitC, sha, freshRunDir, rt, gateReport, failReport, finding } from './helpers.mjs';

function changed() {
  const repo = makeRepo();
  const base = commitRel(repo, 'app.js', 'ORIGINAL_BASE\n', 'base');
  writeRel(repo, 'app.js', 'CURRENT_CHANGE\n');
  return { repo, base };
}

test('paths filter excludes unrelated diff text from every reviewer prompt', async () => {
  const { repo, base } = changed();
  writeRel(repo, 'unrelated.js', 'EXCLUDED_SCOPE_SENTINEL\n');
  gitC(repo, ['add', '--', 'app.js', 'unrelated.js']);
  gitC(repo, ['commit', '-m', 'head']);
  const result = await runReviewGate({ repoDir: repo, mode: 'diff', base, head: sha(repo), paths: ['app.js'] }, rt(async (prompt, opts) => {
    assert.match(prompt, /CURRENT_CHANGE/);
    assert.equal(prompt.includes('EXCLUDED_SCOPE_SENTINEL'), false);
    return gateReport(opts.label);
  }));
  assert.equal(result.passed, true);
});

test('working-tree attribution receives the actual frozen baseline', async () => {
  const { repo, base } = changed();
  const result = await runReviewGate({ repoDir: repo, mode: 'working-tree' }, rt(async (prompt, opts) => {
    assert.match(prompt, /ORIGINAL_BASE/);
    assert.match(prompt, /CURRENT_CHANGE/);
    return gateReport(opts.label);
  }));
  assert.equal(result.scope.head, base);
  assert.equal(result.passed, true);
});

test('a directory symlink cannot expose files outside the source', async () => {
  const { repo } = changed();
  const outside = makeRepo();
  writeRel(outside, 'secret.txt', 'outside source');
  symlinkSync(outside, join(repo, 'link'));
  let calls = 0;
  await assert.rejects(runReviewGate({ repoDir: repo, mode: 'snapshot', paths: ['link/secret.txt'] }, rt(async () => { calls++; })), /escape/);
  assert.equal(calls, 0);
});

test('runDir reached through a symlink into source is rejected', async () => {
  const { repo } = changed();
  const outside = makeRepo();
  symlinkSync(repo, join(outside, 'link'));
  await assert.rejects(runReviewGate({ repoDir: repo, mode: 'working-tree', runDir: join(outside, 'link', 'out') }, rt()), /inside/);
});

test('deleting the last snapshot file preserves reports and invalidates the scope', async () => {
  const { repo } = changed();
  let deleted = false;
  const result = await runReviewGate({ repoDir: repo, mode: 'snapshot', paths: ['app.js'] }, rt(async (_prompt, opts) => {
    if (!deleted) { unlinkSync(join(repo, 'app.js')); deleted = true; }
    return gateReport(opts.label);
  }));
  assert.equal(result.passed, false);
  assert.equal(result.drift.detected, true);
  assert.equal(JSON.parse(readFileSync(result.artifacts.resultJson)).reviews.length, 3);
});

test('tampering with a working-tree snapshot cannot produce PASS', async () => {
  const { repo } = changed();
  const result = await runReviewGate({ repoDir: repo, mode: 'working-tree' }, rt(async (prompt, opts) => {
    const snapshot = /^SNAPSHOT_DIR: (.+)$/m.exec(prompt)[1];
    writeFileSync(join(snapshot, 'app.js'), 'TAMPERED');
    return gateReport(opts.label);
  }));
  assert.equal(result.drift.detected, true);
  assert.equal(result.passed, false);
});

test('a runtime interruption retains completed independent gate output', async () => {
  const { repo } = changed();
  const runDir = freshRunDir();
  const runtime = rt(async (_prompt, opts) => gateReport(opts.label));
  runtime.parallel = async calls => { await calls[0](); throw new Error('runtime interrupted'); };
  await assert.rejects(runReviewGate({ repoDir: repo, mode: 'working-tree', runDir }, runtime), /runtime interrupted/);
  const saved = JSON.parse(readFileSync(join(runDir, 'review-result.json')));
  assert.equal(saved.passed, false);
  assert.equal(saved.executionStatus, 'incomplete');
  assert.equal(saved.overall, 'INVALID');
  assert.equal(saved.reviews[0].raw.gate, 'code-review');
});

test('repro requires explicit opt-in even when an eligible blocker exists', async () => {
  const { repo, base } = changed();
  gitC(repo, ['commit', '-am', 'head']);
  const calls = [];
  const result = await runReviewGate({ repoDir: repo, mode: 'diff', base, head: sha(repo) }, rt(async (_prompt, opts) => {
    calls.push(opts.label);
    return opts.label === 'code-review' ? failReport(opts.label, [finding()]) : gateReport(opts.label);
  }));
  assert.equal(result.verification.enabled, false);
  assert.equal(calls.length, 3);
  assert.equal(result.findings.length, 1);
});

test('a non-boolean repro option is rejected before reviewer calls', async () => {
  const { repo } = changed();
  await assert.rejects(runReviewGate({ repoDir: repo, mode: 'working-tree', repro: 0 }, rt()), /must be boolean/);
});

test('a misspelled scope option cannot silently broaden the review', async () => {
  const { repo } = changed();
  await assert.rejects(runReviewGate({ repoDir: repo, mode: 'working-tree', path: ['app.js'] }, rt()), /unknown args: path/);
});
