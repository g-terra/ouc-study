// /api/backup: what Settings › Backup and the one-time prompt talk to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackupApi } from "../src/api.ts";
import { loadBackupConfig, saveBackupConfig } from "../src/config.ts";
import type { BackupStatus } from "../src/run.ts";

async function serve(listener: RequestListener) {
  const server = createServer(listener);
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => { server.closeAllConnections(); server.close(); } };
}
/** the app's server with the backup API, and a fake GitHub API */
async function app(o: { now?: Date; githubClientId?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ouc-api-"));
  const runs: string[] = [];
  const gh = await serve((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.headers.authorization === "Bearer bad") { res.statusCode = 401; return res.end("{}"); }
    if (req.url === "/user") return res.end(JSON.stringify({ login: "student1" }));
    if (req.method === "GET") { res.statusCode = 404; return res.end("{}"); }
    res.statusCode = 201;
    res.end(JSON.stringify({ full_name: "student1/ouc-study-backup", private: true }));
  });
  const done: BackupStatus = { ok: true, target: "github", at: "2026-10-22T18:04:00.000Z", summary: "1 note", files: 1, bytes: 1 };
  const handler = createBackupApi({
    root, githubApi: gh.base, githubClientId: o.githubClientId ?? "", now: () => o.now ?? new Date("2026-10-22T12:00:00Z"),
    backup: async (r) => { runs.push(r); return done; },
  });
  const web = await serve((req, res) => handler(req, res, () => { res.statusCode = 404; res.end(); }));
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${web.base}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
    return { status: r.status, json: await r.json() as any };
  };
  return { root, runs, call, close: () => { gh.close(); web.close(); } };
}

test("before setup it says so, offers the token route, and asks to show the prompt", async () => {
  const a = await app();
  try {
    const { json } = await a.call("GET", "/api/backup");
    assert.equal(json.setup, null);
    assert.equal(json.prompt, "show");
    assert.deepEqual(json.can, { githubDevice: false });
  } finally { a.close(); }
});

test("a Google Drive setup from an older version counts as not set up, so the prompt asks again", async () => {
  const a = await app();
  try {
    mkdirSync(join(a.root, ".ouc"), { recursive: true });
    writeFileSync(join(a.root, ".ouc", "backup.json"), JSON.stringify({ target: "drive", refreshToken: "ref" }));
    const { json } = await a.call("GET", "/api/backup");
    assert.equal(json.setup, null);
    assert.equal(json.prompt, "show");
  } finally { a.close(); }
});

test("connecting with a GitHub token saves the repo, never sends the token back, and starts the first backup", async () => {
  const a = await app();
  try {
    const r = await a.call("POST", "/api/backup/github/token", { token: "gho_x" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.setup, { target: "github", repo: "student1/ouc-study-backup", login: "student1" });
    assert.equal(JSON.stringify(r.json).includes("gho_x"), false);
    assert.equal(loadBackupConfig(a.root)?.target, "github");
    assert.deepEqual(a.runs, [a.root]);
    assert.equal((await a.call("GET", "/api/backup")).json.prompt, "hide", "no prompt once it's set up");
  } finally { a.close(); }
});

test("a token that doesn't work gives the reason", async () => {
  const a = await app();
  try {
    const r = await a.call("POST", "/api/backup/github/token", { token: "bad" });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /expired|sign in/i);
    assert.equal(loadBackupConfig(a.root), null);
  } finally { a.close(); }
});

test("Back up now runs a backup and the status shows it", async () => {
  const a = await app();
  try {
    saveBackupConfig(a.root, { target: "github", repo: "s/r", login: "s", token: "t" });
    const r = await a.call("POST", "/api/backup/run");
    assert.equal(r.json.ok, true);
    assert.deepEqual(a.runs, [a.root]);
  } finally { a.close(); }
});

test("choices are saved with the setup, and disconnecting forgets the sign-in", async () => {
  const a = await app();
  try {
    saveBackupConfig(a.root, { target: "github", repo: "s/r", login: "s", token: "t" });
    await a.call("POST", "/api/backup/choices", { auto: false, videos: false, token: "sneaky" });
    const cfg = loadBackupConfig(a.root);
    assert.equal(cfg?.auto, false);
    assert.equal(cfg?.videos, false);
    assert.equal(cfg?.target === "github" && cfg.token, "t", "choices can't change the sign-in");
    assert.deepEqual((await a.call("GET", "/api/backup")).json.choices, { auto: false, courseFiles: true, videos: false });
    await a.call("POST", "/api/backup/disconnect");
    assert.equal(loadBackupConfig(a.root), null);
  } finally { a.close(); }
});

test("Don't ask again hides the prompt for good", async () => {
  const a = await app();
  try {
    await a.call("POST", "/api/backup/prompt", { action: "never" });
    assert.equal((await a.call("GET", "/api/backup")).json.prompt, "hide");
  } finally { a.close(); }
});

test("Later hides the prompt for a week, then it comes back", async () => {
  let now = new Date("2026-10-22T12:00:00Z");
  const root = mkdtempSync(join(tmpdir(), "ouc-api-"));
  const handler = createBackupApi({ root, githubClientId: "", now: () => now, backup: async () => ({}) as BackupStatus });
  const web = await serve((req, res) => handler(req, res, () => {}));
  const get = async () => ((await (await fetch(`${web.base}/api/backup`)).json()) as { prompt: string }).prompt;
  try {
    await fetch(`${web.base}/api/backup/prompt`, { method: "POST", body: JSON.stringify({ action: "later" }) });
    assert.equal(await get(), "hide");
    now = new Date("2026-10-29T12:00:01Z");
    assert.equal(await get(), "show");
  } finally { web.close(); }
});

test("only pages from this computer may use it", async () => {
  const root = mkdtempSync(join(tmpdir(), "ouc-api-"));
  const handler = createBackupApi({ root, githubClientId: "", backup: async () => ({}) as BackupStatus });
  const web = await serve((req, res) => handler(req, res, () => {}));
  try {
    const r = await fetch(`${web.base}/api/backup/disconnect`, { method: "POST", headers: { origin: "https://evil.example" } });
    assert.equal(r.status, 403);
  } finally { web.close(); }
});

test("the automatic run after a sync only backs up when it's set up and left on", async () => {
  const a = await app();
  try {
    assert.deepEqual((await a.call("POST", "/api/backup/run?auto=1")).json, { skipped: true });
    saveBackupConfig(a.root, { target: "github", repo: "s/r", login: "s", token: "t", auto: false });
    assert.deepEqual((await a.call("POST", "/api/backup/run?auto=1")).json, { skipped: true });
    saveBackupConfig(a.root, { target: "github", repo: "s/r", login: "s", token: "t" });
    assert.equal((await a.call("POST", "/api/backup/run?auto=1")).json.ok, true);
    assert.equal(a.runs.length, 1);
  } finally { a.close(); }
});

test("the prompt can be turned off for the whole app (the smoke tests)", async () => {
  const root = mkdtempSync(join(tmpdir(), "ouc-api-"));
  const handler = createBackupApi({ root, githubClientId: "", askToSetUp: false, backup: async () => ({}) as BackupStatus });
  const web = await serve((req, res) => handler(req, res, () => {}));
  try {
    assert.equal(((await (await fetch(`${web.base}/api/backup`)).json()) as { prompt: string }).prompt, "hide");
  } finally { web.close(); }
});
