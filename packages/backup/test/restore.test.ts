// Restore: a new (or wiped) computer gets the backup back. Nothing on this computer is replaced
// without asking, big files are joined from their parts, and the next backup carries on from it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gitBackup } from "../src/git.ts";
import { prepareSources } from "../src/media.ts";
import { githubFiles, restoreFiles, type RemoteFile } from "../src/restore.ts";

function study(files: Record<string, string | Buffer> = {}) {
  const root = mkdtempSync(join(tmpdir(), "ouc-restore-"));
  const put = (p: string, b: string | Buffer) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), b); };
  for (const [p, b] of Object.entries(files)) put(p, b);
  return { root, put, read: (p: string) => readFileSync(join(root, p)) };
}
function bareRemote() {
  const remote = mkdtempSync(join(tmpdir(), "ouc-restore-remote-"));
  execFileSync("git", ["init", "--bare", "-q", remote]);
  return remote;
}
/** backs `root` up to `remote` the way runBackup does (big files in parts of `maxBytes`) */
async function backUp(root: string, remote: string, files: string[], maxBytes = 1000) {
  const src = await prepareSources(root, files, { maxBytes, ffmpeg: null });
  const from = Object.fromEntries(src.filter((s) => s.from !== join(root, s.path)).map((s) => [s.path, s.from]));
  await gitBackup({ root, gitDir: join(root, ".ouc", "backup.git"), remote, files: src.map((s) => s.path), from, message: "backup" });
}

test("a GitHub backup comes back on an empty computer, big files joined from their parts", async () => {
  const big = randomBytes(2500);
  const old = study({ "semesters/S/notes/n.md": "note", "memory/progress.md": "p", "semesters/S/courses/C/01-W/slides.pptx": big });
  const remote = bareRemote();
  await backUp(old.root, remote, ["memory/progress.md", "semesters/S/courses/C/01-W/slides.pptx", "semesters/S/notes/n.md"]);

  const fresh = study();
  const files = await githubFiles({ root: fresh.root, remote });
  const r = await restoreFiles(fresh.root, files, { replace: async () => assert.fail("nothing to ask on an empty computer") });
  assert.deepEqual(r.restored.sort(), ["memory/progress.md", "semesters/S/courses/C/01-W/slides.pptx", "semesters/S/notes/n.md"]);
  assert.equal(fresh.read("semesters/S/notes/n.md").toString(), "note");
  assert.deepEqual(fresh.read("semesters/S/courses/C/01-W/slides.pptx"), big);
  assert.equal(existsSync(join(fresh.root, "semesters/S/courses/C/01-W/slides.pptx.ouc-part-001")), false, "no parts left behind");
  assert.equal(existsSync(join(fresh.root, ".ouc", "restore-parts")), false);
});

test("files that differ here are only replaced when the student says so; the same ones are left alone", async () => {
  const old = study({ "memory/b.md": "same", "semesters/S/notes/n.md": "backup note" });
  const remote = bareRemote();
  await backUp(old.root, remote, ["memory/b.md", "semesters/S/notes/n.md"]);

  const here = study({ "memory/b.md": "same", "semesters/S/notes/n.md": "my newer note" });
  let asked: string[] = [];
  const keep = await restoreFiles(here.root, await githubFiles({ root: here.root, remote }), { replace: async (d) => { asked = d; return false; } });
  assert.deepEqual(asked, ["semesters/S/notes/n.md"]);
  assert.deepEqual(keep.kept, ["semesters/S/notes/n.md"]);
  assert.equal(keep.same, 1);
  assert.equal(here.read("semesters/S/notes/n.md").toString(), "my newer note");

  const replace = await restoreFiles(here.root, await githubFiles({ root: here.root, remote }), { replace: async () => true });
  assert.deepEqual(replace.restored, ["semesters/S/notes/n.md"]);
  assert.equal(here.read("semesters/S/notes/n.md").toString(), "backup note");

  const again = await restoreFiles(here.root, await githubFiles({ root: here.root, remote }), { replace: async () => assert.fail("nothing differs now") });
  assert.equal(again.same, 2);
  assert.deepEqual(again.restored, []);
});

test("a class video on this computer is never swapped for the backup's smaller copy", async () => {
  const here = study({ "semesters/S/courses/C/01-W/class.mp4": "the original" });
  const files: RemoteFile[] = [{ path: "semesters/S/courses/C/01-W/class.mp4", same: async () => false, save: async () => assert.fail("not downloaded") }];
  const r = await restoreFiles(here.root, files, { replace: async () => assert.fail("not asked") });
  assert.deepEqual(r.keptVideos, ["semesters/S/courses/C/01-W/class.mp4"]);
  assert.equal(here.read("semesters/S/courses/C/01-W/class.mp4").toString(), "the original");
});

test("only the study files a backup takes can be restored (never code, never outside the folder)", async () => {
  const here = study();
  const saved: string[] = [];
  const f = (path: string): RemoteFile => ({ path, same: async () => false, save: async (to) => { saved.push(path); writeFileSync(to, "x"); } });
  const r = await restoreFiles(here.root, [f("../outside.md"), f("apps/web/src/App.tsx"), f(".eclass-token"), f("semesters/S/../../x.md"), f("memory/ok.md")], {});
  assert.deepEqual(saved, ["memory/ok.md"]);
  assert.deepEqual(r.skipped.sort(), ["../outside.md", ".eclass-token", "apps/web/src/App.tsx", "semesters/S/../../x.md"].sort());
});
