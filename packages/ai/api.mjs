// /api/ai/*: lets the study app talk to the AI chosen with `ouc ai setup`. Mounted by the Vite
// server (apps/web/vite.config.ts), which is also what the background app runs, on 127.0.0.1.
//
//   GET  /api/ai/status        which coding tools are installed and signed in (cached 5 min, ?fresh=1)
//   GET  /api/ai/actions       the study actions (one per skill in ai/skills/)
//   POST /api/ai/run           { sem, chatId?, action?, params?, message } → Server-Sent Events
//   POST /api/ai/stop          { chatId }
//   GET  /api/ai/chats         saved chats (newest first);  GET /api/ai/chats/<id>   one chat
//
// Agents run on the student's own computer with their subscription login (no API keys).
// Chats are saved in .ouc/chats/ (git-ignored).
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { AGENTIC, ALIASES, INSTALL_HINT, TOOL_LABEL, describe, detect, loadConfig, loginStatusAsync, serverUp } from "./providers.mjs";
import { buildPrompt, chatSystem, listActions } from "./actions.mjs";
import { currentSemesterId, loadData } from "./context.mjs";
import { runAgentTurn, runChatTurn } from "./stream.mjs";

// The background app starts with a minimal PATH; add the usual install places of the agent CLIs.
const EXTRA_PATH = [join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".npm-global/bin"), join(homedir(), ".opencode/bin"), join(homedir(), ".bun/bin")];
export function widenPath(env = process.env) {
  const have = (env.PATH ?? "").split(delimiter);
  env.PATH = [...have, ...EXTRA_PATH.filter((p) => !have.includes(p) && existsSync(p))].filter(Boolean).join(delimiter);
}

const LOGIN_FIX = { claude: "claude auth login", codex: "codex login" };
const SERVER_NAME = { ollama: "Ollama", lmstudio: "LM Studio" };
const SERVER_FIX = { ollama: "ollama serve (or open the Ollama app)", lmstudio: "LM Studio → Developer → Start server" };

/** Per-tool state for the header popover: connected | signedout | apikey | missing | noserver | unknown. */
export async function aiStatus(root) {
  const cfg = loadConfig(root);
  const chosen = cfg?.tool ? (ALIASES[cfg.tool] ?? cfg.tool) : null;
  const d = await detect();
  const login = async (t) => (d[t] ? loginStatusAsync(t) : null);
  const [claude, codex] = await Promise.all([login("claude"), login("codex")]);
  const signed = (t, st) => {
    if (!d[t]) return { state: "missing", fix: INSTALL_HINT[t] };
    if (!st || st.unknown) return { state: "unknown", detail: "Installed; couldn't read the sign-in status", fix: LOGIN_FIX[t] };
    if (st.subscription) return { state: "connected", detail: st.how ? `Signed in (${st.how})` : "Signed in with your subscription" };
    if (st.loggedIn) return { state: "apikey", detail: "Signed in with an API key (paid credits)", fix: LOGIN_FIX[t] };
    return { state: "signedout", detail: "Not signed in", fix: LOGIN_FIX[t] };
  };
  const server = async (s) => {
    if (!s?.baseUrl) return { state: "noserver", detail: "No local model chosen yet", fix: "ouc ai setup" };
    const up = await serverUp(s);
    const name = SERVER_NAME[s.kind] ?? s.baseUrl;
    return up ? { state: "connected", detail: `${s.model} on ${name}` } : { state: "noserver", detail: `${name} isn't running`, fix: SERVER_FIX[s.kind] ?? `start the server at ${s.baseUrl}` };
  };
  const ocServer = cfg?.opencode ?? (d.ollama ? { kind: "ollama", ...d.ollama, model: d.ollama.models[0] } : d.lmstudio ? { kind: "lmstudio", ...d.lmstudio, model: d.lmstudio.models[0] } : null);
  const tools = [
    { id: "claude", label: TOOL_LABEL.claude, ...signed("claude", claude) },
    { id: "codex", label: TOOL_LABEL.codex, ...signed("codex", codex) },
    { id: "opencode", label: "opencode", ...(d.opencode ? await server(ocServer) : { state: "missing", fix: INSTALL_HINT.opencode }) },
  ];
  if (chosen === "local") tools.push({ id: "local", label: TOOL_LABEL.local, ...(await server(cfg.local)) });
  for (const t of tools) t.chosen = t.id === chosen;
  const pick = tools.find((t) => t.chosen);
  return {
    chosen, label: describe(cfg), agentic: AGENTIC.has(chosen),
    ready: pick?.state === "connected",
    reason: !chosen ? "No AI chosen yet. In Terminal, run: ouc ai setup" : pick?.state === "connected" ? "" : `${pick?.label}: ${pick?.detail ?? "not ready"}${pick?.fix ? `. Fix: ${pick.fix}` : ""}`,
    skills: { claude: existsSync(join(root, ".claude/skills")), codex: existsSync(join(root, ".agents/skills")) },
    tools, checkedAt: new Date().toISOString(),
  };
}

// ---------- chats (.ouc/chats/<id>.json) ----------
const chatDir = (root) => join(root, ".ouc", "chats");
const safeId = (id) => /^[\w-]{6,64}$/.test(String(id ?? ""));
function loadChat(root, id) {
  try { return JSON.parse(readFileSync(join(chatDir(root), `${id}.json`), "utf8")); } catch { return null; }
}
function saveChat(root, chat) {
  mkdirSync(chatDir(root), { recursive: true });
  const { running, ...rest } = chat;
  writeFileSync(join(chatDir(root), `${chat.id}.json`), `${JSON.stringify(rest, null, 1)}\n`);
}
function listChats(root) {
  const dir = chatDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => loadChat(root, f.slice(0, -5))).filter(Boolean)
    .map(({ id, title, tool, action, sem, updatedAt }) => ({ id, title, tool, action, sem, updatedAt }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 50);
}

// ---------- HTTP ----------
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
function readBody(req, max = 100_000) {
  return new Promise((ok, fail) => {
    let s = "";
    req.on("data", (d) => { s += d; if (s.length > max) { fail(new Error("Request too large")); req.destroy(); } });
    req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch { fail(new Error("Bad JSON")); } });
    req.on("error", fail);
  });
}

/** Connect-style middleware. opts.bin overrides the agent binary (tests). */
export function createAiApi(root, opts = {}) {
  widenPath();
  const token = randomBytes(18).toString("base64url");   // only pages served by this app can read it
  const runs = new Map();                                 // chatId → { chat, stop, listeners }
  let cache;
  const json = (res, body, code = 200) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(body)); };

  async function run(req, res) {
    const body = await readBody(req);
    const cfg = loadConfig(root);
    const tool = cfg?.tool ? (ALIASES[cfg.tool] ?? cfg.tool) : null;
    if (!tool) return json(res, { error: "No AI chosen yet. In Terminal, run: ouc ai setup" }, 400);
    cfg.tool = tool;
    const semId = body.sem && existsSync(join(root, "semesters", body.sem)) ? body.sem : currentSemesterId(root);
    let data;
    try { data = semId ? loadData(root, semId) : { courses: [], notes: [], assignments: [] }; } catch (e) { return json(res, { error: e.message }, 500); }

    let chat = body.chatId && safeId(body.chatId) ? (runs.get(body.chatId)?.chat ?? loadChat(root, body.chatId)) : null;
    if (chat && runs.has(chat.id)) return json(res, { error: "Still working on the last message. Wait for it or press Stop." }, 409);
    const actions = listActions(root);
    const action = chat ? chat.action : body.action || null;
    const params = chat ? chat.params ?? {} : body.params ?? {};
    const meta = actions.find((a) => a.id === action);
    if (action && !meta) return json(res, { error: `Unknown action "${action}".` }, 400);
    if (meta?.agentOnly && !AGENTIC.has(tool)) return json(res, { error: `"${meta.title}" needs Claude Code, Codex or opencode. With a local model, use the ouc command in Terminal (ouc notes, ouc plan).` }, 400);
    const sameTool = chat && chat.tool === tool;
    const firstTurn = !chat || !sameTool || (AGENTIC.has(tool) && !chat.sessionId);
    let prompt;
    try { prompt = buildPrompt({ root, semId, data, action: chat && !firstTurn ? null : action, params, message: body.message, first: firstTurn && AGENTIC.has(tool) }); }
    catch (e) { return json(res, { error: e.message }, 400); }
    // a follow-up after switching tools starts a new conversation with that tool
    if (chat && !sameTool) chat = { ...chat, sessionId: undefined, tool };
    const shown = String(body.message ?? "").trim() || `${meta?.title ?? "Request"}${params.topic ? `: ${params.topic}` : ""}`;
    const now = new Date().toISOString();
    chat ??= { id: randomUUID(), title: shown.slice(0, 80), tool, action, params, sem: semId, createdAt: now, messages: [] };
    chat.updatedAt = now;
    chat.messages.push({ role: "user", text: shown, prompt, at: now });
    const reply = { role: "assistant", text: "", steps: [], files: [], at: now, by: describe(cfg) };
    chat.messages.push(reply);

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Accel-Buffering", "no");
    const live = { chat, stop: () => {}, listeners: new Set() };
    runs.set(chat.id, live);
    chat.running = true;
    const send = (e) => { for (const l of live.listeners) l(e); };
    const write = (e) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`); };
    live.listeners.add(write);
    res.on("close", () => live.listeners.delete(write));   // the run goes on; the chat is saved when it ends
    write({ type: "chat", id: chat.id, title: chat.title });

    const onEvent = (e) => {
      if (e.type === "text") {
        // agent tools send whole messages, local models send pieces: the app always gets pieces
        const piece = e.delta ? e.text : `${reply.text ? "\n\n" : ""}${e.text}`;
        reply.text += piece;
        return send({ type: "text", text: piece });
      }
      if (e.type === "session") chat.sessionId = e.id;
      else if (e.type === "tool") reply.steps.push(e.label);
      else if (e.type === "file") { if (!e.path || reply.files.includes(e.path)) return; reply.files.push(e.path); saveChat(root, chat); }
      else if (e.type === "error") reply.error = e.message;
      send(e);
    };
    const onStart = ({ stop }) => { live.stop = stop; };
    const done = AGENTIC.has(tool)
      ? runAgentTurn(root, cfg, prompt, { resume: sameTool ? chat.sessionId : undefined, onEvent, onStart, bin: opts.bin })
      : runChatTurn(cfg.local, [{ role: "system", content: chatSystem({ root, semId, data, action, params }) },
        ...chat.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.role === "user" ? m.prompt ?? m.text : m.text }))], { onEvent, onStart });
    done.finally(() => {
      chat.running = false;
      chat.updatedAt = new Date().toISOString();
      saveChat(root, chat);
      runs.delete(chat.id);
      if (!res.writableEnded) res.end();
    });
  }

  return async (req, res, next) => {
    if (!req.url?.startsWith("/api/ai/")) return next();
    const url = new URL(req.url, "http://x");
    // Only this app, opened on this computer, may use it (blocks other websites and DNS rebinding).
    const origin = req.headers.origin;
    if (!LOCAL_HOST.test(req.headers.host ?? "") || (origin && !LOCAL_HOST.test(origin.replace(/^https?:\/\//, "")))) return json(res, { error: "Forbidden" }, 403);
    if (req.method !== "GET" && req.headers["x-ouc-ai"] !== token) return json(res, { error: "Reload the app and try again." }, 403);
    try {
      const p = url.pathname;
      if (p === "/api/ai/status") {
        if (!cache || Date.now() - cache.at > 5 * 60_000 || url.searchParams.has("fresh")) cache = { at: Date.now(), body: await aiStatus(root) };
        return json(res, { ...cache.body, token });
      }
      if (p === "/api/ai/actions") return json(res, { actions: listActions(root) });
      if (p === "/api/ai/chats") return json(res, { chats: listChats(root) });
      if (p.startsWith("/api/ai/chats/")) {
        const id = p.split("/").pop();
        const chat = safeId(id) && (runs.get(id)?.chat ?? loadChat(root, id));
        return chat ? json(res, { ...chat, running: runs.has(id) }) : json(res, { error: "Not found" }, 404);
      }
      if (p === "/api/ai/run" && req.method === "POST") return await run(req, res);
      if (p === "/api/ai/stop" && req.method === "POST") {
        const { chatId } = await readBody(req);
        runs.get(chatId)?.stop();
        return json(res, { ok: true });
      }
      return json(res, { error: "Not found" }, 404);
    } catch (e) {
      if (!res.headersSent) json(res, { error: e.message }, 500);
      else res.end();
    }
  };
}
