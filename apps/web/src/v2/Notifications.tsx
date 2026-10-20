import { useEffect, useState } from "react";
import type { SemesterData, UpdateItem } from "@ouc/content/types";
import { Link, enc } from "../lib/router";
import { Empty, PageHeader, cx } from "../components/ui";
import { ORDER, SetupCard, SyncStatus, UpdateRow, UpdatesList, useSync } from "../pages/Updates";
import { PANEL, usePopover } from "./popover";
import { Bell } from "../components/icons";

// The newest update day already seen, per semester (this browser only): newer days count as new.
// (The key keeps its old name so what was read in the Inbox stays read.)
const key = (sem: string) => `ouc-inbox-seen:${sem}`;
const listeners = new Set<() => void>();
const seen = (sem: string) => { try { return localStorage.getItem(key(sem)) ?? ""; } catch { return ""; } };

/** Updates from days after the last look, newest day first. */
export function unreadItems(data: SemesterData): UpdateItem[] {
  const last = seen(data.id);
  return data.updates.days.filter((d) => d.date > last).flatMap((d) => d.items);
}
export const unreadCount = (data: SemesterData) => unreadItems(data).length;

/** Everything up to the newest update day counts as read. */
export function markRead(data: SemesterData) {
  const newest = data.updates.days[0]?.date;
  if (!newest || seen(data.id) >= newest) return;
  try { localStorage.setItem(key(data.id), newest); } catch {}
  listeners.forEach((l) => l());
}

/** Re-renders when the notifications are marked as read. */
export function useNotificationsVersion() {
  const [, set] = useState(0);
  useEffect(() => { const l = () => set((v) => v + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
}

/** When eClass was last checked, and Sync now (it used to sit on the Inbox page). */
export function SyncLine({ data, className }: { data: SemesterData; className?: string }) {
  const { c, msg, canSync, run } = useSync();
  return (
    <div className={cx("text-sm text-muted", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1">{c.syncing ? "Syncing with eClass…" : <SyncStatus data={data} />}</span>
        <button type="button" onClick={run} disabled={!canSync || c.syncing}
          title={canSync ? "Check eClass for news and download new files" : "eClass isn't connected: see Settings"}
          className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-bg disabled:opacity-40">{c.syncing ? "Syncing…" : "Sync now"}</button>
      </div>
      {msg && <p className="mt-1 text-ink">{msg}</p>}
    </div>
  );
}

const MAX = 8;
const id = (u: UpdateItem) => `${u.type}|${u.title}|${u.detail}`;

/** The bell in the header: a count of what's new, and a drop-down of the latest updates. Opening it marks them read. */
export function NotificationsBell({ data }: { data?: SemesterData | null }) {
  const { open, setOpen, box } = usePopover();
  const [fresh, setFresh] = useState<UpdateItem[]>([]);   // what was new when the drop-down opened
  useNotificationsVersion();
  const unread = data ? unreadCount(data) : 0;
  const toggle = () => {
    if (!open && data) { setFresh(unreadItems(data)); markRead(data); }
    setOpen(!open);
  };
  const byType = (a: UpdateItem, b: UpdateItem) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type);
  // by content, not identity: a sync re-reads the data while the drop-down is open
  const isNew = new Set(fresh.map(id));
  const rest = data ? data.updates.days.flatMap((d) => d.items).filter((i) => !isNew.has(id(i))) : [];
  const items = [...[...fresh].sort(byType), ...rest].slice(0, MAX);
  const all = data ? `/v2/${enc(data.id)}/notifications` : "";
  return (
    <div ref={box} className="relative" data-tour="bell">
      <button type="button" onClick={toggle} aria-haspopup="dialog" aria-expanded={open}
        aria-label={unread ? `Notifications · ${unread} new` : "Notifications"} title="Notifications"
        className="relative grid size-9 place-items-center rounded-full border border-line bg-surface text-lg hover:border-muted">
        <Bell aria-hidden className="size-[18px]" />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full border-2 border-bg bg-accent px-1 text-center text-[10px] font-semibold leading-4 text-bg">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && data && (
        <div role="dialog" aria-label="Notifications" className={cx(PANEL, "w-[min(26rem,calc(100vw-2rem))]")}>
          <div className="mb-1 flex items-baseline gap-2 px-1">
            <span className="flex-1 font-serif text-lg font-semibold">Notifications</span>
            {fresh.length > 0 && <span className="text-xs text-muted">{fresh.length} new</span>}
          </div>
          <SyncLine data={data} className="mb-3 border-b border-line px-1 pb-3" />
          {items.length ? (
            <div className="grid gap-2">
              {items.map((u, i) => (
                <div key={i} className="relative">
                  {isNew.has(id(u)) && <span className="absolute -left-1 top-4 z-10 size-2 rounded-full bg-accent" aria-label="New" />}
                  <UpdateRow u={u} data={data} compact />
                </div>
              ))}
            </div>
          ) : <p className="px-1 py-4 text-center text-muted">Nothing from eClass yet.</p>}
          <Link to={all} onClick={() => setOpen(false)} className="mt-3 block rounded-lg px-2 py-2 text-center font-semibold hover:bg-surface-2">
            See all notifications →
          </Link>
        </div>
      )}
    </div>
  );
}

/** The bell's full page: every update day by day, whole messages, the type filters and Sync now. Opening it marks everything read. */
export function NotificationsPage({ data }: { data: SemesterData }) {
  useEffect(() => markRead(data), [data]);
  const s = data.updates.status;
  return (
    <>
      <PageHeader title="Notifications" eyebrow={data.label}>
        What changed on eClass each day: grades, feedback, new materials, deadline changes, announcements and forum posts in full.
      </PageHeader>
      <SyncLine data={data} className="mb-6 rounded-xl border border-line bg-surface px-4 py-3" />
      {(!s || !s.ok) && <SetupCard error={s?.error} />}
      {data.updates.days.length === 0 && s?.ok && <Empty>No changes found yet. The next check runs tomorrow morning (or whenever you start the app).</Empty>}
      <UpdatesList data={data} />
    </>
  );
}
