// "Back up now": the saved settings pick the GitHub repo and its sign-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { saveBackupConfig } from "../src/config.ts";
import { backupNow, backupProgress, restoreNow } from "../src/now.ts";

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
function study(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "ouc-now-"));
  for (const [p, b] of Object.entries(files)) { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), b); }
  return root;
}

test("without a backup set up it says so", async () => {
  const s = await backupNow(study({}));
  assert.equal(s.ok, false);
  assert.match(s.error ?? "", /isn't set up/);
});

test("a GitHub backup goes to the saved repo", async () => {
  const root = study({ "semesters/S/notes/n.md": "n" });
  const remote = mkdtempSync(join(tmpdir(), "ouc-now-remote-"));
  git(remote, "init", "--bare", "-q");
  saveBackupConfig(root, { target: "github", repo: "student1/ouc-study-backup", login: "student1", token: "gho_x", remote });
  const s = await backupNow(root);
  assert.equal(s.ok, true);
  assert.equal(s.target, "github");
  assert.equal(git(remote, "ls-tree", "-r", "--name-only", "main"), "semesters/S/notes/n.md");
});

test("a Google Drive setup from an older version asks to set the backup up again", async () => {
  const root = study({ "semesters/S/notes/n.md": "n" });
  mkdirSync(join(root, ".ouc"), { recursive: true });
  writeFileSync(join(root, ".ouc", "backup.json"), JSON.stringify({ target: "drive", refreshToken: "ref" }));
  const s = await backupNow(root);
  assert.equal(s.ok, false);
  assert.match(s.error ?? "", /isn't set up/);
  assert.match((await restoreNow(root)).error ?? "", /isn't set up/);
});

test("only one backup runs at a time", async () => {
  const root = study({ "a.md": "1" });
  const remote = mkdtempSync(join(tmpdir(), "ouc-now-remote-"));
  git(remote, "init", "--bare", "-q");
  saveBackupConfig(root, { target: "github", repo: "s/r", login: "s", token: "t", remote });
  const [a, b] = await Promise.all([backupNow(root), backupNow(root)]);
  assert.equal(a, b, "the second call joins the first");
});

test("restore gets the saved GitHub backup back, and says so when there's nothing to restore from", async () => {
  const none = await restoreNow(study({}));
  assert.match(none.error ?? "", /isn't set up/);

  const old = study({ "semesters/S/notes/n.md": "n" });
  const remote = mkdtempSync(join(tmpdir(), "ouc-now-remote-"));
  git(remote, "init", "--bare", "-q");
  saveBackupConfig(old, { target: "github", repo: "s/r", login: "s", token: "t", remote });
  await backupNow(old);

  const fresh = study({});
  saveBackupConfig(fresh, { target: "github", repo: "s/r", login: "s", token: "t", remote });
  const r = await restoreNow(fresh);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.result?.restored, ["semesters/S/notes/n.md"]);
});

test("while a backup runs, how far it has got can be read; afterwards there's none", async () => {
  const root = study({ "semesters/S/notes/n.md": "n" });
  const remote = mkdtempSync(join(tmpdir(), "ouc-now-remote-"));
  git(remote, "init", "--bare", "-q");
  saveBackupConfig(root, { target: "github", repo: "s/r", login: "s", token: "t", remote });
  const seen: (string | undefined)[] = [];
  await backupNow(root, { onProgress: () => seen.push(backupProgress(root)?.step) });
  assert.ok(seen.includes("saving") && seen.includes("uploading"));
  assert.equal(backupProgress(root), null);
});
