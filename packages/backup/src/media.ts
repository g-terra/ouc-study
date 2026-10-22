/**
 * Big files in a backup. Class videos get a smaller copy for the backup only (lecture recordings are
 * mostly slides and a voice, so a lower frame rate and H.265 shrink them a lot); the original stays on
 * this computer. Anything still over the target's limit is split into `<name>.ouc-part-NNN` files plus
 * `<name>.ouc-parts.json` (size and checksum), and joined back on restore. Copies and parts are made
 * once and kept in .ouc/backup-media/ (git-ignored, never backed up).
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";

const VIDEO = /\.(mp4|m4v|mov|webm|mkv|avi)$/i;
const FFMPEG_TIMEOUT_MS = 2 * 60 * 60_000; // a long class on a slow laptop
const PART = ".ouc-part-";
const MANIFEST = ".ouc-parts.json";

export interface Source { path: string; from: string }

const cacheDir = (root: string) => join(root, ".ouc", "backup-media");
/** The same file (path, size, date) always gets the same key, so its copy or parts are made once. */
function key(root: string, path: string) {
  const st = statSync(join(root, path));
  return createHash("sha256").update(`${path}\0${st.size}\0${Math.round(st.mtimeMs)}`).digest("hex").slice(0, 24);
}

function sha256File(file: string) {
  const h = createHash("sha256");
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(1 << 20);
    for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n));
  } finally { closeSync(fd); }
  return h.digest("hex");
}

function run(bin: string, args: string[], env?: NodeJS.ProcessEnv) {
  const [file, argv] = bin.endsWith(".mjs") ? [process.execPath, [bin, ...args]] : [bin, args];
  return new Promise<number>((done) => {
    const p = spawn(file, argv, { stdio: "ignore", env: { ...process.env, ...env }, timeout: FFMPEG_TIMEOUT_MS });
    p.on("error", () => done(1));
    p.on("close", (code) => done(code ?? 1));
  });
}

/** A smaller copy of a video for the backup, or null to back up the original (no ffmpeg, it failed, or it isn't smaller). */
export async function compressVideo(root: string, path: string, o: { ffmpeg: string | null; env?: NodeJS.ProcessEnv }): Promise<string | null> {
  if (!o.ffmpeg) return null;
  const dir = join(cacheDir(root), "videos");
  const out = join(dir, `${key(root, path)}.mp4`);
  const none = `${out}.none`; // tried before and it didn't help: don't redo it every backup
  if (existsSync(out)) return out;
  if (existsSync(none)) return null;
  mkdirSync(dir, { recursive: true });
  const tmp = `${out}.part`;
  const common = ["-nostdin", "-y", "-loglevel", "error", "-i", join(root, path), "-vf", "fps=10,scale='min(1280,iw)':-2"];
  const audio = ["-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", tmp];
  let code = await run(o.ffmpeg, [...common, "-c:v", "libx265", "-crf", "30", "-preset", "medium", "-tag:v", "hvc1", ...audio], o.env);
  if (code !== 0) code = await run(o.ffmpeg, [...common, "-c:v", "libx264", "-crf", "28", "-preset", "medium", ...audio], o.env);
  if (code !== 0 || !existsSync(tmp) || statSync(tmp).size >= statSync(join(root, path)).size) {
    rmSync(tmp, { force: true });
    if (code === 0) writeFileSync(none, "");
    return null;
  }
  renameSync(tmp, out);
  return out;
}

/** Splits `file` into parts of `partBytes` in `dir`; returns each part's name suffix and where it is, the manifest last. */
export function splitFile(file: string, dir: string, partBytes: number): { suffix: string; from: string }[] {
  mkdirSync(dir, { recursive: true });
  const size = statSync(file).size;
  const count = Math.max(1, Math.ceil(size / partBytes));
  const parts: { suffix: string; from: string }[] = [];
  const fd = openSync(file, "r");
  try {
    for (let i = 0; i < count; i++) {
      const suffix = `${PART}${String(i + 1).padStart(3, "0")}`;
      const from = join(dir, suffix.slice(1));
      if (!existsSync(from)) {
        const buf = Buffer.alloc(Math.min(partBytes, size - i * partBytes));
        readSync(fd, buf, 0, buf.length, i * partBytes);
        writeFileSync(`${from}.tmp`, buf);
        renameSync(`${from}.tmp`, from);
      }
      parts.push({ suffix, from });
    }
  } finally { closeSync(fd); }
  const manifest = join(dir, MANIFEST.slice(1));
  writeFileSync(manifest, `${JSON.stringify({ size, sha256: sha256File(file), parts: count })}\n`);
  return [...parts, { suffix: MANIFEST, from: manifest }];
}

/** Joins every split file under `dir` (after a restore) and removes the parts; returns the joined paths. Throws on a damaged one. */
export function joinParts(dir: string, rel = ""): string[] {
  const joined: string[] = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { joined.push(...joinParts(dir, p)); continue; }
    if (!e.name.endsWith(MANIFEST)) continue;
    const target = join(dir, p.slice(0, -MANIFEST.length));
    const m = JSON.parse(readFileSync(join(dir, p), "utf8")) as { size: number; sha256: string; parts: number };
    const parts = Array.from({ length: m.parts }, (_, i) => `${target}${PART}${String(i + 1).padStart(3, "0")}`);
    const name = p.slice(0, -MANIFEST.length);
    if (parts.some((f) => !existsSync(f))) throw new Error(`${name} is damaged in the backup: a part is missing.`);
    const tmp = `${target}.joining`;
    const out = openSync(tmp, "w");
    try { for (const f of parts) writeSync(out, readFileSync(f)); } finally { closeSync(out); }
    if (statSync(tmp).size !== m.size || sha256File(tmp) !== m.sha256) {
      rmSync(tmp, { force: true });
      throw new Error(`${name} is damaged in the backup: its parts don't add up.`);
    }
    renameSync(tmp, target);
    for (const f of [...parts, join(dir, p)]) rmSync(f, { force: true });
    joined.push(name);
  }
  return joined;
}

/** What to upload for each file: the file itself, a video's smaller copy, or parts when it's over `maxBytes`. */
export async function prepareSources(root: string, files: string[], o: { maxBytes?: number; ffmpeg: string | null; env?: NodeJS.ProcessEnv }): Promise<Source[]> {
  const out: Source[] = [];
  for (const path of files) {
    let from = join(root, path);
    if (VIDEO.test(path)) from = (await compressVideo(root, path, o)) ?? from;
    if (o.maxBytes && statSync(from).size > o.maxBytes) {
      for (const p of splitFile(from, join(cacheDir(root), "parts", key(root, path)), o.maxBytes)) out.push({ path: `${path}${p.suffix}`, from: p.from });
    } else out.push({ path, from });
  }
  return out;
}
