/**
 * Homework answers saved on this computer (/api/homework in vite.config.ts → each assignment's homework/answers.json),
 * and the AI's checks of them (homework/check.json). One copy per semester, shared by the homework page and the
 * assignment cards that show done/left.
 */
import { useEffect, useState } from "react";
import { applyAnswer, type HomeworkAnswers, type HomeworkCheck, type HomeworkTask } from "@ouc/content/homework";
import { refreshAi, token } from "./ai";

export interface HomeworkState { state: "loading" | "ok" | "unavailable"; answers: Record<string, HomeworkAnswers>; checks: Record<string, HomeworkCheck> }

const store = new Map<string, HomeworkState>();
const listeners = new Set<() => void>();
const set = (sem: string, answers: Record<string, HomeworkAnswers>, state: HomeworkState["state"] = "ok", checks = store.get(sem)?.checks ?? {}) => {
  store.set(sem, { state, answers, checks });
  listeners.forEach((l) => l());
};
const loading = new Map<string, Promise<void>>();
function load(sem: string) {
  if (!loading.has(sem)) loading.set(sem, fetch(`/api/homework?sem=${encodeURIComponent(sem)}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j) => set(sem, j.answers ?? {}, "ok", j.checks ?? {}))
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
  return store.get(sem) ?? { state: "loading", answers: {}, checks: {} };
}

export type AnswerPatch = { task: string; text?: string; choice?: number | null; why?: string; done?: boolean };

// the newest save per assignment: an older save's reply must not undo a newer change shown already
const latest = new Map<string, number>();
let saves = 0;

/** Saves a change to one answer. It shows at once; if it can't be saved, the saved answers come back and this rejects. */
export async function saveAnswer(sem: string, assignment: string, tasks: HomeworkTask[], patch: AnswerPatch): Promise<void> {
  const key = `${sem}|${assignment}`, n = ++saves;
  latest.set(key, n);
  const cur: HomeworkState = store.get(sem) ?? { state: "ok", answers: {}, checks: {} };
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

// ---------- Check my answers: the AI checks them in the background (/api/ai/homework-check) ----------
export interface CheckJob { id: string; chatId?: string; sem: string; assignment: string; started: string; running: boolean; ok?: boolean; error?: string }
let jobs: CheckJob[] = [];
let dismissed = new Set<string>();
const jobListeners = new Set<() => void>();
let jobTimer: number | undefined;
async function pollJobs() {
  const j = await fetch("/api/ai/homework-check", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const next: CheckJob[] = j?.jobs ?? [];
  // a check just finished: show it
  for (const n of next) if (n.ok && jobs.find((o) => o.id === n.id)?.running) load(n.sem);
  jobs = next;
  jobListeners.forEach((l) => l());
  window.clearTimeout(jobTimer);
  jobTimer = jobs.some((x) => x.running) ? window.setTimeout(pollJobs, 2000) : undefined;
}

/** The checks running for an assignment, and the last one that failed (until dismissed); `all` keeps the finished ones too. */
export function useCheckJobs(sem: string, assignment?: string, all = false): CheckJob[] {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    jobListeners.add(l);
    if (jobListeners.size === 1) pollJobs();
    return () => { jobListeners.delete(l); };
  }, []);
  return jobs.filter((j) => j.sem === sem && (!assignment || j.assignment === assignment) && (all || j.running || (!j.ok && !dismissed.has(j.id))));
}
export const dismissCheck = (id: string) => { dismissed = new Set([...dismissed, id]); jobListeners.forEach((l) => l()); };

/** Asks the AI to check the answers in the background. Throws Error(message) if it can't start. */
export async function checkAnswers(sem: string, assignment: string): Promise<void> {
  const res = await fetch("/api/ai/homework-check", { method: "POST", headers: { "Content-Type": "application/json", "X-OUC-AI": await token() }, body: JSON.stringify({ sem, assignment }) }).catch(() => null);
  if (res?.status === 403) refreshAi(true);   // the app server restarted: get a new token
  const j = await res?.json().catch(() => null);
  if (!res?.ok) throw new Error(j?.error ?? "Couldn't start the AI. Is the app running on your computer?");
  jobs = [...jobs.filter((x) => !j.jobs.some((n: CheckJob) => n.id === x.id)), ...j.jobs];
  pollJobs();
}
