// `ouc backup` and the backup step of `ouc setup`: the questions they ask and what they save.
// The terminal is a scripted list of answers; GitHub is a local fake server, and the backup a local bare repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadBackupConfig, saveBackupConfig } from "../../backup/src/config.ts";
import { backupNow } from "../../backup/src/now.ts";
import { backupStep, restoreStep, sayTokenHelp, type BackupIo } from "../src/backup.ts";

function study(files: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "ouc-cli-backup-"));
  for (const [p, b] of Object.entries(files)) { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), b); }
  return root;
}
async function serve(listener: RequestListener) {
  const server = createServer(listener);
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => { server.closeAllConnections(); server.close(); } };
}
const fakeGithub = () => serve((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/user") return res.end(JSON.stringify({ login: "student1" }));
  if (req.method === "GET") { res.statusCode = 404; return res.end("{}"); }
  res.statusCode = 201;
  res.end(JSON.stringify({ full_name: "student1/ouc-study-backup", private: true }));
});

/** a terminal that answers from `answers` in order and records what was said */
function io(answers: (string | boolean)[]): BackupIo & { said: string[]; asked: string[] } {
  const said: string[] = [];
  const asked: string[] = [];
  const next = (q: string) => { asked.push(q); if (!answers.length) throw new Error(`no answer left for: ${q}`); return answers.shift()!; };
  return {
    said, asked,
    select: async (q, choices) => { const a = next(q); const c = choices.find((x) => x.value === a); assert.ok(c, `no choice ${a} for ${q}`); return c.value; },
    secret: async (q) => String(next(q)),
    confirm: async (q) => Boolean(next(q)),
    say: (s) => said.push(s), ok: (s) => said.push(`✓ ${s}`), warn: (s) => said.push(`⚠ ${s}`),
    open: (url) => said.push(`open ${url}`),
  };
}

test("setup's backup step connects GitHub with a token and saves it, never showing the token", async () => {
  const gh = await fakeGithub();
  try {
    const root = study();
    const t = io(["github", "gho_secret"]);
    const done = await backupStep(root, t, { githubApi: gh.base, githubClientId: "" });
    assert.equal(done, true);
    assert.equal(loadBackupConfig(root)?.target, "github");
    assert.equal(t.said.join("\n").includes("gho_secret"), false);
    assert.ok(t.said.some((s) => s.includes("student1/ouc-study-backup")));
  } finally { gh.close(); }
});

test("skipping the step asks again later in the app, not never", async () => {
  const root = study();
  const done = await backupStep(root, io(["skip"]), { githubClientId: "" });
  assert.equal(done, false);
  assert.equal(loadBackupConfig(root), null);
  const p = JSON.parse(readFileSync(join(root, ".ouc", "backup-prompt.json"), "utf8"));
  assert.ok(p.snoozedUntil && !p.never);
});

test("the only place to back up to is a private GitHub repo (or not now)", async () => {
  const root = study();
  const t = io(["skip"]);
  let offered: unknown[] = [];
  t.select = async (_q, choices) => { offered = choices.map((c) => c.value); return "skip" as never; };
  await backupStep(root, t, { githubClientId: "" });
  assert.deepEqual(offered, ["github", "skip"]);
});

test("restore asks once about files that differ here, and keeps them on no", async () => {
  const old = study({ "semesters/S/notes/a.md": "backup a", "semesters/S/notes/b.md": "b" });
  const remote = mkdtempSync(join(tmpdir(), "ouc-cli-remote-"));
  execFileSync("git", ["init", "--bare", "-q", remote]);
  saveBackupConfig(old, { target: "github", repo: "s/r", login: "s", token: "t", remote });
  assert.equal((await backupNow(old)).ok, true);

  const here = study({ "semesters/S/notes/a.md": "mine" });
  saveBackupConfig(here, { target: "github", repo: "s/r", login: "s", token: "t", remote });
  const t = io([false]);
  const r = await restoreStep(here, t);
  assert.equal(r, true);
  assert.equal(t.asked.length, 1);
  assert.match(t.asked[0], /1 file/);
  assert.ok(t.said.some((s) => s.includes("semesters/S/notes/a.md")), "names the file");
  assert.equal(readFileSync(join(here, "semesters/S/notes/a.md"), "utf8"), "mine");
  assert.equal(readFileSync(join(here, "semesters/S/notes/b.md"), "utf8"), "b");
  assert.ok(existsSync(join(here, ".ouc", "backup.git")));
});

test("the token help in Terminal gives both ways, with the commands for this computer", () => {
  const said: string[] = [];
  sayTokenHelp({ say: (s) => said.push(s) }, "mac");
  const text = said.join("\n");
  assert.match(text, /With the GitHub CLI \(gh\)/);
  assert.match(text, /gh auth token \| pbcopy/);
  assert.match(text, /github\.com\/new\?name=ouc-study-backup&visibility=private/);
  assert.match(text, /Contents → Read and write/);
});

test("without a sign-in app, setup shows how to get a token before asking for it", async () => {
  const root = study();
  const t = io(["github", ""]);
  await backupStep(root, t, { githubClientId: "" });
  assert.ok(t.said.some((s) => s.includes("gh auth token")));
});
