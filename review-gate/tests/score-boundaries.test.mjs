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
