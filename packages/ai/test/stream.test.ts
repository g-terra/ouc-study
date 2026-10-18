import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseClaude, parseCodex, parseOpencode, toolLabel } from "../src/stream.ts";

const ROOT = "/Users/me/OUC-Study";

test("Claude Code stream-json", () => {
  assert.deepEqual(parseClaude({ type: "system", subtype: "init", session_id: "abc" }), [{ type: "session", id: "abc" }]);
  const ev = parseClaude({ type: "assistant", message: { content: [
    { type: "text", text: "Hi" },
    { type: "tool_use", name: "Write", input: { file_path: `${ROOT}/semesters/S/notes/COS511/week-01-x.md` } },
  ] } }, ROOT);
  assert.deepEqual(ev, [
    { type: "text", text: "Hi" },
    { type: "tool", label: "Writing week-01-x.md" },
    { type: "file", path: "semesters/S/notes/COS511/week-01-x.md" },
  ]);
  assert.equal(parseClaude({ type: "result", subtype: "error_max_turns", is_error: true, session_id: "abc" })[0].type, "error");
});

test("Codex exec --json", () => {
  assert.deepEqual(parseCodex({ type: "thread.started", thread_id: "t1" }), [{ type: "session", id: "t1" }]);
  assert.deepEqual(parseCodex({ type: "item.started", item: { type: "command_execution", command: "ls semesters" } }), [{ type: "tool", label: "Running ls semesters" }]);
  assert.deepEqual(parseCodex({ type: "item.completed", item: { type: "agent_message", text: "Done" } }), [{ type: "text", text: "Done" }]);
  assert.deepEqual(parseCodex({ type: "item.completed", item: { type: "file_change", changes: [{ path: `${ROOT}/memory/progress.md`, kind: "update" }] } }, ROOT),
    [{ type: "tool", label: "Writing progress.md" }, { type: "file", path: "memory/progress.md" }]);
  assert.deepEqual(parseCodex({ type: "turn.failed", error: { message: "usage limit" } }), [{ type: "error", message: "usage limit" }]);
});

test("opencode run --format json", () => {
  assert.deepEqual(parseOpencode({ type: "text", sessionID: "ses_1", part: { type: "text", text: "Hello" } }),
    [{ type: "session", id: "ses_1" }, { type: "text", text: "Hello" }]);
  assert.deepEqual(parseOpencode({ type: "tool_use", sessionID: "ses_1", part: { type: "tool", tool: "write", state: { status: "completed", input: { filePath: `${ROOT}/a/b.md` } } } }, ROOT),
    [{ type: "session", id: "ses_1" }, { type: "tool", label: "Writing b.md" }, { type: "file", path: "a/b.md" }]);
});

test("tool labels", () => {
  assert.equal(toolLabel("Grep", { pattern: "attention" }), "Searching attention");
  assert.equal(toolLabel("WebSearch", { query: "signal detection" }), "Searching the web: signal detection");
});

test("opencode: a real recorded run (write a file, then reply)", () => {
  const lines = readFileSync(new URL("./fixtures/opencode-run.jsonl", import.meta.url), "utf8").replaceAll("__ROOT__", ROOT).trim().split("\n");
  const ev = lines.flatMap((l) => parseOpencode(JSON.parse(l), ROOT)).filter((e) => e.type !== "session");
  assert.deepEqual(ev, [
    { type: "tool", label: "Writing out.md" },
    { type: "file", path: "out.md" },
    { type: "text", text: "Done, saved out.md." },
  ]);
});
