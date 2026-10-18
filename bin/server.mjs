#!/usr/bin/env node
/**
 * Background app server, started at login by the `ouc` LaunchAgent (or `ouc start`).
 *  1. builds the app data from semesters/   2. runs the Vite server on http://localhost:5173
 *  3. runs the eClass sync every few hours while it's up (if a key exists).
 * No npm needed at runtime: everything is launched with this same Node binary.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NODE = process.execPath;
const PORT = process.env.OUC_PORT ?? "5173";
const SYNC_EVERY_H = Number(process.env.OUC_SYNC_HOURS ?? 4);
const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const say = (m) => console.log(`[${stamp()}] ${m}`);

const tsx = join(ROOT, "node_modules/tsx/dist/cli.mjs");
const vite = join(ROOT, "node_modules/vite/bin/vite.js");
if (!existsSync(vite) || !existsSync(tsx)) {
  say(`Dependencies missing. Run "npm install" in ${ROOT} first.`);
  process.exit(78); // EX_CONFIG: launchd will retry later (ThrottleInterval)
}

const run = (args, opts = {}) => new Promise((ok) => {
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
  }, SYNC_EVERY_H * 3600_000).unref();
}

for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => { server.kill("SIGTERM"); setTimeout(() => process.exit(0), 1500); });
