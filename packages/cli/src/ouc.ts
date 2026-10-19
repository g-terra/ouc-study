// ouc: control the OUC Study app and the eClass sync from a terminal (macOS, Windows, Linux).
//   ouc setup | start | stop | restart | update | status | open | sync | pull | logs [app|sync] | install | uninstall | help
// Started through bin/ouc (macOS/Linux) or bin/ouc.cmd (Windows). Background details: background.ts.
import { spawn, spawnSync, type SpawnSyncOptions } from "node:child_process";
import { accessSync, appendFileSync, chmodSync, closeSync, constants, existsSync, lstatSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, unwatchFile, watchFile } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { service } from "./background.ts";
import { applyUpdate, checkForUpdate } from "./update.ts";
import { installDeps, missingDeps, npmRunner } from "./deps.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OS = process.platform;
const MAC = OS === "darwin";
const WIN = OS === "win32";
const PORT = process.env.OUC_PORT ?? "5173";
const URL_ = `http://localhost:${PORT}`;
const SYNC_TIME = process.env.OUC_SYNC_TIME ?? "07:30";
const SELF = join(ROOT, "bin/ouc");

// The Node the background service runs with. On macOS the one on PATH (/opt/homebrew/bin/node, nvm…),
// not process.execPath, which points into a versioned Cellar folder that a Node upgrade removes.
const which = (bin: string): string | null => {
  const r = spawnSync(WIN ? "where" : "which", [bin], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? null : null;
};
const NODE = (MAC && which("node")) || process.execPath;
const svc = service({ root: ROOT, node: NODE, port: PORT, syncTime: SYNC_TIME });
const LOGS = svc.logs;

const COLOR = !process.env.NO_COLOR;
const paint = (code: string, s: string) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const b = (s: string) => console.log(paint("1", s));
const ok = (s: string) => console.log(`${paint("32", "✓")} ${s}`);
const warn = (s: string) => console.log(`${paint("33", "⚠")} ${s}`);
const err = (s: string) => console.log(`${paint("31", "✗")} ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const node = (args: string[], opts: SpawnSyncOptions = {}) => spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit", ...opts }).status ?? 1;
const git = (...a: string[]) => spawnSync("git", ["-C", ROOT, ...a], { encoding: "utf8" });

async function up() {
  // 127.0.0.1, where the server listens: "localhost" can resolve to ::1 first (Windows)
  try { return (await fetch(`http://127.0.0.1:${PORT}`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
}
/** Installs what package-lock.json asks for when something is missing (e.g. after a plain `git pull`). */
function needDeps() {
  const missing = missingDeps(ROOT);
  if (!missing.length) return;
  warn(`Installing dependencies first (npm ci: ${missing.length} missing, e.g. ${missing[0]})…`);
  if (!installDeps(npmRunner(ROOT), warn)) { err(`Installing dependencies failed; run "npm ci" in ${ROOT}`); process.exit(1); }
}
const buildData = () => {
  const tsx = join(ROOT, "node_modules/tsx/dist/cli.mjs");
  if (existsSync(tsx) && node([tsx, "packages/content/src/build.ts"], { stdio: "ignore" }) === 0) ok("App data refreshed");
};
function openBrowser(url: string) {
  const [cmd, args] = MAC ? ["open", [url]] : WIN ? ["explorer", [url]] : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => warn(`Open ${url} in your browser.`)).unref();
}

// ---------- the `ouc` command on PATH ----------
const writable = (d: string) => { try { accessSync(d, constants.W_OK); return statSync(d).isDirectory(); } catch { return false; } };
// Windows: bin\ouc.cmd is in this folder, so the folder goes on the user's PATH (no admin rights needed)
const userPath = (op: "add" | "remove") => spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
  "$d=$env:OUC_BIN; $p=[Environment]::GetEnvironmentVariable('Path','User'); $l=@(($p -split ';') | Where-Object { $_ -and $_ -ne $d });"
  + (op === "add" ? " $l += $d;" : "") + " [Environment]::SetEnvironmentVariable('Path', ($l -join ';'), 'User')"],
{ env: { ...process.env, OUC_BIN: join(ROOT, "bin") }, stdio: "ignore" }).status === 0;

function linkCmd() {
  if (WIN) {
    if (userPath("add")) ok(`Command installed: open a new terminal window, then type 'ouc' (${join(ROOT, "bin")} is on your PATH)`);
    else warn(`Couldn't add 'ouc' to your PATH. From this folder use: node bin\\ouc …`);
    return;
  }
  try { chmodSync(SELF, 0o755); } catch {}
  const dirs = MAC ? ["/opt/homebrew/bin", "/usr/local/bin"] : [join(homedir(), ".local/bin"), "/usr/local/bin"];
  for (const d of dirs) {
    if (!existsSync(d) || !writable(d)) continue;
    rmSync(join(d, "ouc"), { force: true });
    symlinkSync(SELF, join(d, "ouc"));
    ok(`Command installed: you can now type 'ouc' anywhere (${d}/ouc)`);
    return;
  }
  const rc = join(homedir(), process.env.SHELL?.endsWith("/bash") ? ".bash_profile" : ".zshrc");
  let have = "";
  try { have = readFileSync(rc, "utf8"); } catch {}
  if (!have.includes("alias ouc=")) appendFileSync(rc, `alias ouc='${SELF}'\n`);
  ok(`Command installed as an alias in ${rc}. Open a new Terminal window, then type 'ouc'.`);
}
function unlinkCmd() {
  if (WIN) { userPath("remove"); return; }
  for (const d of ["/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".local/bin")]) {
    const f = join(d, "ouc");
    try { if (lstatSync(f).isSymbolicLink() && resolve(d, readlinkSync(f)) === SELF) rmSync(f); } catch {}
  }
}

// Move to the newest release (--main or --latest: the newest code on this branch), then refresh dependencies and AI skills
// if they changed. Never touches local edits. Details in update.ts.
function updateCode(opts = {}) {
  return applyUpdate(ROOT, { latest: args.includes("--main") || args.includes("--latest"), log: (kind, text) => (kind === "ok" ? ok : warn)(text), ...opts });
}
/** One line when a newer release is out (checked at most once a day). */
async function updateHint() {
  const u = await checkForUpdate(ROOT).catch(() => null);
  if (u?.available) warn(`Update available: v${u.current} → v${u.latest}. Run: ouc update (or press Update in the app)`);
}

async function checkTcc() {
  if (!MAC) return;
  await sleep(6000);
  let log = "";
  try { log = readFileSync(join(LOGS, "app.log"), "utf8"); } catch {}
  if (!log.includes("Operation not permitted")) return;
  console.log(); warn("macOS is blocking background access to your Desktop folder.");
  console.log("   Fix (once): System Settings → Privacy & Security → Full Disk Access → + →");
  console.log(`   press Cmd+Shift+G, paste:  ${NODE}   → Open, and switch it on. Then run: ouc restart`);
}

async function start() {
  needDeps();
  if (!svc.start()) { err("Couldn't start the app."); return false; }
  for (let i = 0; i < 30 && !(await up()); i++) await sleep(1000);
  if (await up()) { ok(`App running: ${URL_}`); return true; }
  warn("Still starting… see: ouc logs"); await checkTcc();
  return false;
}

/** Last n lines of a log, then new lines as they're written (like tail -f). */
function follow(file: string, n = 40) {
  if (!WIN && which("tail")) { spawnSync("tail", ["-n", String(n), "-f", file], { stdio: "inherit" }); return; }
  let pos = 0;
  try { const text = readFileSync(file, "utf8"); process.stdout.write(`${text.split("\n").slice(-n - 1).join("\n")}`); pos = statSync(file).size; } catch { console.log(`(no log yet: ${file})`); }
  watchFile(file, { interval: 500 }, (cur) => {
    if (cur.size < pos) pos = 0;
    if (cur.size === pos) return;
    const fd = openSync(file, "r"); const buf = Buffer.alloc(cur.size - pos);
    readSync(fd, buf, 0, buf.length, pos); closeSync(fd);
    pos = cur.size; process.stdout.write(buf.toString("utf8"));
  });
  process.on("SIGINT", () => { unwatchFile(file); process.exit(0); });
}

function newestMeta() {
  const dir = join(ROOT, "semesters");
  if (!existsSync(dir)) return null;
  return readdirSync(dir).map((s) => join(dir, s, "_meta/eclass-meta.json")).filter(existsSync)
    .sort((x, y) => statSync(y).mtimeMs - statSync(x).mtimeMs)[0] ?? null;
}
function lastStatus() {
  const dir = join(ROOT, "semesters");
  if (!existsSync(dir)) return null;
  return readdirSync(dir).sort().map((s) => join(dir, s, "updates/status.json")).filter(existsSync).pop() ?? null;
}

const HELP = () => `${paint("1", "ouc: OUC Study app & eClass sync")}

  ouc setup        first-time setup (or add courses / a new semester)
  ouc install      start the app automatically at login + daily eClass sync + this command
  ouc start        start the app in the background (${URL_})
  ouc stop         stop it
  ouc restart      stop, update to the latest release, start again (--main: newest code on main
                   instead; --no-update: just restart)
  ouc update       update to the latest release without restarting (--main: newest code on main;
                   --check: only say whether there is one)
  ouc open         open the app in your browser (starts it if needed)
  ouc sync         check eClass now (grades, feedback, materials…) and refresh the app
  ouc pull         download any new course files now (--dry-run: just list them)
  ouc status       is it running? when was the last sync?
  ouc logs [sync]  follow the app (or sync) log
  ouc notes [course] [week]   AI notes for a week (default: latest without notes)
  ouc plan         AI plan for this week      ouc quiz [course] [week]   quiz yourself
  ouc ai           open your AI (Claude Code, Codex or local)   ouc ai setup   choose it
  ouc check-public before pushing to GitHub: is anything personal included?
  ouc uninstall    remove the background app and daily sync
`;

const [cmd = "help", ...args] = process.argv.slice(2);
switch (cmd) {
  case "install": {
    needDeps();
    if (!svc.autostart) {
      warn("Starting at login is set up on macOS and Windows only. Start the app with: ouc start");
      linkCmd();
      break;
    }
    if (!svc.install()) { err("Couldn't set up the background service."); process.exit(1); }
    ok(`App starts automatically when you log in, and runs in the background at ${URL_}`);
    ok(`eClass is checked every day at ${SYNC_TIME} (and every 4 h while the app runs)`);
    linkCmd();
    if (WIN) svc.start();   // the Startup launcher runs at the next login; start it now too
    await checkTcc();
    if (!MAC) for (let i = 0; i < 20 && !(await up()); i++) await sleep(1000);
    (await up()) ? ok(`App is up: ${URL_}`) : console.log("  The app is starting… check with: ouc status");
    break;
  }
  case "uninstall":
    svc.stop(); svc.uninstall(); unlinkCmd();
    ok("Background app and daily sync removed. (Files untouched. Run 'npm run dev' to start manually.)");
    break;
  case "start": if (!(await start())) process.exitCode = 1; else await updateHint(); break;
  case "stop":
    if (svc.stop()) ok(`App stopped${svc.autostart ? " (it will start again at next login; 'ouc uninstall' to turn that off)" : ""}.`);
    else warn("App wasn't running.");
    break;
  case "update":
    if (args.includes("--check")) {
      const u = await checkForUpdate(ROOT, { fresh: true });
      if (u.error) warn(u.error);
      else if (u.available) warn(`Update available: v${u.current} → v${u.latest} (${u.url}). Run: ouc update`);
      else ok(`Up to date: v${u.current}${u.latest ? ` (latest release v${u.latest})` : ""}`);
      break;
    }
    if (!updateCode().ok) process.exitCode = 1;
    else if (await up()) console.log("  Restart the app to use it: ouc restart");
    break;
  case "restart":
    // stop first, so a clean reinstall of the dependencies doesn't pull them from under the running app
    node([SELF, "stop"]); await sleep(1000);
    if (!args.includes("--no-update")) updateCode();
    process.exitCode = node([SELF, "start"]);
    break;
  case "open": if (!(await up())) await start(); openBrowser(URL_); break;
  case "setup": process.exitCode = node([join(ROOT, "bin/setup.mjs"), ...args]); break;
  case "pull":
    process.exitCode = node([join(ROOT, "packages/eclass-sync/pull.mjs"), ...args]);
    if (!args.includes("--dry-run")) buildData();
    break;
  case "link": linkCmd(); break;
  case "ai": process.exitCode = node([join(ROOT, "bin/ai.mjs"), ...args]); break;
  case "notes": case "plan": case "quiz": process.exitCode = node([join(ROOT, "bin/ai.mjs"), cmd, ...args]); break;
  case "check-public": process.exitCode = node([join(ROOT, "bin/check-public.mjs")]); break;
  case "sync": {
    node([join(ROOT, "packages/eclass-sync/daily.mjs"), ...args]);
    // new files too, for semesters created by `ouc setup` (their eclass-meta.json comes from the API)
    const meta = newestMeta();
    if (meta && readFileSync(meta, "utf8").includes('"source": "api"')) node([join(ROOT, "packages/eclass-sync/pull.mjs"), "--quiet"]);
    buildData();
    break;
  }
  case "status": {
    b("OUC Study");
    if (await up()) ok(`App running at ${URL_}`);
    else if (svc.running()) warn("App service loaded but not answering yet (ouc logs)");
    else err("App not running (ouc start)");
    if (svc.syncScheduled()) ok(`Daily eClass sync scheduled at ${SYNC_TIME}`);
    else warn(svc.autostart ? "Daily sync not scheduled (ouc install)" : "Daily sync not scheduled (macOS and Windows only; ouc sync checks now)");
    existsSync(join(ROOT, ".eclass-token")) ? ok("eClass key present") : warn("No eClass key yet (.eclass-token), see README → Daily updates");
    const st = lastStatus();
    if (st) {
      try {
        const s = JSON.parse(readFileSync(st, "utf8"));
        const when = new Date(s.lastRun).toLocaleString("en-GB");
        console.log(`${s.ok ? paint("32", "✓") : paint("31", "✗")} Last sync ${when}${s.ok ? ` (${s.found ?? 0} new)` : ` failed: ${s.error}`}`);
      } catch {}
    }
    await updateHint();
    break;
  }
  case "logs": follow(join(LOGS, args[0] === "sync" ? "sync.log" : "app.log")); break;
  default: console.log(HELP());
}
