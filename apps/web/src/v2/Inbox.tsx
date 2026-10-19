import { useEffect, useState } from "react";
import type { SemesterData, UpdateItem } from "@ouc/content/types";
import { UpdatesPage } from "../pages/Updates";

// The newest update day already seen in the Inbox, per semester (this browser only): newer days count as new.
const key = (sem: string) => `ouc-inbox-seen:${sem}`;
const listeners = new Set<() => void>();
const seen = (sem: string) => { try { return localStorage.getItem(key(sem)) ?? ""; } catch { return ""; } };

/** Updates from days after the last Inbox visit, newest day first. */
export function unreadItems(data: SemesterData): UpdateItem[] {
  const last = seen(data.id);
  return data.updates.days.filter((d) => d.date > last).flatMap((d) => d.items);
}
export const unreadCount = (data: SemesterData) => unreadItems(data).length;

/** Re-renders when the Inbox is marked as read. */
export function useInboxVersion() {
  const [, set] = useState(0);
  useEffect(() => { const l = () => set((v) => v + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
}

/** The Inbox is the classic Daily updates page; opening it marks everything as read. */
export function Inbox({ data }: { data: SemesterData }) {
  useEffect(() => {
    const newest = data.updates.days[0]?.date;
    if (!newest) return;
    try { localStorage.setItem(key(data.id), newest); } catch {}
    listeners.forEach((l) => l());
  }, [data]);
  return <UpdatesPage data={data} />;
}
