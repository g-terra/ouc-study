// "Back up now": the saved settings pick the target (GitHub or Google Drive) and its sign-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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

test("a Google Drive backup gets a fresh access token first, and an expired sign-in says so", async () => {
  const root = study({ "semesters/S/notes/n.md": "n" });
  let expired = false;
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    let b = ""; req.on("data", (d) => (b += d));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/token") {
        if (expired) { res.statusCode = 400; return res.end(JSON.stringify({ error: "invalid_grant" })); }
        return res.end(JSON.stringify({ access_token: "acc", expires_in: 3600 }));
      }
      if (req.headers.authorization !== "Bearer acc") { res.statusCode = 401; return res.end("{}"); }
      if (req.url?.startsWith("/drive/v3/files?")) return res.end(JSON.stringify({ files: [] }));
      if (req.url === "/drive/v3/files") return res.end(JSON.stringify({ id: "folder" }));
      if (req.url?.startsWith("/upload/")) { res.setHeader("location", `http://${req.headers.host}/session/1`); return res.end(); }
      res.end(JSON.stringify({ id: "file1" }));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    saveBackupConfig(root, { target: "drive", refreshToken: "ref" });
    const s = await backupNow(root, { google: { clientId: "cid", clientSecret: "cs" }, tokenUrl: `${base}/token`, driveApi: base });
    assert.equal(s.ok, true, s.error ?? "");
    assert.equal(s.target, "drive");
    assert.ok(seen.includes("PUT /session/1"));
    expired = true;
    const bad = await backupNow(root, { google: { clientId: "cid", clientSecret: "cs" }, tokenUrl: `${base}/token`, driveApi: base });
    assert.equal(bad.ok, false);
    assert.match(bad.error ?? "", /Google sign-in expired/);
  } finally { server.closeAllConnections(); server.close(); }
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
