import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Assignment, Course, SemesterData, SemesterIndex } from "@ouc/content/types";
import { at, day } from "./dates";

const IndexCtx = createContext<SemesterIndex | null>(null);
const cache = new Map<string, Promise<SemesterData>>();

export function DataProvider({ children }: { children: ReactNode }) {
  const [index, setIndex] = useState<SemesterIndex | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    fetch("/data/index.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setIndex)
      .catch((e) => setError(String(e)));
  }, []);
  if (error) return <Problem msg={`Couldn't load the study data (${error}). Run “npm run content” and reload.`} />;
  if (!index) return <Loading />;
  if (!index.semesters.length) return <Welcome />;
  return <IndexCtx.Provider value={index}>{children}</IndexCtx.Provider>;
}

export const useIndex = () => useContext(IndexCtx)!;

/** The semester covering today, else the most recent one. */
export function currentSemesterId(index: SemesterIndex): string {
  const now = new Date();
  const hit = index.semesters.find((s) => day(s.start) <= now && now <= day(s.end));
  return (hit ?? index.semesters[index.semesters.length - 1])?.id ?? "";
}

export function useSemester(id: string): SemesterData | null | undefined {
  const [data, setData] = useState<SemesterData | null>();
  useEffect(() => {
    let alive = true;
    if (!cache.has(id)) cache.set(id, fetch(`/data/${encodeURIComponent(id)}.json`).then((r) => (r.ok ? r.json() : Promise.reject())));
    cache.get(id)!.then((d) => alive && setData(d)).catch(() => alive && setData(null));
    return () => { alive = false; };
  }, [id]);
  return data;
}

// ---------- derived helpers ----------
export type State = "done" | "late" | "soon" | "todo";
export function stateOf(a: Assignment, now = new Date()): State {
  if (a.submitted) return "done";
  if (!a.due) return "todo";
  const d = (at(a.due).getTime() - now.getTime()) / 86_400_000;
  return d < 0 ? "late" : d <= 7 ? "soon" : "todo";
}
export const STATE_LABEL: Record<State, string> = { done: "Submitted", late: "Overdue", soon: "Due soon", todo: "To do" };

export function currentWeek(c: Course, now = new Date()) {
  return c.weeks.find((w) => w.start && w.end && day(w.start) <= now && now < new Date(day(w.end).getTime() + 86_400_000));
}

export function courseMap(d: SemesterData) {
  return Object.fromEntries(d.courses.map((c) => [c.code, c]));
}

export function Loading() {
  return <div className="grid min-h-[50vh] place-items-center text-muted">Loading…</div>;
}
function Welcome() {
  return (
    <div className="mx-auto max-w-lg p-8 pt-20 text-center">
      <div className="mb-4 text-5xl">🎓</div>
      <h1 className="mb-2 text-2xl font-bold">Welcome to OUC Study</h1>
      <p className="mb-6 text-muted">No courses yet. Run the installer once: it connects to your eClass account, downloads your courses and sets everything up.</p>
      <div className="rounded-xl border border-line bg-surface p-4 text-left text-sm leading-7">
        <div>In Terminal, in this folder:</div>
        <code className="mt-1 block rounded-lg bg-ink px-3 py-2 font-mono text-bg">npm run setup</code>
        <div className="mt-2 text-muted">On a Mac you can also double-click <b>Install OUC Study.command</b>.</div>
      </div>
    </div>
  );
}
export function Problem({ msg }: { msg: string }) {
  return <div className="mx-auto max-w-xl p-8 text-center text-muted">{msg}</div>;
}
