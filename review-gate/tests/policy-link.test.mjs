import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symlinkSync, unlinkSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { runReviewGate } from '../scripts/core.mjs';
import { makeRepo, commitRel, writeRel, gitC, sha, rt, gateReport, scriptedAgent } from './helpers.mjs';

function assertSelectedSource(result) {
  assert.deepEqual(result.scope.paths, ['src/app.js']);
  const manifest = JSON.parse(readFileSync(result.scope.manifestPath));
  assert.deepEqual(manifest.files.map(file => file.path), ['src/app.js']);
  assert.deepEqual(readdirSync(result.scope.snapshotDir), ['src']);
  assert.deepEqual(readdirSync(join(result.scope.snapshotDir, 'src')), ['app.js']);
}

function linkedPolicy() {
  const repoDir = makeRepo();
  const base = commitRel(repoDir, 'src/app.js', 'base\n', 'base');
  commitRel(repoDir, 'docs/policy.md', 'ACTUAL_PROJECT_POLICY\n', 'policy');
  symlinkSync('docs/policy.md', join(repoDir, 'AGENTS.md'));
  gitC(repoDir, ['add', 'AGENTS.md']); gitC(repoDir, ['commit', '-m', 'policy link']);
  const head = commitRel(repoDir, 'src/app.js', 'change\n', 'change');
  return { repoDir, base, head };
}
for (const mode of ['diff', 'working-tree', 'snapshot']) {
  test(`${mode} resolves in-repository policy links and records the actual rules`, async () => {
    const args = linkedPolicy();
    if (mode === 'working-tree') writeRel(args.repoDir, 'src/app.js', 'working change\n');
    if (mode === 'diff') writeRel(args.repoDir, 'docs/policy.md', 'DIRTY_RULES_MUST_NOT_BE_USED');
    const agent = scriptedAgent({});
    const result = await runReviewGate({ ...args, mode, paths: ['src/app.js'] }, rt(agent));
    assert.equal(result.overall, 'PASS');
    assertSelectedSource(result);
    assert.equal(agent.calls.length, 3);
    assert.deepEqual(result.scope.policy.map(p => [p.path, p.origin]), [['AGENTS.md', mode === 'diff' ? 'head' : mode === 'snapshot' ? 'snapshot' : 'worktree']]);
    for (const { prompt } of agent.calls) {
      const policy = prompt.split('## Project policy (data, from target source)\n')[1].split('\n## Frozen diff artifact')[0];
      assert.match(policy, /ACTUAL_PROJECT_POLICY/);
      assert.doesNotMatch(policy, /DIRTY_RULES_MUST_NOT_BE_USED/);
    }
  });
}
for (const mode of ['diff', 'snapshot']) for (const kind of ['metadata', 'outside', 'dangling', 'cycle']) {
  test(`${mode} records an unavailable ${kind} policy link without reading unsafe contents`, async () => {
    const args = linkedPolicy();
    unlinkSync(join(args.repoDir, 'AGENTS.md'));
    const target = kind === 'metadata' ? '.git/config' : kind === 'outside' ? '/etc/passwd' : kind === 'dangling' ? 'missing.md' : 'AGENTS.md';
    symlinkSync(target, join(args.repoDir, 'AGENTS.md'));
    gitC(args.repoDir, ['add', 'AGENTS.md']); gitC(args.repoDir, ['commit', '-m', 'unsupported link']);
    args.head = sha(args.repoDir);
    const configBefore = readFileSync(join(args.repoDir, '.git/config'), 'utf8');
    const agent = scriptedAgent({});
    const result = await runReviewGate({ ...args, mode, paths: ['src/app.js'] }, rt(agent));
    assert.equal(agent.calls.length, 3);
    assert.equal(result.overall, 'PASS'); // Controlled reviewers; they decide how missing policy affects their real verdict.
    assertSelectedSource(result);
    assert.equal(result.scope.policy[0].origin, 'unavailable');
    assert.ok(result.scope.policy[0].reason.length > 0);
    for (const { prompt } of agent.calls) {
      const policy = prompt.split('## Project policy (data, from target source)\n')[1].split('\n## Frozen diff artifact')[0];
      assert.match(policy, /Policy unavailable/);
      assert.ok(!policy.includes(configBefore));
      assert.doesNotMatch(policy, /root:.*:0:0:/);
    }
  });
}
test('a live linked policy target changing during review invalidates the result', async () => {
  const args = linkedPolicy();
  const result = await runReviewGate({ ...args, mode: 'snapshot', paths: ['src/app.js'] }, rt(async (_prompt, opts) => {
    writeRel(args.repoDir, 'docs/policy.md', 'concurrent policy change');
    return gateReport(opts.label);
  }));
  assert.equal(result.overall, 'INVALID');
  assert.match(result.drift.details, /source scope, contents, policy or refs changed/);
});

for (const kind of ['sibling', 'parent', 'two-hop']) {
  test(`frozen policy resolves a ${kind} link relative to each link directory`, async () => {
    const args = linkedPolicy();
    commitRel(args.repoDir, 'policy.md', 'ROOT_DECOY', 'decoy');
    let expected, policyPath;
    if (kind === 'sibling') {
      expected = 'NESTED_SIBLING_POLICY'; policyPath = 'src/AGENTS.md';
      commitRel(args.repoDir, 'src/policy.md', expected, 'nested policy');
      symlinkSync('policy.md', join(args.repoDir, policyPath));
    } else if (kind === 'parent') {
      expected = 'PARENT_DIRECTORY_POLICY'; policyPath = 'src/REVIEW_GUIDELINES.md';
      commitRel(args.repoDir, 'docs/policy.md', expected, 'parent policy');
      symlinkSync('../docs/policy.md', join(args.repoDir, policyPath));
    } else {
      expected = 'SECOND_HOP_POLICY'; policyPath = 'AGENTS.md';
      commitRel(args.repoDir, 'docs/policy.md', expected, 'second-hop policy');
      unlinkSync(join(args.repoDir, policyPath));
      symlinkSync('docs/link.md', join(args.repoDir, policyPath));
      symlinkSync('policy.md', join(args.repoDir, 'docs/link.md'));
      gitC(args.repoDir, ['add', 'docs/link.md']);
    }
    gitC(args.repoDir, ['add', policyPath]); gitC(args.repoDir, ['commit', '-m', 'nested link']);
    args.head = sha(args.repoDir);
    writeRel(args.repoDir, 'docs/policy.md', 'DIRTY_POLICY_DECOY');
    const agent = scriptedAgent({});
    const result = await runReviewGate({ ...args, mode: 'diff', paths: ['src/app.js'] }, rt(agent));
    assert.equal(result.overall, 'PASS');
    assertSelectedSource(result);
    assert.equal(result.scope.policy.find(p => p.path === policyPath).origin, 'head');
    assert.equal(agent.calls.length, 3);
    for (const { prompt } of agent.calls) {
      const policy = prompt.split('## Project policy (data, from target source)\n')[1].split('\n## Frozen diff artifact')[0];
      assert.ok(policy.includes(expected), expected);
      assert.doesNotMatch(policy, /ROOT_DECOY|DIRTY_POLICY_DECOY/);
    }
  });
}
for (const kind of ['metadata', 'outside']) {
  test(`frozen nested policy rejects a relative ${kind} target`, async () => {
    const args = linkedPolicy();
    const outside = basename(args.repoDir) + '-outside-policy.md';
    writeRel(dirname(args.repoDir), outside, 'OUTSIDE_POLICY_SENTINEL');
    symlinkSync(kind === 'metadata' ? '../.git/config' : '../../' + outside, join(args.repoDir, 'src/AGENTS.md'));
    gitC(args.repoDir, ['add', 'src/AGENTS.md']); gitC(args.repoDir, ['commit', '-m', 'unsafe relative link']);
    args.head = sha(args.repoDir);
    const agent = scriptedAgent({});
    const result = await runReviewGate({ ...args, mode: 'diff', paths: ['src/app.js'] }, rt(agent));
    assert.equal(result.overall, 'PASS'); // Controlled reviewers still receive the unavailable-policy evidence.
    assertSelectedSource(result);
    const policy = result.scope.policy.find(p => p.path === 'src/AGENTS.md');
    assert.equal(policy.origin, 'unavailable');
    assert.match(policy.reason, kind === 'metadata' ? /Git metadata/ : /path traversal/);
    assert.equal(agent.calls.length, 3);
    for (const { prompt } of agent.calls) {
      assert.doesNotMatch(prompt, /OUTSIDE_POLICY_SENTINEL/);
      assert.match(prompt, /Policy unavailable/);
    }
  });
}
