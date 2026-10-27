// The study AI may write notes and study files, never the app's own code. Everything a student owns
// (semesters/, memory/, STUDENT.md, .ouc/) is git-ignored, so a run that changes a file git tracks,
// or adds one git would track, has strayed into the code: after the run, undo exactly that.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

const git = (root: string, args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });

/** Paths git sees as changed or new (not ignored); null when root isn't a git checkout. */
export function changedFiles(root: string): Set<string> | null {
  const r = git(root, ["status", "--porcelain", "-z", "--untracked-files=all"]);
  if (r.status !== 0 || r.error) return null;
  const out = new Set<string>();
  const parts = r.stdout.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]!;
    if (e.length < 4) continue;
    out.add(e.slice(3));
    if (e[0] === "R" || e[0] === "C") i++;   // a rename is followed by its old path
  }
  return out;
}

/** Undo what the run changed in code that was clean before it (the student's own edits stay). Returns the paths undone. */
export function undoCodeChanges(root: string, before: Set<string> | null): string[] {
  const after = before && changedFiles(root);
  if (!after) return [];
  const strayed = [...after].filter((p) => !before.has(p));
  if (!strayed.length) return [];
  const tracked = new Set(git(root, ["ls-files", "-z", "--", ...strayed]).stdout.split("\0").filter(Boolean));
  const restore = strayed.filter((p) => tracked.has(p));
  if (restore.length) git(root, ["checkout", "HEAD", "--", ...restore]);
  for (const p of strayed) if (!tracked.has(p)) rmSync(join(root, p), { force: true });
  return strayed;
}
