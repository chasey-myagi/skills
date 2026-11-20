import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CODE_THRESH,
  CODE_WEIGHTS,
  DIM_ALIASES,
  LINUS_FAIL,
  LINUS_PASS,
  TEST_THRESH,
  TEST_WEIGHTS,
} from "../scripts/schema.mjs";
import { CODE_DIMS, CODE_WEIGHTS as HELPER_CODE, TEST_DIMS, TEST_WEIGHTS as HELPER_TEST } from "./helpers.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const repo = dirname(ROOT);

function read(rel) {
  return readFileSync(join(repo, rel), "utf8");
}

function parseWeightTable(md) {
  const rows = [];
  for (const line of md.split("\n")) {
    const match = line.match(/^\|\s*([A-Za-z][A-Za-z ]*?)\s*\|\s*X\.X\s*\|\s*(\d+(?:\.\d+)?)%\s*\|/);
    if (!match) continue;
    rows.push([match[1].trim(), Number(match[2]) / 100]);
  }
  return Object.fromEntries(rows);
}

function parseThreshold(md) {
  const match = md.match(/every \*\*applicable\*\* dimension ≥ ([\d.]+) AND final score ≥ ([\d.]+)/);
  assert.ok(match, "rubric is missing the pass-criteria line");
  return { perDim: Number(match[1]), final: Number(match[2]) };
}

function parseRatings(md) {
  const section = md.split("## 评级标准")[1]?.split(/\n## /)[0];
  assert.ok(section, "linus rubric is missing the rating section");
  return [...section.matchAll(/\*\*"([^"]+)"\*\*/g)].map((match) => match[1]);
}

test("code and test weight tables match schema.mjs and helpers.mjs", () => {
  const code = parseWeightTable(read("code-review/code-reviewer.md"));
  const test = parseWeightTable(read("test-review/test-reviewer.md"));
  assert.deepEqual(code, CODE_WEIGHTS);
  assert.deepEqual(code, HELPER_CODE);
  assert.deepEqual(Object.keys(code), CODE_DIMS);
  assert.deepEqual(test, TEST_WEIGHTS);
  assert.deepEqual(test, HELPER_TEST);
  assert.deepEqual(Object.keys(test), TEST_DIMS);
  assert.ok(Math.abs(Object.values(code).reduce((sum, n) => sum + n, 0) - 1) < 1e-9);
  assert.ok(Math.abs(Object.values(test).reduce((sum, n) => sum + n, 0) - 1) < 1e-9);
});

test("pass thresholds match the rubric sentences and nowhere else in the skill entry", () => {
  assert.deepEqual(parseThreshold(read("code-review/code-reviewer.md")), CODE_THRESH);
  assert.deepEqual(parseThreshold(read("test-review/test-reviewer.md")), TEST_THRESH);
  assert.equal(read("code-review/SKILL.md").includes("7.0"), false);
  assert.equal(read("code-review/SKILL.md").includes("7.5"), false);
  assert.equal(read("test-review/SKILL.md").includes("7.5"), false);
  assert.equal(read("test-review/SKILL.md").includes("8.0"), false);
});

test("linus ratings and dimension aliases stay locked to the rubric", () => {
  const ratings = parseRatings(read("linus-review/linus-reviewer.md"));
  assert.deepEqual(new Set(ratings), new Set([...LINUS_PASS, ...LINUS_FAIL]));
  assert.equal(ratings.length, LINUS_PASS.size + LINUS_FAIL.size);
  const names = new Set([...Object.keys(CODE_WEIGHTS), ...Object.keys(TEST_WEIGHTS)]);
  for (const [alias, canonical] of Object.entries(DIM_ALIASES)) {
    assert.equal(alias, alias.toLowerCase());
    assert.ok(names.has(canonical), `${alias} -> ${canonical}`);
  }
});
