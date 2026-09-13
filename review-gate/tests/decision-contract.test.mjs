import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateGate, sha256 } from '../scripts/schema.mjs';
import { runReviewGate } from '../scripts/core.mjs';
import { makeRepo, commitRel, writeRel, gitC, sha, freshRunDir, rt, scriptedAgent, gateReport, failReport, finding, callout, scoresFor, parseWorktree, parseFindingId } from './helpers.mjs';

function changed() {
  const repoDir = makeRepo();
  const base = commitRel(repoDir, 'src/app.js', 'before\n', 'base');
  const head = commitRel(repoDir, 'src/app.js', 'after\n', 'head');
  return { repoDir, base, head, mode: 'diff' };
}
function unknown(gate, verdict = 'INCONCLUSIVE', finalScore = null) {
  const scores = scoresFor(gate).map((s, i) => i ? s : { dimension: s.dimension, unknown: true, reason: 'required evidence absent' });
  return gateReport(gate, { verdict, assessment: { scores, finalScore } });
}
for (const [name, report, expected] of [
  ['UNKNOWN PASS', unknown('code-review', 'PASS', 9), ['UNKNOWN or all N/A requires null finalScore', 'incomplete assessment cannot PASS']],
  ['all NA numeric total', gateReport('code-review', { verdict: 'INCONCLUSIVE', assessment: { scores: scoresFor('code-review').map(s => ({ dimension: s.dimension, na: true, reason: 'not applicable' })), finalScore: 9 } }), ['UNKNOWN or all N/A requires null finalScore']],
  ['UNKNOWN FAIL numeric total', { ...unknown('test-review', 'FAIL', 9), findings: [finding()] }, ['UNKNOWN or all N/A requires null finalScore']],
  ['PASS with blocker', gateReport('code-review', { findings: [finding()] }), ['PASS with blocking findings']],
  ['INCONCLUSIVE with blocker', { ...unknown('code-review'), findings: [finding()] }, ['INCONCLUSIVE with blocking findings or reasons']],
]) {
  test(`${name} is an invalid report, never a valid code judgment`, () => {
    const result = evaluateGate(report.gate, report);
    assert.deepEqual(result.schemaErrors, []);
    assert.deepEqual(result.semanticErrors, expected);
    assert.equal(result.verdict, 'INVALID');
    assert.deepEqual(result.raw, report);
  });
}
for (const [name, mutate, path] of [
  ['string score', r => r.assessment.scores[0].score = '9', '$.assessment.scores[0].score'],
  ['unknown verdict', r => r.verdict = 'MAYBE', '$.verdict'],
  ['missing callouts', r => delete r.humanCallouts, '$: missing required "humanCallouts"'],
  ['invalid priority', r => r.findings = [finding({ priority: 'P9', blocking: false })], '$.findings[0].priority'],
  ['fractional line', r => r.findings = [finding({ line: 1.5, blocking: false })], '$.findings[0].line'],
]) {
  test(`schema rejects ${name} without misclassifying gate identity`, async () => {
    const report = gateReport('code-review'); mutate(report);
    const result = await runReviewGate(changed(), rt(scriptedAgent({ 'code-review': report })));
    assert.equal(result.overall, 'INVALID');
    assert.equal(result.diagnostics.schemaFailures.length, 1);
    assert.ok(result.diagnostics.schemaFailures[0].errors.some(e => e.includes(path)));
    assert.equal(result.diagnostics.identityFailures.length, 0);
    assert.deepEqual(result.reviews[0].raw, report);
  });
}
for (const codeBlocks of [true, false]) {
  test(`cross-gate merging takes strongest priority and blocking state (code blocks=${codeBlocks})`, async () => {
    const code = finding({ priority: codeBlocks ? 'P0' : 'P3', blocking: codeBlocks });
    const linus = finding({ id: 'L1', priority: codeBlocks ? 'P3' : 'P0', blocking: !codeBlocks });
    const report = (gate, f) => f.blocking ? failReport(gate, [f]) : gateReport(gate, { findings: [f] });
    const result = await runReviewGate(changed(), rt(scriptedAgent({ 'code-review': report('code-review', code), 'linus-review': report('linus-review', linus) })));
    assert.equal(result.findings.length, 1);
    const f = result.findings[0];
    assert.equal(f.priority, 'P0');
    assert.equal(f.blocking, true);
    assert.equal(f.officialStatus, 'blocking');
    assert.deepEqual(f.sources, [{ gate: 'code-review', id: 'C1' }, { gate: 'linus-review', id: 'L1' }]);
    assert.deepEqual(result.fixQueue.map(f => f.id), [f.id]);
  });
}
for (const mode of ['diff', 'staged-delete', 'unstaged-delete']) {
  test(`${mode} preserves a deleted file's original bytes and does not report false drift`, async () => {
    const args = changed();
    if (mode === 'diff') {
      gitC(args.repoDir, ['rm', 'src/app.js']); gitC(args.repoDir, ['commit', '-m', 'delete']); args.head = sha(args.repoDir);
    } else {
      args.mode = 'working-tree';
      if (mode === 'staged-delete') gitC(args.repoDir, ['rm', 'src/app.js']);
      else unlinkSync(join(args.repoDir, 'src/app.js'));
    }
    const result = await runReviewGate(args, rt());
    assert.deepEqual(result.scope.paths, ['src/app.js']);
    const manifest = JSON.parse(readFileSync(result.scope.manifestPath));
    assert.equal(manifest.files[0].status, 'deleted');
    assert.equal(manifest.files[0].hash, 'deleted');
    assert.equal(existsSync(join(result.scope.snapshotDir, 'src/app.js')), false);
    assert.match(readFileSync(result.artifacts.diffPath, 'utf8'), /deleted file mode/);
    if (mode !== 'diff') assert.equal(readFileSync(join(result.artifacts.runDir, 'snapshot-base/src/app.js'), 'utf8'), 'after\n');
    assert.equal(result.passed, true);
    assert.equal(result.drift.detected, false);
  });
}
for (const [name, reports, verdict] of [
  ['null plus FAIL', { 'code-review': null, 'test-review': failReport('test-review', [finding()]) }, 'INVALID'],
  ['FAIL plus INCONCLUSIVE', { 'code-review': failReport('code-review', [finding()]), 'test-review': unknown('test-review') }, 'FAIL'],
  ['PASS with a blocker', { 'code-review': gateReport('code-review', { findings: [finding()] }) }, 'INVALID'],
]) {
  test(`overall precedence: ${name}`, async () => {
    const result = await runReviewGate(changed(), rt(scriptedAgent(reports)));
    assert.equal(result.overall, verdict);
    assert.equal(result.passed, false);
    if (name === 'PASS with a blocker') {
      assert.equal(result.findings.length, 0);
      assert.equal(result.fixQueue.length, 0);
      assert.deepEqual(result.diagnostics.semanticFailures[0].errors, ['PASS with blocking findings']);
    }
  });
}
test('a modified diff artifact invalidates its frozen review', async () => {
  const result = await runReviewGate(changed(), rt(async (prompt, opts) => {
    const file = /^DIFF_PATH: (.+)$/m.exec(prompt)[1];
    writeFileSync(file, 'tampered diff');
    return gateReport(opts.label);
  }));
  assert.equal(result.overall, 'INVALID');
  assert.match(result.drift.details, /diff artifact changed/);
});
for (const paths of [['.git/config'], ['/etc/passwd'], ['a\\b']]) {
  test(`unsafe scope ${paths[0]} is rejected before dispatch`, async () => {
    const agent = scriptedAgent({});
    await assert.rejects(runReviewGate({ ...changed(), paths }, rt(agent)), /metadata|absolute path|backslash/);
    assert.equal(agent.calls.length, 0);
  });
}
test('a repository subdirectory is rejected before dispatch instead of yielding empty evidence', async () => {
  const args = changed();
  const agent = scriptedAgent({});
  await assert.rejects(runReviewGate({ ...args, repoDir: join(args.repoDir, 'src') }, rt(agent)), /repoDir must be the Git repository root/);
  assert.equal(agent.calls.length, 0);
});
test('unsupported live checkout fingerprint blocks only verification and retains frozen FAIL', async () => {
  const args = changed();
  symlinkSync('src/app.js', join(args.repoDir, 'untracked-link'));
  const agent = scriptedAgent({ 'code-review': failReport('code-review', [finding()]) });
  const result = await runReviewGate({ ...args, repro: true }, rt(agent));
  assert.equal(result.overall, 'FAIL');
  assert.equal(result.executionStatus, 'completed');
  assert.equal(result.verification.skipped, true);
  assert.match(result.verification.skipReason, /cannot fingerprint source checkout/);
  assert.equal(result.fixQueue.length, 1);
  assert.equal(agent.calls.length, 3);
});
for (const cap of [undefined, 0]) {
  test(`repro cap ${cap ?? 'default'} controls exactly the dispatched work`, async () => {
    let calls = 0;
    const findings = Array.from({ length: 4 }, (_, i) => finding({ id: `C${i}`, trigger: `foo(${i})` }));
    const result = await runReviewGate({ ...changed(), repro: true, ...(cap === undefined ? {} : { reproCap: cap }) }, rt(async (prompt, opts) => {
      if (opts.label.startsWith('repro:')) { calls++; return { id: parseFindingId(prompt), verdict: 'BLOCKED', summary: 'test fixture' }; }
      return opts.label === 'code-review' ? failReport(opts.label, findings) : gateReport(opts.label);
    }));
    assert.equal(calls, cap === undefined ? 3 : 0);
    assert.equal(result.verification.findings.filter(f => f.acceptance === 'over-cap').length, cap === undefined ? 1 : 4);
  });
}
for (const reproCap of [-1, 1.5]) {
  test(`invalid repro cap ${reproCap} is rejected before calls`, async () => {
    const agent = scriptedAgent({});
    await assert.rejects(runReviewGate({ ...changed(), reproCap }, rt(agent)), /nonnegative integer/);
    assert.equal(agent.calls.length, 0);
  });
}
function section(md, name) { return md.split(`## ${name}\n\n`)[1].split('\n\n## ')[0]; }
test('handoff separates actions, callouts, candidate proof, missing evidence and original reports', async () => {
  const args = changed();
  const blocker = finding({ title: 'blocker-title' });
  const advisory = finding({ id: 'A1', title: 'advisory-title', trigger: 'foo(-1)', blocking: false });
  const report = failReport('code-review', [blocker, advisory]);
  report.humanCallouts = [callout({ summary: 'migration-callout' })];
  const result = await runReviewGate({ ...args, repro: true, constraints: 'preserve evidence' }, rt(async (prompt, opts) => {
    if (opts.label === 'code-review') return report;
    if (opts.label === 'test-review') return unknown('test-review');
    if (!opts.label.startsWith('repro:')) return gateReport(opts.label);
    const testPath = 'tests/repro/proof.test.js', testContent = '// controlled proof packet\n';
    writeRel(parseWorktree(prompt), testPath, testContent);
    const red = { cmd: 'test-red', output: 'assertion failed', exitCode: 1 };
    const green = { cmd: 'test-green', output: 'assertion passed', exitCode: 0 };
    return { id: parseFindingId(prompt), verdict: 'REFUTED', summary: 'candidate refutation', scope: 'foo(null)', oracle: { source: 'spec:1', statement: 'null throws' }, evidence: { testPath, testContent, testHash: sha256(testContent), commands: [red, green], greenRuns: [green], redabilityProof: { flippedRed: red, restoredGreen: green } } };
  }));
  const md = readFileSync(result.artifacts.handoffMd, 'utf8');
  assert.match(section(md, 'Blockers'), /blocker-title/);
  assert.doesNotMatch(section(md, 'Blockers'), /advisory-title|migration-callout/);
  assert.match(section(md, 'Advisory findings'), /advisory-title/);
  assert.match(section(md, 'Human callouts'), /migration-callout @ db\/migrate.sql:1/);
  assert.match(section(md, 'Verification'), /acceptance=awaiting-parent/);
  assert.match(section(md, 'Verification'), /proofValid=true/);
  assert.match(section(md, 'Verification'), /"testHash":/);
  assert.match(section(md, 'Pending human decisions'), /test-review/);
  assert.match(section(md, 'Unrun checks'), /\(none\)/);
  for (const r of result.reviews) assert.ok(section(md, 'Original gate reports').includes(JSON.stringify(r.raw, null, 2)));
  assert.match(section(md, 'Constraints'), /preserve evidence/);
});

test('a gate exception is preserved once and produces INVALID with no invented blocker', async () => {
  const result = await runReviewGate(changed(), rt(async (_prompt, opts) => {
    if (opts.label === 'test-review') throw new Error('reviewer unavailable');
    return gateReport(opts.label);
  }));
  assert.equal(result.overall, 'INVALID');
  assert.equal(result.executionStatus, 'incomplete');
  assert.deepEqual(result.diagnostics.agentFailures, [{ gate: 'test-review', error: 'reviewer unavailable' }]);
  assert.deepEqual(result.diagnostics.missingGates, ['test-review']);
  assert.equal(result.findings.length, 0);
});
for (const score of [-0.01, 10.01]) {
  test(`dimension score ${score} is rejected at the rubric boundary`, () => {
    const report = gateReport('code-review');
    report.assessment.scores[0].score = score;
    const result = evaluateGate('code-review', report);
    assert.equal(result.verdict, 'INVALID');
    assert.ok(result.semanticErrors.includes('Correctness score must be finite and between 0 and 10'));
  });
}
test('conversation history is not an accepted review scope argument', async () => {
  const agent = scriptedAgent({});
  await assert.rejects(runReviewGate({ ...changed(), history: 'author narrative' }, rt(agent)), /unknown args: history/);
  assert.equal(agent.calls.length, 0);
});
test('missing evidence is rejected once, without duplicate diagnostic entries', () => {
  const report = failReport('code-review', [finding({ evidence: '' })]);
  const result = evaluateGate('code-review', report);
  assert.equal(result.verdict, 'INVALID');
  assert.equal(result.semanticErrors.length, 1);
  assert.match(result.semanticErrors[0], /evidence/);
});
