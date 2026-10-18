// bin/server.mjs and `ouc` start the app with the root node_modules/vite, so it must be the Vite
// the app asks for. A nested copy left at the root once ran Vite 6 with plugin-react 6 (needs Vite 8).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const json = (f) => JSON.parse(readFileSync(join(ROOT, f), "utf8"));
const major = (v) => Number(String(v).replace(/^[^\d]*/, "").split(".")[0]);

test("the lockfile puts the app's Vite at the root, where the app is started from", () => {
  const want = json("apps/web/package.json").devDependencies.vite;
  const lock = json("package-lock.json").packages;
  assert.equal(major(lock["node_modules/vite"]?.version), major(want), `root vite ${lock["node_modules/vite"]?.version} vs apps/web ${want}`);
  assert.ok(!lock["apps/web/node_modules/vite"], "no second Vite nested under apps/web");
});

test("the installed root Vite matches too", { skip: !existsSync(join(ROOT, "node_modules/vite/package.json")) }, () => {
  assert.equal(major(json("node_modules/vite/package.json").version), major(json("apps/web/package.json").devDependencies.vite));
});
