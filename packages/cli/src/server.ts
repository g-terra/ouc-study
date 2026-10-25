/**
 * Background app server, started at login by the `ouc` LaunchAgent on macOS or the Startup-folder
 * launcher on Windows (or `ouc start`).
 *  1. builds the app data from semesters/   2. runs the Vite server on http://localhost:5173
 *  3. runs the eClass sync every few hours while it's up (if a key exists), then the backup when it's set up.
 * No npm needed at runtime: everything is launched with this same Node binary.
 */
import { spawn, type SpawnOptions } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installDeps, missingDeps, npmRunner } from "./deps.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const NODE = process.execPath;
const PORT = process.env.OUC_PORT ?? "5173";
const SYNC_EVERY_H = Number(process.env.OUC_SYNC_HOURS ?? 4);
const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const say = (m: string) => console.log(`[${stamp()}] ${m}`);

const tsx = join(ROOT, "node_modules/tsx/dist/cli.mjs");
const vite = join(ROOT, "node_modules/vite/bin/vite.js");
// new code that needs a package that isn't installed yet (e.g. after a plain `git pull`): install it first
const missing = missingDeps(ROOT);
if (missing.length) {
  say(`Installing dependencies (${missing.length} missing, e.g. ${missing[0]})…`);
  if (!installDeps(npmRunner(ROOT), say, ROOT)) say(`Installing dependencies failed. Run "npm ci" in ${ROOT}.`);
}
if (!existsSync(vite) || !existsSync(tsx)) {
  say(`Dependencies missing. Run "npm install" in ${ROOT} first.`);
  process.exit(78); // EX_CONFIG: launchd will retry later (ThrottleInterval)
}

// `ouc stop` on Windows and Linux finds the app by this pid
const pidFile = join(ROOT, ".ouc/app.pid");
try { mkdirSync(dirname(pidFile), { recursive: true }); writeFileSync(pidFile, String(process.pid)); } catch {}
process.on("exit", () => { try { rmSync(pidFile, { force: true }); } catch {} });

const run = (args: string[], opts: SpawnOptions = {}) => new Promise<number>((ok) => {
  const p = spawn(NODE, args, { cwd: ROOT, stdio: "inherit", ...opts });
  p.on("exit", (code) => ok(code ?? 0));
});

say("Building app data…");
await run([tsx, "packages/content/src/build.ts"]);

say(`Starting app on http://localhost:${PORT}`);
const server = spawn(NODE, [vite, "--port", PORT, "--strictPort", "--host", "127.0.0.1"], {
  cwd: join(ROOT, "apps/web"), stdio: "inherit", env: { ...process.env, OUC_BACKGROUND: "1" },
});
server.on("exit", (code) => { say(`App server stopped (${code}).`); process.exit(code ?? 1); });

// periodic eClass sync while running (the dev server also syncs once at start-up)
const syncer = join(ROOT, "packages/eclass-sync/daily.mjs");
if (SYNC_EVERY_H > 0) {
  setInterval(async () => {
    if (!existsSync(join(ROOT, ".eclass-token"))) return;
    say("Periodic eClass sync…");
    await run([syncer]);
    // the app's backup API knows the settings and the sign-in; it skips when no backup is set up or it's turned off
    await fetch(`http://127.0.0.1:${PORT}/api/backup/run?auto=1`, { method: "POST", signal: AbortSignal.timeout(60 * 60_000) }).catch(() => {});
  }, SYNC_EVERY_H * 3600_000).unref();
}

for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => { server.kill("SIGTERM"); setTimeout(() => process.exit(0), 1500); });
