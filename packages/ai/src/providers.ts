// AI backends for `ouc ai`: agent tools (Claude Code and Codex with the student's own subscription
// login, opencode on a local model) that read the repo and skills themselves, and plain local/remote
// chat models (Ollama, LM Studio, any OpenAI-compatible server) that get the course material
// handed to them. Zero dependencies.
import { spawn, spawnSync, type ChildProcess, type SpawnOptions, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, win32 } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

/** The AI the student chose: an agent tool that reads the repo itself, or a plain local chat model. */
export type Tool = "claude" | "codex" | "opencode" | "local";
export type AgentTool = Exclude<Tool, "local">;
/** A model server: Ollama, LM Studio or any OpenAI-compatible one. */
export interface LocalModel {
  kind: "ollama" | "lmstudio" | "openai" | (string & {});
  baseUrl: string;
  model: string;
  models?: string[];
  ctx?: number;         // context window (Ollama)
  budget?: number;      // characters of course material to send
  apiKeyEnv?: string;   // name of the environment variable that holds its key
}
/** .ouc/ai.json */
export interface AiConfig {
  tool: Tool | null;
  local?: LocalModel;
  opencode?: LocalModel;
  autoPrep?: boolean;   // prepare assignment prep packs in the background (default on)
  autoQuiz?: boolean;   // Sync now also makes a quiz for every class without one (default on)
  parallel?: number;    // background AI runs at once (default 3)
  models?: Partial<Record<"claude" | "codex", string[]>>;   // the models the app offers for these tools (default AGENT_MODELS)
  defaultModels?: Partial<Record<Tool, string>>;            // the model each AI uses unless the chat picks another (Settings)
}
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface LoginState { loggedIn: boolean; subscription: boolean; how: string; unknown?: boolean }
export interface Detected {
  claude: string | null; codex: string | null; opencode: string | null;
  ollama: { baseUrl: string; models: string[] } | null;
  lmstudio: { baseUrl: string; models: string[] } | null;
}

export const TOOL_LABEL: Record<Tool, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "opencode with a local model",
  local: "Local model",
};
export const AGENTIC: ReadonlySet<string> = new Set(["claude", "codex", "opencode"]);
export const isAgentic = (t: unknown): t is AgentTool => AGENTIC.has(t as string);
export const INSTALL_HINT: Record<AgentTool, string> = {
  claude: "npm i -g @anthropic-ai/claude-code",
  codex: "npm i -g @openai/codex",
  opencode: "npm i -g opencode-ai",
};
// The models the Ask AI panel offers. Claude Code takes these aliases with any Claude plan. Codex's list
// comes from the installed Codex itself (`codex debug models`: the catalog for your ChatGPT sign-in), with
// the one bundled in Codex 0.163 as a fallback. Both stay on the subscription (no API credits); "models"
// in .ouc/ai.json replaces a list. opencode and plain local models offer what their server has (`ouc ai setup`).
export const AGENT_MODELS: Record<"claude" | "codex", string[]> = {
  claude: ["sonnet", "opus", "haiku"],
  codex: ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"],
};
export interface ToolModels {
  models: string[];
  /** the model a new chat uses: the one set in Settings, else the tool's own (undefined: not known) */
  model?: string;
  /** the tool's own default: Claude Code's or Codex's settings, Codex's first model, or the model from `ouc ai setup` */
  own?: string;
  /** set in Settings (.ouc/ai.json defaultModels) */
  setting?: string;
}
/** The models a tool can be asked to use, and which one it uses when the chat picks none. */
export function toolModels(cfg: Pick<AiConfig, "models" | "opencode" | "local" | "defaultModels"> | null, tool: string, home = homedir()): ToolModels {
  let models: string[], own: string | undefined;
  if (tool === "claude" || tool === "codex") {
    const listed = cfg?.models?.[tool]?.filter((m) => typeof m === "string" && m);
    models = listed ?? (tool === "codex" && codexCatalog?.length ? codexCatalog : AGENT_MODELS[tool]);
    own = ownDefault(tool, home) ?? (tool === "codex" ? models[0] : undefined);
  } else {
    const s = tool === "opencode" ? cfg?.opencode : tool === "local" ? cfg?.local : undefined;
    if (!s) return { models: [] };
    // what the server has now (read with the status), else what `ouc ai setup` saved
    models = [...new Set([s.model, ...(serverModels[tool as "opencode" | "local"] ?? s.models ?? [])])].filter(Boolean);
    own = s.model;
  }
  const set = cfg?.defaultModels?.[tool as Tool];
  const setting = set && models.includes(set) ? set : undefined;
  const model = setting ?? own;
  return { models, ...(model && { model }), ...(own && { own }), ...(setting && { setting }) };
}
/** The model set in Claude Code's or Codex's own settings (~/.claude/settings.json, ~/.codex/config.toml), if any. */
export function ownDefault(tool: "claude" | "codex", home = homedir()): string | undefined {
  try {
    if (tool === "claude") return JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8")).model || undefined;
    // a top-level `model = "..."`, not one inside a [profiles.x] table
    return readFileSync(join(home, ".codex", "config.toml"), "utf8").split(/^\s*\[/m)[0].match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1];
  } catch { return undefined; }
}
// the models the local servers had at the last status check (opencode and plain local models)
const serverModels: Partial<Record<"opencode" | "local", string[]>> = {};
export function setServerModels(tool: "opencode" | "local", models: string[] | undefined) { if (models?.length) serverModels[tool] = models; }

// Older configs used Codex's --oss mode for local models; opencode replaces it.
export const ALIASES: Record<string, Tool> = { "codex-oss": "opencode" };

/** Every match on PATH, best first (`where` on Windows lists claude.cmd and claude.exe, one per line). */
export function whichAll(bin: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  const r = spawnSync(platform === "win32" ? "where" : "which", [bin], { encoding: "utf8", env });
  return r.status === 0 ? r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
}
const which = (bin: string) => {
  const all = whichAll(bin);
  return all.find((p) => /\.(exe|com|cmd|bat)$/i.test(p)) ?? all[0] ?? null;
};

// ---------- starting a CLI on any OS ----------
// On Windows, npm installs the agent CLIs as .cmd shims, which Node can't start without a shell
// (and a shell would mangle a multi-line prompt). The shim only runs `node <script> %*`, so we run
// that script with this Node instead; .exe installs (Claude's native installer) start directly.
/** The script or program an npm .cmd shim runs: { node: true, target } or { node: false, target }, or null. */
export function parseCmdShim(text: string, shimPath: string): { node: boolean; target: string } | null {
  const dir = win32.dirname(shimPath);
  const node = text.match(/"%_prog%"\s+"%(?:~)?dp0%?\\([^"]+)"\s+%\*/i);
  if (node) return { node: true, target: win32.resolve(dir, node[1]!) };
  const exe = text.match(/"%(?:~)?dp0%?\\([^"]+\.(?:exe|com))"\s+%\*/i);
  return exe ? { node: false, target: win32.resolve(dir, exe[1]!) } : null;
}
/** cmd.exe quoting for the rare shim we can't read (last resort: newlines can't survive cmd.exe). */
const cmdQuote = (a: string) => `"${String(a).replace(/[\r\n]+/g, " ").replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
/**
 * [file, args, spawnOptions] that starts `bin args` on this OS. A path to a .mjs/.js script runs
 * with this Node everywhere (tests use a fake agent script).
 */
export function resolveCommand(bin: string, args: string[] = [], { platform = process.platform, env = process.env, find = whichAll, read = (f: string) => readFileSync(f, "utf8") }: {
  platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; find?: typeof whichAll; read?: (file: string) => string;
} = {}): [file: string, args: string[], options: { shell?: boolean }] {
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
export const spawnCli = (bin: string, args: string[], opts: SpawnOptions = {}): ChildProcess => { const [f, a, o] = resolveCommand(bin, args, { env: opts.env }); return spawn(f, a, { ...opts, ...o }); };
export function spawnCliSync(bin: string, args: string[], opts: SpawnSyncOptions & { encoding: BufferEncoding }): SpawnSyncReturns<string>;
export function spawnCliSync(bin: string, args: string[], opts?: SpawnSyncOptions): SpawnSyncReturns<string | Buffer>;
export function spawnCliSync(bin: string, args: string[], opts: SpawnSyncOptions = {}) { const [f, a, o] = resolveCommand(bin, args, { env: opts.env }); return spawnSync(f, a, { ...opts, ...o }); }
async function getJson<T>(url: string, ms = 1500): Promise<T | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; }
}

/** Is the model server up? (opencode would otherwise keep retrying in silence.) */
export async function serverUp(server: Pick<LocalModel, "kind" | "baseUrl">): Promise<boolean> {
  const url = server.kind === "ollama" ? `${server.baseUrl.replace(/\/v1\/?$/, "")}/api/tags` : `${server.baseUrl.replace(/\/$/, "")}/models`;
  try { await fetch(url, { signal: AbortSignal.timeout(2500) }); return true; } catch { return false; }
}

/** What's installed / running on this computer. */
export async function detect(): Promise<Detected> {
  const [ollama, lms] = await Promise.all([
    getJson<{ models?: { name: string }[] }>("http://localhost:11434/api/tags"),
    getJson<{ data?: { id: string }[] }>("http://localhost:1234/v1/models"),
  ]);
  return {
    claude: which("claude"),
    codex: which("codex"),
    opencode: which("opencode"),
    ollama: ollama ? { baseUrl: "http://localhost:11434", models: (ollama.models ?? []).map((m) => m.name) } : null,
    lmstudio: lms ? { baseUrl: "http://localhost:1234/v1", models: (lms.data ?? []).map((m) => m.id) } : null,
  };
}

// ---------- config (.ouc/ai.json, git-ignored) ----------
export function loadConfig(root: string): AiConfig | null {
  const p = join(root, ".ouc", "ai.json");
  let cfg;
  try { cfg = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; } catch { return null; }
  if (cfg?.tool === "codex-oss") {   // old "Codex with a local model" settings → opencode on the same model
    const lms = cfg.oss?.provider === "lmstudio";
    cfg = { tool: "opencode", opencode: { kind: lms ? "lmstudio" : "ollama", baseUrl: lms ? "http://localhost:1234/v1" : "http://localhost:11434", model: cfg.oss?.model ?? "gpt-oss:20b" } };
  }
  // opencode set up without `ouc ai setup` saving it here: read its model from .opencode/opencode.json
  if (cfg && !cfg.opencode) { const oc = readOpencodeConfig(root); if (oc) cfg.opencode = oc; }
  return cfg;
}
/** The local model in .opencode/opencode.json (its default `model`, the server and the models it lists), if any. */
export function readOpencodeConfig(root: string): LocalModel | undefined {
  try {
    const j = JSON.parse(readFileSync(join(root, ".opencode", "opencode.json"), "utf8"));
    const [id, ...rest] = String(j.model ?? "").split("/");
    const p = j.provider?.[id];
    if (!rest.length || !p?.options?.baseURL) return undefined;
    const kind = id === "ollama" || id === "lmstudio" ? id : "openai";
    const baseUrl = kind === "ollama" ? String(p.options.baseURL).replace(/\/v1\/?$/, "") : String(p.options.baseURL);
    return { kind, baseUrl, model: rest.join("/"), models: Object.keys(p.models ?? {}) };
  } catch { return undefined; }
}
export function saveConfig(root: string, cfg: AiConfig): void {
  mkdirSync(join(root, ".ouc"), { recursive: true });
  writeFileSync(join(root, ".ouc", "ai.json"), `${JSON.stringify(cfg, null, 2)}\n`);
}
const SERVER_NAME: Record<string, string> = { ollama: "Ollama", lmstudio: "LM Studio" };
export function describe(cfg: AiConfig | null | undefined): string {
  if (!cfg?.tool) return "not chosen yet";
  if (cfg.tool === "local") return `${TOOL_LABEL.local}: ${cfg.local?.model} on ${SERVER_NAME[cfg.local?.kind ?? ""] ?? cfg.local?.baseUrl}`;
  if (cfg.tool === "opencode") return `opencode: ${cfg.opencode?.model} on ${SERVER_NAME[cfg.opencode?.kind ?? ""] ?? cfg.opencode?.baseUrl}`;
  return TOOL_LABEL[cfg.tool];
}

// ---------- sign-in (subscriptions, not API credits) ----------
// Claude Code and Codex are used with the student's own Claude / ChatGPT subscription login.
// An API key in the environment would take priority over that login and bill API credits,
// so these are removed from the environment of every agent we start.
const API_KEY_ENV: Record<string, string[]> = {
  claude: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
  codex: ["OPENAI_API_KEY", "CODEX_API_KEY"],
};
export function agentEnv(tool: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of API_KEY_ENV[tool] ?? []) delete env[k];
  return env;
}
const LOGIN_CMD: Record<string, [string, string[]]> = { claude: ["claude", ["auth", "status", "--json"]], codex: ["codex", ["login", "status"]] };
/** Reads the output of the tool's own status command (see LOGIN_CMD). */
export function parseLogin(tool: string, { status, stdout = "", stderr = "" }: { status: number | null; stdout?: string; stderr?: string }): LoginState {
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
export function loginStatus(tool: string): LoginState | null {
  const cmd = LOGIN_CMD[tool];
  if (!cmd) return null;
  const [bin, args] = cmd;
  const r = spawnCliSync(bin, args, { encoding: "utf8", env: agentEnv(tool), timeout: 15000 });
  return r.error ? null : parseLogin(tool, r);
}
/** Same as loginStatus, without blocking (for the app server). */
export function loginStatusAsync(tool: string, ms = 8000): Promise<LoginState | null> {
  const cmd = LOGIN_CMD[tool];
  if (!cmd) return Promise.resolve(null);
  const [bin, args] = cmd;
  return new Promise((done) => {
    let stdout = "", stderr = "";
    const p = spawnCli(bin, args, { env: agentEnv(tool) });
    const t = setTimeout(() => { p.kill(); done({ loggedIn: false, subscription: false, how: "", unknown: true }); }, ms);
    p.stdout?.on("data", (d) => (stdout += d));
    p.stderr?.on("data", (d) => (stderr += d));
    p.on("error", () => { clearTimeout(t); done(null); });
    p.on("exit", (status) => { clearTimeout(t); done(parseLogin(tool, { status, stdout, stderr })); });
  });
}
/** The models Codex lists in its picker (`codex debug models`), best first; hidden and internal ones are left out. */
export function parseCodexModels(out: string): string[] {
  try {
    const j = JSON.parse(out.slice(out.indexOf("{")));
    return (Array.isArray(j?.models) ? j.models : [])
      .filter((m: { slug?: unknown; visibility?: unknown }) => typeof m?.slug === "string" && /^\w[\w.:-]*$/.test(m.slug) && m.visibility === "list")
      .sort((a: { priority?: number }, b: { priority?: number }) => (a.priority ?? 99) - (b.priority ?? 99))
      .map((m: { slug: string }) => m.slug);
  } catch { return []; }
}
// the last list read from Codex (toolModels uses it, so the app accepts exactly what the picker showed)
let codexCatalog: string[] | null = null;
/** Reads Codex's model catalog for this sign-in; keeps the last good list when Codex can't answer. */
export function codexModelsAsync(ms = 10000, bin = "codex"): Promise<string[] | null> {
  return new Promise((done) => {
    let stdout = "";
    const p = spawnCli(bin, ["debug", "models"], { env: agentEnv("codex") });
    const t = setTimeout(() => { p.kill(); done(codexCatalog); }, ms);
    p.stdout?.on("data", (d) => (stdout += d));
    p.on("error", () => { clearTimeout(t); done(codexCatalog); });
    p.on("exit", () => {
      clearTimeout(t);
      const found = parseCodexModels(stdout);
      if (found.length) codexCatalog = found;
      done(codexCatalog);
    });
  });
}

/** Runs the tool's own browser sign-in (Claude account / ChatGPT account). */
export function login(tool: AgentTool): boolean {
  const [bin, args]: [string, string[]] = tool === "claude" ? ["claude", ["auth", "login"]] : ["codex", ["login"]];
  return spawnCliSync(bin, args, { stdio: "inherit", env: agentEnv(tool) }).status === 0;
}

// ---------- opencode on a local model ----------
// The model choice is personal, so it goes in .opencode/opencode.json (git-ignored); opencode
// merges it with the shared opencode.json in the repo root.
export function opencodeProvider(local: LocalModel) {
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
export function writeOpencodeConfig(root: string, local: LocalModel): string {
  const p = join(root, ".opencode", "opencode.json");
  let cfg: { provider?: Record<string, unknown>; [k: string]: unknown } = {};
  try { if (existsSync(p)) cfg = JSON.parse(readFileSync(p, "utf8")); } catch {}
  const { id, config } = opencodeProvider(local);
  cfg = { $schema: "https://opencode.ai/config.json", ...cfg, model: `${id}/${local.model}`, provider: { ...(cfg.provider ?? {}), [id]: config } };
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(cfg, null, 2)}\n`);
  return `${id}/${local.model}`;
}

// ---------- agent tools ----------
/** Extra Claude Code settings for study runs: contributor plugins (Superpowers, see dev/README.md) stay off. */
export const CLAUDE_STUDY_SETTINGS = fileURLToPath(new URL("../claude-study-settings.json", import.meta.url));
const CLAUDE_TOOLS = "Read,Write,Edit,Glob,Grep,Bash(node packages/ai/validate.mjs *),Bash(python3 tools/extract_text.py *),Bash(python tools/extract_text.py *),Bash(ls *),Bash(grep *),Bash(date),Bash(node bin/ouc sync*),Bash(node bin/ouc pull*)";
/**
 * [bin, args] for an agent run. interactive: the tool's own terminal UI.
 * json: one-shot run that prints machine-readable events (used by the study app), optionally
 * continuing an earlier conversation (resume = the tool's session/thread id).
 */
export function agentCommand(cfg: Pick<AiConfig, "tool" | "opencode">, prompt: string, { interactive = false, json = false, resume, model }: { interactive?: boolean; json?: boolean; resume?: string; model?: string } = {}): [bin: string, args: string[]] {
  if (cfg.tool === "claude") {
    const study = ["--settings", CLAUDE_STUDY_SETTINGS];
    if (interactive) return ["claude", prompt ? [...study, prompt] : study];
    const tools = json ? `${CLAUDE_TOOLS},WebSearch,WebFetch` : CLAUDE_TOOLS;
    return ["claude", [...study, "-p", prompt, "--permission-mode", "acceptEdits", "--allowedTools", tools,
      ...(json ? ["--output-format", "stream-json", "--verbose", "--disallowedTools", "Read(.eclass-token),Read(./.eclass-token)"] : []),
      ...(resume ? ["--resume", resume] : []), ...(model ? ["--model", model] : [])]];
  }
  if (cfg.tool === "opencode") {
    // .opencode/opencode.json sets the model; opencode.json in the root denies the eClass key and destructive commands
    if (interactive) return ["opencode", prompt ? ["--prompt", prompt] : []];
    const m = model && cfg.opencode ? `${opencodeProvider(cfg.opencode).id}/${model}` : model;
    return ["opencode", ["run", "--auto", ...(json ? ["--format", "json"] : []), ...(resume ? ["--session", resume] : []), ...(m ? ["--model", m] : []), prompt]];
  }
  // codex exec never asks for approval; workspace-write keeps it inside this folder
  if (interactive) return ["codex", prompt ? [prompt] : []];
  const base = ["exec", ...(json ? ["--json"] : []), "--sandbox", "workspace-write", "--skip-git-repo-check", ...(model ? ["--model", model] : [])];
  return ["codex", resume ? [...base, "resume", resume, prompt] : [...base, prompt]];
}
export function runAgent(root: string, cfg: AiConfig, prompt: string, opts: Parameters<typeof agentCommand>[2] = {}): Promise<number> {
  const [bin, args] = agentCommand(cfg, prompt, opts);
  return new Promise((res) => {
    const p = spawnCli(bin, args, { cwd: root, stdio: "inherit", env: agentEnv(cfg.tool ?? "") });
    p.on("error", (e) => { console.error(`✗ Couldn't start ${bin}: ${e.message}`); res(127); });
    p.on("exit", (code) => res(code ?? 1));
  });
}

// ---------- chat models ----------
/**
 * Stream a chat completion. local = { kind: "ollama" | "lmstudio" | "openai", baseUrl, model, ctx?, apiKeyEnv? }
 * Returns the full text; onToken(t) gets each piece as it arrives.
 */
export async function chat(local: LocalModel, messages: ChatMessage[], { onToken = (_t: string) => {}, temperature = 0.3, signal }: { onToken?: (piece: string) => void; temperature?: number; signal?: AbortSignal } = {}): Promise<string> {
  let res;
  const ollama = local.kind === "ollama";
  const url = ollama ? `${local.baseUrl.replace(/\/v1\/?$/, "")}/api/chat` : `${local.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (local.apiKeyEnv && process.env[local.apiKeyEnv]) headers.Authorization = `Bearer ${process.env[local.apiKeyEnv]}`;
  const body = ollama
    ? { model: local.model, messages, stream: true, options: { num_ctx: local.ctx ?? 32768, temperature } }
    : { model: local.model, messages, stream: true, temperature };
  try { res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal }); }
  catch (e) { const err = e as Error & { cause?: { code?: string } }; throw new Error(`Can't reach the model at ${local.baseUrl} (${err.cause?.code ?? err.message}). Is ${ollama ? "Ollama" : "the server"} running?`); }
  if (!res.ok) throw new Error(`The model server answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const dec = new TextDecoder();
  let buf = "", out = "";
  for await (const chunk of res.body ?? []) {
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
