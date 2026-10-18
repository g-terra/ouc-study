import type { ReactNode } from "react";
import { Link, useRouter, enc } from "../lib/router";
import { useIndex } from "../lib/data";
import { cx } from "./ui";
import { CONN_LABEL, useConnection } from "../lib/connection";

function ConnectionDot({ to }: { to: string }) {
  const c = useConnection();
  const l = CONN_LABEL[c.state];
  const when = c.checkedAt ? new Date(c.checkedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
  const tip = c.state === "connected" ? `Connected to eClass as ${c.user ?? "you"}${when ? ` · checked ${when}` : ""}` : `${l.text}${c.error ? `: ${c.error}` : ""}`;
  return (
    <Link to={to} title={tip} aria-label={tip}
      className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm whitespace-nowrap hover:border-muted">
      <span className="relative flex size-2.5">
        {c.state === "connected" && <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-40" />}
        <span className={cx("relative inline-flex size-2.5 rounded-full", l.dot)} />
      </span>
      <span className={cx("hidden lg:inline", l.tone)}>{c.syncing ? "Syncing…" : c.state === "connected" ? "Connected" : l.text}</span>
    </Link>
  );
}

const NAV = [
  ["", "Dashboard"],
  ["timeline", "Timeline"],
  ["courses", "Courses"],
  ["notes", "Notes"],
  ["assignments", "Assignments"],
  ["updates", "Updates"],
] as const;

export function Layout({ sem, children }: { sem: string; children: ReactNode }) {
  const { path, navigate } = useRouter();
  const index = useIndex();
  const base = `/${enc(sem)}`;
  const section = path.split("#")[0].split("/").filter(Boolean)[1] ?? "";
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link to={base} className="mr-1 flex items-center gap-2 font-serif text-lg font-semibold tracking-tight">
            <span className="grid size-8 place-items-center rounded-lg bg-ink text-sm text-bg">OU</span>
            <span className="hidden sm:inline">Study</span>
          </Link>
          <nav className="-mx-1 hidden flex-1 gap-1 overflow-x-auto px-1 sm:flex">
            {NAV.map(([seg, label]) => (
              <Link key={seg} to={seg ? `${base}/${seg}` : base}
                className={cx("whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition",
                  section === seg ? "bg-ink text-bg" : "text-muted hover:bg-surface-2 hover:text-ink")}>
                {label}
              </Link>
            ))}
          </nav>
          <span className="flex-1 sm:hidden" />
          <ConnectionDot to={`${base}/updates`} />
          <select aria-label="Semester" value={sem} onChange={(e) => navigate(`/${enc(e.target.value)}`)}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm">
            {index.semesters.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-28 pt-8">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        {NAV.map(([seg, label], i) => (
          <Link key={seg} to={seg ? `${base}/${seg}` : base}
            className={cx("flex flex-col items-center gap-0.5 py-2 text-[10px]", section === seg ? "font-semibold text-ink" : "text-muted")}>
            <span className="text-lg leading-none">{["🏠", "🗓️", "📚", "📒", "📝", "🔔"][i]}</span>{label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
