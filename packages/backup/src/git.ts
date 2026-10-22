/**
 * The GitHub backup: its own git folder (.ouc/backup.git) with the study folder as work tree, so the
 * code checkout's .git and the public repo never see these files. Each backup builds its tree on top of
 * what the remote has (another computer's backup is kept; this computer's version of a file wins),
 * commits only when something changed, and pushes.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface GitBackupOptions {
  /** the study folder */
  root: string;
  /** the backup's git folder, e.g. <root>/.ouc/backup.git */
  gitDir: string;
  /** where to push: a URL or a path */
  remote: string;
  /** the files to back up, relative to root with "/" */
  files: string[];
  message: string;
  /** extra environment for git (sign-in) */
  env?: NodeJS.ProcessEnv;
}

const BRANCH = "main";
const WHO = { GIT_AUTHOR_NAME: "OUC Study", GIT_AUTHOR_EMAIL: "backup@ouc-study.invalid", GIT_COMMITTER_NAME: "OUC Study", GIT_COMMITTER_EMAIL: "backup@ouc-study.invalid" };
const TIMEOUT_MS = 30 * 60_000; // a first backup can upload a few hundred MB

function run(o: GitBackupOptions, args: string[], input?: string) {
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
    p.stderr?.on("data", (d) => (err += d));
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
  if (o.files.length) await must(o, ["add", "-f", "--pathspec-from-file=-", "--pathspec-file-nul"], o.files.join("\0"));
  const tree = await must(o, ["write-tree"]);

  let commit = base;
  const committed = !base || tree !== (await must(o, ["rev-parse", `${base}^{tree}`]));
  if (committed) {
    commit = await must(o, ["commit-tree", tree, ...(base ? ["-p", base] : []), "-m", o.message]);
    const pushed = await run(o, ["push", "-q", "origin", `${commit}:refs/heads/${BRANCH}`]);
    if (pushed.code !== 0) throw new Error(`Backup push failed: ${pushed.err || pushed.out}`);
    await must(o, ["update-ref", `refs/heads/${BRANCH}`, commit]);
    await must(o, ["update-ref", `refs/remotes/origin/${BRANCH}`, commit]);
  }
  writeFileSync(listFile(o), JSON.stringify(o.files));
  return { committed, commit };
}
