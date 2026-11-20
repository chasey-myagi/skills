function lines(xs) {
  return xs.length ? xs.map((x) => `- ${x}`).join("\n") : "(none)";
}

function dump(obj) {
  return "```json\n" + JSON.stringify(obj, null, 2) + "\n```";
}

export function renderHandoff(result) {
  const scope = result.scope || {};
  const blockers = (result.findings || []).filter((f) => f.blocking);
  const tiers = result.scope?.codingStyle?.tiers || {};
  const advisory = [];
  const styleAdvisory = [];
  for (const finding of (result.findings || []).filter((f) => !f.blocking)) {
    const rule = (finding.sources || []).map((s) => s.rule).find((id) => id && tiers[id] === "advisory");
    if (rule) styleAdvisory.push({ finding, rule });
    else advisory.push(finding);
  }
  const callouts = result.humanCallouts || [];
  const ver = result.verification || {};
  const sections = [];

  sections.push("# Review-gate handoff");
  sections.push("## Scope");
  sections.push(`- mode: ${scope.mode}`);
  sections.push(`- sourceRoot: ${scope.sourceRoot || scope.repoDir}`);
  sections.push(`- base: ${scope.base || "(none)"}`);
  sections.push(`- head: ${scope.head || "(none)"}`);
  sections.push(`- mergeBase: ${scope.mergeBase || "(none)"}`);
  sections.push(`- paths: ${(scope.paths || []).join(", ") || "(none)"}`);
  sections.push(`- snapshotDir: ${scope.snapshotDir || ""}`);
  sections.push(`- manifestPath: ${scope.manifestPath || ""}`);
  sections.push(`- manifestHash: ${scope.manifestHash || ""}`);

  sections.push("## Constraints");
  sections.push(result.constraints || "(none)");

  sections.push("## Execution");
  sections.push(`- executionStatus: ${result.executionStatus}`);
  sections.push(`- overall: ${result.overall}`);
  sections.push(`- passed: ${result.passed}`);
  sections.push(`- passCount: ${result.passCount}/${result.total}`);
  sections.push(`- drift: ${result.drift?.detected ? result.drift.details : "none"}`);
  if (result.error) sections.push(`- error: ${result.error}`);
  if (Object.values(result.diagnostics || {}).some(values => values.length)) sections.push(dump(result.diagnostics));

  sections.push("## Blockers");
  sections.push(blockers.length
    ? blockers.map((f) => {
      const src = (f.sources || []).map((s) => `${s.gate}/${s.id}`).join(", ");
      const rules = [...new Set((f.sources || []).map((s) => s.rule).filter(Boolean))];
      const ruleSuffix = rules.length ? ` rule=${rules.join(",")}` : "";
      return `- ${f.id} [${src}] ${f.priority} ${f.category} ${f.path}${f.line != null ? ":" + f.line : ""} — ${f.title}${ruleSuffix}\n  trigger: ${f.trigger}\n  expected: ${f.expected}\n  actual: ${f.actual}\n  evidence: ${f.evidence}`;
    }).join("\n")
    : "(none)");

  sections.push("## Gate-level blocking reasons");
  sections.push(lines((result.gateBlockingReasons || []).flatMap(g => g.reasons.map(reason => `${g.gate}: ${reason}`))));

  sections.push("## Advisory findings");
  sections.push(advisory.length
    ? advisory.map((f) => `- ${f.id} ${f.title} (${f.path})`).join("\n")
    : "(none)");

  if (styleAdvisory.length) {
    const groups = new Map();
    for (const item of styleAdvisory) {
      if (!groups.has(item.rule)) groups.set(item.rule, []);
      groups.get(item.rule).push(item.finding);
    }
    const body = [...groups].map(([rule, findings]) => {
      const rows = findings.map((f) => `- ${f.id} ${f.title} (${f.path})`).join("\n");
      return `### ${rule} (${findings.length})\n${rows}`;
    }).join("\n\n");
    sections.push("## Optional improvements (coding style)");
    sections.push(body);
  }
  const suppressed = result.scope?.codingStyle?.suppressed || [];
  if (suppressed.length) {
    sections.push("## Lint already covers");
    sections.push(suppressed.map((rule) => `- ${rule.id} (${rule.enforcedBy.join(", ")})`).join("\n"));
  }

  sections.push("## Human callouts");
  sections.push(callouts.length
    ? callouts.map((c) => `- ${c.id} ${c.kind}: ${c.summary} @ ${(c.locations || []).join(", ")}`).join("\n")
    : "(none)");

  sections.push("## Verification");
  sections.push(`- enabled: ${ver.enabled} ran: ${ver.ran} skipped: ${ver.skipped}`);
  if (ver.sourceDelta?.detected) sections.push(`- sourceDelta: ${ver.sourceDelta.details}`);
  if (ver.skipReason) sections.push(`- skipReason: ${ver.skipReason}`);
  if (ver.parentReproPath) sections.push(`- parentReproPath: ${ver.parentReproPath}`);
  const vf = ver.findings || [];
  sections.push(vf.length
    ? vf.map((f) => `- ${f.id} claimed=${f.claimed} accepted=${f.accepted} officialStatus=${f.officialStatus} acceptance=${f.acceptance} worktree=${f.worktree || ""} buildDir=${f.buildDir || ""} proofValid=${f.proof?.valid}`).join("\n")
    : "(none)");

  for (const finding of vf) {
    if (finding.raw) sections.push(`### Repro ${finding.id} candidate evidence`, dump(finding.raw));
  }

  sections.push("## Fix queue");
  sections.push(lines((result.fixQueue || []).map((f) => `${f.id} ${f.title}`)));

  sections.push("## Pending human decisions");
  sections.push(lines((result.pendingHumanDecisions || []).map((p) => `${p.id || p.gate || ""} ${p.reason} ${p.title || ""}`.trim())));

  sections.push("## Unrun checks");
  sections.push(lines(result.unrunChecks || []));

  sections.push("## Invalid reports requiring correction or rerun");
  sections.push(lines((result.reviews || []).filter(r => r && !r.semanticOk).map(r => `${r.gate}: ${r.summary}; see the original report below`)));

  sections.push("## Original gate reports");
  for (const r of (result.reviews || []).filter(Boolean)) {
    sections.push(`### ${r.gate} (${r.verdict})`);
    sections.push(dump(r.raw));
  }

  return sections.join("\n\n") + "\n";
}
