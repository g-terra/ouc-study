// AI backends for `ouc ai`: agent tools (Claude Code, Codex, Codex on a local model) that read the
// repo and skills themselves, and plain local/remote chat models (Ollama, LM Studio, any
// OpenAI-compatible server) that get the course material handed to them. Zero dependencies.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const TOOL_LABEL = {
  claude: "Claude Code",
  codex: "Codex",
  "codex-oss": "Codex with a local model",
  local: "Local model",
};
export const AGENTIC = new Set(["claude", "codex", "codex-oss"]);

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

/** What's installed / running on this computer. */
export async function detect() {
  const [ollama, lms] = await Promise.all([getJson("http://localhost:11434/api/tags"), getJson("http://localhost:1234/v1/models")]);
  return {
    claude: which("claude"),
    codex: which("codex"),
    ollama: ollama ? { baseUrl: "http://localhost:11434", models: (ollama.models ?? []).map((m) => m.name) } : null,
    lmstudio: lms ? { baseUrl: "http://localhost:1234/v1", models: (lms.data ?? []).map((m) => m.id) } : null,
  };
}

// ---------- config (.ouc/ai.json, git-ignored) ----------
export function loadConfig(root) {
  const p = join(root, ".ouc", "ai.json");
  try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; } catch { return null; }
}
export function saveConfig(root, cfg) {
  mkdirSync(join(root, ".ouc"), { recursive: true });
  writeFileSync(join(root, ".ouc", "ai.json"), `${JSON.stringify(cfg, null, 2)}\n`);
}
export function describe(cfg) {
  if (!cfg?.tool) return "not chosen yet";
  if (cfg.tool === "local") return `${TOOL_LABEL.local}: ${cfg.local?.model} on ${cfg.local?.kind === "ollama" ? "Ollama" : cfg.local?.kind === "lmstudio" ? "LM Studio" : cfg.local?.baseUrl}`;
  if (cfg.tool === "codex-oss") return `${TOOL_LABEL["codex-oss"]}: ${cfg.oss?.model ?? "gpt-oss:20b"} on ${cfg.oss?.provider === "lmstudio" ? "LM Studio" : "Ollama"}`;
  return TOOL_LABEL[cfg.tool];
}

// ---------- agent tools ----------
const CLAUDE_TOOLS = "Read,Write,Edit,Glob,Grep,Bash(node packages/ai/validate.mjs:*),Bash(python3 tools/extract_text.py:*),Bash(ls:*),Bash(grep:*),Bash(date)";
export function agentCommand(cfg, prompt, { interactive = false } = {}) {
  if (cfg.tool === "claude") {
    return interactive ? ["claude", prompt ? [prompt] : []] : ["claude", ["-p", prompt, "--permission-mode", "acceptEdits", "--allowedTools", CLAUDE_TOOLS]];
  }
  const oss = cfg.tool === "codex-oss"
    ? ["--oss", "-m", cfg.oss?.model ?? "gpt-oss:20b", ...(cfg.oss?.provider ? ["-c", `oss_provider="${cfg.oss.provider}"`] : [])]
    : [];
  return interactive
    ? ["codex", [...oss, ...(prompt ? [prompt] : [])]]
    : ["codex", ["exec", ...oss, "--full-auto", "--skip-git-repo-check", prompt]];
}
export function runAgent(root, cfg, prompt, opts = {}) {
  const [bin, args] = agentCommand(cfg, prompt, opts);
  return new Promise((res) => {
    const p = spawn(bin, args, { cwd: root, stdio: "inherit" });
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
