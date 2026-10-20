/**
 * Quiz scores saved on this computer (/api/quiz/attempts in vite.config.ts → semesters/<sem>/quizzes/attempts.json),
 * removing quizzes, and quizzes the AI is making in the background (/api/ai/quiz in packages/ai/src/api.ts).
 */
import { useEffect, useState } from "react";
import { refreshData } from "./data";
import { refreshAi, token } from "./ai";
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

const failed = async (res: Response | null, fallback = "Couldn't do that. Is the app running on your computer?") => {
  const j = await res?.json().catch(() => null);
  return j?.error ?? fallback;
};

/** Clears a quiz's scores (or every quiz's, without `quiz`). */
export async function resetProgress(sem: string, quiz?: string): Promise<void> {
  const res = await fetch(`/api/quiz/attempts?sem=${encodeURIComponent(sem)}${quiz ? `&quiz=${encodeURIComponent(quiz)}` : ""}`, { method: "DELETE" }).catch(() => null);
  if (!res?.ok) throw new Error(await failed(res));
  set(sem, (await res.json()).attempts ?? []);
}

/** Deletes a quiz file and its scores; the app data rebuilds after. */
export async function removeQuiz(sem: string, quiz: string): Promise<void> {
  const res = await fetch(`/api/quiz?sem=${encodeURIComponent(sem)}&quiz=${encodeURIComponent(quiz)}`, { method: "DELETE" }).catch(() => null);
  if (!res?.ok) throw new Error(await failed(res));
  set(sem, (await res.json()).attempts ?? []);
  window.setTimeout(refreshData, 800);   // in case the file watcher missed it
}

// ---------- quizzes being made ----------
/** queued: waiting for a free slot (the AI makes a few at a time); chatId is set once it starts; phase: reading the material, then writing the quiz. */
export interface QuizJob { id: string; chatId?: string; sem: string; course: string; week?: string; quiz?: string; started: string; queued?: boolean; running: boolean; phase?: "planning" | "writing"; ok?: boolean; error?: string }
let jobs: QuizJob[] = [];
let dismissed = new Set<string>();
const jobListeners = new Set<() => void>();
let jobTimer: number | undefined;
async function pollJobs() {
  const j = await fetch("/api/ai/quiz", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const next: QuizJob[] = j?.jobs ?? [];
  // a quiz just finished: show it
  if (next.some((n) => n.ok && jobs.find((o) => o.id === n.id)?.running)) refreshData();
  jobs = next;
  jobListeners.forEach((l) => l());
  window.clearTimeout(jobTimer);
  jobTimer = jobs.some((x) => x.running || x.queued) ? window.setTimeout(pollJobs, 3000) : undefined;
}

/** The quizzes being made (and ones that just failed) for a semester, optionally one course; `all` keeps the finished ones too. */
export function useQuizJobs(sem: string, course?: string, all = false): QuizJob[] {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    jobListeners.add(l);
    if (jobListeners.size === 1) pollJobs();
    return () => { jobListeners.delete(l); };
  }, []);
  return jobs.filter((j) => j.sem === sem && (!course || j.course === course) && (all || j.running || j.queued || (!j.ok && !dismissed.has(j.id))));
}
export const dismissJob = (id: string) => { dismissed = new Set([...dismissed, id]); jobListeners.forEach((l) => l()); };

/**
 * Asks the AI for a quiz in the background (the chat isn't opened): one class (`week`), the whole course,
 * or `"every"` class without a quiz yet (one quiz each). Throws Error(message) if it can't start.
 */
export async function makeQuiz(sem: string, course: string, week?: string): Promise<QuizJob[]> {
  const res = await fetch("/api/ai/quiz", { method: "POST", headers: { "Content-Type": "application/json", "X-OUC-AI": await token() }, body: JSON.stringify(week === "every" ? { sem, course, every: true } : { sem, course, week }) }).catch(() => null);
  if (res?.status === 403) refreshAi(true);   // the app server restarted: get a new token
  if (!res?.ok) throw new Error(await failed(res, "Couldn't start the AI. Is the app running on your computer?"));
  const { jobs: added } = (await res.json()) as { jobs: QuizJob[] };
  jobs = [...jobs.filter((j) => !added.some((a) => a.id === j.id)), ...added];
  pollJobs();
  return added;
}
