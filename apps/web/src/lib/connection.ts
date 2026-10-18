/** Live "connected to eClass" state, shared by the header dot and the Updates page. */
import { useEffect, useState } from "react";

export type ConnState = "checking" | "connected" | "nokey" | "badkey" | "invalid" | "offline" | "error" | "unavailable";
export interface Connection { state: ConnState; ok?: boolean; user?: string; error?: string; checkedAt?: string; syncing?: boolean }

let current: Connection = { state: "checking" };
const listeners = new Set<(c: Connection) => void>();
const set = (c: Connection) => { current = c; listeners.forEach((l) => l(c)); };
let inflight: Promise<void> | null = null;

export function refreshConnection(fresh = false) {
  if (inflight && !fresh) return inflight;
  inflight = fetch(`/api/eclass/status${fresh ? "?fresh=1" : ""}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j) => set({ ...j, state: (j.state ?? (j.ok ? "connected" : "error")) as ConnState }))
    .catch(() => set({ state: "unavailable" })) // e.g. a static build without the dev server
    .finally(() => { inflight = null; });
  return inflight;
}

export async function syncNow(): Promise<{ ok: boolean; found?: number; error?: string; ai?: { notes: number; prep: number } }> {
  set({ ...current, syncing: true });
  try {
    const r = await fetch("/api/eclass/sync", { method: "POST" }).then((x) => x.json());
    set({ ...current, ...r, state: r.state ?? (r.ok ? "connected" : "error"), syncing: false, checkedAt: new Date().toISOString() });
    return r;
  } catch (e) {
    set({ ...current, syncing: false });
    return { ok: false, error: "The app server isn't reachable." };
  }
}

let started = false;
export function useConnection(): Connection {
  const [c, setC] = useState(current);
  useEffect(() => {
    listeners.add(setC);
    if (!started) { started = true; refreshConnection(); setInterval(() => refreshConnection(), 10 * 60_000); }
    return () => { listeners.delete(setC); };
  }, []);
  return c;
}

export const CONN_LABEL: Record<ConnState, { dot: string; text: string; tone: string }> = {
  checking: { dot: "bg-muted animate-pulse", text: "Checking eClass…", tone: "text-muted" },
  connected: { dot: "bg-ok", text: "Connected to eClass", tone: "text-ok" },
  nokey: { dot: "bg-muted", text: "eClass not set up", tone: "text-muted" },
  badkey: { dot: "bg-bad", text: "eClass key looks wrong", tone: "text-bad" },
  invalid: { dot: "bg-bad", text: "eClass key expired", tone: "text-bad" },
  offline: { dot: "bg-warn", text: "Offline: can't reach eClass", tone: "text-warn" },
  error: { dot: "bg-bad", text: "eClass error", tone: "text-bad" },
  unavailable: { dot: "bg-muted", text: "Live status unavailable", tone: "text-muted" },
};
