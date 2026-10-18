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

/** Where a file the agent wrote opens in the app: a note page, a course file, or nowhere. */
export function fileLink(path: string): { to: string; internal: boolean } | null {
  const m = path.match(/^semesters\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const note = m[2].match(/^notes\/([^/]+)\/([^/]+)\.md$/);
  if (note) return { to: `/${encodeURIComponent(m[1])}/notes/${encodeURIComponent(note[1])}/${encodeURIComponent(note[2])}`, internal: true };
  return { to: `/files/${m[1]}/${m[2].split("/").map(encodeURIComponent).join("/")}`, internal: false };
}
