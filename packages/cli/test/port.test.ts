// The app's port (src/port.ts): OUC_PORT, else the one saved with `ouc port <n>`, else 5173.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterPortChange, DEFAULT_PORT, parsePort, readPort, savePort } from "../src/port.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "ouc-port-"));

test("port: 5173 when nothing is set", () => {
  assert.equal(DEFAULT_PORT, "5173");
  assert.equal(readPort({ root: tmp(), env: {} }), "5173");
});

test("port: a saved port survives, and OUC_PORT still wins over it", () => {
  const root = tmp();
  savePort(root, "5174");
  assert.equal(readPort({ root, env: {} }), "5174");
  assert.equal(readPort({ root, env: { OUC_PORT: "6000" } }), "6000");
});

test("port: saving keeps the other settings in the file", () => {
  const root = tmp();
  mkdirSync(join(root, ".ouc"));
  writeFileSync(join(root, ".ouc/settings.json"), JSON.stringify({ other: 1 }));
  savePort(root, "5180");
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".ouc/settings.json"), "utf8")), { other: 1, port: "5180" });
});

test("port: a broken settings file or bad value falls back to 5173", () => {
  const root = tmp();
  mkdirSync(join(root, ".ouc"));
  writeFileSync(join(root, ".ouc/settings.json"), "{not json");
  assert.equal(readPort({ root, env: {} }), "5173");
  writeFileSync(join(root, ".ouc/settings.json"), JSON.stringify({ port: "http" }));
  assert.equal(readPort({ root, env: { OUC_PORT: "" } }), "5173");
});

test("port: only whole numbers from 1024 to 65535", () => {
  assert.equal(parsePort("5174"), "5174");
  assert.equal(parsePort(" 8080 "), "8080");
  for (const bad of ["80", "70000", "51.7", "abc", "", undefined]) assert.equal(parsePort(bad), null, String(bad));
  assert.throws(() => savePort(tmp(), "80"));
});

test("port change: rewrite the autostart files, restart a running app where reloading doesn't", () => {
  // macOS: reloading the LaunchAgent restarts the app on the new port
  assert.deepEqual(afterPortChange({ platform: "darwin", autostart: true, running: true }), { reinstall: true, restart: false });
  assert.deepEqual(afterPortChange({ platform: "darwin", autostart: false, running: false }), { reinstall: false, restart: false });
  // Windows: the Startup launcher is only read at login, so a running app restarts too
  assert.deepEqual(afterPortChange({ platform: "win32", autostart: true, running: true }), { reinstall: true, restart: true });
  assert.deepEqual(afterPortChange({ platform: "linux", autostart: false, running: true }), { reinstall: false, restart: true });
  assert.deepEqual(afterPortChange({ platform: "linux", autostart: false, running: false }), { reinstall: false, restart: false });
});
