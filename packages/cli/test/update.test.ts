// Updates from GitHub releases (lib/update.mjs), tested against a throwaway git "GitHub" on disk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyUpdate, checkForUpdate, isNewer, newestTag, repoFromRemote } from "../src/update.ts";

test("versions: newer, newest tag, repo from the remote URL", () => {
  assert.ok(isNewer("0.10.0", "0.9.9"));
  assert.ok(isNewer("v1.0.0", "0.99.0"));
  assert.ok(!isNewer("0.2.1", "0.2.1"));
  assert.ok(!isNewer("nonsense", "0.1.0"));
  assert.equal(newestTag(["v0.2.0", "v0.10.1", "v0.9.0", "latest", ""]), "v0.10.1");
  assert.equal(newestTag([]), null);
  assert.equal(repoFromRemote("https://github.com/g-terra/ouc-study.git"), "g-terra/ouc-study");
  assert.equal(repoFromRemote("git@github.com:someone/fork.git\n"), "someone/fork");
  assert.equal(repoFromRemote("https://gitlab.com/x/y"), null);
});

const tmp = () => mkdtempSync(join(tmpdir(), "ouc-update-"));
const sh = (cwd: string, ...a: string[]) => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const release = (dir: string, version: string, files: Record<string, string> = {}) => {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version }));
  for (const [f, body] of Object.entries(files)) { mkdirSync(join(dir, f, ".."), { recursive: true }); writeFileSync(join(dir, f), body); }
  sh(dir, "add", "-A"); sh(dir, "commit", "-qm", `release ${version}`);
};

/** A "GitHub" (bare repo) with v0.1.0, and a student's clone of it at v0.1.0. */
function setup() {
  const base = tmp(), origin = join(base, "origin.git"), dev = join(base, "dev"), student = join(base, "student");
  sh(base, "init", "-q", "--bare", "-b", "main", origin);
  sh(base, "clone", "-q", origin, dev);
  sh(dev, "checkout", "-qb", "main");
  release(dev, "0.1.0", { "package-lock.json": "{}" }); sh(dev, "tag", "v0.1.0"); sh(dev, "push", "-q", "--tags", "origin", "main");
  sh(base, "clone", "-q", origin, student);
  return { base, dev, student, done: () => rmSync(base, { recursive: true, force: true }) };
}
const recorder = () => { const calls: string[] = []; return { calls, run: (cmd: string, args: string[]) => { calls.push([cmd, ...args].join(" ")); return true; } }; };

test("ouc update moves to the newest release tag, not past it, and reinstalls with npm ci when the lockfile changed", () => {
  const { dev, student, done } = setup();
  try {
    release(dev, "0.2.0", { "package-lock.json": '{"v":2}' }); sh(dev, "tag", "v0.2.0");
    release(dev, "0.2.1-dev", { "src.txt": "not released yet" });
    sh(dev, "push", "-q", "--tags", "origin", "main");
    const { calls, run } = recorder();
    const r = applyUpdate(student, { run });
    assert.equal(r.ok, true); assert.equal(r.changed, true);
    assert.equal(JSON.parse(readFileSync(join(student, "package.json"), "utf8")).version, "0.2.0");
    assert.deepEqual(calls, ["npm ci --no-audit --no-fund"]);
    // a second run: nothing new
    assert.equal(applyUpdate(student, { run }).changed, false);
    // --latest follows main past the release
    assert.equal(applyUpdate(student, { run, latest: true }).changed, true);
    assert.equal(JSON.parse(readFileSync(join(student, "package.json"), "utf8")).version, "0.2.1-dev");
    // and then the release is behind: it stays put
    assert.equal(applyUpdate(student, { run }).message, "Ahead of the latest release");
  } finally { done(); }
});

test("ouc update never touches local code edits", () => {
  const { dev, student, done } = setup();
  try {
    release(dev, "0.2.0"); sh(dev, "tag", "v0.2.0"); sh(dev, "push", "-q", "--tags", "origin", "main");
    writeFileSync(join(student, "package.json"), "edited");
    const r = applyUpdate(student, { run: recorder().run });
    assert.equal(r.ok, false);
    assert.match(r.message, /local code changes/);
    assert.equal(readFileSync(join(student, "package.json"), "utf8"), "edited");
  } finally { done(); }
});

test("ouc update works without an injected runner: the real one runs the AI skills install after ai/ changed", () => {
  // the tests above inject `run`; this one uses the default, which once crashed every `ouc restart`
  const { dev, student, done } = setup();
  try {
    mkdirSync(join(student, "node_modules/vite/bin"), { recursive: true }); writeFileSync(join(student, "node_modules/vite/bin/vite.js"), "");
    release(dev, "0.2.0", { "ai/skills/x/SKILL.md": "new", "bin/ai.mjs": 'import { writeFileSync } from "node:fs"; writeFileSync("installed.txt", process.argv[2]);' });
    sh(dev, "tag", "v0.2.0"); sh(dev, "push", "-q", "--tags", "origin", "main");
    const r = applyUpdate(student);
    assert.equal(r.ok, true); assert.equal(r.changed, true);
    assert.equal(readFileSync(join(student, "installed.txt"), "utf8"), "install");
  } finally { done(); }
});

test("the update check compares the latest GitHub release with package.json and asks at most once a day", async () => {
  const { student, done } = setup();
  try {
    let asked = 0;
    const fetchImpl = async (url: string) => { asked++; assert.match(url, /\/releases\/latest$/); return { ok: true, json: async () => ({ tag_name: "v0.3.0", body: "* **web:** a thing", html_url: "https://example/r" }) }; };
    const now = Date.parse("2026-10-18T12:00:00Z");
    const u = await checkForUpdate(student, { fetchImpl, now });
    assert.deepEqual([u.current, u.latest, u.available, u.url], ["0.1.0", "0.3.0", true, "https://example/r"]);
    await checkForUpdate(student, { fetchImpl, now: now + 60 * 60_000 });
    assert.equal(asked, 1, "cached for a day");
    await checkForUpdate(student, { fetchImpl, now: now + 25 * 60 * 60_000 });
    assert.equal(asked, 2);
    // GitHub API refused (rate limit, shared campus network) or unreachable: the newest tag on the git remote tells
    const limited = await checkForUpdate(student, { fresh: true, fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) }), now });
    assert.deepEqual([limited.latest, limited.available, limited.notes], ["0.1.0", false, ""]);
  } finally { done(); }
});
