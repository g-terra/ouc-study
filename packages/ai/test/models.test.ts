// Which models the Ask AI panel offers, and how a picked one reaches each tool's command line.
import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_MODELS, agentCommand, toolModels, type AiConfig, type LocalModel } from "../src/providers.ts";

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
