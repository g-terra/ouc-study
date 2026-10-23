// One backup run, end to end: pick the files, say what changed, push, and remember how it went.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBackup } from "../src/run.ts";

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();

function setup() {
  const root = mkdtempSync(join(tmpdir(), "ouc-run-root-"));
  const remote = mkdtempSync(join(tmpdir(), "ouc-run-remote-"));
  git(remote, "init", "--bare", "-q");
  const put = (p: string, body: string | number) => {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), typeof body === "number" ? Buffer.alloc(body) : body);
  };
  return { root, remote, put };
}

test("a run backs up the student's files, names the changes and saves its status", async () => {
  const { root, remote, put } = setup();
  put("semesters/S/notes/C1/w1.md", "n");
  put("semesters/S/progress.json", "{}");
  put(".eclass-token", "secret");
  const now = new Date("2026-10-22T18:04:00Z");
  const s = await runBackup({ root, remote, now });
  assert.equal(s.ok, true);
  assert.equal(s.summary, "1 note, progress");
  assert.equal(s.files, 2);
  assert.equal(s.at, now.toISOString());
  assert.equal(git(remote, "log", "-1", "--format=%s", "main"), "1 note, progress");
  assert.equal(git(remote, "ls-tree", "-r", "--name-only", "main").includes(".eclass-token"), false);
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".ouc", "backup-status.json"), "utf8")), s);
});

test("the next run only names what changed since, and says when nothing did", async () => {
  const { root, remote, put } = setup();
  put("semesters/S/notes/C1/w1.md", "n");
  await runBackup({ root, remote });
  put("semesters/S/quizzes/attempts.json", "[]");
  assert.equal((await runBackup({ root, remote })).summary, "quiz scores");
  const same = await runBackup({ root, remote });
  assert.equal(same.ok, true);
  assert.equal(same.summary, "no changes");
  assert.equal(git(remote, "rev-list", "--count", "main"), "2");
});

test("files too big for GitHub go up in parts, and videos as their smaller copy", async () => {
  const { root, remote, put } = setup();
  put("semesters/S/courses/C1/01-W/slides.pptx", 2500);
  put("semesters/S/courses/C1/01-W/class.mp4", 3000);
  put("semesters/S/notes/n.md", "n");
  const ffmpeg = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-ffmpeg.mjs");
  const s = await runBackup({ root, remote, maxBytes: 1000, ffmpeg, ffmpegEnv: { FAKE_FFMPEG_BYTES: "600" } });
  assert.equal(s.ok, true);
  assert.equal(s.files, 3, "counts the student's files, not the parts");
  assert.deepEqual(git(remote, "ls-tree", "-r", "--name-only", "main").split("\n"), [
    "semesters/S/courses/C1/01-W/class.mp4",
    "semesters/S/courses/C1/01-W/slides.pptx.ouc-part-001", "semesters/S/courses/C1/01-W/slides.pptx.ouc-part-002",
    "semesters/S/courses/C1/01-W/slides.pptx.ouc-part-003", "semesters/S/courses/C1/01-W/slides.pptx.ouc-parts.json",
    "semesters/S/notes/n.md",
  ]);
  assert.equal(git(remote, "cat-file", "-s", "main:semesters/S/courses/C1/01-W/class.mp4"), "600");
});

test("a failed run keeps the last good backup's details and says why", async () => {
  const { root, remote, put } = setup();
  put("semesters/S/notes/n.md", "n");
  const good = await runBackup({ root, remote, now: new Date("2026-10-22T10:00:00Z") });
  put("semesters/S/notes/m.md", "m");
  const bad = await runBackup({ root, remote: join(root, "gone"), now: new Date("2026-10-22T14:00:00Z") });
  assert.equal(bad.ok, false);
  assert.match(bad.error ?? "", /does not appear to be a git repository/);
  assert.equal(bad.lastGood, good.at);
  // it tries again with the full change list next time
  assert.equal((await runBackup({ root, remote })).summary, "1 note");
});

test("a run reports its progress: files saved out of those that changed, then the upload", async () => {
  const { root, remote, put } = setup();
  put("semesters/S/notes/C1/w1.md", "n");
  put("semesters/S/notes/C1/w2.md", "nn");
  put("memory/progress.md", "p");
  const seen: { step: string; done: number; total: number }[] = [];
  const s = await runBackup({ root, remote, onProgress: (p) => seen.push({ step: p.step, done: p.done, total: p.total }) });
  assert.equal(s.ok, true);
  const saving = seen.filter((x) => x.step === "saving");
  assert.deepEqual(saving.at(-1), { step: "saving", done: 3, total: 3 });
  assert.ok(seen.some((x) => x.step === "uploading"), "the push says how far it got");

  put("semesters/S/notes/C1/w2.md", "changed");
  seen.length = 0;
  await runBackup({ root, remote, onProgress: (p) => seen.push({ step: p.step, done: p.done, total: p.total }) });
  assert.deepEqual(seen.filter((x) => x.step === "saving").at(-1), { step: "saving", done: 1, total: 1 }, "only what changed counts");
});
