/**
 * The GitHub backup: its own git folder (.ouc/backup.git) with the study folder as work tree, so the
 * code checkout's .git and the public repo never see these files. Each backup builds its tree on top of
 * what the remote has (another computer's backup is kept; this computer's version of a file wins),
 * commits only when something changed, and pushes.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BackupProgress } from "./progress.ts";

/** progress from one step, without its start time (run.ts adds it) */
export type Report = (p: Omit<BackupProgress, "startedAt">) => void;

export interface GitBackupOptions {
  /** the study folder */
  root: string;
  /** the backup's git folder, e.g. <root>/.ouc/backup.git */
  gitDir: string;
  /** where to push: a URL or a path */
  remote: string;
  /** the files to back up, relative to root with "/" */
  files: string[];
  /** backup name → the file to store under it, when that isn't the file itself (a video's smaller copy, a part) */
  from?: Record<string, string>;
  message: string;
  /** extra environment for git (sign-in) */
  env?: NodeJS.ProcessEnv;
  /** the files that changed since the last backup (all when left out): the ones progress counts */
  changed?: Set<string>;
  onProgress?: Report;
}

const BRANCH = "main";
const WHO = { GIT_AUTHOR_NAME: "OUC Study", GIT_AUTHOR_EMAIL: "backup@ouc-study.invalid", GIT_COMMITTER_NAME: "OUC Study", GIT_COMMITTER_EMAIL: "backup@ouc-study.invalid" };
const TIMEOUT_MS = 30 * 60_000; // a first backup can upload a few hundred MB
const CHUNK = 50; // files per git call while counting progress

function run(o: GitBackupOptions, args: string[], input?: string, onErr?: (text: string) => void) {
  return new Promise<{ code: number; out: string; err: string }>((done) => {
    const p = spawn("git", [`--git-dir=${o.gitDir}`, `--work-tree=${o.root}`, "--literal-pathspecs", ...args], {
      cwd: o.root,
      env: { ...process.env, ...WHO, GIT_TERMINAL_PROMPT: "0", ...o.env },
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      timeout: TIMEOUT_MS,
    });
    let out = "";
    let err = "";
    p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", (d) => { err += d; onErr?.(String(d)); });
    p.on("error", (e) => done({ code: 1, out, err: String(e) }));
    p.on("close", (code) => done({ code: code ?? 1, out: out.trim(), err: err.trim() }));
    if (p.stdin) { p.stdin.on("error", () => {}); p.stdin.end(input); }
  });
}

async function must(o: GitBackupOptions, args: string[], input?: string) {
  const r = await run(o, args, input);
  if (r.code !== 0) throw new Error(`git ${args[0]} failed: ${r.err || r.out}`);
  return r.out;
}

// what the last backup from this computer held, so only files removed here are taken out
const listFile = (o: GitBackupOptions) => join(o.gitDir, "ouc-backup-files.json");
function lastList(o: GitBackupOptions): string[] {
  try { return JSON.parse(readFileSync(listFile(o), "utf8")); } catch { return []; }
}

/** Backs up `files` and pushes. `committed` is false when nothing changed since the last backup. */
export async function gitBackup(o: GitBackupOptions): Promise<{ committed: boolean; commit: string }> {
  if (!existsSync(join(o.gitDir, "HEAD"))) {
    mkdirSync(o.gitDir, { recursive: true });
    await must(o, ["init", "-q", `--initial-branch=${BRANCH}`]);
    await must(o, ["config", "core.excludesFile", ""]);
  }
  await must(o, ["config", "remote.origin.url", o.remote]);
  const fetched = await run(o, ["fetch", "-q", "origin", `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`]);
  if (fetched.code !== 0 && !/couldn't find remote ref/i.test(fetched.err)) throw new Error(`Backup fetch failed: ${fetched.err}`);
  const base = (await run(o, ["rev-parse", "-q", "--verify", `refs/remotes/origin/${BRANCH}^{commit}`])).out;

  // the index starts from the remote's tree (-m keeps the stat cache, so unchanged files aren't re-read)
  if (base) await must(o, ["read-tree", "-i", "-m", base]);
  else await must(o, ["read-tree", "--empty"]);
  const keep = new Set(o.files);
  const gone = lastList(o).filter((p) => !keep.has(p));
  if (gone.length) await must(o, ["rm", "-q", "--cached", "--ignore-unmatch", "--pathspec-from-file=-", "--pathspec-file-nul"], gone.join("\0"));
  // -f: the code repo's .gitignore ignores semesters/ and memory/, which is exactly what we back up
  const from = o.from ?? {};
  const source = (p: string) => from[p] ?? join(o.root, p);
  const counted = o.files.filter((p) => !o.changed || o.changed.has(p));
  const quiet = o.files.filter((p) => o.changed && !o.changed.has(p));
  const bytesTotal = counted.reduce((n, p) => n + statSync(source(p)).size, 0);
  let done = 0;
  let bytesDone = 0;
  const report = () => o.onProgress?.({ step: "saving", done, total: counted.length, bytesDone, bytesTotal });
  async function save(paths: string[]) {
    const direct = paths.filter((p) => !from[p]);
    const elsewhere = paths.filter((p) => from[p]);
    if (direct.length) await must(o, ["add", "-f", "--pathspec-from-file=-", "--pathspec-file-nul"], direct.join("\0"));
    if (elsewhere.length) {
      const shas = (await must(o, ["hash-object", "-w", "--no-filters", "--stdin-paths"], elsewhere.map((p) => from[p]).join("\n"))).split("\n");
      await must(o, ["update-index", "-z", "--index-info"], elsewhere.map((p, i) => `100644 ${shas[i]}\t${p}\0`).join(""));
    }
  }
  if (quiet.length) await save(quiet);
  report();
  for (let i = 0; i < counted.length; i += CHUNK) {
    const chunk = counted.slice(i, i + CHUNK);
    await save(chunk);
    done += chunk.length;
    bytesDone += chunk.reduce((n, p) => n + statSync(source(p)).size, 0);
    report();
  }
  const tree = await must(o, ["write-tree"]);

  let commit = base;
  const committed = !base || tree !== (await must(o, ["rev-parse", `${base}^{tree}`]));
  if (committed) {
    commit = await must(o, ["commit-tree", tree, ...(base ? ["-p", base] : []), "-m", o.message]);
    const upload = (pct: number) => o.onProgress?.({ step: "uploading", done: pct, total: 100, bytesDone: 0, bytesTotal: 0 });
    upload(0);
    const pushed = await run(o, ["push", "--progress", "origin", `${commit}:refs/heads/${BRANCH}`], undefined, (text) => {
      const pct = [...text.matchAll(/Writing objects:\s+(\d+)%/g)].pop()?.[1];
      if (pct) upload(Number(pct));
    });
    if (pushed.code !== 0) throw new Error(`Backup push failed: ${pushed.err || pushed.out}`);
    upload(100);
    await must(o, ["update-ref", `refs/heads/${BRANCH}`, commit]);
    await must(o, ["update-ref", `refs/remotes/origin/${BRANCH}`, commit]);
  }
  writeFileSync(listFile(o), JSON.stringify(o.files));
  return { committed, commit };
}
