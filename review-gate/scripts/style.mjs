import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GATE_NAMES, sha256 } from "./schema.mjs";

const LANGUAGES = ["python", "typescript", "go", "rust"];

export function parseCodingStyle(value) {
  if (value === undefined || value === "auto") return { mode: "auto", profile: "full", languages: null };
  if (value === "off") return { mode: "off", profile: "full", languages: null };
  if (value === "brief") return { mode: "auto", profile: "brief", languages: null };
  const ok = Array.isArray(value) && value.length > 0 && value.every((lang) => LANGUAGES.includes(lang));
  if (!ok) {
    throw new Error(`review-gate: codingStyle must be "auto", "off", "brief", or a non-empty list of ${LANGUAGES.join(", ")}`);
  }
  return { mode: "explicit", profile: "full", languages: [...new Set(value)] };
}

export function styleIsRequired(selection) {
  if (selection.mode === "off") return false;
  if (selection.mode === "explicit") return true;
  return selection.profile === "brief";
}

function readCapped(path) {
  try {
    const buf = readFileSync(path);
    if (buf.length > 256 * 1024 || buf.includes(0)) return "";
    return buf.toString("utf8");
  } catch {
    return "";
  }
}

function globToRegExp(glob) {
  const body = glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*");
  return new RegExp(`(?:^|/)${body}$`);
}

function matchLanguage(file, routing) {
  for (const [lang, spec] of Object.entries(routing)) {
    if ((spec.ext || []).some((ext) => file.path.endsWith(ext))) return lang;
  }
  const line = String(file.text || "").split("\n", 1)[0];
  if (!line.startsWith("#!")) return null;
  for (const [lang, spec] of Object.entries(routing)) {
    for (const token of spec.shebang || []) {
      if (new RegExp(`\\b${token}(?:\\d+(?:\\.\\d+)*)?\\b`).test(line)) return lang;
    }
  }
  return null;
}

function scriptKind(path) {
  return /\.(ts|tsx|mts|cts)$/.test(path) ? "ts" : "js";
}

export function routeFiles(fileContents, registry) {
  const routing = registry.routing || {};
  const generatedSpec = registry.generated || {};
  const globs = (generatedSpec.globs || []).map(globToRegExp);
  const goHeader = new RegExp(generatedSpec.goHeader || "^// Code generated .* DO NOT EDIT\\.$");
  const found = new Set();
  const generated = [];
  let sawTypeScript = false;
  for (const file of fileContents || []) {
    if (file.status === "deleted" || file.hash === "deleted") continue;
    const lang = matchLanguage(file, routing);
    const first = String(file.text || "").split("\n", 1)[0];
    if (globs.some((re) => re.test(file.path)) || (lang === "go" && goHeader.test(first))) generated.push(file.path);
    if (!lang) continue;
    found.add(lang);
    if (lang === "typescript" && scriptKind(file.path) === "ts") sawTypeScript = true;
  }
  return {
    found: LANGUAGES.filter((lang) => found.has(lang)),
    generated,
    sawTypeScript,
  };
}

function ruffOn(text, code) {
  if (text == null) return false;
  const ignored = [];
  for (const match of text.matchAll(/(?:extend-)?ignore\s*=\s*\[([^\]]*)\]/g)) {
    for (const tok of match[1].matchAll(/["']([A-Za-z0-9]+)["']/g)) ignored.push(tok[1]);
  }
  // Ruff prefixes: ignore = ["E"] suppresses every E* rule, same as select.
  if (ignored.some((token) => code === token || code.startsWith(token))) return false;
  if (/["']ALL["']/.test(text)) return true;
  const selected = [];
  for (const match of text.matchAll(/(?:^|\n)\s*(?:extend-)?select\s*=\s*\[([^\]]*)\]/g)) {
    for (const tok of match[1].matchAll(/["']([A-Za-z0-9]+)["']/g)) selected.push(tok[1]);
  }
  const tokens = selected.length ? selected : ["E4", "E7", "E9", "F"];
  return tokens.some((token) => code === token || (token.length < code.length && code.startsWith(token)));
}

function listed(text, name) {
  return text != null && new RegExp(`\\b${name}\\b`).test(text);
}

function goOn(text, name) {
  if (!listed(text, name)) return false;
  for (const match of text.matchAll(/disable(?:-all)?\s*[:=]\s*\[([^\]]*)\]/g)) {
    if (new RegExp(`\\b${name}\\b`).test(match[1])) return false;
  }
  return true;
}

function eslintOn(text, rule) {
  if (text == null || !text.includes(rule)) return false;
  if (new RegExp(`["']${rule}["']\\s*:\\s*["']off["']`).test(text)) return false;
  if (new RegExp(`["']${rule}["']\\s*:\\s*0\\b`).test(text)) return false;
  return true;
}

function clippyOn(text, name) {
  if (text == null || !text.includes(name)) return false;
  return !new RegExp(`${name}\\s*=\\s*["']allow["']`).test(text);
}

function toolLanguage(spec) {
  if (spec.startsWith("ruff:")) return "python";
  if (spec.startsWith("@typescript-eslint/") || spec.startsWith("eslint:")) return "typescript";
  if (spec.startsWith("clippy::")) return "rust";
  if (spec === "errcheck" || spec === "revive" || spec === "staticcheck") return "go";
  return null;
}

function lintEnabled(lints, spec) {
  if (spec.startsWith("ruff:")) return ruffOn(lints.ruff, spec.slice(5));
  if (spec.startsWith("@typescript-eslint/")) return eslintOn(lints.eslint, spec);
  if (spec.startsWith("clippy::")) return clippyOn(lints.clippy, spec.slice("clippy::".length));
  return goOn(lints.go, spec);
}

export function readLints(repo) {
  const chunks = { ruff: [], go: [], eslint: [], clippy: [] };
  const take = (bucket, path, accept) => {
    const abs = join(repo, path);
    if (!existsSync(abs)) return;
    const text = readCapped(abs);
    if (accept && !accept(text)) return;
    chunks[bucket].push(text);
  };
  take("ruff", "ruff.toml");
  take("ruff", ".ruff.toml");
  take("ruff", "pyproject.toml", (text) => text.includes("[tool.ruff"));
  take("go", ".golangci.yml");
  take("go", ".golangci.yaml");
  take("go", ".golangci.toml");
  for (const path of ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", ".eslintrc", ".eslintrc.json", ".eslintrc.js"]) {
    take("eslint", path);
  }
  take("eslint", "package.json", (text) => text.includes("eslint"));
  take("clippy", "clippy.toml");
  take("clippy", "Cargo.toml", (text) => text.includes("clippy") || text.includes("unwrap_used"));
  return {
    ruff: chunks.ruff.length ? chunks.ruff.join("\n") : null,
    go: chunks.go.length ? chunks.go.join("\n") : null,
    eslint: chunks.eslint.length ? chunks.eslint.join("\n") : null,
    clippy: chunks.clippy.length ? chunks.clippy.join("\n") : null,
  };
}

function lintCovers(rule, languages, lints) {
  if (!rule.enforcedBy?.length) return false;
  const needed = rule.langs.includes("*") ? languages : rule.langs.filter((lang) => languages.includes(lang));
  if (!needed.length) return false;
  return needed.every((lang) => {
    const specs = rule.enforcedBy.filter((spec) => toolLanguage(spec) === lang);
    return specs.length > 0 && specs.every((spec) => lintEnabled(lints, spec));
  });
}

function styleSection(languages, generated, rules, note) {
  if (!rules.length) return "";
  // The per-rule tier in the heading closes the registry -> prompt -> schema
  // chain: the reviewer sees PY-3 is hard and PY-9 is advisory, and the schema
  // then rejects a finding whose blocking/priority contradicts that tier.
  const body = rules.map((rule) => `### ${rule.id} [${rule.tier}] · ${rule.title}\n${rule.text}`).join("\n\n");
  return [
    "## Coding style reference (this gate's rules)",
    `Languages in scope: ${languages.length ? languages.join(", ") : "(common only)"}. Generated files exempt from these rules: ${generated.length ? generated.join(", ") : "(none)"}.`,
    "Target repository policy overrides these rules; when it does, cite the policy line and do not report the rule.",
    "Cite a rule in the finding's `rule` field using only the IDs below. Tiers:",
    "- hard: may block (P0–P2) under the review contract; use one of the rule's categories.",
    "- structural: block only if the selected change introduces or worsens it and the finding names the concrete cost and a simpler alternative; otherwise P2–P3 non-blocking.",
    "- advisory: P3, category `style`, never blocking; at most 3 instances per rule, count the rest in evidence.",
    "Advisory findings do not on their own lower any score dimension below its threshold.",
    note,
    "",
    body,
  ].filter((line) => line !== "").join("\n");
}

function emptyStyle(mode, missing) {
  return {
    mode,
    profile: mode === "off" ? "full" : "full",
    missing,
    languages: [],
    generated: [],
    suppressed: [],
    sections: Object.fromEntries(GATE_NAMES.map((gate) => [gate, ""])),
    catalog: [],
    allowed: Object.fromEntries(GATE_NAMES.map((gate) => [gate, []])),
    tiers: {},
    kitFiles: [],
  };
}

function catalogOf(registry, missing) {
  return (registry?.rules || []).map((rule) => ({
    id: rule.id,
    tier: rule.tier,
    gate: rule.gate,
    categories: rule.categories || [],
  }));
}

export function loadCodingStyle({ skillsRoot, repo, fileContents, selection }) {
  if (selection.mode === "off") return emptyStyle("off", false);
  const rulesPath = join(skillsRoot, "coding-style", "rules.json");
  let registry = null;
  if (existsSync(rulesPath)) {
    try {
      registry = JSON.parse(readFileSync(rulesPath, "utf8"));
    } catch (err) {
      throw new Error(`review-gate: coding-style/rules.json is not valid JSON: ${err.message}`);
    }
  }
  if (registry === null) {
    if (styleIsRequired(selection)) throw new Error("review-gate: coding-style/rules.json is missing");
    // Missing registry still carries the empty catalog so a finding that cites
    // a rule is flagged instead of slipping past every check.
    return { ...emptyStyle("auto", true), catalog: catalogOf(registry, true) };
  }
  const routed = routeFiles(fileContents, registry);
  const languages = selection.languages ? LANGUAGES.filter((lang) => selection.languages.includes(lang)) : routed.found;
  const includeTsOnly = selection.mode === "explicit" ? languages.includes("typescript") : routed.sawTypeScript;
  const brief = new Set((registry.profiles && registry.profiles.brief) || ["strong", "some"]);
  const lints = readLints(repo);
  const suppressed = [];
  const chosen = [];
  for (const rule of registry.rules || []) {
    const inLang = rule.langs.includes("*") || rule.langs.some((lang) => languages.includes(lang));
    if (!inLang) continue;
    if (rule.tsOnly && !includeTsOnly) continue;
    if (selection.profile === "brief" && !brief.has(rule.evidence)) continue;
    if (lintCovers(rule, languages, lints)) {
      suppressed.push({ id: rule.id, enforcedBy: rule.enforcedBy });
      continue;
    }
    chosen.push(rule);
  }
  const note = languages.includes("typescript") && !includeTsOnly
    ? "TypeScript-only rules are omitted because this diff has no TypeScript file."
    : "";
  const sections = {};
  const allowed = {};
  for (const gate of GATE_NAMES) {
    const slice = chosen.filter((rule) => rule.gate === gate);
    sections[gate] = styleSection(languages, routed.generated, slice, note);
    allowed[gate] = slice.map((rule) => rule.id);
  }
  const catalog = catalogOf(registry, false);
  const tiers = Object.fromEntries(catalog.map((rule) => [rule.id, rule.tier]));
  const rels = ["coding-style/rules.json"];
  for (const gate of GATE_NAMES) {
    rels.push(`coding-style/rules/${gate}/common.md`);
    for (const lang of languages) rels.push(`coding-style/rules/${gate}/${lang}.md`);
  }
  const kitFiles = rels.filter((rel) => existsSync(join(skillsRoot, rel))).map((rel) => {
    const bytes = readFileSync(join(skillsRoot, rel));
    return { path: rel, bytes, hash: sha256(bytes) };
  });
  return {
    mode: selection.mode,
    profile: selection.profile,
    missing: false,
    languages,
    generated: routed.generated,
    suppressed,
    sections,
    catalog,
    allowed,
    tiers,
    kitFiles,
  };
}
