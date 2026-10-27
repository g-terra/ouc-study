// The study AI writes notes and study files only: a run that changes the app's code gets it undone.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentTurn, type AgentEvent } from "../src/stream.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "fixtures/fake-agent.mjs");

/** A made-up checkout: app code is tracked, the student's semesters/ is git-ignored. */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "ouc-guard-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
  git("init", "-q");
  writeFileSync(join(root, ".gitignore"), "semesters/\n");
  writeFileSync(join(root, "app.ts"), "export const x = 1;\n");
  writeFileSync(join(root, "mine.ts"), "export const y = 1;\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  return root;
}

test("an AI run that edits the app's code gets the edits undone, and its notes kept", async () => {
  const root = repo();
  writeFileSync(join(root, "mine.ts"), "export const y = 2; // my own edit\n");
  const events: AgentEvent[] = [];
  await runAgentTurn(root, { tool: "claude" }, "Make notes. TOUCH_CODE", { bin: BIN, onEvent: (e) => events.push(e) });
  assert.equal(readFileSync(join(root, "app.ts"), "utf8"), "export const x = 1;\n");
  assert.equal(existsSync(join(root, "tools/new.py")), false);
  assert.equal(readFileSync(join(root, "mine.ts"), "utf8"), "export const y = 2; // my own edit\n");   // changed before the run: left alone
  assert.ok(existsSync(join(root, "semesters/2026-Fall/notes/AAA/week-01.md")));
  const err = events.find((e) => e.type === "error");
  assert.ok(err && err.type === "error" && /app\.ts/.test(err.message) && /tools\/new\.py/.test(err.message), JSON.stringify(events));
});

test("a run that only writes study files reports no undo", async () => {
  const root = repo();
  const events: AgentEvent[] = [];
  await runAgentTurn(root, { tool: "claude" }, "Plan my week.", { bin: BIN, onEvent: (e) => events.push(e) });
  assert.deepEqual(events.filter((e) => e.type === "error"), []);
});

test("outside a git checkout the run goes ahead as before", async () => {
  const root = mkdtempSync(join(tmpdir(), "ouc-guard-nogit-"));
  const events: AgentEvent[] = [];
  const { ok } = await runAgentTurn(root, { tool: "claude" }, "Plan my week.", { bin: BIN, onEvent: (e) => events.push(e) });
  assert.equal(ok, true);
});
