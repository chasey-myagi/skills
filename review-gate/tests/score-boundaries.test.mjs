import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGate } from '../scripts/schema.mjs';
import { gateReport, scoresFor } from './helpers.mjs';

function scored(gate, values, bonus = 0) {
  const scores = scoresFor(gate).map((s, i) => ({ ...s, score: values[i], weighted: values[i] * s.weight }));
  return gateReport(gate, { assessment: { scores, finalScore: scores.reduce((n, s) => n + s.weighted, 0) + bonus,
    ...(gate === 'test-review' ? { e2eBonus: bonus } : {}) } });
}
// Fixed contract expectations remain independent of production threshold constants.
for (const [gate, dim, final] of [['code-review', 7, 7.5], ['test-review', 7.5, 8]]) {
  for (const [label, values, errors] of [
    ['dimension below', [dim - 0.01, 9, 9, 9, 9, 9], ['applicable dimension below threshold']],
    ['dimension exact', [dim, 9, 9, 9, 9, 9], []],
    ['final below', Array(6).fill(final - 0.01), ['finalScore below threshold']],
    ['final exact', Array(6).fill(final), []],
  ]) {
    test(`${gate} ${label} with consistent arithmetic`, () => {
      const report = scored(gate, values);
      const result = evaluateGate(gate, report);
      assert.deepEqual(result.schemaErrors, []);
      assert.deepEqual(result.semanticErrors, errors);
      assert.equal(result.semanticOk, errors.length === 0);
      assert.equal(result.verdict, errors.length ? 'INVALID' : 'PASS');
      assert.deepEqual(result.raw, report);
    });
  }
}
for (const bonus of [-0.5, 0, 0.5, 0.25]) {
  test(`test-review bonus ${bonus} obeys fixed rubric and arithmetic`, () => {
    const report = scored('test-review', Array(6).fill(9), bonus);
    const result = evaluateGate('test-review', report);
    assert.deepEqual(result.semanticErrors, bonus === 0.25 ? ['E2E bonus contradicts rubric'] : []);
  });
}
for (const rating of ['Revert this.', undefined]) {
  test(`Linus PASS rejects ${rating ?? 'missing rating'} through semantic validation`, () => {
    const report = gateReport('linus-review');
    if (rating) report.assessment.rating = rating;
    else delete report.assessment.rating;
    const result = evaluateGate('linus-review', report);
    assert.deepEqual(result.schemaErrors, []);
    assert.equal(result.semanticOk, false);
    assert.equal(result.verdict, 'INVALID');
    assert.match(result.semanticErrors.join('\n'), /rating/i);
  });
}

function notApplicable() {
  const r = gateReport('code-review');
  r.assessment.scores[1] = { dimension: 'Security', na: true, reason: 'no changed security behavior' };
  for (const s of r.assessment.scores.filter(s => !s.na)) s.weighted = s.score * s.weight / 0.85;
  return r;
}
function incomplete() {
  const r = gateReport('code-review', { verdict: 'INCONCLUSIVE', assessment: { finalScore: null } });
  r.assessment.scores[1] = { dimension: 'Security', unknown: true, reason: 'necessary threat model unavailable' };
  return r;
}
for (const [name, base, mutate, errors] of [
  ['N/A needs reason', notApplicable, r => delete r.assessment.scores[1].reason, ['Security missing reason']],
  ['UNKNOWN needs reason', incomplete, r => delete r.assessment.scores[1].reason, ['Security missing reason']],
  ['score and N/A are exclusive', notApplicable, r => r.assessment.scores[1].score = 9, ['Security requires exactly one of score, N/A or UNKNOWN']],
  ['rubric weight is fixed', () => gateReport('code-review'), r => r.assessment.scores[0].weight = 0.3, ['Correctness weight contradicts rubric']],
  ['weighted contribution agrees', () => gateReport('code-review'), r => r.assessment.scores[0].weighted += 0.06, ['Correctness weighted contribution contradicts rubric']],
  ['code has no E2E bonus', () => gateReport('code-review'), r => { r.assessment.e2eBonus = 0.5; r.assessment.finalScore = 9.5; }, ['E2E bonus contradicts rubric']],
  ['duplicate dimension rejected', () => gateReport('code-review'), r => {
    r.assessment.scores.push({ ...r.assessment.scores[0] });
    for (const s of r.assessment.scores) s.weighted = s.score * s.weight / 1.25;
  }, ['unknown or duplicate dimension Correctness']],
]) {
  test(name, () => {
    const report = base();
    assert.equal(evaluateGate('code-review', report).semanticOk, true, 'control packet must be valid');
    mutate(report);
    const result = evaluateGate('code-review', report);
    assert.deepEqual(result.schemaErrors, []);
    assert.deepEqual(result.semanticErrors, errors);
    assert.equal(result.verdict, 'INVALID');
  });
}
for (const delta of [0.05, 0.06]) {
  test(`reported final score arithmetic tolerance: ${delta}`, () => {
    const report = gateReport('code-review');
    report.assessment.finalScore += delta;
    const result = evaluateGate('code-review', report);
    assert.equal(result.semanticOk, delta === 0.05);
    if (delta === 0.06) assert.deepEqual(result.semanticErrors, ['finalScore 9.06 contradicts weighted scores (~9.000)']);
    else assert.deepEqual(result.semanticErrors, []);
  });
}
for (const [gate, values, rounded] of [
  ['code-review', [7.4, 7.5, 7.4, 7.5, 7.5, 7.5], 7.5],
  ['test-review', [7.7, 8, 8, 8, 8, 8], 8],
]) {
  test(`${gate} rounding cannot promote a below-threshold calculated score`, () => {
    const report = scored(gate, values);
    report.assessment.finalScore = rounded;
    const result = evaluateGate(gate, report);
    assert.deepEqual(result.semanticErrors, ['finalScore below threshold']);
    assert.equal(result.verdict, 'INVALID');
    assert.equal(result.raw.assessment.finalScore, rounded);
  });
}
