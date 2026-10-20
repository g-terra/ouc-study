// Which models the Ask AI panel offers, and how a picked one reaches each tool's command line.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_MODELS, agentCommand, codexModelsAsync, loadConfig, ownDefault, parseCodexModels, setServerModels, toolModels, type AiConfig, type LocalModel } from "../src/providers.ts";

const noHome = mkdtempSync(join(tmpdir(), "ouc-home-"));   // no Claude Code or Codex settings
const ollama: LocalModel = { kind: "ollama", baseUrl: "http://127.0.0.1:11434", model: "qwen3:8b", models: ["qwen3:8b", "llama3.2"] };

test("each tool offers its models: subscription aliases, or what the local server has", () => {
  assert.deepEqual(toolModels(null, "claude", noHome), { models: AGENT_MODELS.claude });
  assert.deepEqual(toolModels({ models: { codex: ["gpt-5", "gpt-4"] } }, "codex", noHome), { models: ["gpt-5", "gpt-4"], model: "gpt-5", own: "gpt-5" });
  assert.deepEqual(toolModels({ opencode: ollama }, "opencode"), { models: ["qwen3:8b", "llama3.2"], model: "qwen3:8b", own: "qwen3:8b" });
  assert.deepEqual(toolModels({ local: { ...ollama, models: undefined } }, "local"), { models: ["qwen3:8b"], model: "qwen3:8b", own: "qwen3:8b" });
  assert.deepEqual(toolModels({}, "opencode"), { models: [] });
});

test("the default model: the one set in Settings, else the tool's own", () => {
  const home = mkdtempSync(join(tmpdir(), "ouc-home-"));
  mkdirSync(join(home, ".claude")); mkdirSync(join(home, ".codex"));
  writeFileSync(join(home, ".claude/settings.json"), JSON.stringify({ model: "opus" }));
  writeFileSync(join(home, ".codex/config.toml"), 'approval_policy = "never"\nmodel = "gpt-5.5"\n\n[profiles.fast]\nmodel = "gpt-6-luna"\n');
  assert.equal(ownDefault("claude", home), "opus");
  assert.equal(ownDefault("codex", home), "gpt-5.5");   // not the profile's
  assert.equal(ownDefault("claude", noHome), undefined);
  assert.deepEqual(toolModels(null, "claude", home), { models: AGENT_MODELS.claude, model: "opus", own: "opus" });
  assert.deepEqual(toolModels({ defaultModels: { claude: "haiku" } }, "claude", home), { models: AGENT_MODELS.claude, model: "haiku", own: "opus", setting: "haiku" });
  // a saved default the tool no longer offers is ignored
  assert.deepEqual(toolModels({ defaultModels: { claude: "gone" } }, "claude", noHome), { models: AGENT_MODELS.claude });
  assert.equal(toolModels({ opencode: ollama, defaultModels: { opencode: "llama3.2" } }, "opencode").model, "llama3.2");
});

test("opencode offers every model the local server has right now", () => {
  setServerModels("opencode", ["qwen3:8b", "gemma3:4b", "deepseek-r1:7b"]);
  assert.deepEqual(toolModels({ opencode: ollama }, "opencode").models, ["qwen3:8b", "gemma3:4b", "deepseek-r1:7b"]);
  setServerModels("opencode", []);   // the server didn't answer: keep the last list
  assert.deepEqual(toolModels({ opencode: ollama }, "opencode").models, ["qwen3:8b", "gemma3:4b", "deepseek-r1:7b"]);
  assert.deepEqual(toolModels({ local: ollama }, "local").models, ["qwen3:8b", "llama3.2"]);   // each tool its own list
});

test("a picked model is passed with each tool's own flag; none leaves the tool's default", () => {
  const args = (cfg: Pick<AiConfig, "tool" | "opencode">, model?: string) => agentCommand(cfg, "hi", { json: true, model })[1];
  assert.deepEqual(args({ tool: "claude" }, "opus").slice(-2), ["--model", "opus"]);
  assert.ok(!args({ tool: "claude" }).includes("--model"));
  const codex = args({ tool: "codex" }, "gpt-5");
  assert.deepEqual(codex.slice(codex.indexOf("--model"), codex.indexOf("--model") + 2), ["--model", "gpt-5"]);
  assert.equal(codex.at(-1), "hi");
  const resumed = agentCommand({ tool: "codex" }, "hi", { json: true, model: "gpt-5", resume: "t1" })[1];
  assert.ok(resumed.indexOf("--model") < resumed.indexOf("resume"));   // exec options go before the subcommand
  assert.deepEqual(args({ tool: "opencode", opencode: ollama }, "llama3.2").slice(-3), ["--model", "ollama/llama3.2", "hi"]);
});

// the shape of `codex debug models` (Codex 0.163), cut down to the fields read
const CATALOG = JSON.stringify({ models: [
  { slug: "gpt-6-astra", display_name: "GPT-6-Astra", visibility: "list", priority: 2 },
  { slug: "gpt-6.1-sol", display_name: "GPT-6.1-Sol", visibility: "list", priority: 1 },
  { slug: "codex-auto-review", visibility: "hide", priority: 43 },
  { slug: "--yolo", visibility: "list", priority: 0 },
  { slug: "gpt-5.5", visibility: "list" },
] });

test("Codex's own catalog lists its picker models, best first, without hidden ones", () => {
  assert.deepEqual(parseCodexModels(`WARNING: something\n${CATALOG}`), ["gpt-6.1-sol", "gpt-6-astra", "gpt-5.5"]);
  assert.deepEqual(parseCodexModels("not json"), []);
});

test("the models read from the installed Codex are what the panel offers (else the bundled list)", { skip: process.platform === "win32" }, async () => {
  assert.deepEqual(toolModels(null, "codex").models, AGENT_MODELS.codex);
  const dir = mkdtempSync(join(tmpdir(), "ouc-codex-"));
  const fake = join(dir, "codex");
  writeFileSync(fake, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(CATALOG)});\n`);
  chmodSync(fake, 0o755);
  assert.deepEqual(await codexModelsAsync(5000, fake), ["gpt-6.1-sol", "gpt-6-astra", "gpt-5.5"]);
  assert.deepEqual(toolModels(null, "codex").models, ["gpt-6.1-sol", "gpt-6-astra", "gpt-5.5"]);
  assert.deepEqual(toolModels({ models: { codex: ["mine"] } }, "codex").models, ["mine"]);   // .ouc/ai.json still wins
  // Codex can't answer: the last good list stays
  assert.deepEqual(await codexModelsAsync(5000, join(dir, "missing")), ["gpt-6.1-sol", "gpt-6-astra", "gpt-5.5"]);
});

test("opencode set up outside `ouc ai setup`: its model and server are read from .opencode/opencode.json", () => {
  const root = mkdtempSync(join(tmpdir(), "ouc-oc-"));
  mkdirSync(join(root, ".ouc")); mkdirSync(join(root, ".opencode"));
  writeFileSync(join(root, ".ouc/ai.json"), JSON.stringify({ tool: "opencode" }));
  writeFileSync(join(root, ".opencode/opencode.json"), JSON.stringify({
    model: "ollama/gemma4:26b",
    provider: { ollama: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "http://localhost:11434/v1" }, models: { "gemma4:26b": {}, "qwen3:8b": {} } } },
  }));
  assert.deepEqual(loadConfig(root)?.opencode, { kind: "ollama", baseUrl: "http://localhost:11434", model: "gemma4:26b", models: ["gemma4:26b", "qwen3:8b"] });
  // what `ouc ai setup` saved still wins
  writeFileSync(join(root, ".ouc/ai.json"), JSON.stringify({ tool: "opencode", opencode: ollama }));
  assert.equal(loadConfig(root)?.opencode?.model, "qwen3:8b");
});
