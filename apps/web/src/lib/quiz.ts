/** Quiz scores saved on this computer (/api/quiz/attempts in vite.config.ts → semesters/<sem>/quizzes/attempts.json). */
import { useEffect, useState } from "react";
import type { QuizAttempt } from "@ouc/content/types";
import { quizStats, type QuizStats } from "@ouc/content/quiz";

export interface Attempts { state: "loading" | "ok" | "unavailable"; attempts: QuizAttempt[]; stats: QuizStats }

// one copy per semester, shared by every component that shows scores
const store = new Map<string, Attempts>();
const listeners = new Set<() => void>();
const set = (sem: string, attempts: QuizAttempt[], state: Attempts["state"] = "ok") => {
  store.set(sem, { state, attempts, stats: quizStats(attempts) });
  listeners.forEach((l) => l());
};
const loading = new Map<string, Promise<void>>();
function load(sem: string) {
  if (!loading.has(sem)) loading.set(sem, fetch(`/api/quiz/attempts?sem=${encodeURIComponent(sem)}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j) => set(sem, j.attempts ?? []))
    .catch(() => set(sem, [], "unavailable"))   // a static build has no app server
    .finally(() => loading.delete(sem)));
  return loading.get(sem)!;
}

export function useAttempts(sem: string): Attempts {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    if (!store.has(sem)) load(sem);
    return () => { listeners.delete(l); };
  }, [sem]);
  return store.get(sem) ?? { state: "loading", attempts: [], stats: quizStats([]) };
}

/** Saves a finished quiz; the server works out the points. Throws Error(message) if it couldn't. */
export async function saveAttempt(sem: string, body: { quiz: string; title: string; results: boolean[] }): Promise<QuizAttempt> {
  const res = await fetch("/api/quiz/attempts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sem, ...body }) }).catch(() => null);
  const j = await res?.json().catch(() => null);
  if (!res?.ok || !j?.attempt) throw new Error(j?.error ?? "Couldn't save your score. Is the app running on your computer?");
  set(sem, j.attempts ?? [...(store.get(sem)?.attempts ?? []), j.attempt]);
  return j.attempt;
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
