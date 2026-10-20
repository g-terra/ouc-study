import { useEffect, type ReactNode } from "react";
import type { SemesterData } from "@ouc/content/types";
import { Link, enc, useRouter } from "../lib/router";
import { useIndex } from "../lib/data";
import { refreshAi } from "../lib/ai";
import { cx } from "../components/ui";
import { AiWorkBar, AskAiFab, UpdateBar, useConnectionSummary } from "../components/Layout";
import { v2Section } from "./paths";
import { rememberLook } from "./look";
import { NotificationsBell } from "./Notifications";
import { PANEL, usePopover } from "./popover";

const NAV = [
  ["", "Today", "☀️"],
  ["courses", "Courses", "📚"],
  ["calendar", "Calendar", "🗓️"],
] as const;

const initials = (name?: string) => (name ?? "").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

/** The profile circle: who is signed in to eClass and whether eClass and the AI tools work, then Settings and the other pages. */
function ProfileMenu({ sem }: { sem: string }) {
  const { c, dot, word, eclassOk, l } = useConnectionSummary();
  const { open, setOpen, box } = usePopover();
  const base = `/v2/${enc(sem)}`;
  const name = eclassOk ? c.user : undefined;
  const item = "flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-surface-2";
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => { setOpen(!open); if (!open) refreshAi(); }} aria-haspopup="menu" aria-expanded={open}
        aria-label={`Profile · ${word}`} title={`${name ?? "Profile"} · ${word}`}
        className="relative grid size-9 place-items-center rounded-full bg-ink text-xs font-semibold text-bg hover:opacity-90">
        {initials(name) || <span aria-hidden className="text-base">👤</span>}
        <span className={cx("absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-bg", dot)} />
      </button>
      {open && (
        <div role="menu" aria-label="Profile" className={cx(PANEL, "w-[min(17rem,calc(100vw-2rem))]")}>
          <div className="mb-2 border-b border-line px-2 pb-3">
            <div className="truncate font-semibold">{name ?? "OUC Study"}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
              <span className={cx("size-2 shrink-0 rounded-full", dot)} />
              {eclassOk ? word : l.text}
            </div>
          </div>
          <Link role="menuitem" to={`${base}/settings`} onClick={() => setOpen(false)} className={item}><span aria-hidden>⚙️</span>Settings</Link>
          <Link role="menuitem" to={`${base}/ai-work`} onClick={() => setOpen(false)} className={item}><span aria-hidden>✨</span>AI background work</Link>
          <Link role="menuitem" to={`${base}/chat`} onClick={() => setOpen(false)} className={item}><span aria-hidden>💬</span>Ask AI chats</Link>
        </div>
      )}
    </div>
  );
}

/** The v2 frame: three places (Today, Courses, Calendar), the notifications bell and the profile menu top right, Ask AI bottom right. */
export function Shell({ sem, data, children }: { sem: string; data?: SemesterData | null; children: ReactNode }) {
  const { path, navigate } = useRouter();
  const index = useIndex();
  const base = `/v2/${enc(sem)}`;
  const section = v2Section(path);
  useEffect(() => { rememberLook("v2"); }, []);
  return (
    <div className="flex min-h-screen flex-col" data-look="v2">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
          <Link to={base} className="mr-2 flex items-center gap-2 font-serif text-lg font-semibold tracking-tight">
            <span className="grid size-8 place-items-center rounded-lg bg-ink text-sm text-bg">OU</span>
            <span className="hidden sm:inline">Study</span>
          </Link>
          <nav aria-label="Main" className="hidden flex-1 gap-1 sm:flex">
            {NAV.map(([seg, text]) => (
              <Link key={seg} to={seg ? `${base}/${seg}` : base} aria-current={section === seg ? "page" : undefined}
                className={cx("flex items-center whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm transition",
                  section === seg ? "bg-ink text-bg" : "text-muted hover:bg-surface-2 hover:text-ink")}>
                {text}
              </Link>
            ))}
          </nav>
          <span className="flex-1 sm:hidden" />
          {index.semesters.length > 1 && (
            <select aria-label="Semester" value={sem} onChange={(e) => navigate(`${"/v2"}/${enc(e.target.value)}`, { raw: true })}
              className="max-w-[10rem] rounded-full border border-line bg-surface px-3 py-1.5 text-sm">
              {index.semesters.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          )}
          <NotificationsBell data={data} />
          <ProfileMenu sem={sem} />
        </div>
        <UpdateBar />
        <AiWorkBar sem={sem} />
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-6 sm:pt-8">{children}</main>
      <AskAiFab />
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        {NAV.map(([seg, text, icon]) => (
          <Link key={seg} to={seg ? `${base}/${seg}` : base} aria-current={section === seg ? "page" : undefined}
            className={cx("relative flex flex-col items-center gap-0.5 py-2 text-[11px]", section === seg ? "font-semibold text-ink" : "text-muted")}>
            <span className="text-lg leading-none">{icon}</span>{text}
          </Link>
        ))}
      </nav>
    </div>
  );
}
