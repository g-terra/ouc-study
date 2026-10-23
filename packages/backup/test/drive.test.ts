// Google Drive backup: sign-in (browser + PKCE), then uploading changed files into "OUC Study backup".
// A local http server stands in for Google's sign-in and the Drive API; never the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fakeDrive } from "./fixtures/fake-drive.ts";
import { driveBackup, exchangeCode, googleAuthUrl, pkce, refreshAccess, waitForGoogleCode } from "../src/drive.ts";

function study(files: Record<string, string | Buffer>) {
  const root = mkdtempSync(join(tmpdir(), "ouc-drive-"));
  const put = (p: string, b: string | Buffer) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), b); };
  for (const [p, b] of Object.entries(files)) put(p, b);
  return { root, put };
}

test("sign-in opens Google with only the Drive files permission and a PKCE challenge", () => {
  const { verifier, challenge } = pkce();
  assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
  const u = new URL(googleAuthUrl({ clientId: "cid", redirectUri: "http://127.0.0.1:5555", challenge, state: "st" }));
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.file");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("state"), "st");
});

test("the browser comes back to the app with the code, and a wrong state is refused", async () => {
  const wait = waitForGoogleCode({ state: "st" });
  const { redirectUri, code } = await wait;
  const r = await fetch(`${redirectUri}/?code=abc&state=st`);
  assert.match(await r.text(), /You can close this tab/);
  assert.equal(await code, "abc");
  const bad = await waitForGoogleCode({ state: "st" });
  await fetch(`${bad.redirectUri}/?code=abc&state=nope`);
  await assert.rejects(bad.code, /didn't match/);
});

test("the code becomes a lasting sign-in, and it gets a fresh access token later", async () => {
  const seen: URLSearchParams[] = [];
  const server = createServer((req, res) => {
    let b = ""; req.on("data", (d) => (b += d));
    req.on("end", () => {
      const f = new URLSearchParams(b); seen.push(f);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(f.get("grant_type") === "authorization_code" ? { access_token: "acc", refresh_token: "ref", expires_in: 3600 } : { access_token: "acc2", expires_in: 3600 }));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const tokenUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/token`;
  try {
    const t = await exchangeCode({ clientId: "cid", clientSecret: "cs", code: "abc", verifier: "v", redirectUri: "http://127.0.0.1:5555", tokenUrl });
    assert.deepEqual(t, { refreshToken: "ref", accessToken: "acc" });
    assert.equal(seen[0].get("code_verifier"), "v");
    assert.equal(await refreshAccess({ clientId: "cid", clientSecret: "cs", refreshToken: "ref", tokenUrl }), "acc2");
    assert.equal(seen[1].get("refresh_token"), "ref");
  } finally { server.closeAllConnections(); server.close(); }
});

test("the first backup makes the folder tree in Drive and uploads every file", async () => {
  const d = await fakeDrive();
  const { root } = study({ "semesters/S/notes/C1/w1.md": "note", "memory/progress.md": "p" });
  try {
    const r = await driveBackup({ root, accessToken: "acc", files: ["memory/progress.md", "semesters/S/notes/C1/w1.md"], api: d.base });
    assert.deepEqual(r, { uploaded: 2, removed: 0 });
    assert.deepEqual(d.files(), { "memory/progress.md": "p", "semesters/S/notes/C1/w1.md": "note" });
  } finally { d.close(); }
});

test("later backups upload only what changed and move removed files to _removed", async () => {
  const d = await fakeDrive();
  const { root, put } = study({ "a.md": "1", "b.md": "1", "c.md": "1" });
  try {
    await driveBackup({ root, accessToken: "acc", files: ["a.md", "b.md", "c.md"], api: d.base });
    d.puts.length = 0;
    put("a.md", "22");
    rmSync(join(root, "c.md"));
    const r = await driveBackup({ root, accessToken: "acc", files: ["a.md", "b.md"], api: d.base });
    assert.deepEqual(r, { uploaded: 1, removed: 1 });
    assert.deepEqual(d.puts, ["a.md"]);
    assert.deepEqual(d.files(), { "a.md": "22", "b.md": "1", "_removed/c.md": "1" });
    assert.deepEqual(await driveBackup({ root, accessToken: "acc", files: ["a.md", "b.md"], api: d.base }), { uploaded: 0, removed: 0 });
  } finally { d.close(); }
});

test("big files go up in chunks, and progress counts the bytes as they go", async () => {
  const d = await fakeDrive();
  const big = Buffer.alloc(600 * 1024, 7);
  const { root } = study({ "semesters/S/courses/C/class.mp4": big });
  const bytes: number[] = [];
  try {
    await driveBackup({ root, accessToken: "acc", files: ["semesters/S/courses/C/class.mp4"], api: d.base, chunkBytes: 256 * 1024, onProgress: (p) => bytes.push(p.bytesDone) });
    const it = [...d.items.values()].find((i) => i.name === "class.mp4");
    assert.equal(it?.data.length, big.length);
    assert.deepEqual(bytes, [0, 256 * 1024, 512 * 1024, big.length, big.length]);
  } finally { d.close(); }
});

test("an expired sign-in says so", async () => {
  const d = await fakeDrive();
  const { root } = study({ "a.md": "1" });
  try {
    await assert.rejects(driveBackup({ root, accessToken: "old", files: ["a.md"], api: d.base }), /Google sign-in expired/);
  } finally { d.close(); }
});

test("a file can go up from somewhere else under its backup name (a video's smaller copy)", async () => {
  const d = await fakeDrive();
  const { root, put } = study({ "semesters/S/class.mp4": "the big original" });
  put(".ouc/backup-media/videos/k.mp4", "small");
  try {
    await driveBackup({ root, accessToken: "acc", files: ["semesters/S/class.mp4"], from: { "semesters/S/class.mp4": join(root, ".ouc/backup-media/videos/k.mp4") }, api: d.base });
    assert.deepEqual(d.files(), { "semesters/S/class.mp4": "small" });
  } finally { d.close(); }
});
