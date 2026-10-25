// /api/ai/*: lets the study app talk to the AI chosen with `ouc ai setup`. Mounted by the Vite
// server (apps/web/vite.config.ts), which is also what the background app runs, on 127.0.0.1.
//
//   GET  /api/ai/status        which coding tools are installed and signed in (cached 5 min, ?fresh=1)
//   GET  /api/ai/actions       the study actions (one per skill in ai/skills/)
//   POST /api/ai/enabled       { tool, enabled } switch an AI off (hidden from the chat, never used) or on (Settings); not the default AI
//   POST /api/ai/tool          { tool } the AI that answers new chats and does the background work (Settings), saved in .ouc/ai.json
//   POST /api/ai/defaults      { tool, model } the model an AI uses unless a chat picks another ("" = the tool's own), saved in .ouc/ai.json
//   POST /api/ai/run           { sem, chatId?, action?, params?, message, tool?, model? } → Server-Sent Events (model: one of the tool's `models` in status)
//   POST /api/ai/stop          { chatId }
//   GET  /api/ai/chats         saved chats (newest first; not the background work);  GET /api/ai/chats/<id>   one chat
//   DELETE /api/ai/chats/<id>  deletes a saved chat (not while it runs: 409);  DELETE /api/ai/chats  all of them but the running ones → { deleted, kept }
//   GET  /api/ai/view?path=…  a visual the AI saved (HTML, SVG or image), sandboxed, for the chat to show inline
//   POST /api/ai/plan/task     { sem, week, line, done } ticks a task in semesters/<sem>/plans/<week>.md
//   POST /api/ai/quiz          { sem, course, week?, title? } makes a quiz in the background (no chat on screen) → { jobs: [job] };
//                              409 while the same quiz is being made (a different title is a second quiz on purpose)
//                              { sem, course, topics, web?, title? } a custom quiz on the student's topics (the web too when web)
//   GET  /api/ai/quiz          the quizzes being made or waiting, and the ones just finished: { jobs: [{ id, chatId?, quiz, course, week, queued?, running, ok?, error? }] }
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
// missing notes, for every week with files, and a quiz for every class with material and no quiz
// ("autoQuiz": false turns the quizzes off). Up to "parallel" (default 3) runs at once.
// Class videos and narrated slides get transcripts in the background too (transcribe.ts); Sync now
// makes those of the weeks about to get notes first, so the notes are made from them. Only when Whisper
// is set up: GET /api/ai/transcribe says whether it is, POST { enabled } turns transcripts on or off and
// POST { setup: true } installs it (⚙ Settings), POST { redo: <path>, language? } makes one transcript again (the video page).
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";
import { delimiter, extname, join, relative, resolve, sep } from "node:path";
import { AGENTIC, ALIASES, INSTALL_HINT, TOOL_LABEL, describe, detect, isAgentic, loadConfig, longContextModel, warmUp, preferLongContext, saveConfig, codexModelsAsync, loginStatusAsync, serverUp, setServerModels, toolModels, writeOpencodeConfig, type AiConfig, type LocalModel, type LoginState } from "./providers.ts";
import { buildPrompt, chatSystem, listActions, prepPath, quizFile, quizScope, quizTitle, quizTopics, weeksWithoutNotes, weeksWithoutQuiz, type Params } from "./actions.ts";
import { parseQuiz } from "../../content/src/quiz.ts";
import { currentSemesterId, loadData, read } from "./context.ts";
import { runAgentTurn, runChatTurn, type AgentEvent, type RunHandle } from "./stream.ts";
import { MAX_UPLOAD, addVersion, approve, findConverter, loadReview, markReview, reviewState, type Converter } from "./review.ts";
import type { Assignment, SemesterData } from "../../content/src/types.ts";
import { setTask } from "../../content/src/plan.ts";
import { polishFile, readAnswers, readCheck, readHomework, writeCheck } from "../../content/src/homework-store.ts";
import { mergeCheck, tasksToCheck } from "../../content/src/homework.ts";
import { setClassTime } from "../../content/src/classes.ts";
import { createTranscriber, type Engine } from "./transcribe.ts";

type ToolState = { state: "connected" | "signedout" | "apikey" | "missing" | "noserver" | "unknown"; detail?: string; fix?: string };
/** models: what the panel offers; model: what a new chat uses (the Settings default, else own: the tool's own); setting: the Settings default */
export interface ToolStatus extends ToolState { id: string; label: string; chosen?: boolean; enabled?: boolean; models?: string[]; model?: string; own?: string; setting?: string }
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
  background?: boolean;                                // started by the app (Sync now, Make a quiz): not in the chat history
}
/** POST /api/ai/run (and the background work). */
interface RunBody { sem?: string | null; chatId?: string; action?: string | null; params?: Params; message?: string; tool?: string; model?: string; auto?: boolean; background?: boolean }
/** null tells a listener the turn ended. */
type Listener = (e: Record<string, unknown> | null) => void;
interface Live { chat: Chat; stop(): void; listeners: Set<Listener> }
type Turn = { error: string; code: number } | { error?: undefined; chat: Chat; live: Live; done: Promise<{ ok: boolean }> };
export interface AiApiOptions {
  bin?: string;                                         // tests: a fake agent instead of the real CLI
  status?: () => Promise<{ ready: boolean; reason?: string }>;
  converter?: Converter | null;
  noAutoPrep?: boolean;
  whisper?: () => Engine | null;                        // tests: a fake speech-to-text engine
  installWhisper?: () => Promise<{ ok: boolean; message: string }>;   // tests: a fake install
}
export type AiApi = ((req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>) & {
  autoPrep(): void; catchUp(): { notes: number; prep: number; quizzes: number }; prepIdle(): boolean; warmUp(): Promise<string | null>;
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
  // Codex's model list is read from Codex itself (toolModels then offers it)
  const [claude, codex] = await Promise.all([login("claude"), login("codex"), d.codex ? codexModelsAsync() : null]);
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
  // the models Ollama or LM Studio has right now, to pick from (opencode and plain local models)
  const live = (s?: LocalModel) => (s?.kind === "ollama" ? d.ollama?.models : s?.kind === "lmstudio" ? d.lmstudio?.models : undefined);
  const ocLive = live(ocServer ?? undefined);
  setServerModels("opencode", ocServer?.kind === "ollama" && ocLive ? preferLongContext(ocLive) : ocLive);
  setServerModels("local", live(cfg?.local));
  // opencode with no model saved anywhere still offers what the server has
  const offer = { ...cfg, opencode: ocServer ?? undefined };
  for (const t of tools) Object.assign(t, { chosen: t.id === chosen, enabled: !cfg?.off?.includes(t.id as AiConfig["tool"] & string), ...toolModels(offer, t.id) });
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
    .filter((c) => !c.background)   // background work is followed on the AI background work page, not in the chat
    .map(({ id, title, tool, action, sem, updatedAt }) => ({ id, title, tool, action, sem, updatedAt }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 50);
}
/** Deletes saved chats (one, or all of them), never one that is still running. */
function deleteChats(root: string, running: (id: string) => boolean, id?: string) {
  const dir = chatDir(root);
  const ids = id ? [id] : existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)) : [];
  let deleted = 0, kept = 0;
  for (const x of ids) {
    if (running(x)) { kept++; continue; }
    const f = join(dir, `${x}.json`);
    if (existsSync(f)) { rmSync(f); deleted++; }
  }
  return { deleted, kept };
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

/**
 * New assignments (not submitted yet) with something to work from (a brief or the task on eClass) and no
 * interactive version yet, skipping ones tried recently. Done ones are converted once by an agent, not here.
 */
export function needsHomework(root: string, semId: string, data: Pick<SemesterData, "assignments">, tried: Record<string, string> = {}, now = new Date()): Assignment[] {
  return data.assignments.filter((a) => !a.submitted && !a.homework && (a.briefs.length || a.question?.trim())
    && !existsSync(join(root, "semesters", semId, "assignments", a.id, "homework", "tasks.json"))
    && !(tried[`homework:${a.id}`] && now.getTime() - new Date(tried[`homework:${a.id}`]!).getTime() < 12 * 3600_000));
}

// ---------- quizzes (semesters/<id>/quizzes/<CODE>/<name>.json) ----------
const stripTicks = (s?: string) => String(s ?? "").replace(/`/g, "").trim().slice(0, 300);
const QUIZ_FILE = /^semesters\/[\w.-]+\/quizzes\/([\w-]+)\/([\w.-]+)\.json$/;
/** Notes which AI made a quiz, and when, unless the file says so already. */
/** Sets a quiz file's title (the name given in the Make a quiz pop-up). */
export function renameQuiz(root: string, rel: string, title: string): boolean {
  if (!QUIZ_FILE.test(rel) || !existsSync(join(root, rel))) return false;
  let d: Record<string, unknown>;
  try { d = JSON.parse(read(join(root, rel))); } catch { return false; }
  if (!d || typeof d !== "object" || Array.isArray(d) || d.title === title) return false;
  writeFileSync(join(root, rel), `${JSON.stringify({ ...d, title }, null, 2)}\n`);
  return true;
}
export function stampQuiz(root: string, rel: string, by: string, at = new Date()): boolean {
  if (!QUIZ_FILE.test(rel) || !existsSync(join(root, rel))) return false;
  let d: Record<string, unknown>;
  try { d = JSON.parse(read(join(root, rel))); } catch { return false; }
  if (!d || typeof d !== "object" || Array.isArray(d) || (d.by && d.created)) return false;
  const { title, course, scope, section, description, ...rest } = d;
  writeFileSync(join(root, rel), `${JSON.stringify({ title, course, scope, section, description, by: d.by ?? by, created: d.created ?? at.toISOString(), ...rest }, null, 2)}\n`);
  return true;
}
/** Whether an event of a quiz run shows the AI writing the quiz (a file saved, a "Writing …" step, or quiz JSON in a local model's answer). */
export const quizWriting = (e: Record<string, unknown>): boolean =>
  e.type === "file" || (e.type === "tool" && /^Writing\b/.test(String(e.label ?? ""))) || (e.type === "text" && /"questions"\s*:/.test(String(e.text ?? "")));
/** Checks the quiz a run saved at `rel`: an error says why it won't show in the app (missing, or not a valid quiz). */
export function checkQuizFile(root: string, rel: string): { error?: string } {
  const m = QUIZ_FILE.exec(rel);
  if (!m || !existsSync(join(root, rel))) return { error: "The AI finished without saving a quiz." };
  const { quiz, errors } = parseQuiz(read(join(root, rel)), { code: m[1]!, name: m[2]! });
  return quiz ? {} : { error: `The AI saved a quiz the app can't open: ${errors.slice(0, 2).join(" ")}` };
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
/** An agent's error, in words the student can act on (opencode's "compaction" error means the model's context window is too small). */
export function explainError(tool: string, model: string | undefined, message: string): string {
  if (tool === "opencode" && /compaction|context (length|window|size)|too (long|many tokens)|exceeds? the (context|maximum)/i.test(message))
    return `${model ?? "This model"} ran out of room for the chat: opencode needs a model with a 32k context window. Pick another model next to Send (or set the default back in Settings, AI tools), then start a New chat.`;
  return message;
}

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
    if (cfg.off?.includes(tool as never)) return fail(`${TOOL_LABEL[tool as keyof typeof TOOL_LABEL]} is switched off in Settings, AI tools.`);
    if (tool === "opencode" && !cfg.opencode && !existsSync(join(root, ".opencode/opencode.json"))) return fail("opencode has no local model set up yet. In Terminal, run: ouc ai setup");
    cfg.tool = tool as AiConfig["tool"];
    // only a model the panel offers: it never reaches the command line as anything else
    // (none picked: the default set in Settings, if any; else the tool's own)
    const offered = toolModels(cfg, tool);
    const model = body.model || offered.setting;
    if (model && !offered.models.includes(model)) return fail(`${TOOL_LABEL[tool as keyof typeof TOOL_LABEL]} can't use the model "${model}" here.`);
    // a model other than the one `ouc ai setup` prepared: give it the 32k window opencode needs, and
    // add it to opencode's config (opencode only runs models it lists)
    const oc = cfg.opencode;
    const ready: Promise<string | undefined> = !(model && tool === "opencode" && oc && model !== oc.model) ? Promise.resolve(model)
      : longContextModel(root, oc, model).then((m) => {
        if (!(oc.models ?? [oc.model]).includes(m)) {
          cfg.opencode = { ...oc, models: [...new Set([oc.model, ...(oc.models ?? []), m])] };
          writeOpencodeConfig(root, cfg.opencode);
          saveConfig(root, { ...(loadConfig(root) ?? { tool: null }), opencode: cfg.opencode });
        }
        return m;
      });
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
    if (!chat && action === "make-quiz" && semId) { const q = quizScope(data, params); quiz = quizFile(root, semId, q.course, q.week, params); }
    chat ??= { id: randomUUID(), title: shown.slice(0, 80), tool, action, params, sem: semId, createdAt: now, messages: [], quiz, ...(body.background && { background: true }) };
    chat.updatedAt = now;
    chat.messages.push({ role: "user", text: shown, prompt, at: now });
    // who answered, with the model picked for this turn
    const named = !model ? cfg : tool === "local" ? { ...cfg, local: { ...cfg.local!, model } } : tool === "opencode" && cfg.opencode ? { ...cfg, opencode: { ...cfg.opencode, model } } : cfg;
    const by = tool === "opencode" && !cfg.opencode ? "opencode" : `${describe(named)}${model && (tool === "claude" || tool === "codex") ? ` (${model})` : ""}`;
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
      else if (e.type === "error") reply.error = e.message = explainError(tool, model, e.message);
      send(e);
    };
    const onStart = ({ stop }: RunHandle) => { live.stop = stop; };
    const done = (isAgentic(tool)
      ? ready.then((m) => runAgentTurn(root, cfg, prompt, { resume: sameTool ? turnChat.sessionId : undefined, model: m, onEvent, onStart, bin: opts.bin }),
        (e: Error) => { onEvent({ type: "error", message: e.message }); return { ok: false }; })
      : runChatTurn(model ? { ...cfg.local!, model } : cfg.local!, [{ role: "system", content: chatSystem({ root, semId: semId ?? "", data, action, params }) },
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
          // the name the student gave in the pop-up wins over the AI's title
          const named = quizTitle(turnChat.params ?? {});
          if (named && turnChat.quiz) renameQuiz(root, turnChat.quiz, named);
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
  const transcriber = createTranscriber(root, { ...(opts.whisper && { engine: opts.whisper }), ...(opts.installWhisper && { install: opts.installWhisper }) });
  const prep = { busy: false, again: false, notes: false, force: false, running: [] as Slot[], queue: [] as string[], finished: [] as Slot[], total: 0, done: 0, error: null as string | null };
  async function status(fresh = false) {
    if (!cache || Date.now() - cache.at > 5 * 60_000 || fresh) cache = { at: Date.now(), body: await aiStatus(root) };
    return cache.body;
  }
  const prepEnabled = (cfg = loadConfig(root)) => !!cfg?.tool && cfg.autoPrep !== false && isAgentic(ALIASES[cfg.tool] ?? cfg.tool);
  /**
   * Background work, one AI run at a time: prep packs for assignments without one (on its own when the
   * app starts and after each rebuild) and, when asked (Sync now), notes for every week that has files
   * and no note (one run per course) and quizzes for every class with material and no quiz (one run
   * per class, unless "autoQuiz": false). An explicit request ignores "autoPrep": false and recent attempts.
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
        let data = loadData(root, semId);
        if (wantNotes) {
          // transcripts first for the weeks about to get notes (the notes are made from them)
          prep.total = 0; prep.done = 0; prep.finished = [];   // the bar shows the transcribing meanwhile
          const todo = new Set(weeksWithoutNotes(data, data.courses).map(({ course, week }) => `${course.code}|${week.index}`));
          await transcriber.run({ only: (j) => todo.has(`${j.code}|${j.section}`) });
          if (transcriber.status().made) data = loadData(root, semId);
        }
        const jobs: { id: string; body: RunBody }[] = [
          ...(wantNotes ? data.courses.filter((c) => weeksWithoutNotes(data, [c]).length)
            .map((c) => ({ id: `notes:${c.code}`, body: { action: "make-notes", params: { course: c.code } } })) : []),
          ...(wantNotes && cfg.autoQuiz !== false ? quizzesToMake(semId, data)
            .map(({ course, week }) => ({ id: `quiz:${course}/${week}`, body: { action: "make-quiz", params: { course, week } } })) : []),
          ...needsPrep(root, semId, data, forced ? {} : tried)
            .map((a) => ({ id: a.id, body: { action: "assignment-prep", params: { assignment: a.id, mode: "new" }, auto: true } })),
          // the interactive version of each new assignment (unless "autoHomework": false)
          ...(cfg.autoHomework !== false ? needsHomework(root, semId, data, forced ? {} : tried)
            .map((a) => ({ id: `homework:${a.id}`, body: { action: "make-homework", params: { assignment: a.id } } })) : []),
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
            // a quiz made meanwhile (from the pop-up or the chat): don't make a second one
            if (job.id.startsWith("quiz:") && !quizzesToMake(semId, data).some((x) => `quiz:${x.course}/${x.week}` === job.id)) { prep.done++; continue; }
            tried[job.id] = new Date().toISOString();
            mkdirSync(join(root, ".ouc"), { recursive: true });
            writeFileSync(prepState, JSON.stringify(tried, null, 1));
            const t = startTurn({ sem: semId, ...job.body, background: true });
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

  // ----- quizzes made in the background (the Make a quiz pop-up) -----
  // A job waits in the queue (queued) until a slot is free: "parallel" in .ouc/ai.json (default 3) run at once.
  // phase: "planning" while the AI reads the material, "writing" once it starts writing the quiz
  type QuizJob = { id: string; chatId?: string; sem: string; course: string; week?: string; title?: string; topics?: string; web?: boolean; quiz?: string; started: string; queued?: boolean; running: boolean; phase?: "planning" | "writing"; ok?: boolean; error?: string };
  let quizJobs: QuizJob[] = [];
  const quizSlots = () => Math.max(1, Math.min(8, Number(loadConfig(root)?.parallel) || 3));
  function startQuizJob(job: QuizJob) {
    const params: Params = { course: job.course, ...(job.week !== undefined ? { week: job.week } : {}), ...(job.title ? { title: job.title } : {}), ...(job.topics ? { topics: job.topics, web: job.web } : {}) };
    const t = startTurn({ sem: job.sem, action: "make-quiz", params, background: true });
    if (t.error !== undefined) return Object.assign(job, { queued: false, running: false, ok: false, error: t.error, code: t.code });
    Object.assign(job, { chatId: t.chat.id, quiz: t.chat.quiz, started: t.chat.createdAt, queued: false, running: true, phase: "planning" });
    t.live.listeners.add((e) => { if (e && job.phase === "planning" && quizWriting(e)) job.phase = "writing"; });
    t.done.then((r) => {
      job.running = false;
      const check = r?.ok && job.quiz ? checkQuizFile(root, job.quiz) : null;
      job.ok = !!check && !check.error;
      if (!job.ok) job.error = check?.error ?? t.chat.messages.at(-1)?.error ?? (r?.ok ? stripTicks(t.chat.messages.at(-1)?.text) || "The AI finished without saving a quiz." : "The AI stopped with an error.");
      // the AI stopped (usage limit, sign-in): the rest would fail the same way
      if (!r?.ok) quizJobs = quizJobs.filter((j) => !j.queued);
      pumpQuizzes();
    });
    return job;
  }
  function pumpQuizzes() {
    for (const job of quizJobs) {
      if (quizJobs.filter((j) => j.running).length >= quizSlots()) break;
      if (job.queued) startQuizJob(job);
    }
  }
  /** The quizzes being made (or waiting to be), from the pop-up or from Sync now: "<CODE>/<week>" and the name given, if any. */
  const quizzesBusy = (): { cls: string; title?: string }[] => [
    ...quizJobs.filter((j) => j.queued || j.running).map((j) => ({ cls: `${j.course}/${j.topics ? "custom" : j.week}`, title: j.title?.toLowerCase() })),
    ...[...prep.running.map((x) => x.id), ...prep.queue].filter((id) => id.startsWith("quiz:")).map((id) => ({ cls: id.slice(5) })),
  ];
  /** The classes still without a quiz, leaving out the ones being made. */
  const quizzesToMake = (semId: string, data: SemesterData) => {
    const busy = new Set(quizzesBusy().map((b) => b.cls));
    return data.courses.flatMap((c) => weeksWithoutQuiz(root, semId, data, c).map((w) => ({ course: c.code, week: String(w.index) })))
      .filter((x) => !busy.has(`${x.course}/${x.week}`));
  };
  function makeQuiz(b: Json): QuizJob[] {
    const semId = /^[\w-]+$/.test(String(b.sem ?? "")) ? String(b.sem) : currentSemesterId(root);
    const course = String(b.course ?? "");
    const topics = quizTopics({ topics: b.topics });
    if (b.topics !== undefined && !topics) throw Object.assign(new Error("Write the topics you want the quiz on."), { code: 400 });
    if (b.every) throw Object.assign(new Error("Choose one class, the whole course or a custom quiz (Sync now makes a quiz for every class)."), { code: 400 });
    // a custom quiz has no class; its name tells it apart
    const week = topics || b.week === undefined || b.week === null || b.week === "" ? undefined : String(b.week);
    const cls = topics ? `${course}/custom` : `${course}/${week}`;
    const title = quizTitle({ title: b.title });
    // two runs at once would write the same quiz twice; a quiz with a name of its own is a second one on purpose
    if (quizzesBusy().some((x) => (x.title && x.title === title?.toLowerCase()) || (x.cls === cls && (!x.title || !title)))) throw Object.assign(new Error(`${title ? `“${title}”` : `A quiz for ${week === undefined ? "the whole course" : "this class"}`} is already being made.`), { code: 409 });
    const added: QuizJob[] = [{ id: randomUUID(), sem: semId ?? "", course, week, started: new Date().toISOString(), queued: true, running: false, ...(title ? { title } : {}), ...(topics ? { topics, web: !!b.web } : {}) }];
    // keep the last few finished ones, so the page can say how it went
    const recent = quizJobs.filter((j) => !j.queued && !j.running && Date.now() - new Date(j.started).getTime() < 3600_000).slice(-20);
    quizJobs = [...quizJobs.filter((j) => j.queued || j.running || recent.includes(j)), ...added];
    pumpQuizzes();
    // a single quiz that couldn't start (no material, no AI) is an error for the pop-up to show
    const failed = added.length === 1 && added[0]!.ok === false ? added[0] as QuizJob & { code?: number } : null;
    if (failed) { quizJobs = quizJobs.filter((j) => j !== failed); throw Object.assign(new Error(failed.error), { code: failed.code }); }
    return added;
  }

  // ----- homework in the background, with no chat: Check my answers (homework/check.json), Make it interactive (homework/tasks.json)
  // and Make it more academic (one answer's wording, homework/polish/<task>.html) -----
  type HomeworkJob = { id: string; kind: "check" | "make" | "polish"; task?: string; chatId?: string; sem: string; assignment: string; started: string; running: boolean; ok?: boolean; error?: string };
  let homeworkJobs: HomeworkJob[] = [];
  const tasksFile = (semId: string, id: string) => join(root, "semesters", semId, "assignments", id, "homework", "tasks.json");
  function homeworkJob(kind: HomeworkJob["kind"], b: Json): HomeworkJob[] {
    const { semId, a } = assignmentOf(b.sem, b.assignment);
    const semDir = join(root, "semesters", semId);
    if (kind === "check" && !a.homework?.tasks.length) throw Object.assign(new Error(`${a.title} has no interactive version to check.`), { code: 400 });
    if (kind === "make" && (a.homework || existsSync(tasksFile(semId, a.id)))) throw Object.assign(new Error(`${a.title} already has an interactive version.`), { code: 409 });
    const task = kind === "polish" ? String(b.task ?? "") : undefined;
    if (kind === "polish") {
      if (!a.homework?.tasks.some((x) => x.id === task)) throw Object.assign(new Error("No such task."), { code: 400 });
      if (!readAnswers(semDir, a.id)[task!]?.text?.replace(/<[^>]*>|&nbsp;|\s/g, "")) throw Object.assign(new Error("Write an answer first, then the AI can make its wording more academic."), { code: 400 });
    }
    const busy = { check: "Your answers are already being checked.", make: "The interactive version is already being made.", polish: "That answer is already being reworded." }[kind];
    if (homeworkJobs.some((j) => j.running && j.kind === kind && j.sem === semId && j.assignment === a.id && j.task === task)) throw Object.assign(new Error(busy), { code: 409 });
    const prev = kind === "check" ? readCheck(semDir, a.id) : undefined, before = prev?.checked;
    // a check looks at each answer once: again only when it changed or wasn't right (the answers as they are now)
    const answers = kind === "check" ? readAnswers(semDir, a.id) : {};
    const only = kind === "check" ? tasksToCheck(a.homework!.tasks, answers, prev) : [];
    if (kind === "check" && !only.length) throw Object.assign(new Error("Nothing new to check: every answer was right and hasn't changed since the last check."), { code: 409 });
    const action = { check: "check-homework", make: "make-homework", polish: "polish-answer" }[kind];
    const started = Date.now();
    const t = startTurn({ sem: semId, action, params: { assignment: a.id, ...(task ? { task } : {}), ...(kind === "check" && prev ? { tasks: only.join(",") } : {}) }, background: true });
    if (t.error !== undefined) throw Object.assign(new Error(t.error), { code: t.code });
    const job: HomeworkJob = { id: randomUUID(), kind, ...(task ? { task } : {}), chatId: t.chat.id, sem: semId, assignment: a.id, started: t.chat.createdAt, running: true };
    t.done.then((r) => {
      job.running = false;
      // done only when the file it was for is there and can be read: a new check, tasks without problems, a new wording
      const check = kind === "check" ? readCheck(semDir, a.id) : undefined;
      const polished = kind === "polish" ? polishFile(semDir, a.id, task!) : "";
      const made = kind === "check" ? !!check && check.checked !== before && !!Object.keys(check.tasks).length
        : kind === "polish" ? existsSync(polished) && statSync(polished).mtimeMs >= started - 1000 && !!readFileSync(polished, "utf8").trim()
        : !!readHomework(semDir, a.id)?.homework;
      job.ok = !!r?.ok && made;
      // the tasks it skipped keep their old entries; the ones it checked note which answer that was
      if (job.ok && check) writeCheck(semDir, a.id, mergeCheck(prev, check, only, answers));
      const missing = { check: "The AI finished without saving the check.", make: "The AI finished without saving the tasks.", polish: "The AI finished without saving the new wording." }[kind];
      if (!job.ok) job.error = t.chat.messages.at(-1)?.error ?? (r?.ok ? stripTicks(t.chat.messages.at(-1)?.text) || missing : "The AI stopped with an error.");
    });
    // keep the last few finished ones, so the page can say how it went
    homeworkJobs = [...homeworkJobs.filter((j) => j.running || Date.now() - new Date(j.started).getTime() < 3600_000).slice(-20), job];
    return [job];
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
      if (p === "/api/ai/prep") return json(res, { enabled: prepEnabled(), busy: prep.busy, running: prep.running, queue: prep.queue, finished: prep.finished, total: prep.total, done: prep.done, error: prep.error, transcribe: transcriber.status() });
      if (p === "/api/ai/transcribe") {
        if (req.method !== "POST") return json(res, transcriber.whisper(url.searchParams.has("fresh")));
        const b = await readBody(req);
        if (b.setup === true) return json(res, transcriber.setup());
        if (typeof b.redo === "string") {
          const r = transcriber.redo(b.redo, typeof b.language === "string" ? b.language : undefined);
          return r.ok ? json(res, r) : json(res, r, 400);
        }
        if (typeof b.enabled !== "boolean") return json(res, { error: "Bad request" }, 400);
        return json(res, transcriber.setEnabled(b.enabled));
      }
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
      if (p === "/api/ai/homework-check" || p === "/api/ai/homework-make" || p === "/api/ai/homework-polish") {
        const kind = p.endsWith("check") ? "check" : p.endsWith("make") ? "make" : "polish";
        if (req.method === "POST") return json(res, { jobs: homeworkJob(kind, await readBody(req)) });
        return json(res, { jobs: homeworkJobs.filter((j) => j.kind === kind) });
      }
      if (p === "/api/ai/quiz") {
        if (req.method === "POST") return json(res, { jobs: makeQuiz(await readBody(req)) });
        return json(res, { jobs: quizJobs });
      }
      if (p === "/api/ai/actions") return json(res, { actions: listActions(root) });
      if (p === "/api/ai/chats" && req.method === "DELETE") return json(res, deleteChats(root, (x) => runs.has(x)));
      if (p === "/api/ai/chats") return json(res, { chats: listChats(root) });
      if (p.startsWith("/api/ai/chats/")) {
        const id = p.split("/").pop() ?? "";
        if (req.method === "DELETE") {
          if (!safeId(id) || !loadChat(root, id)) return json(res, { error: "Not found" }, 404);
          if (runs.has(id)) return json(res, { error: "This chat is still working. Stop it first." }, 409);
          return json(res, deleteChats(root, () => false, id));
        }
        const chat = safeId(id) && (runs.get(id)?.chat ?? loadChat(root, id));
        return chat ? json(res, { ...chat, running: runs.has(id) }) : json(res, { error: "Not found" }, 404);
      }
      if (p === "/api/ai/run" && req.method === "POST") return await run(req, res);
      if (p === "/api/ai/enabled" && req.method === "POST") {
        // Settings: switch an AI off (hidden from the chat, never used) or back on; the default AI stays on
        const { tool, enabled } = await readBody(req);
        const cfg = loadConfig(root) ?? { tool: null };
        if (!["claude", "codex", "opencode", "local"].includes(tool) || typeof enabled !== "boolean") return json(res, { error: "Bad request" }, 400);
        if (!enabled && (ALIASES[cfg.tool ?? ""] ?? cfg.tool) === tool) return json(res, { error: `${TOOL_LABEL[tool as keyof typeof TOOL_LABEL]} is the Default AI. Pick another Default AI first.` }, 400);
        const off = [...new Set([...(cfg.off ?? []).filter((x) => x !== tool), ...(enabled ? [] : [tool])])];
        saveConfig(root, { ...cfg, off: off.length ? off : undefined });
        cache = undefined;
        return json(res, { ok: true, tool, enabled });
      }
      if (p === "/api/ai/tool" && req.method === "POST") {
        // Settings: the AI that answers new chats and does the background work (what `ouc ai setup` chose)
        const { tool } = await readBody(req);
        const cfg = loadConfig(root) ?? { tool: null };
        if (!["claude", "codex", "opencode", "local"].includes(tool)) return json(res, { error: "Bad request" }, 400);
        if (cfg.off?.includes(tool)) return json(res, { error: `${TOOL_LABEL[tool as keyof typeof TOOL_LABEL]} is switched off. Switch it on first.` }, 400);
        if ((tool === "opencode" && !cfg.opencode) || (tool === "local" && !cfg.local)) return json(res, { error: `${TOOL_LABEL[tool as keyof typeof TOOL_LABEL]} has no local model set up yet. In Terminal, run: ouc ai setup` }, 400);
        saveConfig(root, { ...cfg, tool });
        cache = undefined;
        void handler.warmUp();
        return json(res, { ok: true, tool });
      }
      if (p === "/api/ai/defaults" && req.method === "POST") {
        // Settings: the model each AI uses unless a chat picks another ("" = the tool's own)
        const { tool, model } = await readBody(req);
        const cfg = loadConfig(root) ?? { tool: null };
        if (!["claude", "codex", "opencode", "local"].includes(tool) || typeof (model ?? "") !== "string") return json(res, { error: "Bad request" }, 400);
        if (model && !toolModels(cfg, tool).models.includes(model)) return json(res, { error: `${TOOL_LABEL[tool as keyof typeof TOOL_LABEL]} doesn't offer "${model}".` }, 400);
        const defaultModels = { ...cfg.defaultModels, [tool]: model || undefined };
        saveConfig(root, { ...cfg, defaultModels: JSON.parse(JSON.stringify(defaultModels)) });
        cache = undefined;
        void handler.warmUp();
        return json(res, { ok: true, ...toolModels(loadConfig(root), tool) });
      }
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
      if (!res.headersSent) json(res, { error: err.message }, err.code === 404 ? 404 : err.code && err.code >= 400 && err.code < 500 ? err.code : url.pathname.startsWith("/api/ai/review/") ? 400 : 500);
      else res.end();
    }
  }) as AiApi;
  /** Call when the app data was rebuilt (a sync, new files): prepares assignments that need it. */
  handler.autoPrep = () => {
    if (opts.noAutoPrep) return;
    catchUp();
    transcriber.run();   // videos and narrated slides without a transcript, one at a time
  };
  /** Sync now: make the missing notes and prep packs (returns how many it will make). */
  handler.catchUp = () => {
    const semId = currentSemesterId(root);
    let todo = { notes: 0, prep: 0, quizzes: 0 };
    try {
      if (!semId) throw new Error("no semester");
      const data = loadData(root, semId);
      const cfg = loadConfig(root);
      todo = { notes: weeksWithoutNotes(data, data.courses).length, prep: needsPrep(root, semId, data).length, quizzes: cfg?.autoQuiz === false ? 0 : quizzesToMake(semId, data).length };
    } catch { /* no data yet */ }
    catchUp({ notes: true, force: true });
    return todo;
  };
  handler.prepIdle = () => !prep.busy;
  // load the default AI's model once at a time (on start, and when Settings change the default)
  let warming: Promise<string | null> | undefined;
  handler.warmUp = () => (warming ??= warmUp(root, loadConfig(root)).finally(() => { warming = undefined; }));
  return handler;
}
