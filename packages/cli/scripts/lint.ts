/**
 * Fast checks that need no build:  npm run lint
 * Every tracked .mjs file and Node script (the launchers in bin/) parses (node --check) and every shell
 * script parses (bash -n; skipped on Windows, where CI checks only the Node files).
 * TypeScript is checked by `npm run typecheck`; the whole set by `npm run check`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
const head = (f: string) => { try { return readFileSync(resolve(ROOT, f), "utf8").slice(0, 40); } catch { return ""; } };
const shell = (f: string) => /\.(sh|command)$/.test(f) || /^#!.*\b(ba)?sh\b/.test(head(f));
const nodeScript = (f: string) => f.endsWith(".mjs") || (!/\.\w+$/.test(f) && /^#!.*\bnode\b/.test(head(f)));

const failed = [];
for (const f of files) {
  const run: [string, string[]] | null = nodeScript(f) ? [process.execPath, ["--check", f]] : shell(f) && process.platform !== "win32" ? ["bash", ["-n", f]] : null;
  if (!run) continue;
  const r = spawnSync(...run, { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) failed.push(`${f}\n${(r.stderr || r.stdout).trim()}`);
}
if (failed.length) {
  console.error(`✗ ${failed.length} file(s) don't parse:\n\n${failed.join("\n\n")}`);
  process.exit(1);
}
console.log("✓ scripts parse");
