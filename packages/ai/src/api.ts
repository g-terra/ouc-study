// /api/ai/*: lets the study app talk to the AI chosen with `ouc ai setup`. Mounted by the Vite
// server (apps/web/vite.config.ts), which is also what the background app runs, on 127.0.0.1.
//
//   GET  /api/ai/status        which coding tools are installed and signed in (cached 5 min, ?fresh=1)
//   GET  /api/ai/actions       the study actions (one per skill in ai/skills/)
//   POST /api/ai/run           { sem, chatId?, action?, params?, message } → Server-Sent Events
//   POST /api/ai/stop          { chatId }
//   GET  /api/ai/chats         saved chats (newest first);  GET /api/ai/chats/<id>   one chat
//   GET  /api/ai/view?path=…  a visual the AI saved (HTML, SVG or image), sandboxed, for the chat to show inline
//   POST /api/ai/plan/task     { sem, week, line, done } ticks a task in semesters/<sem>/plans/<week>.md
//   GET  /api/ai/prep          background notes/prep work: { enabled, busy, running/finished: [{ id, chatId, ok? }], queue, total, done, error }
//   GET  /api/ai/review?sem=…&assignment=…          pre-submission review rounds of an assignment (see review.mjs)
//   POST /api/ai/review/upload?sem=…&assignment=…&name=…   the student's .docx as the body → the next version
//   POST /api/ai/review/approve { sem, assignment, v }      the approved .docx → PDF on this computer
//
// Agents run on the student's own computer with their subscription login (no API keys).
// Chats are saved in .ouc/chats/ (git-ignored).
//
// Background work: when the app data is rebuilt (a sync found something) or the app starts, every
// assignment not submitted yet without a PREP.md gets one, one at a time, from the AI chosen with
// `ouc ai setup` ("autoPrep": false in .ouc/ai.json turns that off). Sync now also makes the
// missing notes, for every week with files. Up to "parallel" (default 3) runs at once.
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";
import { delimiter, extname, join, relative, resolve, sep } from "node:path";
import { AGENTIC, ALIASES, INSTALL_HINT, TOOL_LABEL, describe, detect, isAgentic, loadConfig, loginStatusAsync, serverUp, type AiConfig, type LocalModel, type LoginState } from "./providers.ts";
import { buildPrompt, chatSystem, listActions, prepPath, quizPath, quizScope, weeksWithoutNotes, type Params } from "./actions.ts";
import { parseQuiz } from "../../content/src/quiz.ts";
import { currentSemesterId, loadData, read } from "./context.ts";
import { runAgentTurn, runChatTurn, type AgentEvent, type RunHandle } from "./stream.ts";
import { MAX_UPLOAD, addVersion, approve, findConverter, loadReview, markReview, reviewState, type Converter } from "./review.ts";
import type { Assignment, SemesterData } from "../../content/src/types.ts";
import { setTask } from "../../content/src/plan.ts";
import { setClassTime } from "../../content/src/classes.ts";

type ToolState = { state: "connected" | "signedout" | "apikey" | "missing" | "noserver" | "unknown"; detail?: string; fix?: string };
export interface ToolStatus extends ToolState { id: string; label: string; chosen?: boolean }
/** GET /api/ai/status */
export interface AiStatus {
  chosen: string | null; label: string; agentic: boolean; ready: boolean; reason: string;
  skills: { claude: boolean; codex: boolean }; tools: ToolStatus[]; checkedAt: string;
}
interface Message {
  role: "user" | "assistant"; text: string; at: string;
  prompt?: string;                                     // user: what was sent to the AI
  by?: string; updates?: string[]; steps?: string[]; files?: string[]; error?: string;   // assistant
}
/** A saved chat (.ouc/chats/<id>.json). */
export interface Chat {
  id: string; title: string; tool: string; action: string | null; params: Params; sem: string | null;
  createdAt: string; updatedAt?: string; sessionId?: string; messages: Message[]; running?: boolean;
  quiz?: string;                                       // make-quiz: the file it makes (repo-relative)
}
/** POST /api/ai/run (and the background work). */
interface RunBody { sem?: string | null; chatId?: string; action?: string | null; params?: Params; message?: string; tool?: string; auto?: boolean }
/** null tells a listener the turn ended. */
type Listener = (e: Record<string, unknown> | null) => void;
interface Live { chat: Chat; stop(): void; listeners: Set<Listener> }
type Turn = { error: string; code: number } | { error?: undefined; chat: Chat; live: Live; done: Promise<{ ok: boolean }> };
export interface AiApiOptions {
  bin?: string;                                         // tests: a fake agent instead of the real CLI
  status?: () => Promise<{ ready: boolean; reason?: string }>;
  converter?: Converter | null;
  noAutoPrep?: boolean;
}
export type AiApi = ((req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>) & {
  autoPrep(): void; catchUp(): { notes: number; prep: number }; prepIdle(): boolean;
};

// The background app starts with a minimal PATH; add the usual install places of the agent CLIs
// (on Windows: npm's global folder, Claude's native installer in ~/.local/bin, Ollama, LM Studio).
const WIN_PATH = () => {
  const appData = process.env.APPDATA ?? join(homedir(), "AppData/Roaming");
  const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData/Local");
  return [join(appData, "npm"), join(local, "Programs/Ollama"), join(homedir(), ".lmstudio/bin")];
};
const EXTRA_PATH = [join(homedir(), ".local/bin"), ...(process.platform === "win32" ? WIN_PATH() : ["/opt/homebrew/bin", "/usr/local/bin"]), join(homedir(), ".npm-global/bin"), join(homedir(), ".opencode/bin"), join(homedir(), ".bun/bin")];
export function widenPath(env: NodeJS.ProcessEnv = process.env): void {
  const have = (env.PATH ?? "").split(delimiter);
  env.PATH = [...have, ...EXTRA_PATH.filter((p) => !have.includes(p) && existsSync(p))].filter(Boolean).join(delimiter);
}

const LOGIN_FIX: Record<string, string> = { claude: "claude auth login", codex: "codex login" };
const SERVER_NAME: Record<string, string> = { ollama: "Ollama", lmstudio: "LM Studio" };
const SERVER_FIX: Record<string, string> = { ollama: "ollama serve (or open the Ollama app)", lmstudio: "LM Studio → Developer → Start server" };

/** Per-tool state for the header popover: connected | signedout | apikey | missing | noserver | unknown. */
export async function aiStatus(root: string): Promise<AiStatus> {
  const cfg = loadConfig(root);
  const chosen = cfg?.tool ? (ALIASES[cfg.tool] ?? cfg.tool) : null;
  const d = await detect();
  const login = async (t: "claude" | "codex") => (d[t] ? loginStatusAsync(t) : null);
  const [claude, codex] = await Promise.all([login("claude"), login("codex")]);
  const signed = (t: "claude" | "codex", st: LoginState | null): ToolState => {
    if (!d[t]) return { state: "missing", fix: INSTALL_HINT[t] };
    if (!st || st.unknown) return { state: "unknown", detail: "Installed; couldn't read the sign-in status", fix: LOGIN_FIX[t] };
    if (st.subscription) return { state: "connected", detail: st.how ? `Signed in (${st.how})` : "Signed in with your subscription" };
    if (st.loggedIn) return { state: "apikey", detail: "Signed in with an API key (paid credits)", fix: LOGIN_FIX[t] };
    return { state: "signedout", detail: "Not signed in", fix: LOGIN_FIX[t] };
  };
  const server = async (s: Pick<LocalModel, "kind" | "baseUrl" | "model"> | null | undefined): Promise<ToolState> => {
    if (!s?.baseUrl) return { state: "noserver", detail: "No local model chosen yet", fix: "ouc ai setup" };
    const up = await serverUp(s);
    const name = SERVER_NAME[s.kind] ?? s.baseUrl;
    return up ? { state: "connected", detail: `${s.model} on ${name}` } : { state: "noserver", detail: `${name} isn't running`, fix: SERVER_FIX[s.kind] ?? `start the server at ${s.baseUrl}` };
  };
  const ocServer = cfg?.opencode ?? (d.ollama ? { kind: "ollama", ...d.ollama, model: d.ollama.models[0] } : d.lmstudio ? { kind: "lmstudio", ...d.lmstudio, model: d.lmstudio.models[0] } : null);
  const tools: ToolStatus[] = [
    { id: "claude", label: TOOL_LABEL.claude, ...signed("claude", claude) },
    { id: "codex", label: TOOL_LABEL.codex, ...signed("codex", codex) },
    { id: "opencode", label: "opencode", ...(d.opencode ? await server(ocServer) : { state: "missing", fix: INSTALL_HINT.opencode }) },
  ];
  if (cfg?.local) tools.push({ id: "local", label: TOOL_LABEL.local, ...(await server(cfg.local)) });
  for (const t of tools) t.chosen = t.id === chosen;
  const pick = tools.find((t) => t.chosen);
  return {
    chosen, label: describe(cfg), agentic: isAgentic(chosen),
    ready: pick?.state === "connected",
    reason: !chosen ? "No AI chosen yet. In Terminal, run: ouc ai setup" : pick?.state === "connected" ? "" : `${pick?.label}: ${pick?.detail ?? "not ready"}${pick?.fix ? `. Fix: ${pick.fix}` : ""}`,
    skills: { claude: existsSync(join(root, ".claude/skills")), codex: existsSync(join(root, ".agents/skills")) },
    tools, checkedAt: new Date().toISOString(),
  };
}

// ---------- chats (.ouc/chats/<id>.json) ----------
const chatDir = (root: string) => join(root, ".ouc", "chats");
const safeId = (id: unknown): id is string => /^[\w-]{6,64}$/.test(String(id ?? ""));
function loadChat(root: string, id: string): Chat | null {
  try { return JSON.parse(readFileSync(join(chatDir(root), `${id}.json`), "utf8")); } catch { return null; }
}
function saveChat(root: string, chat: Chat) {
  mkdirSync(chatDir(root), { recursive: true });
  const { running, ...rest } = chat;
  writeFileSync(join(chatDir(root), `${chat.id}.json`), `${JSON.stringify(rest, null, 1)}\n`);
}
function listChats(root: string) {
  const dir = chatDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => loadChat(root, f.slice(0, -5))).filter((c) => c !== null)
    .map(({ id, title, tool, action, sem, updatedAt }) => ({ id, title, tool, action, sem, updatedAt }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 50);
}

// ---------- assignment prep (PREP.md in each assignment folder) ----------
const PREP_TITLE: Record<string, string> = { review: "Review prep", more: "Add to prep", redo: "Redo prep" };
const PREP_DONE: Record<string, string> = { new: "prepared", auto: "prepared after a sync", redo: "started over", review: "reviewed and improved", more: "added more" };
/** { by, updated, log[] } from a PREP.md's front matter (written by stampPrep). */
export function readPrepMeta(text: unknown): { by?: string; updated?: string; log: string[] } {
  const fm = String(text ?? "").match(/^---\n([\s\S]*?)\n---\n?/)?.[1] ?? "";
  const get = (k: string) => fm.match(new RegExp(`^${k}:\\s*(.*)$`, "m"))?.[1]?.trim();
  return { by: get("by"), updated: get("updated"), log: [...fm.matchAll(/^\s+-\s+(.+)$/gm)].map((m) => m[1]!) };
}
/** Puts the app's own front matter (who wrote it, when, and the history) on a PREP.md after a run. */
export function stampPrep(abs: string, { assignment, by, mode, log = [], at = new Date() }: { assignment: string; by: string; mode?: string; log?: string[]; at?: Date }): boolean {
  if (!existsSync(abs)) return false;
  const body = read(abs).replace(/^---\n[\s\S]*?\n---\n?/, "").trimStart();
  const line = `${at.toISOString().slice(0, 10)} · ${by} · ${PREP_DONE[mode ?? "new"] ?? PREP_DONE.new}`;
  const all = [...log, line].slice(-20);
  writeFileSync(abs, `---\nassignment: ${assignment}\nby: ${by}\nupdated: ${at.toISOString()}\nlog:\n${all.map((l) => `  - ${l}`).join("\n")}\n---\n\n${body}`);
  return true;
}
/** Assignments not submitted yet (including ones not open yet) with no PREP.md, skipping ones tried recently. */
export function needsPrep(root: string, semId: string, data: Pick<SemesterData, "assignments">, tried: Record<string, string> = {}, now = new Date()): Assignment[] {
  return data.assignments.filter((a) => !a.submitted && !existsSync(join(root, prepPath(semId, a)))
    && !(tried[a.id] && now.getTime() - new Date(tried[a.id]!).getTime() < 12 * 3600_000));
}

// ---------- quizzes (semesters/<id>/quizzes/<CODE>/<name>.json) ----------
const QUIZ_FILE = /^semesters\/[\w.-]+\/quizzes\/([\w-]+)\/([\w.-]+)\.json$/;
/** Notes which AI made a quiz, and when, unless the file says so already. */
export function stampQuiz(root: string, rel: string, by: string, at = new Date()): boolean {
  if (!QUIZ_FILE.test(rel) || !existsSync(join(root, rel))) return false;
  let d: Record<string, unknown>;
  try { d = JSON.parse(read(join(root, rel))); } catch { return false; }
  if (!d || typeof d !== "object" || Array.isArray(d) || (d.by && d.created)) return false;
  const { title, course, scope, section, description, ...rest } = d;
  writeFileSync(join(root, rel), `${JSON.stringify({ title, course, scope, section, description, by: d.by ?? by, created: d.created ?? at.toISOString(), ...rest }, null, 2)}\n`);
  return true;
}
/**
 * A plain local model answers with the quiz JSON: check it and save it at `rel`.
 * Returns the message for the chat (the JSON itself isn't worth showing).
 */
export function saveQuizReply(root: string, rel: string, text: string, by: string, at = new Date()): { ok: boolean; message: string } {
  const m = rel.match(QUIZ_FILE);
  if (!m) return { ok: false, message: "That isn't a quiz file path." };
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)?.[1];
  const raw = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const { quiz, errors } = parseQuiz(raw, { code: m[1]!, name: m[2]! });
  if (!quiz) return { ok: false, message: `The quiz couldn't be saved: ${errors.slice(0, 3).join(" ")} Ask me to fix it and answer with the whole JSON again.` };
  mkdirSync(join(root, rel, ".."), { recursive: true });
  const d = JSON.parse(raw);
  writeFileSync(join(root, rel), `${JSON.stringify({ ...d, by: d.by ?? by, created: d.created ?? at.toISOString() }, null, 2)}\n`);
  return { ok: true, message: `Saved the quiz \`${rel}\`: ${quiz.questions.length} questions. Play it on the Quizzes page.` };
}

// ---------- visuals the AI saves (shown inline in the chat) ----------
const VIEW_TYPE: Record<string, string> = { ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
/** The absolute path of a visual inside the folder, or null (other types, hidden folders, outside the folder). */
export function viewablePath(root: string, rel: unknown): string | null {
  const abs = resolve(root, String(rel ?? ""));
  const r = relative(root, abs);
  if (!r || r.startsWith("..") || r.split(sep).some((p) => p.startsWith(".") || p === "node_modules")) return null;
  return VIEW_TYPE[extname(abs).toLowerCase()] && existsSync(abs) ? abs : null;
}

// ---------- HTTP ----------
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;   // a request body: each route checks the fields it reads
function readBody(req: IncomingMessage, max = 100_000): Promise<Json> {
  return new Promise((ok, fail) => {
    let s = "";
    req.on("data", (d) => { s += d; if (s.length > max) { fail(new Error("Request too large")); req.destroy(); } });
    req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch { fail(new Error("Bad JSON")); } });
    req.on("error", fail);
  });
}

function readRaw(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const parts: Buffer[] = [];
    let n = 0;
    req.on("data", (d: Buffer) => { n += d.length; if (n > max) { fail(new Error("That file is over 25 MB.")); req.destroy(); } else parts.push(d); });
    req.on("end", () => ok(Buffer.concat(parts)));
    req.on("error", fail);
  });
}

/** Connect-style middleware. opts.bin overrides the agent binary and opts.status the sign-in check (tests). */
export function createAiApi(root: string, opts: AiApiOptions = {}): AiApi {
  widenPath();
  const token = randomBytes(18).toString("base64url");   // only pages served by this app can read it
  const runs = new Map<string, Live>();
  let cache: { at: number; body: AiStatus } | undefined;
  const json = (res: ServerResponse, body: unknown, code = 200) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(body)); };

  /** Starts one turn. Returns { error, code } or { chat, live, done } (done resolves when it ends). */
  function startTurn(body: RunBody): Turn {
    const cfg: AiConfig = loadConfig(root) ?? { tool: null };
    // the panel can pick another installed tool for this message; otherwise the one from `ouc ai setup`
    const tool = body.tool ?? (cfg.tool ? (ALIASES[cfg.tool] ?? cfg.tool) : null);
    const fail = (error: string, code = 400) => ({ error, code });
    if (!tool) return fail("No AI chosen yet. In Terminal, run: ouc ai setup");
    if (!isAgentic(tool) && !(tool === "local" && cfg.local)) return fail(`Unknown AI "${tool}".`);
    if (tool === "opencode" && !cfg.opencode && !existsSync(join(root, ".opencode/opencode.json"))) return fail("opencode has no local model set up yet. In Terminal, run: ouc ai setup");
    cfg.tool = tool as AiConfig["tool"];
    const semId = body.sem && existsSync(join(root, "semesters", body.sem)) ? body.sem : currentSemesterId(root);
    let data: SemesterData;
    try { data = semId ? loadData(root, semId) : ({ courses: [], notes: [], assignments: [] } as unknown as SemesterData); } catch (e) { return fail((e as Error).message, 500); }

    let chat: Chat | null = body.chatId && safeId(body.chatId) ? (runs.get(body.chatId)?.chat ?? loadChat(root, body.chatId)) : null;
    if (chat && runs.has(chat.id)) return fail("Still working on the last message. Wait for it or press Stop.", 409);
    const actions = listActions(root);
    const action = chat ? chat.action : body.action || null;
    const params = chat ? chat.params ?? {} : body.params ?? {};
    const meta = actions.find((a) => a.id === action);
    if (action && !meta) return fail(`Unknown action "${action}".`);
    if (meta?.agentOnly && !AGENTIC.has(tool)) return fail(`"${meta.title}" needs Claude Code, Codex or opencode. With a local model, use the ouc command in Terminal (ouc notes, ouc plan).`);
    const sameTool = chat && chat.tool === tool;
    const firstTurn = !chat || !sameTool || (AGENTIC.has(tool) && !chat.sessionId);
    let prompt: string;
    try { prompt = buildPrompt({ root, semId: semId ?? "", data, action: chat && !firstTurn ? null : action, params, message: body.message, first: firstTurn && AGENTIC.has(tool) }); }
    catch (e) { return fail((e as Error).message); }
    // a follow-up after switching tools starts a new conversation with that tool
    if (chat && !sameTool) chat = { ...chat, sessionId: undefined, tool };
    const assignment = data.assignments.find((x) => x.id === params.assignment);
    const what = params.topic || assignment?.title || data.courses.find((c) => c.code === params.course)?.short || (meta?.id === "make-notes" ? "all courses" : "");
    const title = (action === "assignment-prep" && PREP_TITLE[params.mode ?? ""]) || meta?.title || "Request";
    const shown = String(body.message ?? "").trim() || `${title}${what ? `: ${what}` : ""}`;
    const now = new Date().toISOString();
    // a new quiz: the same path buildPrompt gave the agent (a local model's answer is saved there)
    let quiz: string | undefined;
    if (!chat && action === "make-quiz" && semId) { const q = quizScope(data, params); quiz = quizPath(root, semId, q.course, q.week); }
    chat ??= { id: randomUUID(), title: shown.slice(0, 80), tool, action, params, sem: semId, createdAt: now, messages: [], quiz };
    chat.updatedAt = now;
    chat.messages.push({ role: "user", text: shown, prompt, at: now });
    const by = tool === "opencode" && !cfg.opencode ? "opencode" : describe(cfg);
    const reply = { role: "assistant" as const, text: "", updates: [] as string[], steps: [] as string[], files: [] as string[], at: now, by, error: undefined as string | undefined };
    chat.messages.push(reply);
    // a prep pack's history survives even if the AI rewrites the file without it
    const prepAbs = action === "assignment-prep" && assignment && semId ? join(root, prepPath(semId, assignment)) : null;
    const prepLog = prepAbs ? readPrepMeta(read(prepAbs)).log : [];
    const prepMode = body.auto ? "auto" : params.mode;
    // a review round remembers which chat (and AI) reviewed it, so the page can open the discussion
    const reviewV = action === "assignment-review" && assignment && semId ? (Number(params.version) || loadReview(root, semId, assignment).versions.at(-1)?.v) : null;
    if (reviewV && semId && assignment) markReview(root, semId, assignment, reviewV, { chatId: chat.id, by, started: now });

    const live: Live = { chat, stop: () => {}, listeners: new Set() };
    runs.set(chat.id, live);
    chat.running = true;
    const send = (e: Record<string, unknown>) => { for (const l of live.listeners) l(e); };
    const turnChat = chat;
    const onEvent = (e: AgentEvent) => {
      if (e.type === "text") {
        // local models send pieces of one answer; agent tools send whole messages, and only the
        // latest is the answer: the ones before it are kept as progress updates
        if (e.delta) { reply.text += e.text; return send({ type: "text", text: e.text }); }
        if (reply.text) reply.updates.push(reply.text);
        reply.text = e.text;
        return send({ type: "text", text: e.text, replace: true });
      }
      if (e.type === "session") turnChat.sessionId = e.id;
      else if (e.type === "tool") reply.steps.push(e.label);
      else if (e.type === "file") { if (!e.path || reply.files.includes(e.path)) return; reply.files.push(e.path); saveChat(root, turnChat); }
      else if (e.type === "error") reply.error = e.message;
      send(e);
    };
    const onStart = ({ stop }: RunHandle) => { live.stop = stop; };
    const done = (isAgentic(tool)
      ? runAgentTurn(root, cfg, prompt, { resume: sameTool ? chat.sessionId : undefined, onEvent, onStart, bin: opts.bin })
      : runChatTurn(cfg.local!, [{ role: "system", content: chatSystem({ root, semId: semId ?? "", data, action, params }) },
        ...chat.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.role === "user" ? m.prompt ?? m.text : m.text }))], { onEvent, onStart }))
      .then((r) => {
        if (r?.ok && prepAbs && assignment) stampPrep(prepAbs, { assignment: assignment.id, by, mode: prepMode, log: prepLog });
        if (reviewV && semId && assignment) markReview(root, semId, assignment, reviewV, { finished: new Date().toISOString(), ok: !!r?.ok });
        if (r?.ok && turnChat.action === "make-quiz") {
          if (isAgentic(tool)) for (const f of new Set([...reply.files, ...(turnChat.quiz ? [turnChat.quiz] : [])])) stampQuiz(root, f, by);
          else if (turnChat.quiz && reply.text.includes("{")) {
            const saved = saveQuizReply(root, turnChat.quiz, reply.text, by);
            reply.text = saved.message;
            send({ type: "text", text: reply.text, replace: true });
            if (saved.ok) { reply.files.push(turnChat.quiz); send({ type: "file", path: turnChat.quiz }); }
          }
        }
        return r;
      })
      .finally(() => {
        turnChat.running = false;
        turnChat.updatedAt = new Date().toISOString();
        saveChat(root, turnChat);
        runs.delete(turnChat.id);
        for (const l of live.listeners) l(null);
      });
    return { chat, live, done };
  }

  async function run(req: IncomingMessage, res: ServerResponse) {
    const t = startTurn(await readBody(req));
    if (t.error !== undefined) return json(res, { error: t.error }, t.code);
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Accel-Buffering", "no");
    // null = the turn ended
    const write: Listener = (e) => { if (res.writableEnded) return; if (e) res.write(`data: ${JSON.stringify(e)}\n\n`); else res.end(); };
    t.live.listeners.add(write);
    res.on("close", () => t.live.listeners.delete(write));   // the run goes on; the chat is saved when it ends
    write({ type: "chat", id: t.chat.id, title: t.chat.title });
  }

  // ----- automatic prep: one assignment at a time, in the background -----
  const prepState = join(root, ".ouc", "prep-state.json");
  type Slot = { id: string; chatId: string; ok?: boolean };
  const prep = { busy: false, again: false, notes: false, force: false, running: [] as Slot[], queue: [] as string[], finished: [] as Slot[], total: 0, done: 0, error: null as string | null };
  async function status(fresh = false) {
    if (!cache || Date.now() - cache.at > 5 * 60_000 || fresh) cache = { at: Date.now(), body: await aiStatus(root) };
    return cache.body;
  }
  const prepEnabled = (cfg = loadConfig(root)) => !!cfg?.tool && cfg.autoPrep !== false && isAgentic(ALIASES[cfg.tool] ?? cfg.tool);
  /**
   * Background work, one AI run at a time: prep packs for assignments without one (on its own when the
   * app starts and after each rebuild) and, when asked (Sync now), notes for every week that has files
   * and no note (one run per course). An explicit request ignores "autoPrep": false and recent attempts.
   */
  async function catchUp({ notes = false, force = false } = {}) {
    if (prep.busy) { prep.again = true; prep.notes ||= notes; prep.force ||= force; return; }
    prep.busy = true;
    try {
      do {
        const wantNotes = notes || prep.notes, forced = force || prep.force;
        prep.again = false; prep.notes = false; prep.force = false; notes = false; force = false;
        if (!forced && !prepEnabled()) break;
        const cfg = loadConfig(root);
        if (!cfg?.tool || !isAgentic(ALIASES[cfg.tool] ?? cfg.tool)) break;
        const st = await (opts.status ?? status)();
        if (!st.ready) { prep.error = st.reason || "Your AI isn't signed in."; break; }   // try again on the next rebuild
        const semId = currentSemesterId(root);
        if (!semId) break;
        let tried: Record<string, string> = {};
        try { tried = JSON.parse(read(prepState, "{}")); } catch { /* start fresh */ }
        const data = loadData(root, semId);
        const jobs: { id: string; body: RunBody }[] = [
          ...(wantNotes ? data.courses.filter((c) => weeksWithoutNotes(data, [c]).length)
            .map((c) => ({ id: `notes:${c.code}`, body: { action: "make-notes", params: { course: c.code } } })) : []),
          ...needsPrep(root, semId, data, forced ? {} : tried)
            .map((a) => ({ id: a.id, body: { action: "assignment-prep", params: { assignment: a.id, mode: "new" }, auto: true } })),
        ];
        prep.queue = jobs.map((j) => j.id);
        prep.total = jobs.length; prep.done = 0; prep.error = null; prep.finished = [];
        // a few at a time ("parallel" in .ouc/ai.json, default 3); a failure (usage limit, sign-in)
        // would fail for the rest too, so nothing new starts after one
        let stop = false;
        const worker = async () => {
          while (!stop && prep.queue.length) {
            const job = jobs.find((j) => j.id === prep.queue[0])!;
            prep.queue = prep.queue.slice(1);
            tried[job.id] = new Date().toISOString();
            mkdirSync(join(root, ".ouc"), { recursive: true });
            writeFileSync(prepState, JSON.stringify(tried, null, 1));
            const t = startTurn({ sem: semId, ...job.body });
            if (t.error !== undefined) { prep.done++; continue; }   // e.g. that course has nothing left after all
            const slot = { id: job.id, chatId: t.chat.id };
            prep.running = [...prep.running, slot];
            const r = await t.done;
            prep.running = prep.running.filter((x) => x !== slot);
            prep.finished = [...prep.finished, { ...slot, ok: !!r?.ok }];
            prep.done++;
            if (!r?.ok) { stop = true; prep.queue = []; prep.error = t.chat.messages.at(-1)?.error ?? "The AI stopped with an error."; }
          }
        };
        const n = Math.max(1, Math.min(8, Number(cfg.parallel) || 3));
        await Promise.all(Array.from({ length: n }, worker));
      } while (prep.again);
    } catch (e) {
      console.error(`[ai] background work: ${(e as Error).message}`);
    } finally {
      prep.busy = false; prep.running = []; prep.queue = [];
    }
  }

  // ----- pre-submission review -----
  let conv: { at: number; found: Converter | null } = { at: 0, found: null };
  // looked up again after a minute, so installing LibreOffice works without restarting the app
  const converter = (fresh = false) => { if (fresh || Date.now() - conv.at > 60_000) conv = { at: Date.now(), found: findConverter() }; return conv.found; };
  const assignmentOf = (sem: unknown, id: unknown): { semId: string; a: Assignment } => {
    const semId = /^[\w-]+$/.test(String(sem ?? "")) && existsSync(join(root, "semesters", String(sem))) ? String(sem) : currentSemesterId(root);
    const a = semId ? loadData(root, semId).assignments.find((x) => x.id === id) : null;
    if (!a) throw Object.assign(new Error("That assignment isn't in the app data."), { code: 404 });
    return { semId: semId!, a };
  };
  const reviewBody = (semId: string, a: Assignment) => ({ ...reviewState(root, semId, a, (id) => runs.has(id)), converter: converter()?.label ?? null });

  const handler = (async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith("/api/ai/")) return next();
    const url = new URL(req.url, "http://x");
    // Only this app, opened on this computer, may use it (blocks other websites and DNS rebinding).
    const origin = req.headers.origin;
    if (!LOCAL_HOST.test(req.headers.host ?? "") || (origin && !LOCAL_HOST.test(origin.replace(/^https?:\/\//, "")))) return json(res, { error: "Forbidden" }, 403);
    if (req.method !== "GET" && req.headers["x-ouc-ai"] !== token) return json(res, { error: "Reload the app and try again." }, 403);
    try {
      const p = url.pathname;
      if (p === "/api/ai/status") return json(res, { ...(await status(url.searchParams.has("fresh"))), token });
      if (p === "/api/ai/prep") return json(res, { enabled: prepEnabled(), busy: prep.busy, running: prep.running, queue: prep.queue, finished: prep.finished, total: prep.total, done: prep.done, error: prep.error });
      if (p === "/api/ai/view") {
        const abs = viewablePath(root, url.searchParams.get("path"));
        if (!abs) return json(res, { error: "Not found" }, 404);
        res.setHeader("Content-Type", VIEW_TYPE[extname(abs).toLowerCase()]!);
        // the page runs in its own sandbox (no access to the app, its token or your files), even when opened in a tab
        res.setHeader("Content-Security-Policy", "sandbox allow-scripts allow-popups");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        return res.end(readFileSync(abs));
      }
      if (p.startsWith("/api/ai/review")) {
        const q = url.searchParams;
        if (p === "/api/ai/review") { const { semId, a } = assignmentOf(q.get("sem"), q.get("assignment")); return json(res, reviewBody(semId, a)); }
        if (p === "/api/ai/review/upload" && req.method === "POST") {
          const { semId, a } = assignmentOf(q.get("sem"), q.get("assignment"));
          const version = addVersion(root, semId, a, q.get("name") ?? "submission.docx", await readRaw(req, MAX_UPLOAD));
          return json(res, { version, ...reviewBody(semId, a) });
        }
        if (p === "/api/ai/review/approve" && req.method === "POST") {
          const b = await readBody(req);
          const { semId, a } = assignmentOf(b.sem, b.assignment);
          await approve(root, semId, a, b.v, { converter: "converter" in opts ? opts.converter : converter(true) });
          return json(res, reviewBody(semId, a));
        }
      }
      if (p === "/api/ai/actions") return json(res, { actions: listActions(root) });
      if (p === "/api/ai/chats") return json(res, { chats: listChats(root) });
      if (p.startsWith("/api/ai/chats/")) {
        const id = p.split("/").pop() ?? "";
        const chat = safeId(id) && (runs.get(id)?.chat ?? loadChat(root, id));
        return chat ? json(res, { ...chat, running: runs.has(id) }) : json(res, { error: "Not found" }, 404);
      }
      if (p === "/api/ai/run" && req.method === "POST") return await run(req, res);
      if (p === "/api/ai/plan/task" && req.method === "POST") {
        const { sem, week, line, done } = await readBody(req);
        if (!/^\w[\w.-]*$/.test(sem ?? "") || !/^\d{4}-W\d{1,2}$/.test(week ?? "") || !Number.isInteger(line)) return json(res, { error: "Bad request" }, 400);
        const abs = join(root, "semesters", sem, "plans", `${week}.md`);
        const next = existsSync(abs) ? setTask(readFileSync(abs, "utf8"), line, !!done) : null;
        if (next === null) return json(res, { error: "The plan changed. Reload it and try again." }, 409);
        writeFileSync(abs, next);
        return json(res, { ok: true });
      }
      // "Fix the time" on a course page: the weekly live class, in the semester's time zone
      if (p === "/api/ai/classes" && req.method === "POST") {
        const { sem, code, day, time, group } = await readBody(req);
        if (!/^\w[\w.-]*$/.test(sem ?? "")) return json(res, { error: "Bad request" }, 400);
        const abs = join(root, "semesters", sem, "semester.json");
        if (!existsSync(abs)) return json(res, { error: "No semester.json for that semester." }, 404);
        let cfg: unknown;
        try { cfg = setClassTime(JSON.parse(readFileSync(abs, "utf8")), String(code ?? ""), { day, time, group }); }
        catch (e) { return json(res, { error: (e as Error).message }, 400); }
        writeFileSync(abs, `${JSON.stringify(cfg, null, 2)}\n`);
        return json(res, { ok: true });
      }
      if (p === "/api/ai/stop" && req.method === "POST") {
        const { chatId } = await readBody(req);
        runs.get(chatId)?.stop();
        return json(res, { ok: true });
      }
      return json(res, { error: "Not found" }, 404);
    } catch (e) {
      const err = e as Error & { code?: number };
      if (!res.headersSent) json(res, { error: err.message }, err.code === 404 ? 404 : url.pathname.startsWith("/api/ai/review/") ? 400 : 500);
      else res.end();
    }
  }) as AiApi;
  /** Call when the app data was rebuilt (a sync, new files): prepares assignments that need it. */
  handler.autoPrep = () => { if (!opts.noAutoPrep) catchUp(); };
  /** Sync now: make the missing notes and prep packs (returns how many it will make). */
  handler.catchUp = () => {
    const semId = currentSemesterId(root);
    let todo = { notes: 0, prep: 0 };
    try {
      if (!semId) throw new Error("no semester");
      const data = loadData(root, semId);
      todo = { notes: weeksWithoutNotes(data, data.courses).length, prep: needsPrep(root, semId, data).length };
    } catch { /* no data yet */ }
    catchUp({ notes: true, force: true });
    return todo;
  };
  handler.prepIdle = () => !prep.busy;
  return handler;
}
