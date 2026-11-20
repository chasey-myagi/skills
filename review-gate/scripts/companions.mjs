import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./schema.mjs";

export function packageDir(moduleUrl = import.meta.url) {
  return realpathSync(resolve(dirname(fileURLToPath(moduleUrl)), ".."));
}

// Sibling skills sit next to the real review-gate directory. A symlink such as
// ~/.claude/skills/review-gate -> ../../.agents/skills/review-gate resolves to
// that real parent, not to the directory that holds the link.
export function siblingRootFrom(entryDir) {
  return dirname(realpathSync(entryDir));
}

export function defaultSkillsRoot(moduleUrl = import.meta.url) {
  return siblingRootFrom(packageDir(moduleUrl));
}

export function loadManifest(reviewGateDir) {
  const manifestPath = join(reviewGateDir, "companions.json");
  if (!existsSync(manifestPath)) {
    throw new Error("review-gate: companions.json is missing from the review-gate package");
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    throw new Error(`review-gate: companions.json is not valid JSON: ${err.message}`);
  }
  if (!manifest || !Array.isArray(manifest.required) || manifest.required.length === 0) {
    throw new Error("review-gate: companions.json has no required files");
  }
  return manifest;
}

export function loadCompanionSet({ reviewGateDir, skillsRoot }) {
  const manifest = loadManifest(reviewGateDir);
  const root = realpathSync(skillsRoot);
  const missing = [];
  const files = [];
  for (const rel of manifest.required) {
    if (typeof rel !== "string" || !rel || rel.startsWith("/") || rel.includes("\\") || rel.split("/").includes("..")) {
      throw new Error(`review-gate: companion path is not a relative file: ${rel}`);
    }
    const abs = join(root, rel);
    if (!existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    const bytes = readFileSync(abs);
    files.push({ path: rel, bytes, hash: sha256(bytes), text: bytes.toString("utf8") });
  }
  if (missing.length) {
    throw new Error(`review-gate: missing companion files: ${missing.join(", ")}`);
  }
  return { manifest, root, files };
}

export function freezeKit(runDir, files) {
  for (const file of files) {
    const dest = join(runDir, "meta", "kit", file.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, file.bytes);
  }
  return { files: files.map(({ path, hash }) => ({ path, hash })) };
}
