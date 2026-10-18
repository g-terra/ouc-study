// AI backends for `ouc ai`: agent tools (Claude Code and Codex with the student's own subscription
// login, opencode on a local model) that read the repo and skills themselves, and plain local/remote
// chat models (Ollama, LM Studio, any OpenAI-compatible server) that get the course material
// handed to them. Zero dependencies.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const TOOL_LABEL = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "opencode with a local model",
  local: "Local model",
};
export const AGENTIC = new Set(["claude", "codex", "opencode"]);
export const INSTALL_HINT = {
  claude: "npm i -g @anthropic-ai/claude-code",
  codex: "npm i -g @openai/codex",
  opencode: "npm i -g opencode-ai",
};
// Older configs used Codex's --oss mode for local models; opencode replaces it.
export const ALIASES = { "codex-oss": "opencode" };

const which = (bin) => {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim().split("\n")[0] : null;
};
async function getJson(url, ms = 1500) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** Is the model server up? (opencode would otherwise keep retrying in silence.) */
export async function serverUp(server) {
  const url = server.kind === "ollama" ? `${server.baseUrl.replace(/\/v1\/?$/, "")}/api/tags` : `${server.baseUrl.replace(/\/$/, "")}/models`;
  try { await fetch(url, { signal: AbortSignal.timeout(2500) }); return true; } catch { return false; }
}

/** What's installed / running on this computer. */
export async function detect() {
  const [ollama, lms] = await Promise.all([getJson("http://localhost:11434/api/tags"), getJson("http://localhost:1234/v1/models")]);
  return {
    claude: which("claude"),
    codex: which("codex"),
    opencode: which("opencode"),
    ollama: ollama ? { baseUrl: "http://localhost:11434", models: (ollama.models ?? []).map((m) => m.name) } : null,
    lmstudio: lms ? { baseUrl: "http://localhost:1234/v1", models: (lms.data ?? []).map((m) => m.id) } : null,
  };
}

// ---------- config (.ouc/ai.json, git-ignored) ----------
export function loadConfig(root) {
  const p = join(root, ".ouc", "ai.json");
  let cfg;
  try { cfg = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; } catch { return null; }
  if (cfg?.tool === "codex-oss") {   // old "Codex with a local model" settings → opencode on the same model
    const lms = cfg.oss?.provider === "lmstudio";
    cfg = { tool: "opencode", opencode: { kind: lms ? "lmstudio" : "ollama", baseUrl: lms ? "http://localhost:1234/v1" : "http://localhost:11434", model: cfg.oss?.model ?? "gpt-oss:20b" } };
  }
  return cfg;
}
export function saveConfig(root, cfg) {
  mkdirSync(join(root, ".ouc"), { recursive: true });
  writeFileSync(join(root, ".ouc", "ai.json"), `${JSON.stringify(cfg, null, 2)}\n`);
}
const SERVER_NAME = { ollama: "Ollama", lmstudio: "LM Studio" };
export function describe(cfg) {
  if (!cfg?.tool) return "not chosen yet";
  if (cfg.tool === "local") return `${TOOL_LABEL.local}: ${cfg.local?.model} on ${SERVER_NAME[cfg.local?.kind] ?? cfg.local?.baseUrl}`;
  if (cfg.tool === "opencode") return `opencode: ${cfg.opencode?.model} on ${SERVER_NAME[cfg.opencode?.kind] ?? cfg.opencode?.baseUrl}`;
  return TOOL_LABEL[cfg.tool];
}

// ---------- sign-in (subscriptions, not API credits) ----------
// Claude Code and Codex are used with the student's own Claude / ChatGPT subscription login.
// An API key in the environment would take priority over that login and bill API credits,
// so these are removed from the environment of every agent we start.
const API_KEY_ENV = {
  claude: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
  codex: ["OPENAI_API_KEY", "CODEX_API_KEY"],
};
export function agentEnv(tool) {
  const env = { ...process.env };
  for (const k of API_KEY_ENV[tool] ?? []) delete env[k];
  return env;
}
/** { loggedIn, subscription, how } for claude/codex; null if the tool isn't installed. */
export function loginStatus(tool) {
  if (tool === "claude") {
    const r = spawnSync("claude", ["auth", "status", "--json"], { encoding: "utf8", env: agentEnv("claude"), timeout: 15000 });
    if (r.error) return null;
    try {
      const j = JSON.parse(r.stdout);
      const apiKey = /api.?key/i.test(`${j.authMethod ?? ""} ${j.apiKeySource ?? ""}`);
      return { loggedIn: !!j.loggedIn, subscription: !!j.loggedIn && !apiKey, how: j.authMethod ?? "" };
    } catch { return { loggedIn: false, subscription: false, how: "" }; }
  }
  if (tool === "codex") {
    const r = spawnSync("codex", ["login", "status"], { encoding: "utf8", env: agentEnv("codex"), timeout: 15000 });
    if (r.error) return null;
    const out = `${r.stdout}${r.stderr}`.trim();
    const loggedIn = r.status === 0 && /logged in/i.test(out) && !/not logged in/i.test(out);
    return { loggedIn, subscription: loggedIn && !/api key/i.test(out), how: out.split("\n")[0] };
  }
  return null;
}
/** Runs the tool's own browser sign-in (Claude account / ChatGPT account). */
export function login(tool) {
  const [bin, args] = tool === "claude" ? ["claude", ["auth", "login"]] : ["codex", ["login"]];
  return spawnSync(bin, args, { stdio: "inherit", env: agentEnv(tool) }).status === 0;
}

// ---------- opencode on a local model ----------
// The model choice is personal, so it goes in .opencode/opencode.json (git-ignored); opencode
// merges it with the shared opencode.json in the repo root.
export function opencodeProvider(local) {
  const id = local.kind === "lmstudio" ? "lmstudio" : local.kind === "ollama" ? "ollama" : "local";
  const baseURL = local.kind === "ollama" ? `${local.baseUrl.replace(/\/v1\/?$/, "")}/v1` : local.baseUrl;
  return {
    id,
    config: {
      npm: "@ai-sdk/openai-compatible",
      name: SERVER_NAME[local.kind] ?? "Local server",
      options: { baseURL, ...(local.apiKeyEnv ? { apiKey: `{env:${local.apiKeyEnv}}` } : {}) },
      models: Object.fromEntries((local.models?.length ? local.models : [local.model]).map((m) => [m, { name: m }])),
    },
  };
}
export function writeOpencodeConfig(root, local) {
  const p = join(root, ".opencode", "opencode.json");
  let cfg = {};
  try { if (existsSync(p)) cfg = JSON.parse(readFileSync(p, "utf8")); } catch {}
  const { id, config } = opencodeProvider(local);
  cfg = { $schema: "https://opencode.ai/config.json", ...cfg, model: `${id}/${local.model}`, provider: { ...(cfg.provider ?? {}), [id]: config } };
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(cfg, null, 2)}\n`);
  return `${id}/${local.model}`;
}

// ---------- agent tools ----------
const CLAUDE_TOOLS = "Read,Write,Edit,Glob,Grep,Bash(node packages/ai/validate.mjs *),Bash(python3 tools/extract_text.py *),Bash(ls *),Bash(grep *),Bash(date)";
export function agentCommand(cfg, prompt, { interactive = false } = {}) {
  if (cfg.tool === "claude") {
    return interactive ? ["claude", prompt ? [prompt] : []] : ["claude", ["-p", prompt, "--permission-mode", "acceptEdits", "--allowedTools", CLAUDE_TOOLS]];
  }
  if (cfg.tool === "opencode") {
    // .opencode/opencode.json sets the model; opencode.json in the root denies the eClass key and destructive commands
    return interactive
      ? ["opencode", prompt ? ["--prompt", prompt] : []]
      : ["opencode", ["run", "--auto", prompt]];
  }
  // codex exec never asks for approval; workspace-write keeps it inside this folder
  return interactive
    ? ["codex", prompt ? [prompt] : []]
    : ["codex", ["exec", "--sandbox", "workspace-write", "--skip-git-repo-check", prompt]];
}
export function runAgent(root, cfg, prompt, opts = {}) {
  const [bin, args] = agentCommand(cfg, prompt, opts);
  return new Promise((res) => {
    const p = spawn(bin, args, { cwd: root, stdio: "inherit", env: agentEnv(cfg.tool) });
    p.on("error", (e) => { console.error(`✗ Couldn't start ${bin}: ${e.message}`); res(127); });
    p.on("exit", (code) => res(code ?? 1));
  });
}

// ---------- chat models ----------
/**
 * Stream a chat completion. local = { kind: "ollama" | "lmstudio" | "openai", baseUrl, model, ctx?, apiKeyEnv? }
 * Returns the full text; onToken(t) gets each piece as it arrives.
 */
export async function chat(local, messages, { onToken = () => {}, temperature = 0.3 } = {}) {
  let res;
  const ollama = local.kind === "ollama";
  const url = ollama ? `${local.baseUrl.replace(/\/v1\/?$/, "")}/api/chat` : `${local.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const headers = { "Content-Type": "application/json" };
  if (local.apiKeyEnv && process.env[local.apiKeyEnv]) headers.Authorization = `Bearer ${process.env[local.apiKeyEnv]}`;
  const body = ollama
    ? { model: local.model, messages, stream: true, options: { num_ctx: local.ctx ?? 32768, temperature } }
    : { model: local.model, messages, stream: true, temperature };
  try { res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) }); }
  catch (e) { throw new Error(`Can't reach the model at ${local.baseUrl} (${e.cause?.code ?? e.message}). Is ${ollama ? "Ollama" : "the server"} running?`); }
  if (!res.ok) throw new Error(`The model server answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const dec = new TextDecoder();
  let buf = "", out = "";
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let piece = "";
      try {
        if (ollama) { const j = JSON.parse(line); if (j.error) throw new Error(j.error); piece = j.message?.content ?? ""; }
        else if (line.startsWith("data:")) { const d = line.slice(5).trim(); if (d === "[DONE]") continue; piece = JSON.parse(d).choices?.[0]?.delta?.content ?? ""; }
      } catch (e) { if (e instanceof SyntaxError) continue; throw e; }
      if (piece) { out += piece; onToken(piece); }
    }
  }
  return out;
}
