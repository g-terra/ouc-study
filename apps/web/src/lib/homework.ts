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

// the newest save per assignment: an older save's reply must not undo a newer change shown already
const latest = new Map<string, number>();
let saves = 0;

/** Saves a change to one answer. It shows at once; if it can't be saved, the saved answers come back and this rejects. */
export async function saveAnswer(sem: string, assignment: string, tasks: HomeworkTask[], patch: AnswerPatch): Promise<void> {
  const key = `${sem}|${assignment}`, n = ++saves;
  latest.set(key, n);
  const cur = store.get(sem) ?? { state: "ok" as const, answers: {} };
  const before = cur.answers[assignment] ?? {};
  set(sem, { ...cur.answers, [assignment]: applyAnswer(tasks, before, patch) }, cur.state);
  const res = await fetch("/api/homework", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sem, assignment, ...patch }) }).catch(() => null);
  const j = await res?.json().catch(() => null);
  const now = store.get(sem)!;
  const newest = latest.get(key) === n;
  if (res?.ok && j?.answers) { if (newest) set(sem, { ...now.answers, [assignment]: j.answers }, now.state); return; }
  if (newest) set(sem, { ...now.answers, [assignment]: before }, now.state);
  throw new Error(j?.error ?? "Couldn't save. Is the app still running?");
}

/** Saves a picture added to an answer; resolves to its address for the editor. */
export async function uploadPicture(sem: string, assignment: string, file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error("That picture is too big (10 MB at most).");
  const res = await fetch(`/api/homework/image?sem=${encodeURIComponent(sem)}&assignment=${encodeURIComponent(assignment)}`, { method: "POST", body: file }).catch(() => null);
  const j = await res?.json().catch(() => null);
  if (res?.ok && j?.src) return j.src;
  throw new Error(j?.error ?? "Couldn't add the picture. Is the app still running?");
}

/** Asks the app server to print the homework to a PDF in the assignment's my-submission folder; resolves to its address. */
export async function makePdf(sem: string, assignment: string, title: string, name: string): Promise<string> {
  const res = await fetch("/api/homework/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sem, assignment, title, name }) }).catch(() => null);
  const j = await res?.json().catch(() => null);
  if (res?.ok && j?.pdf) return j.pdf;
  throw Object.assign(new Error(j?.error ?? "Couldn't make the PDF. Is the app still running?"), { noBrowser: !!j?.noBrowser });
}

/** The print page of a homework (what goes into the PDF). */
export const printHref = (sem: string, assignment: string, name: string) =>
  `/print/homework/${[sem, ...assignment.split("/")].map(encodeURIComponent).join("/")}?name=${encodeURIComponent(name)}`;
