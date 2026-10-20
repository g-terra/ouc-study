// Warming up the default AI when the app starts, so the first message doesn't wait for a model to load.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { warmUp, type AiConfig, type LocalModel } from "../src/providers.ts";

const root = mkdtempSync(join(tmpdir(), "ouc-warm-"));
const ollama: LocalModel = { kind: "ollama", baseUrl: "http://127.0.0.1:11434", model: "qwen3-32k:8b" };
const lms: LocalModel = { kind: "lmstudio", baseUrl: "http://127.0.0.1:1234/v1", model: "qwen/qwen3-8b" };
function fakes(ps = "") {
  const fetched: { url: string; body: unknown }[] = [], ran: string[][] = [];
  const fetch = async (url: string, init?: { body?: string }) => { fetched.push({ url, body: init?.body ? JSON.parse(init.body) : undefined }); return new Response("{}"); };
  const run = async (bin: string, args: string[]) => { ran.push([bin, ...args]); return { ok: true, out: args[0] === "ps" ? ps : "" }; };
  return { fetched, ran, deps: { fetch, run, bin: (b: string) => b } };
}

test("opencode on Ollama: its model is loaded into memory, and opencode itself is started once", async () => {
  const f = fakes();
  assert.equal(await warmUp(root, { tool: "opencode", opencode: ollama }, f.deps), "qwen3-32k:8b");
  assert.deepEqual(f.fetched, [{ url: "http://127.0.0.1:11434/api/generate", body: { model: "qwen3-32k:8b", keep_alive: "30m" } }]);
  assert.deepEqual(f.ran, [["opencode", "models"]]);
});

test("the default model set in Settings is the one warmed up", async () => {
  const f = fakes();
  const cfg: AiConfig = { tool: "opencode", opencode: { ...ollama, models: ["qwen3-32k:8b", "gemma4-32k:26b"] }, defaultModels: { opencode: "gemma4-32k:26b" } };
  await warmUp(root, cfg, f.deps);
  assert.equal((f.fetched[0].body as { model: string }).model, "gemma4-32k:26b");
});

test("a plain local model on Ollama is loaded with its context window", async () => {
  const f = fakes();
  await warmUp(root, { tool: "local", local: { ...ollama, model: "qwen3:8b" } }, f.deps);
  assert.deepEqual(f.fetched[0].body, { model: "qwen3:8b", keep_alive: "30m", options: { num_ctx: 32768 } });
});

test("LM Studio: the model is loaded with a 32k window unless it already is", async () => {
  const f = fakes("IDENTIFIER  MODEL\nsomething-else");
  await warmUp(root, { tool: "opencode", opencode: lms }, f.deps);
  assert.deepEqual(f.ran.slice(0, 2), [["lms", "ps"], ["lms", "load", "qwen/qwen3-8b", "--context-length", "32768", "--yes"]]);
  const g = fakes("qwen/qwen3-8b  loaded");
  await warmUp(root, { tool: "opencode", opencode: lms }, g.deps);
  assert.ok(!g.ran.some((r) => r[1] === "load"));
});

test("Claude Code and Codex are started without a model call (no usage spent); off with warmUp: false", async () => {
  for (const tool of ["claude", "codex"] as const) {
    const f = fakes();
    await warmUp(root, { tool }, f.deps);
    assert.deepEqual(f.ran, [[tool, "--version"]]);
    assert.deepEqual(f.fetched, []);
  }
  const off = fakes();
  assert.equal(await warmUp(root, { tool: "opencode", opencode: ollama, warmUp: false }, off.deps), null);
  assert.deepEqual([off.fetched, off.ran], [[], []]);
  assert.equal(await warmUp(root, { tool: null }, off.deps), null);
});
