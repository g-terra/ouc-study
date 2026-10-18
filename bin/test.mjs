#!/usr/bin/env node
// npm test: runs every packages/*/test/*.test.mjs and bin/test/*.test.mjs with node:test.
// (A shell glob doesn't expand on Windows, and Node 20's --test doesn't expand globs itself.)
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dirs = [...readdirSync(join(ROOT, "packages")).map((p) => join(ROOT, "packages", p, "test")), join(ROOT, "bin/test")];
const files = dirs.filter(existsSync).flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".test.mjs")).map((f) => relative(ROOT, join(d, f))));
const r = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files], { cwd: ROOT, stdio: "inherit" });
process.exit(r.status ?? 1);
