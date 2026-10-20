/**
 * What's been watched and read, saved on this computer (/api/progress in vite.config.ts → semesters/<sem>/progress.json).
 * Each week's videos, slides, files and links get a tick box; videos and slides tick themselves when played or viewed to the end.
 */
import { useEffect, useState } from "react";
import type { Week, WeekItem } from "@ouc/content/types";
import { itemKey, type DoneEntry, type Progress } from "@ouc/content/progress";

export interface ProgressState { state: "loading" | "ok" | "unavailable"; done: Progress }

// one copy per semester, shared by every component that shows ticks
const store = new Map<string, ProgressState>();
const listeners = new Set<() => void>();
const set = (sem: string, done: Progress, state: ProgressState["state"] = "ok") => {
  store.set(sem, { state, done });
  listeners.forEach((l) => l());
};
const loading = new Map<string, Promise<void>>();
function load(sem: string) {
  if (!loading.has(sem)) loading.set(sem, fetch(`/api/progress?sem=${encodeURIComponent(sem)}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j) => set(sem, j.done ?? {}))
    .catch(() => set(sem, {}, "unavailable"))   // a static build has no app server
    .finally(() => loading.delete(sem)));
  return loading.get(sem)!;
}

export function useProgress(sem: string): ProgressState {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    if (!store.has(sem)) load(sem);
    return () => { listeners.delete(l); };
  }, [sem]);
  return store.get(sem) ?? { state: "loading", done: {} };
}

/** Ticks or unticks a week item. The tick shows at once and goes back if it couldn't be saved. */
export async function markDone(sem: string, code: string, w: Pick<Week, "index">, it: WeekItem, done: boolean, how: DoneEntry["how"] = "ticked"): Promise<void> {
  const key = itemKey(code, w.index, it);
  const before = store.get(sem)?.done ?? {};
  if (Boolean(before[key]) === done) return;
  const next = { ...before };
  if (done) next[key] = { course: code, week: w.index, title: it.title, kind: it.kind, at: new Date().toISOString(), how };
  else delete next[key];
  set(sem, next);
  const res = await fetch("/api/progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sem, key, done, course: code, week: w.index, title: it.title, kind: it.kind, how }) }).catch(() => null);
  const j = await res?.json().catch(() => null);
  if (res?.ok && j?.done) set(sem, j.done);
  else set(sem, before, store.get(sem)?.state);
}
