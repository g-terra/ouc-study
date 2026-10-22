/**
 * Homework answers saved on this computer (/api/homework in vite.config.ts → each assignment's homework/answers.json).
 * One copy per semester, shared by the homework page and the assignment cards that show done/left.
 */
import { useEffect, useState } from "react";
import { applyAnswer, type HomeworkAnswers, type HomeworkTask } from "@ouc/content/homework";

export interface HomeworkState { state: "loading" | "ok" | "unavailable"; answers: Record<string, HomeworkAnswers> }

const store = new Map<string, HomeworkState>();
const listeners = new Set<() => void>();
const set = (sem: string, answers: Record<string, HomeworkAnswers>, state: HomeworkState["state"] = "ok") => {
  store.set(sem, { state, answers });
  listeners.forEach((l) => l());
};
const loading = new Map<string, Promise<void>>();
function load(sem: string) {
  if (!loading.has(sem)) loading.set(sem, fetch(`/api/homework?sem=${encodeURIComponent(sem)}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j) => set(sem, j.answers ?? {}))
    .catch(() => set(sem, {}, "unavailable"))   // a static build has no app server
    .finally(() => loading.delete(sem)));
  return loading.get(sem)!;
}

export function useHomework(sem: string): HomeworkState {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    if (!store.has(sem)) load(sem);
    return () => { listeners.delete(l); };
  }, [sem]);
  return store.get(sem) ?? { state: "loading", answers: {} };
}

export type AnswerPatch = { task: string; text?: string; choice?: number | null; why?: string; done?: boolean };

/** Saves a change to one answer. It shows at once; if it can't be saved, the saved answers come back and this rejects. */
export async function saveAnswer(sem: string, assignment: string, tasks: HomeworkTask[], patch: AnswerPatch): Promise<void> {
  const cur = store.get(sem) ?? { state: "ok" as const, answers: {} };
  const before = cur.answers[assignment] ?? {};
  set(sem, { ...cur.answers, [assignment]: applyAnswer(tasks, before, patch) }, cur.state);
  const res = await fetch("/api/homework", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sem, assignment, ...patch }) }).catch(() => null);
  const j = await res?.json().catch(() => null);
  const now = store.get(sem)!;
  if (res?.ok && j?.answers) return set(sem, { ...now.answers, [assignment]: j.answers }, now.state);
  set(sem, { ...now.answers, [assignment]: before }, now.state);
  throw new Error(j?.error ?? "Couldn't save. Is the app still running?");
}
