// App updates from GitHub releases: is there a newer release, and move this checkout to it.
// Used by `ouc update` / `ouc restart` and by the app's "Update available" banner (/api/update in vite.config.ts).
// Releases are the vX.Y.Z tags release-please makes on main; `ouc update --main` follows main itself.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DEFAULT_REPO = "g-terra/ouc-study";
const DAY = 24 * 60 * 60_000;

/** "v1.2.3" or "1.2.3" → [1, 2, 3]; anything else → null. */
export function parseVersion(v) {
  const m = String(v ?? "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return m ? m.slice(1).map(Number) : null;
}
/** Is version a newer than b? */
export function isNewer(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
/** The newest vX.Y.Z of a list of tags, or null. */
export function newestTag(tags) {
  return tags.filter(parseVersion).reduce((best, t) => (!best || isNewer(t, best) ? t : best), null);
}
/** "owner/repo" from a GitHub remote URL (https or ssh), or null. */
export function repoFromRemote(url) {
  return String(url ?? "").trim().match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/)?.[1] ?? null;
}

const git = (root, ...a) => spawnSync("git", ["-C", root, ...a], { encoding: "utf8" });
export const localVersion = (root) => { try { return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? null; } catch { return null; } };
const repoSlug = (root) => repoFromRemote(git(root, "remote", "get-url", "origin").stdout) ?? DEFAULT_REPO;
/** The newest vX.Y.Z tag on GitHub, read with git (no API rate limit), or null. */
const remoteTag = (root) => {
  const r = spawnSync("git", ["-C", root, "ls-remote", "--tags", "--refs", "origin", "v*"], { encoding: "utf8", timeout: 15_000 });
  return r.status === 0 ? newestTag(r.stdout.split(/\r?\n/).map((l) => l.split("refs/tags/")[1] ?? "")) : null;
};
const cacheFile = (root) => join(root, ".ouc/update.json");

/**
 * Is a newer release out? { current, latest, available, notes, url, checkedAt, error? }
 * Asks GitHub at most once a day (fresh: now), so the app and `ouc status` can call it freely.
 */
export async function checkForUpdate(root, { fresh = false, fetchImpl = fetch, now = Date.now() } = {}) {
  const current = localVersion(root);
  let cached;
  try { cached = JSON.parse(readFileSync(cacheFile(root), "utf8")); } catch {}
  let rel = cached;
  if (!rel || fresh || now - Date.parse(rel.checkedAt ?? 0) > DAY) {
    try {
      const r = await fetchImpl(`https://api.github.com/repos/${repoSlug(root)}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "ouc-study" }, signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      const j = await r.json();
      rel = { latest: String(j.tag_name ?? "").replace(/^v/, ""), notes: j.body ?? "", url: j.html_url ?? "", publishedAt: j.published_at ?? null, checkedAt: new Date(now).toISOString() };
      try { mkdirSync(dirname(cacheFile(root)), { recursive: true }); writeFileSync(cacheFile(root), JSON.stringify(rel, null, 2)); } catch {}
    } catch (e) {
      // the GitHub API allows 60 calls an hour per network (shared on campus Wi-Fi): fall back to the git tags
      const tag = remoteTag(root);
      if (tag) rel = { latest: tag.replace(/^v/, ""), notes: "", url: `https://github.com/${repoSlug(root)}/releases/tag/${tag}`, checkedAt: new Date(now).toISOString() };
      else if (!rel) return { current, latest: null, available: false, error: `Couldn't check for updates (${e.message})` };
    }
  }
  return { current, ...rel, available: isNewer(rel.latest, current) };
}

/**
 * Move this git checkout to the newest release (or, with latest, to the newest code on its branch),
 * then reinstall what changed: a clean `npm ci` when the dependencies changed, the AI skills when ai/ did.
 * Never touches local code edits. Returns { ok, changed, message }; log(kind, text) reports progress.
 */
export function applyUpdate(root, { latest = false, log = () => {}, run = defaultRun } = {}) {
  const fail = (message) => { log("warn", message); return { ok: false, changed: false, message }; };
  if (git(root, "rev-parse", "--is-inside-work-tree").status !== 0) return fail("Not a git checkout, so no code update (download the latest from GitHub instead).");
  if (git(root, "status", "--porcelain", "--untracked-files=no").stdout.trim()) return fail("You have local code changes, so the code wasn't updated (commit or stash them, then: ouc update).");
  const branch = git(root, "rev-parse", "--abbrev-ref", "HEAD").stdout.trim();
  const before = git(root, "rev-parse", "HEAD").stdout.trim();
  if (git(root, "fetch", "--tags", "--quiet", "origin").status !== 0) return fail("Couldn't reach GitHub (offline?). Carrying on with this version.");

  const tag = newestTag(git(root, "tag", "--list", "v*").stdout.split(/\r?\n/).map((t) => t.trim()));
  const onReleases = !latest && branch === "main" && tag;
  if (onReleases) {
    const tagSha = git(root, "rev-list", "-n", "1", tag).stdout.trim();
    if (tagSha === before) { log("ok", `Up to date: v${localVersion(root)}`); return { ok: true, changed: false, message: "Up to date" }; }
    // already past the release (code from main that isn't released yet): nothing to do
    if (git(root, "merge-base", "--is-ancestor", tag, "HEAD").status === 0) { log("ok", `Up to date: v${localVersion(root)} (newer than the latest release ${tag})`); return { ok: true, changed: false, message: "Ahead of the latest release" }; }
    if (git(root, "merge-base", "--is-ancestor", "HEAD", tag).status !== 0) return fail(`Your branch has commits that aren't in ${tag}, so it wasn't moved. To follow main instead: ouc update --main`);
    if (git(root, "merge", "--ff-only", "--quiet", tag).status !== 0) return fail(`Couldn't move to ${tag}.`);
  } else {
    if (git(root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}").status !== 0) return fail("This branch doesn't track GitHub, so no code update.");
    if (git(root, "merge", "--ff-only", "--quiet", "@{u}").status !== 0) return fail("Couldn't update: your branch differs from GitHub. Carrying on with this version.");
  }
  const after = git(root, "rev-parse", "HEAD").stdout.trim();
  if (before === after) { log("ok", "Code is up to date"); return { ok: true, changed: false, message: "Up to date" }; }
  log("ok", onReleases ? `Updated to ${tag}` : `Code updated: ${git(root, "rev-list", "--count", `${before}..${after}`).stdout.trim()} new change(s), now at ${git(root, "log", "-1", "--format=%h %s").stdout.trim()}`);
  rmSync(cacheFile(root), { force: true });

  const changed = git(root, "diff", "--name-only", before, after).stdout.split(/\r?\n/);
  if (changed.some((f) => /(^|\/)package(-lock)?\.json$/.test(f)) || !existsSync(join(root, "node_modules/vite/bin/vite.js"))) {
    // a clean install: `npm install` over old node_modules can keep stale copies (it once left Vite 6 next to Vite 8)
    log("warn", "Dependencies changed, reinstalling them (npm ci)…");
    if (!run("npm", ["ci", "--no-audit", "--no-fund"])) {
      log("warn", "npm ci failed, trying npm install…");
      if (!run("npm", ["install", "--no-audit", "--no-fund"])) return fail(`Installing dependencies failed; run "npm ci" in ${root}`);
    }
  }
  if (changed.some((f) => f.startsWith("ai/")) && !run(process.execPath, [join(root, "bin/ai.mjs"), "install"])) log("warn", "Couldn't reinstall the AI skills (ouc ai install)");
  return { ok: true, changed: true, message: onReleases ? `Updated to ${tag}` : "Updated" };

  function defaultRun(cmd, args) {
    // npm is npm.cmd on Windows, which needs a shell (the arguments here are fixed)
    return spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" && cmd === "npm" }).status === 0;
  }
}

/**
 * Run `ouc restart` (stop, update, start) in a process that outlives the app that asked for it:
 * a short-lived launcher starts it detached and exits, so stopping the app (launchd, or taskkill /T
 * on Windows) doesn't take the updater down with it. Output goes to .ouc/update.log.
 */
export function restartDetached(root) {
  mkdirSync(join(root, ".ouc"), { recursive: true });
  const log = join(root, ".ouc/update.log");
  writeFileSync(log, `[${new Date().toISOString()}] Update requested from the app\n`);
  const inner = `const{spawn}=require("node:child_process"),fs=require("node:fs");const fd=fs.openSync(${JSON.stringify(log)},"a");` +
    `spawn(process.execPath,[${JSON.stringify(join(root, "bin/ouc.mjs"))},"restart"],{cwd:${JSON.stringify(root)},detached:true,stdio:["ignore",fd,fd],windowsHide:true,env:{...process.env,NO_COLOR:"1"}}).unref();`;
  spawn(process.execPath, ["-e", inner], { cwd: root, detached: true, stdio: "ignore", windowsHide: true }).unref();
}
