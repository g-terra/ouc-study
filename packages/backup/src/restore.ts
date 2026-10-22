/**
 * Restore: brings a backup back into the study folder (a new computer, or one that lost files).
 * A file that's missing here is restored; one that's the same is left alone; one that differs is only
 * replaced when the student says so (`replace`, asked once for all of them). A class video that's on
 * this computer always stays, since the backup only has a smaller copy. Split files are joined again.
 * Only paths a backup takes (select.ts) are written, so a tampered backup can't reach code or secrets.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { MANIFEST, PART, VIDEO, joinParts } from "./media.ts";
import { inBackup } from "./select.ts";

/** One file in a backup. */
export interface RemoteFile {
  /** relative to the study folder, with "/" */
  path: string;
  /** true when `local` (a file that exists) has the same content */
  same(local: string): Promise<boolean>;
  /** downloads it to `to` */
  save(to: string): Promise<void>;
}

export interface RestoreResult {
  restored: string[];
  /** already the same here */
  same: number;
  /** differ here and were kept, as the student asked */
  kept: string[];
  /** class videos kept as they are on this computer */
  keptVideos: string[];
  /** not a study file: never written */
  skipped: string[];
}

export interface RestoreOptions {
  /** asked once with the files that differ here; true replaces them with the backup's. Without it they're kept. */
  replace?: (differ: string[]) => Promise<boolean>;
}

/** a file as it is in the backup: by itself, or as parts plus their manifest */
interface Item { path: string; file?: RemoteFile; parts: RemoteFile[]; manifest?: RemoteFile }

function group(files: RemoteFile[]): Item[] {
  const items = new Map<string, Item>();
  const item = (path: string) => items.get(path) ?? items.set(path, { path, parts: [] }).get(path)!;
  for (const f of files) {
    const part = f.path.lastIndexOf(PART);
    if (f.path.endsWith(MANIFEST)) item(f.path.slice(0, -MANIFEST.length)).manifest = f;
    else if (part > 0 && /^\d+$/.test(f.path.slice(part + PART.length))) item(f.path.slice(0, part)).parts.push(f);
    else item(f.path).file = f;
  }
  return [...items.values()];
}

export function sha256File(file: string) {
  return new Promise<string>((done, fail) => {
    const h = createHash("sha256");
    createReadStream(file).on("data", (d) => h.update(d)).on("error", fail).on("end", () => done(h.digest("hex")));
  });
}

export async function restoreFiles(root: string, files: RemoteFile[], o: RestoreOptions = {}): Promise<RestoreResult> {
  const r: RestoreResult = { restored: [], same: 0, kept: [], keptVideos: [], skipped: [] };
  const staging = join(root, ".ouc", "restore-parts");
  const todo: Item[] = [];
  const differ: Item[] = [];
  for (const it of group(files)) {
    if (!inBackup(it.path)) { r.skipped.push(it.path); continue; }
    const here = join(root, it.path);
    if (!existsSync(here)) { todo.push(it); continue; }
    if (VIDEO.test(it.path)) { r.keptVideos.push(it.path); continue; }
    let same: boolean;
    if (it.file) same = await it.file.same(here);
    else {
      // a split file: compare with the size and checksum its manifest gives
      mkdirSync(staging, { recursive: true });
      const m = join(staging, "manifest.json");
      await it.manifest?.save(m);
      const want = existsSync(m) ? JSON.parse(readFileSync(m, "utf8")) as { size: number; sha256: string } : null;
      rmSync(m, { force: true });
      same = !!want && statSync(here).size === want.size && (await sha256File(here)) === want.sha256;
    }
    if (same) r.same++;
    else differ.push(it);
  }
  if (differ.length) {
    const yes = o.replace ? await o.replace(differ.map((d) => d.path)) : false;
    if (yes) todo.push(...differ);
    else r.kept.push(...differ.map((d) => d.path));
  }

  try {
    for (const it of todo) {
      const dest = join(root, it.path);
      mkdirSync(dirname(dest), { recursive: true });
      if (it.file) {
        const tmp = `${dest}.ouc-restoring`;
        await it.file.save(tmp);
        renameSync(tmp, dest);
      } else {
        if (!it.manifest || !it.parts.length) throw new Error(`${it.path} is damaged in the backup: a part is missing.`);
        const at = join(staging, "files");
        for (const p of [...it.parts, it.manifest]) {
          const to = join(at, p.path);
          mkdirSync(dirname(to), { recursive: true });
          await p.save(to);
        }
        joinParts(at);
        renameSync(join(at, it.path), dest);
      }
      r.restored.push(it.path);
    }
  } finally { rmSync(staging, { recursive: true, force: true }); }
  return r;
}

// ---------- GitHub: the backup repo's latest commit ----------

function git(gitDir: string, args: string[], env?: NodeJS.ProcessEnv, stdout?: NodeJS.WritableStream) {
  return new Promise<{ code: number; out: string; err: string }>((done) => {
    const p = spawn("git", [`--git-dir=${gitDir}`, ...args], { env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    if (stdout) p.stdout.pipe(stdout); else p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => done({ code: 1, out, err: String(e) }));
    p.on("close", (code) => done({ code: code ?? 1, out, err: err.trim() }));
  });
}

/** git's id for a file's content */
function blobSha(file: string) {
  return new Promise<string>((done, fail) => {
    const h = createHash("sha1").update(`blob ${statSync(file).size}\0`);
    createReadStream(file).on("data", (d) => h.update(d)).on("error", fail).on("end", () => done(h.digest("hex")));
  });
}

/** The files in the GitHub backup (fetched into .ouc/backup.git, the folder the next backup uses too). */
export async function githubFiles(o: { root: string; gitDir?: string; remote: string; env?: NodeJS.ProcessEnv }): Promise<RemoteFile[]> {
  const gitDir = o.gitDir ?? join(o.root, ".ouc", "backup.git");
  if (!existsSync(join(gitDir, "HEAD"))) {
    mkdirSync(gitDir, { recursive: true });
    await git(gitDir, ["init", "-q", "--bare", "--initial-branch=main"]);
  }
  await git(gitDir, ["config", "remote.origin.url", o.remote]);
  const fetched = await git(gitDir, ["fetch", "-q", "origin", "+refs/heads/main:refs/remotes/origin/main"], o.env);
  if (fetched.code !== 0) {
    if (/couldn't find remote ref/i.test(fetched.err)) return [];
    throw new Error(`Couldn't get the backup: ${fetched.err}`);
  }
  const listed = await git(gitDir, ["ls-tree", "-r", "-z", "refs/remotes/origin/main"]);
  return listed.out.split("\0").filter(Boolean).map((line) => {
    const [meta, path] = line.split("\t");
    const sha = meta.split(" ")[2];
    return {
      path,
      same: async (local) => (await blobSha(local)) === sha,
      save: async (to) => {
        const out = createWriteStream(to);
        const done = new Promise((ok, fail) => out.on("finish", ok).on("error", fail));
        const r = await git(gitDir, ["cat-file", "blob", sha], undefined, out);
        await done;
        if (r.code !== 0) throw new Error(`Couldn't restore ${path}: ${r.err}`);
      },
    };
  });
}
