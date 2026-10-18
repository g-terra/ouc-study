// The .mjs files in bin/ are launchers: the code is TypeScript in packages/cli/src, run through tsx.
// They stay because their paths are used from outside the code: the `ouc` shims, the background
// services `ouc install` wrote (LaunchAgents, Windows launchers), "Install OUC Study.command" and
// older copies of `ouc update`. A fresh `git clone` has no node_modules yet, so this installs them first.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Import a TypeScript file (a path from the repo root) through tsx and return the module.
 * install: false is for background jobs, which can't run npm: they exit with EX_CONFIG instead
 * (launchd tries the app again later).
 */
export async function runTs(file, { install = true } = {}) {
  if (!existsSync(join(ROOT, "node_modules/tsx/package.json"))) {
    if (!install) { console.log(`Dependencies missing. Run "npm install" in ${ROOT} first.`); process.exit(78); }
    console.log("Installing what OUC Study needs first (npm install, one-off, about a minute)…");
    // npm is npm.cmd on Windows, which needs a shell (the arguments here are fixed)
    const r = spawnSync("npm", ["install", "--no-fund", "--no-audit"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
    if (r.status !== 0) {
      console.log(`npm install failed. Install Node.js from https://nodejs.org (npm comes with it), then run "npm install" in ${ROOT}.`);
      process.exit(1);
    }
  }
  const { register } = await import("tsx/esm/api");
  register();
  return import(pathToFileURL(join(ROOT, file)).href);
}
