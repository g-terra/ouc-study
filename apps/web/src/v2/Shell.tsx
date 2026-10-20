import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SemesterData } from "@ouc/content/types";
import { Link, enc, useRouter } from "../lib/router";
import { useIndex } from "../lib/data";
import { refreshAi } from "../lib/ai";
import { cx } from "../components/ui";
import { AiWorkBar, AppVersion, AskAiFab, ConnectionDetails, ThemePicker, UpdateBar, VideoTranscripts, useConnectionSummary } from "../components/Layout";
import { toClassic, v2Section } from "./paths";
import { rememberLook } from "./look";
import { unreadCount, useInboxVersion } from "./Inbox";


const NAV = [
  ["", "Today", "☀️"],
  ["courses", "Courses", "📚"],
  ["calendar", "Calendar", "🗓️"],
  ["inbox", "Inbox", "🔔"],
] as const;

/** Settings, connection status, theme, version and the switch back to the classic look: one menu in the header. */
function Menu({ sem }: { sem: string }) {
  const { dot, word } = useConnectionSummary();
  const { path, navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const head = "mt-4 mb-1 border-t border-line px-2 pt-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted";
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => { setOpen(!open); if (!open) refreshAi(); }} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`Settings · ${word}`} title={`Settings · ${word}`}
        className="relative grid size-9 place-items-center rounded-full border border-line bg-surface text-lg hover:border-muted">
        <span aria-hidden>⚙️</span>
        <span className={cx("absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-bg", dot)} />
      </button>
      {open && (
        <div role="dialog" aria-label="Settings"
          className="absolute right-0 top-full z-50 mt-2 max-h-[calc(100vh-6rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-line bg-surface p-3 text-sm shadow-xl">
          <div className="mb-2 px-2 font-serif text-lg font-semibold">Settings</div>
          <ConnectionDetails to={`/${enc(sem)}/updates`} onNavigate={() => setOpen(false)} />
          <div className={head}>Colour theme</div>
          <ThemePicker />
          <VideoTranscripts head={head} />
          <div className={head}>App version</div>
          <AppVersion />
          <div className={head}>Look</div>
          <div className="space-y-1 px-2">
            <p className="text-muted">You're trying the new, simpler look.</p>
            <button type="button" className="font-semibold underline" onClick={() => { rememberLook("classic"); navigate(toClassic(path), { raw: true }); }}>
              Back to the classic look
            </button>
          </div>
          <div className={head}>More</div>
          <Link to={`/${enc(sem)}/ai-work`} onClick={() => setOpen(false)} className="block rounded-lg px-2 py-1.5 hover:bg-surface-2">✨ AI background work</Link>
        </div>
      )}
    </div>
  );
}

/** The v2 frame: four places (Today, Courses, Calendar, Inbox), settings in one header menu, Ask AI bottom right. */
export function Shell({ sem, data, children }: { sem: string; data?: SemesterData | null; children: ReactNode }) {
  const { path, navigate } = useRouter();
  const index = useIndex();
  const base = `/v2/${enc(sem)}`;
  const section = v2Section(path);
  useInboxVersion();
  const unread = data ? unreadCount(data) : 0;
  useEffect(() => { rememberLook("v2"); }, []);
  const label = (seg: string, text: string) => seg === "inbox" && unread > 0
    ? <>{text}<span className="ml-1.5 rounded-full bg-accent px-1.5 text-[11px] font-semibold text-bg" aria-label={`${unread} new`}>{unread}</span></>
    : text;
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
                {label(seg, text)}
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
          <Menu sem={sem} />
        </div>
        <UpdateBar />
        <AiWorkBar sem={sem} />
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-6 sm:pt-8">{children}</main>
      <AskAiFab />
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        {NAV.map(([seg, text, icon]) => (
          <Link key={seg} to={seg ? `${base}/${seg}` : base} aria-current={section === seg ? "page" : undefined}
            className={cx("relative flex flex-col items-center gap-0.5 py-2 text-[11px]", section === seg ? "font-semibold text-ink" : "text-muted")}>
            <span className="text-lg leading-none">{icon}</span>{text}
            {seg === "inbox" && unread > 0 && <span className="absolute right-[30%] top-1 size-2 rounded-full bg-accent" />}
          </Link>
        ))}
      </nav>
    </div>
  );
}
