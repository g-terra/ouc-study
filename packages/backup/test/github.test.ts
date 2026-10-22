// GitHub sign-in (device code), the private backup repo and handing the sign-in to git.
// A local http server stands in for github.com and api.github.com; never the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensurePrivateRepo, gitAuthEnv, githubRemote, githubUser, startDeviceLogin, waitForDeviceToken } from "../src/github.ts";
import { connectGithub, loadBackupConfig, saveBackupConfig } from "../src/config.ts";

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
async function fake(handler: Handler) {
  const seen: { method: string; url: string; body: string; auth?: string }[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", body, auth: req.headers.authorization });
      handler(req, body, res);
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, seen, close: () => { server.closeAllConnections(); server.close(); } };
}
const json = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const noSleep = async () => {};

test("sign-in starts with a code for the student to type on github.com/login/device", async () => {
  const gh = await fake((req, body, res) => json(res, 200, { device_code: "dev1", user_code: "WDJB-MJHT", verification_uri: "https://github.com/login/device", interval: 5, expires_in: 900 }));
  try {
    const s = await startDeviceLogin({ clientId: "Iv1.abc", base: gh.base });
    assert.deepEqual(s, { deviceCode: "dev1", userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", interval: 5, expiresIn: 900 });
    assert.equal(gh.seen[0].url, "/login/device/code");
    assert.deepEqual(Object.fromEntries(new URLSearchParams(gh.seen[0].body)), { client_id: "Iv1.abc", scope: "repo" });
  } finally { gh.close(); }
});

test("it waits while the student types the code, slows down when asked, and returns the sign-in", async () => {
  const answers = [{ error: "authorization_pending" }, { error: "slow_down", interval: 10 }, { access_token: "gho_x", token_type: "bearer" }];
  const gh = await fake((req, body, res) => json(res, 200, answers.shift()));
  const waits: number[] = [];
  try {
    const token = await waitForDeviceToken({ clientId: "Iv1.abc", deviceCode: "dev1", interval: 5, base: gh.base, sleep: async (ms) => { waits.push(ms); } });
    assert.equal(token, "gho_x");
    assert.deepEqual(waits, [5000, 5000, 10000]);
    assert.equal(new URLSearchParams(gh.seen[0].body).get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
  } finally { gh.close(); }
});

test("a cancelled or expired code says so in plain words", async () => {
  for (const [error, words] of [["access_denied", /cancelled/], ["expired_token", /expired/]] as const) {
    const gh = await fake((req, body, res) => json(res, 200, { error }));
    try {
      await assert.rejects(waitForDeviceToken({ clientId: "c", deviceCode: "d", interval: 1, base: gh.base, sleep: noSleep }), words);
    } finally { gh.close(); }
  }
});

test("finds who signed in", async () => {
  const api = await fake((req, body, res) => json(res, 200, { login: "student1" }));
  try {
    assert.equal(await githubUser("tok", api.base), "student1");
    assert.equal(api.seen[0].auth, "Bearer tok");
  } finally { api.close(); }
});

test("makes the private backup repo when it doesn't exist yet", async () => {
  const api = await fake((req, body, res) => {
    if (req.method === "GET") return json(res, 404, { message: "Not Found" });
    json(res, 201, { full_name: "student1/ouc-study-backup", private: true });
  });
  try {
    assert.equal(await ensurePrivateRepo("tok", "student1", "ouc-study-backup", api.base), "student1/ouc-study-backup");
    const made = api.seen.find((s) => s.method === "POST");
    assert.equal(made?.url, "/user/repos");
    assert.equal(JSON.parse(made?.body ?? "{}").private, true);
  } finally { api.close(); }
});

test("uses the repo when it is already there and private, and refuses a public one", async () => {
  let isPrivate = true;
  const api = await fake((req, body, res) => json(res, 200, { full_name: "student1/ouc-study-backup", private: isPrivate }));
  try {
    assert.equal(await ensurePrivateRepo("tok", "student1", "ouc-study-backup", api.base), "student1/ouc-study-backup");
    assert.equal(api.seen.some((s) => s.method === "POST"), false);
    isPrivate = false;
    await assert.rejects(ensurePrivateRepo("tok", "student1", "ouc-study-backup", api.base), /public/);
  } finally { api.close(); }
});

test("git gets the sign-in as a header, never in the repo address or its settings", async () => {
  const host = await fake((req, body, res) => { res.writeHead(401, { "www-authenticate": "Basic realm=x" }); res.end(); });
  const gitDir = mkdtempSync(join(tmpdir(), "ouc-auth-"));
  try {
    execFileSync("git", ["init", "-q", "--bare", gitDir]);
    // async: the fake host runs in this process and must answer while git waits
    await new Promise((done) => spawn("git", [`--git-dir=${gitDir}`, "ls-remote", `${host.base}/student1/ouc-study-backup.git`], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...gitAuthEnv("gho_secret", `${host.base}/`) }, stdio: "ignore",
    }).on("close", done));
    const sent = host.seen[0]?.auth ?? "";
    assert.equal(sent, `Basic ${Buffer.from("x-access-token:gho_secret").toString("base64")}`);
    assert.equal(readFileSync(join(gitDir, "config"), "utf8").includes("gho_secret"), false);
    assert.equal(githubRemote("student1/ouc-study-backup"), "https://github.com/student1/ouc-study-backup.git");
  } finally { host.close(); }
});

test("the backup settings are saved only for this user to read", { skip: process.platform === "win32" && "no file modes on Windows" }, () => {
  const root = mkdtempSync(join(tmpdir(), "ouc-cfg-"));
  assert.equal(loadBackupConfig(root), null);
  saveBackupConfig(root, { target: "github", repo: "student1/ouc-study-backup", login: "student1", token: "gho_x" });
  assert.deepEqual(loadBackupConfig(root), { target: "github", repo: "student1/ouc-study-backup", login: "student1", token: "gho_x" });
  assert.equal(statSync(join(root, ".ouc", "backup.json")).mode & 0o077, 0);
});

test("connecting with a sign-in finds the student, makes the private repo and saves both", async () => {
  const api = await fake((req, body, res) => {
    if (req.url === "/user") return json(res, 200, { login: "student1" });
    if (req.method === "GET") return json(res, 404, {});
    json(res, 201, { full_name: "student1/ouc-study-backup", private: true });
  });
  const root = mkdtempSync(join(tmpdir(), "ouc-connect-"));
  try {
    const cfg = await connectGithub({ root, token: "gho_x", api: api.base });
    assert.deepEqual(cfg, { target: "github", repo: "student1/ouc-study-backup", login: "student1", token: "gho_x" });
    assert.deepEqual(loadBackupConfig(root), cfg);
  } finally { api.close(); }
});

test("a sign-in that doesn't work saves nothing", async () => {
  const api = await fake((req, body, res) => json(res, 401, { message: "Bad credentials" }));
  const root = mkdtempSync(join(tmpdir(), "ouc-connect-"));
  try {
    await assert.rejects(connectGithub({ root, token: "bad", api: api.base }), /expired|sign in/i);
    assert.equal(loadBackupConfig(root), null);
  } finally { api.close(); }
});
