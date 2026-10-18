// AI backends for `ouc ai`: agent tools (Claude Code and Codex with the student's own subscription
// login, opencode on a local model) that read the repo and skills themselves, and plain local/remote
// chat models (Ollama, LM Studio, any OpenAI-compatible server) that get the course material
// handed to them. Zero dependencies.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, win32 } from "node:path";

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

/** Every match on PATH, best first (`where` on Windows lists claude.cmd and claude.exe, one per line). */
export function whichAll(bin, platform = process.platform, env = process.env) {
  const r = spawnSync(platform === "win32" ? "where" : "which", [bin], { encoding: "utf8", env });
  return r.status === 0 ? r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
}
const which = (bin) => {
  const all = whichAll(bin);
  return all.find((p) => /\.(exe|com|cmd|bat)$/i.test(p)) ?? all[0] ?? null;
};

// ---------- starting a CLI on any OS ----------
// On Windows, npm installs the agent CLIs as .cmd shims, which Node can't start without a shell
// (and a shell would mangle a multi-line prompt). The shim only runs `node <script> %*`, so we run
// that script with this Node instead; .exe installs (Claude's native installer) start directly.
/** The script or program an npm .cmd shim runs: { node: true, target } or { node: false, target }, or null. */
export function parseCmdShim(text, shimPath) {
  const dir = win32.dirname(shimPath);
  const node = text.match(/"%_prog%"\s+"%(?:~)?dp0%?\\([^"]+)"\s+%\*/i);
  if (node) return { node: true, target: win32.resolve(dir, node[1]) };
  const exe = text.match(/"%(?:~)?dp0%?\\([^"]+\.(?:exe|com))"\s+%\*/i);
  return exe ? { node: false, target: win32.resolve(dir, exe[1]) } : null;
}
/** cmd.exe quoting for the rare shim we can't read (last resort: newlines can't survive cmd.exe). */
const cmdQuote = (a) => `"${String(a).replace(/[\r\n]+/g, " ").replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
/**
 * [file, args, spawnOptions] that starts `bin args` on this OS. A path to a .mjs/.js script runs
 * with this Node everywhere (tests use a fake agent script).
 */
export function resolveCommand(bin, args = [], { platform = process.platform, env = process.env, find = whichAll, read = (f) => readFileSync(f, "utf8") } = {}) {
  if (/\.[cm]?js$/i.test(bin)) return [process.execPath, [bin, ...args], {}];
  if (platform !== "win32") return [bin, args, {}];
  const found = /[\\/]/.test(bin) ? [bin] : find(bin, platform, env);
  const exe = found.find((p) => /\.(exe|com)$/i.test(p));
  if (exe) return [exe, args, {}];
  const shim = found.find((p) => /\.(cmd|bat)$/i.test(p));
  if (!shim) return [bin, args, {}];
  let parsed = null;
  try { parsed = parseCmdShim(read(shim), shim); } catch {}
  if (parsed?.node) return [process.execPath, [parsed.target, ...args], {}];
  if (parsed) return [parsed.target, args, {}];
  return [`"${shim}" ${args.map(cmdQuote).join(" ")}`, [], { shell: true }];
}
/** spawn / spawnSync that also work with the Windows .cmd shims (same arguments as node's). */
export const spawnCli = (bin, args, opts = {}) => { const [f, a, o] = resolveCommand(bin, args, { env: opts.env }); return spawn(f, a, { ...opts, ...o }); };
export const spawnCliSync = (bin, args, opts = {}) => { const [f, a, o] = resolveCommand(bin, args, { env: opts.env }); return spawnSync(f, a, { ...opts, ...o }); };
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
const LOGIN_CMD = { claude: ["claude", ["auth", "status", "--json"]], codex: ["codex", ["login", "status"]] };
/** Reads the output of the tool's own status command (see LOGIN_CMD). */
export function parseLogin(tool, { status, stdout = "", stderr = "" }) {
  if (tool === "claude") {
    try {
      const j = JSON.parse(stdout);
      const apiKey = /api.?key/i.test(`${j.authMethod ?? ""} ${j.apiKeySource ?? ""}`);
      return { loggedIn: !!j.loggedIn, subscription: !!j.loggedIn && !apiKey, how: j.authMethod ?? "" };
    } catch { return { loggedIn: false, subscription: false, how: "" }; }
  }
  const out = `${stdout}${stderr}`.trim();
  const loggedIn = status === 0 && /logged in/i.test(out) && !/not logged in/i.test(out);
  return { loggedIn, subscription: loggedIn && !/api key/i.test(out), how: out.split("\n")[0] };
}
/** { loggedIn, subscription, how } for claude/codex; null if the tool isn't installed. */
export function loginStatus(tool) {
  if (!LOGIN_CMD[tool]) return null;
  const [bin, args] = LOGIN_CMD[tool];
  const r = spawnCliSync(bin, args, { encoding: "utf8", env: agentEnv(tool), timeout: 15000 });
  return r.error ? null : parseLogin(tool, r);
}
/** Same as loginStatus, without blocking (for the app server). */
export function loginStatusAsync(tool, ms = 8000) {
  if (!LOGIN_CMD[tool]) return Promise.resolve(null);
  const [bin, args] = LOGIN_CMD[tool];
  return new Promise((done) => {
    let stdout = "", stderr = "";
    const p = spawnCli(bin, args, { env: agentEnv(tool) });
    const t = setTimeout(() => { p.kill(); done({ loggedIn: false, subscription: false, how: "", unknown: true }); }, ms);
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", () => { clearTimeout(t); done(null); });
    p.on("exit", (status) => { clearTimeout(t); done(parseLogin(tool, { status, stdout, stderr })); });
  });
}
/** Runs the tool's own browser sign-in (Claude account / ChatGPT account). */
export function login(tool) {
  const [bin, args] = tool === "claude" ? ["claude", ["auth", "login"]] : ["codex", ["login"]];
  return spawnCliSync(bin, args, { stdio: "inherit", env: agentEnv(tool) }).status === 0;
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
const CLAUDE_TOOLS = "Read,Write,Edit,Glob,Grep,Bash(node packages/ai/validate.mjs *),Bash(python3 tools/extract_text.py *),Bash(python tools/extract_text.py *),Bash(ls *),Bash(grep *),Bash(date),Bash(node bin/ouc sync*),Bash(node bin/ouc pull*)";
/**
 * [bin, args] for an agent run. interactive: the tool's own terminal UI.
 * json: one-shot run that prints machine-readable events (used by the study app), optionally
 * continuing an earlier conversation (resume = the tool's session/thread id).
 */
export function agentCommand(cfg, prompt, { interactive = false, json = false, resume } = {}) {
  if (cfg.tool === "claude") {
    if (interactive) return ["claude", prompt ? [prompt] : []];
    const tools = json ? `${CLAUDE_TOOLS},WebSearch,WebFetch` : CLAUDE_TOOLS;
    return ["claude", ["-p", prompt, "--permission-mode", "acceptEdits", "--allowedTools", tools,
      ...(json ? ["--output-format", "stream-json", "--verbose", "--disallowedTools", "Read(.eclass-token),Read(./.eclass-token)"] : []),
      ...(resume ? ["--resume", resume] : [])]];
  }
  if (cfg.tool === "opencode") {
    // .opencode/opencode.json sets the model; opencode.json in the root denies the eClass key and destructive commands
    if (interactive) return ["opencode", prompt ? ["--prompt", prompt] : []];
    return ["opencode", ["run", "--auto", ...(json ? ["--format", "json"] : []), ...(resume ? ["--session", resume] : []), prompt]];
  }
  // codex exec never asks for approval; workspace-write keeps it inside this folder
  if (interactive) return ["codex", prompt ? [prompt] : []];
  const base = ["exec", ...(json ? ["--json"] : []), "--sandbox", "workspace-write", "--skip-git-repo-check"];
  return ["codex", resume ? [...base, "resume", resume, prompt] : [...base, prompt]];
}
export function runAgent(root, cfg, prompt, opts = {}) {
  const [bin, args] = agentCommand(cfg, prompt, opts);
  return new Promise((res) => {
    const p = spawnCli(bin, args, { cwd: root, stdio: "inherit", env: agentEnv(cfg.tool) });
    p.on("error", (e) => { console.error(`✗ Couldn't start ${bin}: ${e.message}`); res(127); });
    p.on("exit", (code) => res(code ?? 1));
  });
}

// ---------- chat models ----------
/**
 * Stream a chat completion. local = { kind: "ollama" | "lmstudio" | "openai", baseUrl, model, ctx?, apiKeyEnv? }
 * Returns the full text; onToken(t) gets each piece as it arrives.
 */
export async function chat(local, messages, { onToken = () => {}, temperature = 0.3, signal } = {}) {
  let res;
  const ollama = local.kind === "ollama";
  const url = ollama ? `${local.baseUrl.replace(/\/v1\/?$/, "")}/api/chat` : `${local.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const headers = { "Content-Type": "application/json" };
  if (local.apiKeyEnv && process.env[local.apiKeyEnv]) headers.Authorization = `Bearer ${process.env[local.apiKeyEnv]}`;
  const body = ollama
    ? { model: local.model, messages, stream: true, options: { num_ctx: local.ctx ?? 32768, temperature } }
    : { model: local.model, messages, stream: true, temperature };
  try { res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal }); }
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
