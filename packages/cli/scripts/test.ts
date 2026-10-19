// npm test: runs every packages/*/test/*.test.{ts,mjs} (and apps/*/test/) with node:test, TypeScript through tsx.
// (A shell glob doesn't expand on Windows, and Node 20's --test doesn't expand globs itself.)
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const dirs = ["packages", "apps"].flatMap((top) => readdirSync(join(ROOT, top)).map((p) => join(ROOT, top, p, "test")));
const files = dirs.filter(existsSync).flatMap((d) => readdirSync(d).filter((f) => /\.test\.(ts|mjs)$/.test(f)).map((f) => relative(ROOT, join(d, f))));
const r = spawnSync(process.execPath, ["--import", "tsx", "--test", ...process.argv.slice(2), ...files], { cwd: ROOT, stdio: "inherit" });
process.exit(r.status ?? 1);
