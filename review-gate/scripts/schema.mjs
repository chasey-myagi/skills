import { createHash } from "node:crypto";

export const SCHEMA_VERSION = 1;
export const GATE_NAMES = ["code-review", "test-review", "linus-review"];

export const META = {
  name: "review-gate",
  description:
    "3-gate review: code-review / test-review / linus-review with structured findings, human callouts, and optional repro. Args: { repoDir, mode, base, head, paths, context, constraints, repro, reproCap, runDir, benchmarkHarness }.",
  phases: [
    { title: "Review", detail: "3 independent gates with inlined sibling rubrics" },
    { title: "Verify", detail: "conditional red-light repro of falsifiable blocking findings" },
  ],
};

export const CATEGORIES = [
  "correctness",
  "error-handling",
  "data-loss",
  "security",
  "performance",
  "test-gap",
  "architecture",
  "maintainability",
  "style",
  "requirements",
];
export const PRIORITIES = ["P0", "P1", "P2", "P3"];
export const CALLOUT_KINDS = [
  "migration",
  "dependency",
  "auth",
  "public-contract",
  "destructive",
  "feature-flag",
  "config-default",
];
export const BEHAVIORAL = new Set(["correctness", "error-handling", "data-loss", "security", "performance"]);

export const CODE_WEIGHTS = {
  Correctness: 0.25,
  Security: 0.15,
  Architecture: 0.2,
  "Error Handling": 0.15,
  Maintainability: 0.15,
  "Requirements Fit": 0.1,
};
export const TEST_WEIGHTS = {
  "Quantity Adequacy": 0.15,
  "Scenario Coverage": 0.2,
  "Boundary Exploration": 0.2,
  "Error Path Coverage": 0.15,
  "State Combination": 0.15,
  "Test Quality": 0.15,
};
export const CODE_THRESH = { perDim: 7.0, final: 7.5 };
export const TEST_THRESH = { perDim: 7.5, final: 8.0 };
export const LINUS_PASS = new Set(["Looks reasonable.", "Applied."]);
export const LINUS_FAIL = new Set(["Revert this.", "Please fix and resend.", "Close, but no cigar."]);

const SCORE_ITEM = {
  type: "object",
  required: ["dimension"],
  properties: {
    dimension: { type: "string" },
    score: { type: "number" },
    na: { type: "boolean" },
    unknown: { type: "boolean" },
    weight: { type: "number" },
    weighted: { type: "number" },
    reason: { type: "string" },
  },
};

const FINDING_ITEM = {
  type: "object",
  required: [
    "id", "priority", "category", "blocking", "title",
    "path", "evidence", "trigger", "expected", "actual", "suggestedFix",
  ],
  properties: {
    id: { type: "string" },
    priority: { type: "string", enum: PRIORITIES },
    category: { type: "string", enum: CATEGORIES },
    blocking: { type: "boolean" },
    title: { type: "string" },
    path: { type: "string" },
    line: { type: "integer" },
    evidence: { type: "string" },
    trigger: { type: "string" },
    expected: { type: "string" },
    actual: { type: "string" },
    suggestedFix: { type: "string" },
  },
};

const CALLOUT_ITEM = {
  type: "object",
  required: ["kind", "summary", "locations"],
  properties: {
    kind: { type: "string", enum: CALLOUT_KINDS },
    summary: { type: "string" },
    locations: { type: "array", items: { type: "string" } },
  },
};

export const GATE_SCHEMA = {
  type: "object",
  required: ["gate", "verdict", "summary", "findings", "humanCallouts", "assessment"],
  properties: {
    gate: { type: "string", enum: GATE_NAMES },
    verdict: { type: "string", enum: ["PASS", "FAIL", "INCONCLUSIVE"] },
    summary: { type: "string" },
    findings: { type: "array", items: FINDING_ITEM },
    humanCallouts: { type: "array", items: CALLOUT_ITEM },
    assessment: {
      type: "object",
      required: ["blockingReasons"],
      properties: {
        scores: { type: "array", items: SCORE_ITEM },
        finalScore: { anyOf: [{ type: "number" }, { type: "null" }] },
        e2eBonus: { type: "number" },
        rating: { type: "string", enum: [...LINUS_PASS, ...LINUS_FAIL] },
        naDimensions: { type: "array", items: { type: "string" } },
        blockingReasons: { type: "array", items: { type: "string" } },
      },
    },
    report: { type: "string" },
  },
};

const RUN_RECORD = {
  type: "object", required: ["cmd", "output", "exitCode"],
  properties: { cmd: { type: "string" }, output: { type: "string" }, exitCode: { type: "integer" } },
};
export const REPRO_SCHEMA = {
  type: "object", required: ["id", "verdict", "summary"],
  properties: {
    id: { type: "string" },
    verdict: { type: "string", enum: ["CONFIRMED", "REFUTED", "NOT_TESTABLE", "BLOCKED"] },
    summary: { type: "string" },
    predicted: { type: "string" }, observed: { type: "string" }, assertionMapping: { type: "string" }, scope: { type: "string" },
    oracle: { type: "object", properties: { source: { type: "string" }, statement: { type: "string" } } },
    evidence: { type: "object", properties: {
      testPath: { type: "string" }, testContent: { type: "string" }, testHash: { type: "string" },
      commands: { type: "array", items: RUN_RECORD }, redRuns: { type: "array", items: RUN_RECORD },
      controlRuns: { type: "array", items: RUN_RECORD }, greenRuns: { type: "array", items: RUN_RECORD },
      redabilityProof: { type: "object", properties: { flippedRed: RUN_RECORD, restoredGreen: RUN_RECORD } },
    } },
    notTestableReason: { type: "string", enum: ["non-behavioral", "env-bound", "nondeterministic", "cost-prohibitive", "needs-code-change"] },
  },
};

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

export function collapseHoriz(s) {
  return String(s ?? "").replace(/[ \t]+/g, " ").replace(/^[ \t]+|[ \t]+$/g, "");
}

export function nonempty(s) {
  return typeof s === "string" && s.trim().length > 0;
}

export function validateSchema(schema, value, path = "$") {
  const errors = [];
  if (!schema || typeof schema !== "object") return errors;
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${path}: not in enum [${schema.enum.join(", ")}]`);
  }
  const t = schema.type;
  if (t) {
    const ok =
      (t === "object" && value !== null && typeof value === "object" && !Array.isArray(value)) ||
      (t === "array" && Array.isArray(value)) ||
      (t === "string" && typeof value === "string") ||
      (t === "number" && Number.isFinite(value)) ||
      (t === "integer" && Number.isInteger(value)) ||
      (t === "boolean" && typeof value === "boolean") ||
      (t === "null" && value === null);
    if (!ok) {
      errors.push(`${path}: expected ${t}, got ${Array.isArray(value) ? "array" : value === null ? "null" : typeof value}`);
      return errors;
    }
  }
  if (t === "object" || (schema.properties && typeof value === "object" && value)) {
    for (const req of schema.required || []) {
      if (!(req in value)) errors.push(`${path}: missing required "${req}"`);
    }
    for (const [k, sub] of Object.entries(schema.properties || {})) {
      if (k in value) errors.push(...validateSchema(sub, value[k], `${path}.${k}`));
    }
  }
  if (t === "array" && schema.items) {
    value.forEach((v, i) => errors.push(...validateSchema(schema.items, v, `${path}[${i}]`)));
  }
  return errors;
}

function dimCanon(name, gate) {
  const key = String(name || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  const table = gate === "test-review" ? TEST_WEIGHTS : CODE_WEIGHTS;
  for (const k of Object.keys(table)) {
    if (k.toLowerCase() === key) return k;
  }
  const aliases = {
    requirements: "Requirements Fit",
    "requirements fit": "Requirements Fit",
    "error handling": "Error Handling",
    "error path coverage": "Error Path Coverage",
    "quantity adequacy": "Quantity Adequacy",
    "scenario coverage": "Scenario Coverage",
    "boundary exploration": "Boundary Exploration",
    "state combination": "State Combination",
    "test quality": "Test Quality",
  };
  return aliases[key] || name;
}

function scoreIssues(gate, report) {
  if (gate === "linus-review") return [];
  const errors = [];
  const scores = report.assessment?.scores || [];
  const weights = gate === "test-review" ? TEST_WEIGHTS : CODE_WEIGHTS;
  const seen = new Set();
  const scored = [];
  let unknown = false;
  for (const item of scores) {
    const name = dimCanon(item.dimension, gate);
    if (!(name in weights) || seen.has(name)) errors.push(`unknown or duplicate dimension ${name}`);
    seen.add(name);
    const states = Number(item.na === true) + Number(item.unknown === true) + Number(item.score !== undefined);
    if (states !== 1) errors.push(`${name} requires exactly one of score, N/A or UNKNOWN`);
    if (item.na || item.unknown) {
      if (!nonempty(item.reason)) errors.push(`${name} missing reason`);
      unknown ||= item.unknown === true;
    } else if (!Number.isFinite(item.score) || item.score < 0 || item.score > 10) {
      errors.push(`${name} score must be finite and between 0 and 10`);
    } else {
      scored.push({ ...item, dimension: name });
    }
    if (item.weight !== undefined && Math.abs(item.weight - weights[name]) > 0.0001) {
      errors.push(`${name} weight contradicts rubric`);
    }
  }
  const missing = Object.keys(weights).filter(name => !seen.has(name));
  if (missing.length) errors.push(`missing dimensions: ${missing.join(", ")}`);
  const final = report.assessment?.finalScore;
  const bonus = report.assessment?.e2eBonus ?? 0;
  if (gate === "test-review" ? ![-0.5, 0, 0.5].includes(bonus) : bonus !== 0) {
    errors.push("E2E bonus contradicts rubric");
  }
  const incomplete = unknown || scored.length === 0 || missing.length > 0;
  if (incomplete) {
    if (final !== null) errors.push("UNKNOWN or all N/A requires null finalScore");
    if (report.verdict === "PASS") errors.push("incomplete assessment cannot PASS");
  } else {
    if (!Number.isFinite(final)) errors.push("finalScore must be a finite number");
    const totalWeight = scored.reduce((sum, item) => sum + weights[item.dimension], 0);
    const calculated = scored.reduce((sum, item) => sum + item.score * weights[item.dimension], 0) / totalWeight + bonus;
    if (Number.isFinite(final) && Math.abs(final - calculated) > 0.051) {
      errors.push(`finalScore ${final} contradicts weighted scores (~${calculated.toFixed(3)})`);
    }
    for (const item of scored) {
      const weighted = item.score * weights[item.dimension] / totalWeight;
      if (item.weighted !== undefined && Math.abs(item.weighted - weighted) > 0.051) {
        errors.push(`${item.dimension} weighted contribution contradicts rubric`);
      }
    }
  }
  if (report.verdict === "PASS") {
    const threshold = gate === "test-review" ? TEST_THRESH : CODE_THRESH;
    if (scored.some(item => item.score < threshold.perDim)) errors.push("applicable dimension below threshold");
    if (final < threshold.final) errors.push("finalScore below threshold");
  }
  return errors;
}

export function normalizeFinding(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["finding is not an object"], finding: null };
  if (!nonempty(raw.path)) errors.push("finding.path empty");
  if (!nonempty(raw.evidence)) errors.push("finding.evidence empty");
  if (!nonempty(raw.id)) errors.push("finding.id empty");
  if (!nonempty(raw.title)) errors.push("finding.title empty");
  if (typeof raw.blocking !== "boolean") errors.push("finding.blocking not boolean");
  if ("line" in raw && raw.line != null && (!Number.isInteger(raw.line) || raw.line < 1)) {
    errors.push("finding.line must be a positive integer");
  }
  for (const k of ["trigger", "expected", "actual", "suggestedFix"]) {
    if (typeof raw[k] !== "string") errors.push(`finding.${k} must be a string`);
  }
  if (BEHAVIORAL.has(raw.category) && ["trigger", "expected", "actual"].some(k => !nonempty(raw[k]))) {
    errors.push("behavioral finding requires trigger, expected and actual");
  }
  if (errors.length) return { ok: false, errors, finding: null };
  return {
    ok: true,
    errors: [],
    finding: {
      id: raw.id,
      priority: raw.priority,
      category: raw.category,
      blocking: raw.blocking,
      path: raw.path,
      line: Number.isInteger(raw.line) ? raw.line : undefined,
      title: raw.title,
      trigger: typeof raw.trigger === "string" ? raw.trigger : "",
      expected: typeof raw.expected === "string" ? raw.expected : "",
      actual: typeof raw.actual === "string" ? raw.actual : "",
      evidence: raw.evidence,
      suggestedFix: typeof raw.suggestedFix === "string" ? raw.suggestedFix : "",
    },
  };
}

export function normalizeCallout(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["callout is not an object"] };
  const locations = Array.isArray(raw.locations) ? raw.locations.filter((x) => nonempty(x)) : [];
  if (!nonempty(raw.kind) || !nonempty(raw.summary) || !locations.length) {
    return { ok: false, errors: ["callout requires kind, summary, and nonempty locations"] };
  }
  return {
    ok: true,
    errors: [],
    callout: { kind: raw.kind, summary: raw.summary, locations },
  };
}

export function semanticCheck(assignedGate, report) {
  const errors = [];
  if (!report || typeof report !== "object") return ["report is not an object"];
  if (report.gate !== assignedGate) errors.push(`gate identity ${report.gate} !== ${assignedGate}`);
  if (!nonempty(report.summary)) errors.push("review summary is empty");
  const verdict = report.verdict;
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const admitted = [];
  for (const f of findings) {
    const n = normalizeFinding(f);
    if (!n.ok) errors.push(...n.errors);
    else admitted.push(n.finding);
  }
  const blocking = admitted.filter((f) => f.blocking);
  const reasons = Array.isArray(report.assessment?.blockingReasons) ? report.assessment.blockingReasons.filter(nonempty) : [];
  if (verdict === "PASS") {
    if (blocking.length) errors.push("PASS with blocking findings");
    if (reasons.length) errors.push("PASS with blockingReasons");
    if (assignedGate === "linus-review") {
      const rating = report.assessment?.rating;
      if (LINUS_FAIL.has(rating)) errors.push(`PASS with FAIL rating ${rating}`);
      if (rating && !LINUS_PASS.has(rating)) errors.push(`unrecognized passing rating ${rating}`);
      if (!rating) errors.push("linus PASS missing rating");
    }
  }
  if (verdict === "FAIL" && !blocking.length && !reasons.length) {
    errors.push("FAIL with no blocking reason");
  }
  errors.push(...scoreIssues(assignedGate, report));
  return errors;
}

export function fingerprintFinding(finding, source) {
  const path = finding.path;
  const category = finding.category;
  const trigger = finding.trigger;
  const expected = finding.expected;
  const actual = finding.actual;
  const mergeable = nonempty(path) && nonempty(category) && nonempty(trigger) && nonempty(expected) && nonempty(actual);
  const payload = mergeable
    ? { path, line: finding.line, category, trigger, expected, actual }
    : { path, line: finding.line, category, title: finding.title, evidence: finding.evidence, gate: source.gate };
  return "F" + sha256(JSON.stringify(payload)).slice(0, 16);
}

export function fingerprintCallout(callout) {
  return "H" + sha256(JSON.stringify({ kind: callout.kind, summary: collapseHoriz(callout.summary) })).slice(0, 16);
}

export function aggregateFindings(reviews) {
  const byId = new Map();
  for (const review of reviews) {
    if (!review?.identityOk) continue;
    for (const f of review.findings || []) {
      const id = fingerprintFinding(f, { gate: review.gate });
      const existing = byId.get(id);
      const source = { gate: review.gate, id: f.id };
      if (existing) {
        if (!existing.sources.some((s) => s.gate === source.gate && s.id === source.id)) {
          existing.sources.push(source);
        }
        existing.blocking = existing.blocking || f.blocking;
        existing.priority = PRIORITIES[Math.min(PRIORITIES.indexOf(existing.priority), PRIORITIES.indexOf(f.priority))];
        existing.officialStatus = existing.blocking ? "blocking" : "advisory";
      } else {
        byId.set(id, {
          id,
          sources: [source],
          priority: f.priority,
          category: f.category,
          blocking: f.blocking,
          path: f.path,
          line: f.line,
          title: f.title,
          trigger: f.trigger,
          expected: f.expected,
          actual: f.actual,
          evidence: f.evidence,
          suggestedFix: f.suggestedFix,
          officialStatus: f.blocking ? "blocking" : "advisory",
        });
      }
    }
  }
  return [...byId.values()];
}

export function aggregateCallouts(reviews) {
  const byId = new Map();
  for (const review of reviews) {
    if (!review?.identityOk) continue;
    for (const c of review.humanCallouts || []) {
      const id = fingerprintCallout(c);
      const existing = byId.get(id);
      if (existing) {
        if (!existing.sources.some((s) => s.gate === review.gate)) existing.sources.push({ gate: review.gate });
        for (const loc of c.locations) {
          if (!existing.locations.includes(loc)) existing.locations.push(loc);
        }
      } else {
        byId.set(id, {
          id,
          sources: [{ gate: review.gate }],
          kind: c.kind,
          summary: c.summary,
          locations: [...c.locations],
        });
      }
    }
  }
  return [...byId.values()];
}

export function isRoutable(finding, { benchmarkHarness } = {}) {
  if (!finding?.blocking) return false;
  if (!nonempty(finding.trigger) || !nonempty(finding.expected) || !nonempty(finding.actual) || !nonempty(finding.evidence)) {
    return false;
  }
  if (finding.category === "performance") return Boolean(benchmarkHarness);
  return BEHAVIORAL.has(finding.category);
}

export function evaluateGate(assigned, raw) {
  if (raw == null) {
    return {
      gate: assigned,
      verdict: "INVALID",
      summary: "agent returned null",
      findings: [],
      humanCallouts: [],
      assessment: { blockingReasons: [] },
      identityOk: false,
      semanticOk: false,
      raw,
      schemaErrors: ["agent returned null"],
      semanticErrors: [],
    };
  }
  const schemaErrors = validateSchema(GATE_SCHEMA, raw);
  if (schemaErrors.length) {
    return {
      gate: assigned,
      verdict: "INVALID",
      summary: "schema invalid",
      findings: [],
      humanCallouts: [],
      assessment: { blockingReasons: [] },
      identityOk: raw.gate === assigned,
      semanticOk: false,
      raw,
      schemaErrors,
      semanticErrors: [],
    };
  }
  const findings = [];
  const findingErrors = [];
  for (const f of raw.findings) {
    const n = normalizeFinding(f);
    if (n.ok) findings.push(n.finding);
    else findingErrors.push(...n.errors);
  }
  const humanCallouts = [];
  for (const c of raw.humanCallouts) {
    const n = normalizeCallout(c);
    if (n.ok) humanCallouts.push(n.callout);
    else findingErrors.push(...n.errors);
  }
  const semanticErrors = [...semanticCheck(assigned, raw), ...findingErrors];
  const identityOk = raw.gate === assigned;
  const semanticOk = identityOk && semanticErrors.length === 0;
  return {
    gate: assigned,
    verdict: semanticOk ? raw.verdict : "INVALID",
    summary: raw.summary,
    findings,
    humanCallouts,
    assessment: raw.assessment,
    report: raw.report,
    identityOk,
    semanticOk,
    raw,
    schemaErrors: [],
    semanticErrors,
  };
}
