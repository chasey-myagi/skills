import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGate, fingerprintFinding } from '../scripts/schema.mjs';
import { gateReport, finding } from './helpers.mjs';

function evaluate(report) {
  return evaluateGate(report.gate, JSON.parse(JSON.stringify(report)));
}

test('a PASS cannot omit every dimension value', () => {
  const report = gateReport('code-review');
  report.assessment.scores = report.assessment.scores.map(s => ({ dimension: s.dimension }));
  assert.equal(evaluate(report).semanticOk, false);
});

test('a PASS requires a finite numerical final score', () => {
  const report = gateReport('code-review');
  report.assessment.finalScore = 'banana';
  assert.equal(evaluate(report).semanticOk, false);
});

test('a PASS requires a recognized passing Linus rating', () => {
  const report = gateReport('linus-review', { assessment: { rating: 'NAK for a serious defect' } });
  assert.equal(evaluate(report).semanticOk, false);
});

test('different string literal whitespace remains different behavior', () => {
  const a = finding({ expected: 'returns "a  b"' });
  const b = finding({ expected: 'returns "a b"' });
  assert.notEqual(fingerprintFinding(a, { gate: 'code-review' }), fingerprintFinding(b, { gate: 'code-review' }));
});

test('two spaces in a source filename are preserved in claim identity', () => {
  const a = finding({ path: 'src/a  b.js' });
  const b = finding({ path: 'src/a b.js' });
  assert.notEqual(fingerprintFinding(a, { gate: 'code-review' }), fingerprintFinding(b, { gate: 'code-review' }));
});
