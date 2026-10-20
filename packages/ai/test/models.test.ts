// Which models the Ask AI panel offers, and how a picked one reaches each tool's command line.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_MODELS, agentCommand, codexModelsAsync, parseCodexModels, toolModels, type AiConfig, type LocalModel } from "../src/providers.ts";

const ollama: LocalModel = { kind: "ollama", baseUrl: "http://127.0.0.1:11434", model: "qwen3:8b", models: ["qwen3:8b", "llama3.2"] };

test("each tool offers its models: subscription aliases, or what the local server has", () => {
  assert.deepEqual(toolModels(null, "claude"), { models: AGENT_MODELS.claude });
  assert.deepEqual(toolModels({ models: { codex: ["gpt-5"] } }, "codex"), { models: ["gpt-5"] });
  assert.deepEqual(toolModels({ opencode: ollama }, "opencode"), { models: ["qwen3:8b", "llama3.2"], model: "qwen3:8b" });
  assert.deepEqual(toolModels({ local: { ...ollama, models: undefined } }, "local"), { models: ["qwen3:8b"], model: "qwen3:8b" });
  assert.deepEqual(toolModels({}, "opencode"), { models: [] });
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
