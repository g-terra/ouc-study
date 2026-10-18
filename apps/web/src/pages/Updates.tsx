import { useState, type ReactNode } from "react";
import type { SemesterData, UpdateItem, UpdateType } from "@ouc/content/types";
import { courseMap } from "../lib/data";
import { day, fmtFull, relative } from "../lib/dates";
import { Card, CourseBadge, Empty, PageHeader, cx } from "../components/ui";
import { CONN_LABEL, refreshConnection, syncNow, useConnection } from "../lib/connection";

export const UPDATE_META: Record<UpdateType, { icon: string; label: string; tone: string }> = {
  grade: { icon: "🏅", label: "Grades", tone: "bg-ok-bg text-ok" },
  feedback: { icon: "💬", label: "Feedback", tone: "bg-ok-bg text-ok" },
  submission: { icon: "📤", label: "Submissions", tone: "bg-surface-2 text-muted" },
  assignment: { icon: "📝", label: "New assignments", tone: "bg-info-bg text-info" },
  deadline: { icon: "⏰", label: "Deadline changes", tone: "bg-warn-bg text-warn" },
  material: { icon: "📄", label: "Materials", tone: "bg-info-bg text-info" },
  announcement: { icon: "📣", label: "Announcements", tone: "bg-warn-bg text-warn" },
  forum: { icon: "🗨️", label: "Forum", tone: "bg-surface-2 text-muted" },
  notification: { icon: "🔔", label: "Notifications", tone: "bg-surface-2 text-muted" },
  event: { icon: "📅", label: "Events", tone: "bg-info-bg text-info" },
  baseline: { icon: "✨", label: "Setup", tone: "bg-surface-2 text-muted" },
};
export const ORDER: UpdateType[] = ["grade", "feedback", "announcement", "deadline", "assignment", "material", "event", "submission", "forum", "notification", "baseline"];

export function SyncStatus({ data }: { data: SemesterData }) {
  const s = data.updates.status;
  if (!s) return <span>Daily sync not set up yet</span>;
  if (!s.ok) return <span className="text-bad">⚠️ Last sync failed: {s.error}</span>;
  return <span>✓ Checked eClass {relative(new Date(s.lastRun))}</span>;
}

export function UpdateRow({ u, data, compact }: { u: UpdateItem; data: SemesterData; compact?: boolean }) {
  const C = courseMap(data);
  const m = UPDATE_META[u.type] ?? UPDATE_META.notification;
  const body = (
    <div className={cx("flex gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition", u.url && "hover:border-muted", (u.type === "grade" || u.type === "feedback") && "border-ok/40")}>
      <span className={cx("grid size-9 shrink-0 place-items-center rounded-lg text-lg", m.tone)}>{m.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold leading-snug">{u.title}</span>
          {C[u.code] && <CourseBadge course={C[u.code]} />}
        </div>
        {u.detail && <div className={cx("mt-0.5 text-sm text-muted", compact && "line-clamp-1")}>{u.detail}</div>}
      </div>
      {u.url && <span className="self-center text-muted">↗</span>}
    </div>
  );
  return u.url ? <a href={u.url} target="_blank" rel="noreferrer">{body}</a> : body;
}

export function UpdatesPage({ data }: { data: SemesterData }) {
  const [type, setType] = useState<UpdateType | "all">("all");
  const days = data.updates.days;
  const counts = days.flatMap((d) => d.items).reduce<Record<string, number>>((m, i) => ((m[i.type] = (m[i.type] ?? 0) + 1), m), {});
  const s = data.updates.status;
  return (
    <>
      <PageHeader title="Daily updates" eyebrow={data.label}>
        What changed on eClass each day: grades, feedback, new materials, deadline changes and announcements. <SyncStatus data={data} />.
      </PageHeader>

      <ConnectionCard />
      {(!s || !s.ok) && <SetupCard error={s?.error} />}

      {days.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          <Chip on={type === "all"} onClick={() => setType("all")}>All</Chip>
          {ORDER.filter((t) => counts[t]).map((t) => (
            <Chip key={t} on={type === t} onClick={() => setType(t)}>{UPDATE_META[t].icon} {UPDATE_META[t].label} <span className="opacity-60">{counts[t]}</span></Chip>
          ))}
        </div>
      )}

      {days.length === 0 && s?.ok && <Empty>No changes found yet. The next check runs tomorrow morning (or whenever you start the app).</Empty>}

      <div className="space-y-8">
        {days.map((d) => {
          const items = d.items.filter((i) => type === "all" || i.type === type)
            .sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
          if (!items.length) return null;
          return (
            <section key={d.date}>
              <h2 className="mb-3 font-serif text-xl font-semibold">
                {day(d.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
                <span className="ml-2 font-sans text-sm font-normal text-muted">{items.length} update{items.length > 1 ? "s" : ""}</span>
              </h2>
              <div className="grid gap-2">{items.map((u, i) => <UpdateRow key={i} u={u} data={data} />)}</div>
            </section>
          );
        })}
      </div>
      {s?.lastRun && <p className="mt-10 text-xs text-muted">Last run {fmtFull(new Date(s.lastRun))}{s.warnings?.length ? ` · ${s.warnings.length} parts skipped` : ""}.</p>}
    </>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} className={cx("flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm", on ? "border-ink bg-ink text-bg" : "border-line bg-surface text-muted")}>{children}</button>;
}

function SetupCard({ error }: { error?: string }) {
  return (
    <Card className="mb-8 p-5">
      <div className="mb-2 font-semibold">🔑 Set up daily updates</div>
      {error && <p className="mb-3 rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p>}
      <p className="text-sm leading-6">Open Terminal in this folder and run <code>ouc setup</code> (or double-click <b>Install OUC Study.command</b>). It walks you through creating your personal eClass key, tests it, and saves it safely.</p>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-muted">
        <li>The key comes from <a className="underline" href="https://eclass.ouc.ac.cy/user/managetoken.php" target="_blank" rel="noreferrer">eClass → Preferences → Security keys</a>, row <b>Moodle mobile web service</b>.</li>
        <li>No such row? Install the <b>Moodle</b> app on your phone and sign in to <code>eclass.ouc.ac.cy</code> once (Office365 Login).</li>
      </ol>
    </Card>
  );
}

function ConnectionCard() {
  const c = useConnection();
  const [msg, setMsg] = useState<string>();
  const l = CONN_LABEL[c.state];
  const canSync = c.state === "connected" || c.state === "offline" || c.state === "error";
  const run = async () => {
    setMsg(undefined);
    const r = await syncNow();
    if (r.ok) { setMsg(r.found ? `Found ${r.found} new update${r.found > 1 ? "s" : ""}. Refreshing…` : "All up to date. Nothing new on eClass."); if (r.found) setTimeout(() => window.location.reload(), 900); }
    else setMsg(r.error ?? "Sync failed.");
  };
  return (
    <Card className="mb-6 flex flex-wrap items-center gap-4 p-4">
      <span className={cx("grid size-10 place-items-center rounded-xl text-lg", c.state === "connected" ? "bg-ok-bg" : c.state === "offline" ? "bg-warn-bg" : c.state === "checking" || c.state === "nokey" || c.state === "unavailable" ? "bg-surface-2" : "bg-bad-bg")}>
        {c.state === "connected" ? "🟢" : c.state === "offline" ? "🟠" : c.state === "checking" ? "⏳" : c.state === "nokey" || c.state === "unavailable" ? "⚪" : "🔴"}
      </span>
      <div className="min-w-0 flex-1">
        <div className={cx("font-semibold", l.tone)}>{c.syncing ? "Syncing with eClass…" : l.text}</div>
        <div className="text-sm text-muted">
          {c.state === "connected" ? <>Signed in as <b className="text-ink">{c.user}</b>{c.checkedAt && <> · checked {new Date(c.checkedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</>}</>
            : c.state === "unavailable" ? <>Start the app with <code>ouc start</code> or <code>npm run dev</code> to see the live status.</>
            : c.error ?? "Checking…"}
        </div>
        {msg && <div className="mt-1 text-sm">{msg}</div>}
      </div>
      <div className="flex gap-2">
        <button onClick={() => refreshConnection(true)} className="rounded-full border border-line px-3 py-1.5 text-sm text-muted hover:text-ink">Re-check</button>
        <button onClick={run} disabled={!canSync || c.syncing}
          className="rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-bg disabled:opacity-40">{c.syncing ? "Syncing…" : "Sync now"}</button>
      </div>
    </Card>
  );
}
