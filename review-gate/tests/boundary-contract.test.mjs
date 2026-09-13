import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { runReviewGate } from '../scripts/core.mjs';
import { inspectIntegrity } from '../scripts/repro.mjs';
import { makeRepo, commitRel, writeRel, gitC, sha, rt, gateReport, failReport, finding, scoresFor, scriptedAgent } from './helpers.mjs';

for (const mode of ['diff', 'working-tree', 'snapshot']) {
  test(`${mode} gives every reviewer the matching attribution contract`, async () => {
    const repoDir = makeRepo();
    const base = commitRel(repoDir, 'bug.js', 'existing defect\n', 'base');
    const head = commitRel(repoDir, 'new.js', 'new code\n', 'head');
    if (mode === 'working-tree') writeRel(repoDir, 'new.js', 'changed again\n');
    const agent = scriptedAgent({});
    const result = await runReviewGate({ repoDir, mode, base, head, ...(mode === 'snapshot' ? { paths: ['bug.js'] } : {}) }, rt(agent));
    assert.equal(result.overall, 'PASS');
    assert.equal(agent.calls.length, 3);
    for (const { prompt } of agent.calls) {
      const authority = prompt.split('## Authority\n')[1].split('\n## Task constraints')[0];
      assert.match(authority, mode === 'snapshot' ? /Snapshot mode:.*including existing ones/ : /Delta mode:.*introduced or worsened/);
      assert.doesNotMatch(authority, mode === 'snapshot' ? /Delta mode:/ : /Snapshot mode:/);
    }
    if (mode === 'snapshot') {
      assert.equal(readFileSync(join(result.scope.snapshotDir, 'bug.js'), 'utf8'), 'existing defect\n');
      assert.equal(readFileSync(result.artifacts.diffPath, 'utf8'), 'Snapshot review: current files only; no delta attribution.');
    }
  });
}

for (const verdict of ['FAIL', 'INCONCLUSIVE']) {
  test(`source drift takes precedence over a valid ${verdict} without erasing its evidence`, async () => {
    const repoDir = makeRepo();
    commitRel(repoDir, 'src/app.js', 'base\n', 'base');
    writeRel(repoDir, 'src/app.js', 'reviewed\n');
    const report = verdict === 'FAIL' ? failReport('code-review', [finding()]) : gateReport('code-review', {
      verdict, assessment: { finalScore: null, scores: scoresFor('code-review').map((s, i) => i ? s : { dimension: s.dimension, unknown: true, reason: 'required oracle absent' }) },
    });
    const result = await runReviewGate({ repoDir, mode: 'working-tree' }, rt(async (_prompt, opts) => {
      writeRel(repoDir, 'src/app.js', 'concurrent change\n');
      return opts.label === 'code-review' ? report : gateReport(opts.label);
    }));
    assert.equal(result.overall, 'INVALID');
    assert.equal(result.passed, false);
    assert.equal(result.drift.detected, true);
    assert.match(result.drift.details, /source scope, contents, policy or refs changed/);
    assert.equal(result.reviews[0].semanticOk, true);
    assert.deepEqual(result.reviews[0].raw, report);
    assert.equal(result.fixQueue.length, verdict === 'FAIL' ? 1 : 0);
    assert.deepEqual(result.gateBlockingReasons, verdict === 'FAIL' ? [{ gate: 'code-review', reasons: report.assessment.blockingReasons }] : []);
  });
}

for (const [mode, kind, paths, error] of [
  ['diff', 'gitlink', null, /unsupported non-blob source sub/],
  ['working-tree', 'nested', null, /not a regular file: nested/],
  ['snapshot', 'gitlink', ['.'], /not a regular file: sub/],
  ['snapshot', 'missing-gitlink', ['.'], /not a regular file: sub/],
  ['working-tree', 'replaced-gitlink', null, /not a regular file: sub/],
  ['snapshot', 'nested', ['.'], /not a regular file: nested/],
  ['snapshot', 'symlink', ['.'], /symlink rejected/],
  ['snapshot', 'symlink', ['link.js'], /symlink rejected/],
  ['snapshot', 'metadata-link', ['link.js'], /symlink rejected/],
  ['snapshot', 'parent-link', ['linked/app.js'], /symlink rejected/],
]) {
  test(`${mode} rejects ${kind} (${paths || 'changed files'}) before reviewer dispatch`, async () => {
    const repoDir = makeRepo();
    let base = commitRel(repoDir, 'src/app.js', 'ordinary source\n', 'base');
    if (kind.includes('gitlink')) {
      if (kind === 'replaced-gitlink') {
        base = commitRel(repoDir, 'sub', 'old regular file', 'base file');
        gitC(repoDir, ['rm', 'sub']);
      }
      if (kind !== 'missing-gitlink') mkdirSync(join(repoDir, 'sub'));
      gitC(repoDir, ['update-index', '--add', '--cacheinfo', `160000,${base},sub`]);
      if (kind !== 'replaced-gitlink') gitC(repoDir, ['commit', '-m', 'gitlink']);
    } else if (kind === 'nested') {
      mkdirSync(join(repoDir, 'nested'));
      gitC(join(repoDir, 'nested'), ['init', '-b', 'main']);
      commitRel(join(repoDir, 'nested'), 'child.js', 'nested source', 'nested');
    } else if (kind === 'parent-link') symlinkSync('src', join(repoDir, 'linked'));
    else symlinkSync(kind === 'metadata-link' ? '.git/config' : 'src/app.js', join(repoDir, 'link.js'));
    const agent = scriptedAgent({});
    await assert.rejects(runReviewGate({ repoDir, mode, base, head: sha(repoDir), ...(paths ? { paths } : {}) }, rt(agent)), error);
    assert.equal(agent.calls.length, 0);
  });
}

test('a staged source rename into the allowed new-test directory still rejects the source deletion', () => {
  const repo = makeRepo();
  const head = commitRel(repo, 'src/app.js', 'source bytes\n', 'base');
  mkdirSync(join(repo, 'tests/repro'), { recursive: true });
  gitC(repo, ['mv', 'src/app.js', 'tests/repro/app.test.js']);
  const integrity = inspectIntegrity(repo, null, head);
  assert.deepEqual(integrity.tamper, ['source change src/app.js']);
  assert.deepEqual(integrity.newTests, ['tests/repro/app.test.js']);
});

for (const [mode, direction] of [['diff', 'file-to-directory'], ['working-tree', 'file-to-directory'], ['working-tree', 'directory-to-file']]) {
  test(`${mode} captures a ${direction} replacement as deletion plus addition`, async () => {
    const repoDir = makeRepo();
    const oldPath = direction === 'file-to-directory' ? 'tool' : 'tool/main.js';
    const newPath = direction === 'file-to-directory' ? 'tool/main.js' : 'tool';
    const base = commitRel(repoDir, oldPath, 'old bytes\n', 'base');
    gitC(repoDir, ['rm', oldPath]);
    writeRel(repoDir, newPath, 'new bytes\n');
    gitC(repoDir, ['add', newPath]);
    if (mode === 'diff') gitC(repoDir, ['commit', '-m', 'replace']);
    const result = await runReviewGate({ repoDir, mode, base, head: sha(repoDir) }, rt());
    assert.equal(result.overall, 'PASS');
    assert.equal(result.drift.detected, false);
    assert.deepEqual(result.scope.paths, ['tool', 'tool/main.js']);
    const manifest = JSON.parse(readFileSync(result.scope.manifestPath));
    assert.equal(manifest.files.find(f => f.path === oldPath).hash, 'deleted');
    assert.equal(readFileSync(join(result.scope.snapshotDir, newPath), 'utf8'), 'new bytes\n');
    const patch = readFileSync(result.artifacts.diffPath, 'utf8');
    assert.match(patch, /-old bytes/);
    assert.match(patch, /\+new bytes/);
  });
}
