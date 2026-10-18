#!/usr/bin/env node
/**
 * Fast checks that need no build:  npm run lint
 * Every tracked .mjs file parses (node --check) and every shell script parses (bash -n).
 * TypeScript is checked by `npm run typecheck`; the whole set by `npm run check`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
const shell = (f) => /\.(sh|command)$/.test(f) || /^#!.*\bbash\b/.test(readFileSync(resolve(ROOT, f), "utf8").slice(0, 40));

const failed = [];
for (const f of files) {
  const run = f.endsWith(".mjs") ? ["node", ["--check", f]] : shell(f) ? ["bash", ["-n", f]] : null;
  if (!run) continue;
  const r = spawnSync(run[0], run[1], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) failed.push(`${f}\n${(r.stderr || r.stdout).trim()}`);
}
if (failed.length) {
  console.error(`✗ ${failed.length} file(s) don't parse:\n\n${failed.join("\n\n")}`);
  process.exit(1);
}
console.log("✓ scripts parse");
