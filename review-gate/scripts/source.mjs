import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { sha256 } from "./schema.mjs";

const POLICY_NAMES = ["AGENTS.md", "REVIEW_GUIDELINES.md"];

export class CaptureError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "CaptureError";
  }
}

export function git(repo, args, opts = {}) {
  const r = spawnSync("git", ["-C", repo, ...args], {
    encoding: opts.encoding ?? "buffer",
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
  });
  if (r.error) throw new CaptureError(`git ${args[0]} failed: ${r.error.message}`);
  if (r.status !== 0 && !opts.allowFail) {
    const err = (opts.encoding === "utf8" ? r.stderr : r.stderr?.toString?.()) || "";
    throw new CaptureError(`git ${args.join(" ")} failed: ${err.trim() || `exit ${r.status}`}`);
  }
  return r;
}

function splitZ(buf) {
  const s = Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf || "");
  return s.split("\0").filter((x) => x.length > 0);
}

export function assertSafeRef(ref) {
  if (typeof ref !== "string" || !ref || ref.includes("\0") || ref.startsWith("-")) {
    throw new CaptureError(`invalid ref ${JSON.stringify(ref)}`);
  }
  return ref;
}

export function assertRelPath(p) {
  if (typeof p !== "string" || !p || p.includes("\0")) {
    throw new CaptureError("invalid path");
  }
  if (p.includes("\\")) throw new CaptureError("backslash paths are unsupported; use repository-relative paths");
  const norm = p;
  if (norm.startsWith("/") || /^[a-zA-Z]:/.test(norm)) {
    throw new CaptureError(`absolute path rejected: ${p}`);
  }
  const parts = norm.split("/").filter((x) => x && x !== ".");
  if (parts.some((x) => x === "..")) throw new CaptureError(`path traversal rejected: ${p}`);
  if (parts.includes(".git")) throw new CaptureError("Git metadata is not review source");
  return parts.join("/") || ".";
}

// Resolve the nearest existing ancestor too, so directory symlinks cannot bypass boundaries.
export function physicalPath(path) {
  let ancestor = resolve(path);
  const suffix = [];
  for (;;) {
    try { lstatSync(ancestor); break; }
    catch (err) {
      if (err.code !== "ENOENT" && err.code !== "ENOTDIR") throw err;
      if (dirname(ancestor) === ancestor) throw err;
      suffix.unshift(basename(ancestor));
      ancestor = dirname(ancestor);
    }
  }
  return resolve(realpathSync(ancestor), ...suffix);
}

export function pathInsideRepo(repoRoot, absPath) {
  const root = realpathSync(repoRoot);
  const target = physicalPath(absPath);
  return target === root || target.startsWith(root + sep);
}

export function resolveInRepo(repoRoot, rel, { mustExist = false, follow = true } = {}) {
  const safe = assertRelPath(rel);
  const abs = resolve(repoRoot, safe);
  if (!pathInsideRepo(repoRoot, abs)) throw new CaptureError(`symlink/path escapes source: ${rel}`);
  if (mustExist && !existsSync(abs)) throw new CaptureError(`path not found: ${rel}`);
  if (!follow) {
    let current = repoRoot;
    for (const part of safe.split("/")) {
      current = join(current, part);
      try {
        if (lstatSync(current).isSymbolicLink()) throw new CaptureError(`symlink rejected: ${rel}`);
      } catch (err) {
        if (err.code === "ENOENT" || err.code === "ENOTDIR") break;
        throw err;
      }
    }
  }
  return { rel: safe, abs };
}

export function resolveCommit(repo, ref) {
  assertSafeRef(ref);
  try {
    const r = git(repo, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], { encoding: "utf8" });
    return r.stdout.trim();
  } catch (err) {
    throw new CaptureError(`invalid ref '${ref}': ${err.message}`, { cause: err });
  }
}

function blobAt(repo, sha, rel) {
  const entry = git(repo, ["--literal-pathspecs", "ls-tree", "-z", sha, "--", rel]).stdout.toString();
  if (!entry) return null;
  const header = entry.slice(0, entry.indexOf("\t"));
  // A file replaced by a directory has no blob at this side of the delta.
  if (header.split(" ")[1] === "tree") return null;
  if (header.split(" ")[1] !== "blob") throw new CaptureError(`unsupported non-blob source ${rel}`);
  return git(repo, ["cat-file", "blob", `${sha}:${rel}`]).stdout;
}

function indexBlob(repo, rel) {
  const entry = git(repo, ["--literal-pathspecs", "ls-files", "--stage", "-z", "--", rel]).stdout.toString();
  if (entry.startsWith("160000 ") && entry.slice(entry.indexOf("\t") + 1).split("\0")[0] === rel) {
    throw new CaptureError(`not a regular file: ${rel} (gitlink)`);
  }
  const r = git(repo, ["show", `:${rel}`], { allowFail: true });
  if (r.status !== 0) return null;
  return r.stdout;
}

function asText(buf) {
  if (buf == null) return null;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.includes(0)) return { binary: true, bytes: b };
  const text = b.toString("utf8");
  return { binary: false, bytes: b, text };
}

function fileRecord(path, buf, status) {
  const parsed = asText(buf);
  const hash = buf == null ? "deleted" : sha256(parsed.bytes);
  return {
    path,
    status,
    hash,
    binary: parsed?.binary || false,
    text: parsed?.binary ? null : parsed?.text ?? null,
    bytes: parsed?.bytes ?? null,
  };
}

function intersect(paths, filter) {
  if (!filter) return paths;
  const want = new Set(filter.map((p) => assertRelPath(p)));
  return paths.filter((p) => [...want].some(q => q === "." || p === q || p.startsWith(q + "/")));
}

function collectPolicy(repo, changed, read) {
  const dirs = new Set([""]);
  for (const p of changed) {
    const parts = p.split("/");
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      dirs.add(acc);
    }
  }
  const policy = [];
  for (const dir of [...dirs].sort()) {
    for (const name of POLICY_NAMES) {
      const rel = dir ? `${dir}/${name}` : name;
      const got = read(rel);
      if (got) policy.push({ path: rel, ...got });
    }
  }
  return policy;
}

function walkDir(repo, rel, out) {
  const { abs } = resolveInRepo(repo, rel || ".", { mustExist: true });
  const st = lstatSync(abs);
  if (st.isSymbolicLink()) throw new CaptureError(`snapshot directory traversal does not follow symlinks: ${rel}`);
  if (st.isFile()) {
    out.push(rel);
    return;
  }
  if (!st.isDirectory()) throw new CaptureError(`not a regular file or directory: ${rel}`);
  for (const name of readdirSync(abs)) {
    if (name === ".git") continue;
    const child = rel && rel !== "." ? `${rel}/${name}` : name;
    walkDir(repo, child, out);
  }
}

export function captureTarget(args, repo) {
  const mode = args.mode;
  const filter = args.paths ? args.paths.map(assertRelPath) : null;
  let baseSha = null;
  let headSha = null;
  let mergeBase = null;
  let files = [];

  if (mode === "diff") {
    baseSha = resolveCommit(repo, args.base);
    headSha = resolveCommit(repo, args.head);
    mergeBase = git(repo, ["merge-base", baseSha, headSha], { encoding: "utf8" }).stdout.trim();
    const entries = splitZ(git(repo, ["diff", "--name-status", "-M", "-z", mergeBase, headSha]).stdout);
    const selected = new Map();
    for (let i = 0; i < entries.length;) {
      const status = entries[i++];
      const first = assertRelPath(entries[i++]);
      const pair = status.startsWith("R") ? [first, assertRelPath(entries[i++])] : [first];
      // Keep both sides of a selected rename so pathspec filtering preserves its delta.
      if (!intersect(pair, filter).length) continue;
      for (const name of pair) selected.set(name, status.startsWith("R") ? "renamed" :
        ({ A: "added", D: "deleted", M: "modified", T: "type-changed" }[status] || status));
    }
    for (const [path, status] of [...selected].sort(([a], [b]) => a.localeCompare(b))) {
      files.push(fileRecord(path, blobAt(repo, headSha, path), status));
    }
  } else if (mode === "working-tree") {
    const current = git(repo, ["rev-parse", "--verify", "HEAD"], { encoding: "utf8", allowFail: true });
    headSha = current.status === 0 ? current.stdout.trim() : null;
    baseSha = headSha;
    const staged = splitZ(git(repo, ["diff", "--no-renames", "-z", "--name-only", "--cached"]).stdout).map(assertRelPath);
    const unstaged = splitZ(git(repo, ["diff", "--no-renames", "-z", "--name-only"]).stdout).map(assertRelPath);
    const untracked = splitZ(git(repo, ["ls-files", "-z", "--others", "--exclude-standard"]).stdout).map(assertRelPath);
    const all = [...new Set([...staged, ...unstaged, ...untracked])];
    const selected = intersect(all, filter);
    for (const path of selected.sort()) {
      resolveInRepo(repo, path, { follow: false });
      const abs = resolve(repo, path);
      const st = existsSync(abs) ? lstatSync(abs) : null;
      const buf = st?.isFile() ? readFileSync(abs) : null;
      const baseBytes = headSha ? blobAt(repo, headSha, path) : null;
      const indexBytes = indexBlob(repo, path);
      const replacedFile = st?.isDirectory() && (baseBytes !== null || indexBytes !== null);
      if (st && !st.isFile() && !replacedFile) throw new CaptureError(`not a regular file: ${path}`);
      const record = fileRecord(path, buf, "modified");
      record.baseBytes = baseBytes;
      record.indexBytes = indexBytes;
      record.indexHash = record.indexBytes === null ? "deleted" : sha256(record.indexBytes);
      record.status = buf === null ? "deleted" : record.baseBytes === null ? "added" : "modified";
      files.push(record);
    }
  } else if (mode === "snapshot") {
    if (!filter || !filter.length) throw new CaptureError("snapshot requires paths");
    const expanded = [];
    const gitlinks = new Set(splitZ(git(repo, ["ls-files", "--stage", "-z"]).stdout)
      .filter(entry => entry.startsWith("160000 ")).map(entry => entry.slice(entry.indexOf("\t") + 1)));
    for (const p of filter) {
      if ([...gitlinks].some(link => p === link || p.startsWith(link + "/"))) throw new CaptureError(`not a regular file: ${p} (gitlink)`);
      const { abs, rel } = resolveInRepo(repo, p, { mustExist: true, follow: false });
      const st = lstatSync(abs);
      if (st.isDirectory()) {
        // Directory scope follows Git's tracked + non-ignored working files.
        // An explicitly named ignored file remains an intentional opt-in.
        const names = splitZ(git(repo, ["--literal-pathspecs", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", rel]).stdout);
        for (const name of names) {
          if (gitlinks.has(name)) throw new CaptureError(`not a regular file: ${name} (gitlink)`);
          const checked = resolveInRepo(repo, name, { follow: false });
          if (!existsSync(checked.abs)) continue;
          if (!lstatSync(checked.abs).isFile()) throw new CaptureError(`not a regular file: ${checked.rel}`);
          expanded.push(checked.rel);
        }
      }
      else if (st.isFile()) expanded.push(rel);
      else throw new CaptureError(`not a regular file: ${rel}`);
    }
    const selected = [...new Set(expanded)].sort();
    for (const path of selected) {
      const abs = resolve(repo, path);
      const buf = readFileSync(abs);
      files.push(fileRecord(path, buf, "snapshot"));
    }
  } else {
    throw new CaptureError(`unknown mode '${mode}'`);
  }

  if (!files.length) throw new CaptureError("empty target: no files to review");

  const readPolicy = (rel) => {
    if (mode === "diff") {
      const buf = blobAt(repo, headSha, rel);
      if (!buf) return null;
      const rec = fileRecord(rel, buf, "policy");
      return { origin: "head", hash: rec.hash, text: rec.text, binary: rec.binary };
    }
    try {
      const { abs } = resolveInRepo(repo, rel, { mustExist: true, follow: false });
      const rec = fileRecord(rel, readFileSync(abs), "policy");
      return { origin: mode === "snapshot" ? "snapshot" : "worktree", hash: rec.hash, text: rec.text, binary: rec.binary };
    } catch (err) {
      if (!existsSync(resolve(repo, rel)) && /path not found/.test(err.message)) return null;
      throw err;
    }
  };
  const policy = collectPolicy(repo, files.map((f) => f.path), readPolicy);

  const manifest = {
    mode,
    repo,
    baseSha,
    headSha,
    mergeBase,
    files: files.map(({ path, hash, status, indexHash }) => ({ path, hash, status, ...(indexHash ? { indexHash } : {}) })),
    policy: policy.map(({ path, hash, origin }) => ({ path, hash, origin })),
  };
  manifest.manifestHash = sha256(JSON.stringify(manifest));
  return { ...manifest, fileContents: files, policyContents: policy, baseRef: args.base || null, headRef: args.head || null, pathFilter: filter };
}

export function writeSnapshot(runDir, captured) {
  const snap = join(runDir, "snapshot");
  mkdirSync(snap, { recursive: true });
  if (captured.mode === "working-tree") {
    mkdirSync(join(runDir, "snapshot-base"));
    mkdirSync(join(runDir, "snapshot-index"));
  }
  for (const f of captured.fileContents) {
    if (captured.mode === "working-tree") {
      for (const [dir, bytes] of [["snapshot-base", f.baseBytes], ["snapshot-index", f.indexBytes]]) {
        if (bytes === null) continue;
        const file = join(runDir, dir, f.path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, bytes);
      }
    }
    if (f.bytes == null) continue;
    const dest = join(snap, f.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, f.bytes);
  }
  const meta = join(runDir, "meta");
  mkdirSync(meta, { recursive: true });
  const manifestPath = join(meta, "manifest.json");
  const publicManifest = {
    mode: captured.mode,
    baseSha: captured.baseSha,
    headSha: captured.headSha,
    mergeBase: captured.mergeBase,
    files: captured.files,
    policy: captured.policy,
    manifestHash: captured.manifestHash,
  };
  writeFileSync(manifestPath, JSON.stringify(publicManifest, null, 2) + "\n");
  return { snapshotDir: snap, manifestPath };
}

export function detectDrift(args, repo, captured, snapshotDir) {
  const details = [];
  try {
    const frozenArgs = captured.mode === "diff" ? { ...args, base: captured.baseSha, head: captured.headSha } : args;
    const again = captureTarget(frozenArgs, repo);
    if (again.manifestHash !== captured.manifestHash) details.push("source scope, contents, policy or refs changed");
  } catch (err) {
    details.push(`source no longer readable at captured scope: ${err.message}`);
  }
  const sets = [[snapshotDir, captured.fileContents.filter(f => f.bytes !== null)]];
  if (captured.mode === "working-tree") {
    for (const [dir, field] of [["snapshot-base", "baseBytes"], ["snapshot-index", "indexBytes"]]) {
      sets.push([join(dirname(snapshotDir), dir), captured.fileContents.filter(f => f[field] !== null).map(f => ({ path: f.path, hash: sha256(f[field]) }))]);
    }
  }
  for (const [root, expected] of sets) {
    try {
      const actual = [];
      if (existsSync(root)) walkDir(root, ".", actual);
      if (JSON.stringify(actual.sort()) !== JSON.stringify(expected.map(f => f.path).sort())) details.push("snapshot file set changed");
      for (const f of expected) {
        const { abs } = resolveInRepo(root, f.path, { mustExist: true, follow: false });
        if (sha256(readFileSync(abs)) !== f.hash) details.push(`snapshot hash changed ${f.path}`);
      }
    } catch (err) {
      details.push(`snapshot integrity failure: ${err.message}`);
    }
  }
  return { detected: details.length > 0, details: details.length ? details.join("; ") : null };
}

export function unifiedDiff(repo, captured, runDir) {
  const paths = captured.files.map(f => f.path);
  if (captured.mode === "diff") {
    return git(repo, ["--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "-M", captured.mergeBase, captured.headSha, "--", ...paths], { encoding: "utf8" }).stdout;
  }
  if (captured.mode === "working-tree") {
    // git --no-index returns 1 for a legitimate diff; both sides are frozen directories.
    const pairs = [["snapshot-base", "snapshot-index"], ["snapshot-index", "snapshot"]];
    return pairs.map(([before, after]) => {
      const r = git(runDir, ["diff", "--no-index", "--no-ext-diff", "--no-textconv", "--no-renames", "--", before, after], { encoding: "utf8", allowFail: true });
      if (r.status !== 0 && r.status !== 1) throw new CaptureError(`frozen diff failed: ${r.stderr}`);
      return `# ${before} -> ${after}\n${r.stdout}`;
    }).join("\n");
  }
  return "Snapshot review: current files only; no delta attribution.";
}

// Observe source checkout deltas without attributing concurrent user edits to an agent.
export function checkoutFingerprint(repo) {
  const parts = [git(repo, ["rev-parse", "HEAD"]).stdout,
    git(repo, ["diff", "--no-ext-diff", "--no-textconv", "--binary"]).stdout,
    git(repo, ["diff", "--no-ext-diff", "--no-textconv", "--binary", "--cached"]).stdout];
  for (const rel of splitZ(git(repo, ["ls-files", "-z", "--others", "--exclude-standard"]).stdout).sort()) {
    const { abs } = resolveInRepo(repo, rel, { follow: false });
    parts.push(Buffer.from(rel + "\0"), readFileSync(abs));
  }
  return sha256(Buffer.concat(parts));
}
