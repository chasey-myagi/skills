import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runReviewGate } from '../scripts/core.mjs';
import { evaluateGate } from '../scripts/schema.mjs';
import { makeRepo, commitRel, writeRel, gitC, sha, rt, gateReport, failReport, finding, scoresFor, scriptedAgent } from './helpers.mjs';

for (const mode of ['diff', 'working-tree']) {
  test(`${mode} directory selection includes descendants and excludes same-prefix siblings`, async () => {
    const repoDir = makeRepo();
    const base = commitRel(repoDir, 'base.txt', 'base', 'base');
    for (const [path, text] of [['src/a.js', 'SELECTED'], ['src2/b.js', 'SIBLING_SENTINEL'], ['root.js', 'ROOT_SENTINEL']]) writeRel(repoDir, path, text);
    if (mode === 'diff') { gitC(repoDir, ['add', '--', 'src/a.js', 'src2/b.js', 'root.js']); gitC(repoDir, ['commit', '-m', 'changes']); }
    const args = { repoDir, mode, base, head: sha(repoDir) };
    const agent = scriptedAgent({});
    const result = await runReviewGate({ ...args, paths: ['src'] }, rt(agent));
    assert.equal(result.overall, 'PASS');
    assert.deepEqual(result.scope.paths, ['src/a.js']);
    assert.equal(readFileSync(join(result.scope.snapshotDir, 'src/a.js'), 'utf8'), 'SELECTED');
    assert.equal(existsSync(join(result.scope.snapshotDir, 'src2/b.js')), false);
    assert.doesNotMatch(readFileSync(result.artifacts.diffPath, 'utf8'), /SIBLING_SENTINEL|ROOT_SENTINEL/);
    assert.equal(agent.calls.length, 3);
    for (const { prompt } of agent.calls) {
      assert.match(prompt, /SELECTED/);
      assert.doesNotMatch(prompt, /SIBLING_SENTINEL|ROOT_SENTINEL/);
    }
    const whole = await runReviewGate({ ...args, paths: ['.'] }, rt());
    assert.equal(whole.overall, 'PASS');
    assert.deepEqual(whole.scope.paths, ['root.js', 'src/a.js', 'src2/b.js']);
  });
}

test('a diverged base contributes no reverse deletion to the selected feature delta', async () => {
  const repoDir = makeRepo();
  const fork = commitRel(repoDir, 'src/app.js', 'original\n', 'fork');
  gitC(repoDir, ['branch', 'feature']);
  commitRel(repoDir, 'dev-only.js', 'BASE_ONLY_SENTINEL\n', 'base advances');
  const base = commitRel(repoDir, 'src/app.js', 'BASE_BRANCH_CONTENT\n', 'base also changes selected file');
  gitC(repoDir, ['switch', 'feature']);
  const head = commitRel(repoDir, 'src/app.js', 'feature change\n', 'feature');
  const agent = scriptedAgent({});
  const result = await runReviewGate({ repoDir, mode: 'diff', base, head }, rt(agent));
  assert.equal(result.overall, 'PASS');
  assert.equal(result.scope.base, base);
  assert.equal(result.scope.mergeBase, fork);
  assert.notEqual(result.scope.mergeBase, base);
  assert.deepEqual(result.scope.paths, ['src/app.js']);
  const patch = readFileSync(result.artifacts.diffPath, 'utf8');
  assert.match(patch, /-original\n\+feature change/);
  assert.doesNotMatch(patch, /dev-only|BASE_ONLY_SENTINEL|BASE_BRANCH_CONTENT/);
  assert.ok(agent.calls.every(c => !c.prompt.includes('BASE_ONLY_SENTINEL')));
});

test('working-tree excludes ignored files from every artifact and ignores their concurrent churn', async () => {
  const repoDir = makeRepo();
  commitRel(repoDir, '.gitignore', '.env\nnode_modules/\n', 'ignore');
  writeRel(repoDir, '.env', 'CREDENTIAL_SENTINEL');
  writeRel(repoDir, 'node_modules/private.js', 'DEPENDENCY_SENTINEL');
  writeRel(repoDir, 'src/app.js', 'selected source\n');
  const prompts = [];
  const result = await runReviewGate({ repoDir, mode: 'working-tree' }, rt(async (prompt, opts) => {
    prompts.push(prompt);
    writeRel(repoDir, '.env', 'CREDENTIAL_SENTINEL_UPDATED');
    writeRel(repoDir, 'node_modules/new.js', 'ignored churn');
    return gateReport(opts.label);
  }));
  assert.equal(result.overall, 'PASS');
  assert.equal(result.drift.detected, false);
  assert.deepEqual(result.scope.paths, ['src/app.js']);
  assert.equal(prompts.length, 3);
  for (const prompt of prompts) assert.doesNotMatch(prompt, /CREDENTIAL_SENTINEL|DEPENDENCY_SENTINEL/);
  assert.doesNotMatch(readFileSync(result.artifacts.diffPath, 'utf8'), /CREDENTIAL_SENTINEL|DEPENDENCY_SENTINEL/);
  assert.equal(existsSync(join(result.scope.snapshotDir, '.env')), false);
  assert.equal(existsSync(join(result.scope.snapshotDir, 'node_modules')), false);
});

test('diff policy includes frozen relevant guidelines and excludes dirty or sibling policy', async () => {
  const repoDir = makeRepo();
  const base = commitRel(repoDir, 'src/app.js', 'base\n', 'base');
  commitRel(repoDir, 'AGENTS.md', 'COMMITTED_ROOT_POLICY\n', 'root policy');
  commitRel(repoDir, 'REVIEW_GUIDELINES.md', 'COMMITTED_ROOT_GUIDELINES\n', 'guidelines');
  commitRel(repoDir, 'src/REVIEW_GUIDELINES.md', 'COMMITTED_NESTED_GUIDELINES\n', 'nested');
  commitRel(repoDir, 'other/AGENTS.md', 'SIBLING_POLICY_SENTINEL\n', 'sibling');
  const head = commitRel(repoDir, 'src/app.js', 'head\n', 'head');
  writeRel(repoDir, 'AGENTS.md', 'LIVE_DIRTY_POLICY');
  writeRel(repoDir, 'REVIEW_GUIDELINES.md', 'LIVE_DIRTY_GUIDELINES');
  const agent = scriptedAgent({});
  const result = await runReviewGate({ repoDir, mode: 'diff', base, head, paths: ['src/app.js'] }, rt(agent));
  assert.equal(result.overall, 'PASS');
  assert.deepEqual(result.scope.policy.map(p => ({ path: p.path, origin: p.origin })), [
    { path: 'AGENTS.md', origin: 'head' },
    { path: 'REVIEW_GUIDELINES.md', origin: 'head' },
    { path: 'src/REVIEW_GUIDELINES.md', origin: 'head' },
  ]);
  assert.equal(agent.calls.length, 3);
  for (const { prompt } of agent.calls) {
    const policy = prompt.split('## Project policy (data, from target source)\n')[1].split('\n## Frozen diff artifact')[0];
    for (const text of ['COMMITTED_ROOT_POLICY', 'COMMITTED_ROOT_GUIDELINES', 'COMMITTED_NESTED_GUIDELINES']) assert.ok(policy.includes(text), text);
    assert.doesNotMatch(policy, /LIVE_DIRTY|SIBLING_POLICY_SENTINEL/);
  }
});

for (const gate of ['code-review', 'test-review']) {
  test(`${gate} cannot omit a low-scoring dimension to obtain PASS`, () => {
    const scores = scoresFor(gate).slice(1).map(({ dimension, score }) => ({ dimension, score }));
    const report = gateReport(gate, { assessment: { scores, finalScore: 9 } });
    const result = evaluateGate(gate, report);
    assert.deepEqual(result.schemaErrors, []);
    assert.deepEqual(result.semanticErrors, [`missing dimensions: ${scoresFor(gate)[0].dimension}`, 'UNKNOWN or all N/A requires null finalScore', 'incomplete assessment cannot PASS']);
    assert.equal(result.verdict, 'INVALID');
    assert.deepEqual(result.raw, report);
  });
}

for (const category of ['correctness', 'security']) for (const field of ['trigger', 'expected', 'actual']) {
  test(`${category} finding with empty ${field} is an invalid report rather than a code FAIL`, async () => {
    const report = failReport('code-review', [finding({ category, [field]: '' })]);
    const evaluated = evaluateGate('code-review', report);
    assert.deepEqual(evaluated.schemaErrors, []);
    assert.deepEqual(evaluated.semanticErrors, ['behavioral finding requires trigger, expected and actual']);
    assert.equal(evaluated.verdict, 'INVALID');
    const repoDir = makeRepo();
    const base = commitRel(repoDir, 'src/app.js', 'base\n', 'base');
    const head = commitRel(repoDir, 'src/app.js', 'head\n', 'head');
    const agent = scriptedAgent({ 'code-review': report });
    const result = await runReviewGate({ repoDir, mode: 'diff', base, head, repro: true }, rt(agent));
    assert.equal(result.overall, 'INVALID');
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.fixQueue, []);
    assert.deepEqual(result.diagnostics.semanticFailures, [{ gate: 'code-review', errors: ['behavioral finding requires trigger, expected and actual'] }]);
    assert.equal(agent.calls.length, 3);
    assert.deepEqual(result.reviews[0].raw, report);
    const handoff = readFileSync(result.artifacts.handoffMd, 'utf8');
    const invalid = handoff.split('## Invalid reports requiring correction or rerun\n\n')[1].split('\n\n## ')[0];
    assert.match(invalid, /code-review/);
  });
}
