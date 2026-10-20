/**
 * Saving a course's important dates (/api/dates in vite.config.ts → semesters/<sem>/_meta/dates.json).
 * The list itself comes with the semester data, which rebuilds after each change.
 */
import { refreshData } from "./data";

/** What the form sends: no id adds a date, an id changes that one. */
export interface DateInput { id?: string; code: string; title: string; kind: "exam" | "other"; date: string; time: string; topics: string }

const failed = async (res: Response | null) => (await res?.json().catch(() => null))?.error ?? "Couldn't save that. Is the app running on your computer?";

export async function saveImportantDate(sem: string, d: DateInput): Promise<void> {
  const res = await fetch("/api/dates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sem, ...d }) }).catch(() => null);
  if (!res?.ok) throw new Error(await failed(res));
  window.setTimeout(refreshData, 800);   // in case the file watcher missed it
}

export async function removeImportantDate(sem: string, id: string): Promise<void> {
  const res = await fetch(`/api/dates?sem=${encodeURIComponent(sem)}&id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
  if (!res?.ok) throw new Error(await failed(res));
  window.setTimeout(refreshData, 800);
}
