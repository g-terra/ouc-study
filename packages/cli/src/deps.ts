// Are the installed dependencies the ones package-lock.json asks for? Code that arrives by a plain
// `git pull` (not `ouc update`) can need a package that isn't installed yet, and the app then fails
// with "Failed to resolve import". `ouc start`, `ouc update` and the background app check this and
// run `npm ci` when something is missing.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

interface LockEntry { version?: string; optional?: boolean; link?: boolean; inBundle?: boolean }

/** The packages in package-lock.json that aren't installed, or are installed at another version ("name@version"). */
export function missingDeps(root: string): string[] {
  let lock: Record<string, LockEntry>;
  try { lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")).packages ?? {}; } catch { return []; }
  const out: string[] = [];
  for (const [path, e] of Object.entries(lock)) {
    // optional ones are for other systems (e.g. another platform's esbuild); links are our own workspaces
    if (!path.includes("node_modules/") || e.optional || e.link || e.inBundle) continue;
    let have: string | undefined;
    try { have = JSON.parse(readFileSync(join(root, path, "package.json"), "utf8")).version; } catch {}
    if (!have || (e.version && have !== e.version)) out.push(`${path.slice(path.lastIndexOf("node_modules/") + 13)}@${e.version ?? "?"}`);
  }
  return out;
}

export type Run = (cmd: string, args: string[]) => boolean;

/** npm, run with this same Node (the background app has no npm on its PATH), or npm from the PATH. */
export function npmRunner(root: string, stdio: "inherit" | "ignore" = "inherit"): Run {
  const bin = dirname(process.execPath);
  // macOS/Linux: <prefix>/bin/node + <prefix>/lib/node_modules/npm; Windows: node.exe next to node_modules\npm
  const cli = [join(bin, "../lib/node_modules/npm/bin/npm-cli.js"), join(bin, "node_modules/npm/bin/npm-cli.js")].find(existsSync);
  return (cmd, args) => {
    const [c, a] = cmd === "npm" && cli ? [process.execPath, [cli, ...args]] : [cmd, args];
    // npm is npm.cmd on Windows, which needs a shell (the arguments here are fixed)
    return spawnSync(c, a, { cwd: root, stdio, shell: process.platform === "win32" && c === "npm" }).status === 0;
  };
}

/**
 * A clean `npm ci` (falling back to `npm install`); true when it worked. With `root`, it then throws away
 * Vite's pre-bundled dependencies (node_modules/.vite), which point at the packages it just replaced.
 */
export function installDeps(run: Run, log: (text: string) => void = () => {}, root?: string): boolean {
  // a clean install: `npm install` over old node_modules can keep stale copies (it once left Vite 6 next to Vite 8)
  let ok = run("npm", ["ci", "--no-audit", "--no-fund"]);
  if (!ok) { log("npm ci failed, trying npm install…"); ok = run("npm", ["install", "--no-audit", "--no-fund"]); }
  if (ok && root) for (const d of ["apps/web/node_modules/.vite", "node_modules/.vite"]) rmSync(join(root, d), { recursive: true, force: true });
  return ok;
}
