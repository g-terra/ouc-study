// The GitHub backup: a separate git folder (.ouc/backup.git) over the study folder, pushed to a remote.
// Tests push to a local bare repo; the code checkout's own .git is never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gitBackup } from "../src/git.ts";

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();

function setup() {
  const root = mkdtempSync(join(tmpdir(), "ouc-backup-root-"));
  const remote = mkdtempSync(join(tmpdir(), "ouc-backup-remote-"));
  git(remote, "init", "--bare", "-q");
  // the code repo ignores semesters/; the backup must still take them
  writeFileSync(join(root, ".gitignore"), "semesters/*\nmemory/\n");
  git(root, "init", "-q");
  const put = (p: string, body: string) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), body); };
  return { root, remote, put, gitDir: join(root, ".ouc", "backup.git") };
}

const shown = (remote: string) => git(remote, "ls-tree", "-r", "--name-only", "main").split("\n").filter(Boolean).sort();

test("the first backup commits the chosen files and pushes them", async () => {
  const { root, remote, put, gitDir } = setup();
  put("semesters/S/notes/n.md", "note");
  put("memory/progress.md", "p");
  put("apps/web/App.tsx", "code");
  const r = await gitBackup({ root, gitDir, remote, files: ["semesters/S/notes/n.md", "memory/progress.md"], message: "1 note, study memory" });
  assert.equal(r.committed, true);
  assert.deepEqual(shown(remote), ["memory/progress.md", "semesters/S/notes/n.md"]);
  assert.equal(git(remote, "log", "-1", "--format=%s", "main"), "1 note, study memory");
  assert.equal(git(root, "status", "--porcelain").includes("semesters"), false, "the code repo's own git is untouched");
  assert.equal(git(root, "rev-list", "--all").length, 0, "nothing committed to the code repo");
});

test("a later backup sends changes and removals, and nothing changed means no commit", async () => {
  const { root, remote, put, gitDir } = setup();
  put("a.md", "1"); put("b.md", "1");
  await gitBackup({ root, gitDir, remote, files: ["a.md", "b.md"], message: "first" });
  put("a.md", "2"); rmSync(join(root, "b.md")); put("c.md", "1");
  const r = await gitBackup({ root, gitDir, remote, files: ["a.md", "c.md"], message: "second" });
  assert.equal(r.committed, true);
  assert.deepEqual(shown(remote), ["a.md", "c.md"]);
  assert.equal(git(remote, "show", "main:a.md"), "2");
  const again = await gitBackup({ root, gitDir, remote, files: ["a.md", "c.md"], message: "third" });
  assert.equal(again.committed, false);
  assert.equal(git(remote, "rev-list", "--count", "main"), "2");
});

test("a file left out of the list is taken out of the backup", async () => {
  const { root, remote, put, gitDir } = setup();
  put("a.md", "1"); put("b.md", "1");
  await gitBackup({ root, gitDir, remote, files: ["a.md", "b.md"], message: "first" });
  await gitBackup({ root, gitDir, remote, files: ["a.md"], message: "second" });
  assert.deepEqual(shown(remote), ["a.md"]);
});

test("a backup made from another computer in between is kept, not overwritten", async () => {
  const { root, remote, put, gitDir } = setup();
  put("a.md", "1");
  await gitBackup({ root, gitDir, remote, files: ["a.md"], message: "first" });
  // another computer pushes its own file
  const other = mkdtempSync(join(tmpdir(), "ouc-backup-other-"));
  git(other, "clone", "-q", "-b", "main", remote, ".");
  writeFileSync(join(other, "other.md"), "x");
  git(other, "add", "other.md");
  git(other, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "other");
  git(other, "push", "-q", "origin", "HEAD:main");
  put("a.md", "2");
  const r = await gitBackup({ root, gitDir, remote, files: ["a.md"], message: "second" });
  assert.equal(r.committed, true);
  assert.equal(git(remote, "show", "main:a.md"), "2");
  assert.equal(git(remote, "show", "main:other.md"), "x");
});

test("an unreachable backup repo says why", async () => {
  const { root, put, gitDir } = setup();
  put("a.md", "1");
  await assert.rejects(gitBackup({ root, gitDir, remote: join(tmpdir(), "ouc-no-such-remote", String(Date.now())), files: ["a.md"], message: "first" }), /^Error: Backup (fetch|push) failed: .*does not appear to be a git repository/);
});

test("files can come from somewhere else (a video's smaller copy, a part) under their backup name", async () => {
  const { root, remote, put, gitDir } = setup();
  put("semesters/S/class.mp4", "the big original");
  put(".ouc/backup-media/videos/k.mp4", "small");
  put(".ouc/backup-media/parts/k/ouc-part-001", "p1");
  await gitBackup({
    root, gitDir, remote, message: "first",
    files: ["semesters/S/class.mp4", "semesters/S/slides.pptx.ouc-part-001"],
    from: { "semesters/S/class.mp4": join(root, ".ouc/backup-media/videos/k.mp4"), "semesters/S/slides.pptx.ouc-part-001": join(root, ".ouc/backup-media/parts/k/ouc-part-001") },
  });
  assert.equal(git(remote, "show", "main:semesters/S/class.mp4"), "small");
  assert.equal(git(remote, "show", "main:semesters/S/slides.pptx.ouc-part-001"), "p1");
  assert.deepEqual(shown(remote), ["semesters/S/class.mp4", "semesters/S/slides.pptx.ouc-part-001"]);
});
