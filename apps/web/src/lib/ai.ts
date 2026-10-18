/** Talks to /api/ai (packages/ai/api.mjs): AI tool status, study actions and chats. */
import { useEffect, useState } from "react";

export type ToolState = "connected" | "signedout" | "apikey" | "missing" | "noserver" | "unknown";
export interface AiTool { id: string; label: string; state: ToolState; detail?: string; fix?: string; chosen: boolean }
export interface AiStatus {
  state: "checking" | "ok" | "unavailable";
  chosen?: string | null; label?: string; agentic?: boolean; ready?: boolean; reason?: string;
  tools: AiTool[]; checkedAt?: string; token?: string;
}
export interface ActionField { key: string; kind: "course" | "assignment" | "text"; label: string; required?: boolean; placeholder?: string }
export interface AiAction { id: string; title: string; icon: string; description: string; fields: ActionField[]; agentOnly: boolean }
/** An assistant message: `text` is the latest (final) answer; earlier messages from the agent are progress `updates`. */
export interface ChatMessage { role: "user" | "assistant"; text: string; updates?: string[]; steps?: string[]; files?: string[]; error?: string; by?: string; at?: string }
export interface Chat { id: string; title: string; tool?: string; action?: string | null; sem?: string; messages: ChatMessage[]; running?: boolean; updatedAt?: string }
export interface ChatSummary { id: string; title: string; tool?: string; action?: string; sem?: string; updatedAt: string }
export type AiEvent =
  | { type: "chat"; id: string; title: string }
  | { type: "text"; text: string; replace?: boolean }
  | { type: "tool"; label: string }
  | { type: "file"; path: string }
  | { type: "session"; id: string }
  | { type: "error"; message: string }
  | { type: "done"; ok: boolean };

// ---------- status (shared by the header and the panel) ----------
let current: AiStatus = { state: "checking", tools: [] };
const listeners = new Set<(s: AiStatus) => void>();
const set = (s: AiStatus) => { current = s; listeners.forEach((l) => l(s)); };
let inflight: Promise<void> | null = null;

export function refreshAi(fresh = false) {
  if (inflight && !fresh) return inflight;
  if (fresh) set({ ...current, state: current.state === "unavailable" ? "checking" : current.state, checkedAt: undefined });
  inflight = fetch(`/api/ai/status${fresh ? "?fresh=1" : ""}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j) => set({ ...j, state: "ok" }))
    .catch(() => set({ state: "unavailable", tools: [] })) // a static build has no app server
    .finally(() => { inflight = null; });
  return inflight;
}

let started = false;
export function useAiStatus(): AiStatus {
  const [s, setS] = useState(current);
  useEffect(() => {
    listeners.add(setS);
    if (!started) { started = true; refreshAi(); setInterval(() => refreshAi(), 10 * 60_000); }
    return () => { listeners.delete(setS); };
  }, []);
  return s;
}

export const TOOL_STATE: Record<ToolState, { dot: string; text: string }> = {
  connected: { dot: "bg-ok", text: "Connected" },
  signedout: { dot: "bg-warn", text: "Not signed in" },
  apikey: { dot: "bg-warn", text: "Uses an API key" },
  missing: { dot: "bg-muted/50", text: "Not installed" },
  noserver: { dot: "bg-warn", text: "Model app not running" },
  unknown: { dot: "bg-muted", text: "Installed" },
};

// ---------- actions & chats ----------
let actions: Promise<AiAction[]> | undefined;
export function useActions(): AiAction[] {
  const [a, setA] = useState<AiAction[]>([]);
  useEffect(() => {
    actions ??= fetch("/api/ai/actions").then((r) => (r.ok ? r.json() : { actions: [] })).then((j) => j.actions).catch(() => []);
    actions.then(setA);
  }, []);
  return a;
}

export const listChats = (): Promise<ChatSummary[]> => fetch("/api/ai/chats").then((r) => r.json()).then((j) => j.chats ?? []).catch(() => []);
export const getChat = (id: string): Promise<Chat | null> => fetch(`/api/ai/chats/${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);

/** Background AI work (missing notes and prep packs): what's running, what's queued, how far along. */
export interface PrepStatus {
  enabled: boolean; busy: boolean; running: { id: string; chatId: string }[]; queue: string[];
  total: number; done: number; error: string | null;
}
let prepNow: PrepStatus | null = null;
const prepListeners = new Set<(s: PrepStatus | null) => void>();
let prepTimer: number | undefined;
export const refreshPrep = () => fetch("/api/ai/prep").then((r) => (r.ok ? r.json() : null)).catch(() => null)
  .then((j) => { prepNow = j; prepListeners.forEach((l) => l(j)); });
export function usePrepStatus(): PrepStatus | null {
  const [s, setS] = useState(prepNow);
  useEffect(() => {
    prepListeners.add(setS);
    if (prepTimer === undefined) { refreshPrep(); prepTimer = window.setInterval(refreshPrep, 3000); }
    return () => { prepListeners.delete(setS); if (!prepListeners.size) { window.clearInterval(prepTimer); prepTimer = undefined; } };
  }, []);
  return s;
}

async function token() {
  if (!current.token) await refreshAi();
  return current.token ?? "";
}
export async function stopRun(chatId: string) {
  await fetch("/api/ai/stop", { method: "POST", headers: { "Content-Type": "application/json", "X-OUC-AI": await token() }, body: JSON.stringify({ chatId }) });
}

/** One turn: streams the agent's events to onEvent. Throws Error(message) if the turn can't start. */
export async function runTurn(body: { sem: string; tool?: string; chatId?: string; action?: string; params?: Record<string, string>; message?: string }, onEvent: (e: AiEvent) => void) {
  const res = await fetch("/api/ai/run", { method: "POST", headers: { "Content-Type": "application/json", "X-OUC-AI": await token() }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    if (res.status === 403) refreshAi(true); // the app server restarted: get a new token
    throw new Error(j.error ?? `The app server answered ${res.status}.`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      if (block.startsWith("data: ")) { try { onEvent(JSON.parse(block.slice(6))); } catch { /* ignore a broken line */ } }
    }
  }
}

const enc = (s: string) => s.split("/").map(encodeURIComponent).join("/");
const TOP = /^(notes|courses|assignments|text|plans|research|updates|_meta|visuals)\//;
/**
 * Where a path an agent wrote or named opens in the app: a note page, an assignment page, or the file
 * itself (in a new tab). Takes repo-relative or absolute paths, and paths inside the semester folder
 * when `sem` is given ("notes/COS514/x.md"). Null when the app can't open it.
 */
export function fileLink(path: string, sem?: string): { to: string; internal: boolean } | null {
  let p = path.trim().replace(/^\.\//, "").replace(/[),.;:]+$/, "");
  const at = p.indexOf("semesters/");
  if (at > 0 && p[at - 1] === "/") p = p.slice(at);   // an absolute path inside the study folder
  else if (sem && TOP.test(p)) p = `semesters/${sem}/${p}`;
  const m = p.match(/^semesters\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const [, s, rest] = m;
  const note = rest.match(/^notes\/([^/]+)\/([^/]+)\.md$/);
  if (note) return { to: `/${encodeURIComponent(s)}/notes/${encodeURIComponent(note[1])}/${encodeURIComponent(note[2])}`, internal: true };
  // an assignment's folder, its working notes or its prep pack open the assignment page; its files open as files
  const asg = rest.match(/^assignments\/([^/]+)\/([^/]+)(?:\/(README\.md|PREP\.md)?)?$/);
  if (asg) return { to: `/${encodeURIComponent(s)}/assignments/${encodeURIComponent(asg[1])}/${encodeURIComponent(asg[2])}`, internal: true };
  if (!/\.\w{1,6}$/.test(rest)) return null;   // a folder
  return { to: `/files/${s}/${enc(rest)}`, internal: false };
}

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
/** Turns `paths` in a reply's HTML (and links to paths) into links to the app's pages and files. */
export function linkPaths(html: string, sem?: string): string {
  return html
    .replace(/<a href="([^"]+)"/g, (all, href) => {
      const l = /^[a-z]+:/i.test(href) || href.startsWith("/files/") ? null : fileLink(decodeURIComponent(unescape(href)), sem);
      return l ? `<a href="${attr(l.to)}"${l.internal ? " data-internal" : ' target="_blank" rel="noreferrer"'}` : all;
    })
    .replace(/(<a [^>]*>[\s\S]*?<\/a>)|<code>([^<]+)<\/code>/g, (all, link, code) => {
      if (link) return all;   // already a link
      const l = fileLink(unescape(code), sem);
      return l ? `<a href="${attr(l.to)}"${l.internal ? " data-internal" : ' target="_blank" rel="noreferrer"'} title="${l.internal ? "Open in the app" : "Open the file"}"><code>${code}</code></a>` : all;
    });
}

const VISUAL = /\.(html?|svg|png|jpe?g|gif|webp)$/i;
/** Visuals an answer produced (HTML pages, SVGs, images): files it wrote, plus paths it names in `code`. */
export function visualsOf(msg: ChatMessage): string[] {
  const named = [...(msg.text ?? "").matchAll(/`([^`\s]+\.(?:html?|svg|png|jpe?g|gif|webp))`/gi)].map((m) => m[1]);
  return [...new Set([...(msg.files ?? []), ...named].filter((f) => VISUAL.test(f) && !/^https?:/i.test(f)))];
}
export const viewUrl = (path: string) => `/api/ai/view?path=${encodeURIComponent(path)}`;
