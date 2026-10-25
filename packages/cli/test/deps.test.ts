// bin/server.mjs and `ouc` start the app with the root node_modules/vite, so it must be the Vite
// the app asks for. A nested copy left at the root once ran Vite 6 with plugin-react 6 (needs Vite 8).
// And what package-lock.json asks for must be installed before the app starts (src/deps.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installDeps, missingDeps } from "../src/deps.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const json = (f: string) => JSON.parse(readFileSync(join(ROOT, f), "utf8"));
const major = (v: unknown) => Number(String(v).replace(/^[^\d]*/, "").split(".")[0]);

test("the lockfile puts the app's Vite at the root, where the app is started from", () => {
  const want = json("apps/web/package.json").devDependencies.vite;
  const lock = json("package-lock.json").packages;
  assert.equal(major(lock["node_modules/vite"]?.version), major(want), `root vite ${lock["node_modules/vite"]?.version} vs apps/web ${want}`);
  assert.ok(!lock["apps/web/node_modules/vite"], "no second Vite nested under apps/web");
});

test("the installed root Vite matches too", { skip: !existsSync(join(ROOT, "node_modules/vite/package.json")) }, () => {
  assert.equal(major(json("node_modules/vite/package.json").version), major(json("apps/web/package.json").devDependencies.vite));
});

// ---------- missingDeps: code pulled without `npm ci` (the slide viewer once failed on a missing pdfjs-dist) ----------
const lockfile = (dir: string, packages: Record<string, object>) => writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...packages } }));
const installed = (dir: string, path: string, version: string) => { mkdirSync(join(dir, path), { recursive: true }); writeFileSync(join(dir, path, "package.json"), JSON.stringify({ version })); };

test("missingDeps lists packages the lockfile wants that aren't installed at that version", () => {
  const dir = mkdtempSync(join(tmpdir(), "ouc-deps-"));
  lockfile(dir, {
    "node_modules/react": { version: "19.0.0" },
    "node_modules/pdfjs-dist": { version: "6.4.299" },
    "node_modules/vite": { version: "8.3.4" },
    "apps/web/node_modules/yaml": { version: "2.6.1" },
    "node_modules/@esbuild/win32-x64": { version: "0.25.0", optional: true },
    "node_modules/@ouc/web": { resolved: "apps/web", link: true },
  });
  installed(dir, "node_modules/react", "19.0.0");
  installed(dir, "node_modules/vite", "6.0.0");
  installed(dir, "apps/web/node_modules/yaml", "2.6.1");
  assert.deepEqual(missingDeps(dir), ["pdfjs-dist@6.4.299", "vite@8.3.4"]);
  installed(dir, "node_modules/pdfjs-dist", "6.4.299");
  installed(dir, "node_modules/vite", "8.3.4");
  assert.deepEqual(missingDeps(dir), []);
  // no lockfile: nothing to compare with
  assert.deepEqual(missingDeps(join(dir, "nowhere")), []);
});

test("this checkout has everything its lockfile asks for", { skip: !existsSync(join(ROOT, "node_modules")) }, () => {
  assert.deepEqual(missingDeps(ROOT), []);
});

test("installDeps runs npm ci, and npm install if that fails", () => {
  const calls: string[] = [];
  assert.equal(installDeps((c, a) => { calls.push([c, ...a].join(" ")); return true; }), true);
  assert.deepEqual(calls, ["npm ci --no-audit --no-fund"]);
  calls.length = 0;
  assert.equal(installDeps((c, a) => { calls.push([c, ...a].join(" ")); return a[0] === "install"; }), true);
  assert.deepEqual(calls, ["npm ci --no-audit --no-fund", "npm install --no-audit --no-fund"]);
});

test("after a reinstall, Vite's pre-bundled dependencies are thrown away (they point at the old packages)", () => {
  const root = mkdtempSync(join(tmpdir(), "ouc-deps-"));
  for (const d of ["apps/web/node_modules/.vite/deps", "node_modules/.vite/deps"]) { mkdirSync(join(root, d), { recursive: true }); writeFileSync(join(root, d, "react.js"), "old"); }
  assert.equal(installDeps(() => true, () => {}, root), true);
  assert.ok(!existsSync(join(root, "apps/web/node_modules/.vite")) && !existsSync(join(root, "node_modules/.vite")));
  // a failed install leaves them alone
  mkdirSync(join(root, "apps/web/node_modules/.vite"), { recursive: true });
  assert.equal(installDeps(() => false, () => {}, root), false);
  assert.ok(existsSync(join(root, "apps/web/node_modules/.vite")));
});
