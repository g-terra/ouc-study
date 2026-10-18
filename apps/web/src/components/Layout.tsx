import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useRouter, enc } from "../lib/router";
import { useIndex, useSemester } from "../lib/data";
import { cx } from "./ui";
import { CONN_LABEL, useConnection } from "../lib/connection";
import { TOOL_STATE, refreshAi, useAiStatus, usePrepStatus, workLabel } from "../lib/ai";
import { useAssistant } from "./Assistant";

/** Footer status: eClass and the AI coding tool in one dot; click for the details. */
function ConnectionDot({ to }: { to: string }) {
  const c = useConnection();
  const ai = useAiStatus();
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
  const l = CONN_LABEL[c.state];
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "");
  const eclassOk = c.state === "connected";
  const aiKnown = ai.state === "ok";
  const aiOk = aiKnown && !!ai.ready;
  // green: everything works · amber: one of them needs attention · grey: still checking / not set up
  const dot = c.state === "checking" || ai.state === "checking" ? "bg-muted animate-pulse"
    : (eclassOk || c.state === "nokey" || c.state === "unavailable") && (aiOk || !aiKnown || !ai.chosen) ? (eclassOk || aiOk ? "bg-ok" : "bg-muted") : "bg-warn";
  const word = c.syncing ? "Syncing…" : eclassOk && aiOk ? "Connected" : eclassOk ? (aiKnown && ai.chosen ? "AI not ready" : "Connected") : l.text;
  const tip = `${eclassOk ? `eClass: ${c.user ?? "connected"}` : l.text}${aiKnown ? ` · AI: ${aiOk ? ai.label : ai.reason || "not set up"}` : ""}`;
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => { setOpen(!open); if (!open) refreshAi(); }} title={tip} aria-label={tip} aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm whitespace-nowrap hover:border-muted">
        <span className="relative flex size-2.5">
          {eclassOk && aiOk && <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-40" />}
          <span className={cx("relative inline-flex size-2.5 rounded-full", dot)} />
        </span>
        <span className={cx(eclassOk && (aiOk || !aiKnown) ? "text-ok" : l.tone)}>{word}</span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-2 w-80 rounded-2xl border border-line bg-surface p-3 text-sm shadow-xl">
          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted">eClass</div>
          <Link to={to} onClick={() => setOpen(false)} className="mb-3 flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2">
            <span className={cx("size-2 shrink-0 rounded-full", l.dot)} />
            <span className="min-w-0 flex-1 truncate">{eclassOk ? `Connected as ${c.user ?? "you"}` : l.text}</span>
            <span className="text-xs text-muted">{when(c.checkedAt)}</span>
          </Link>
          <div className="mb-1 flex items-center text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            <span className="flex-1">AI coding tools</span>
            {aiKnown && <button type="button" className="normal-case tracking-normal text-muted underline hover:text-ink" onClick={() => refreshAi(true)}>Check again</button>}
          </div>
          {ai.state === "checking" && <p className="px-2 py-1.5 text-muted">Checking…</p>}
          {ai.state === "unavailable" && <p className="px-2 py-1.5 text-muted">Only shown when the app runs on your computer (npm run dev or ouc open).</p>}
          {aiKnown && (
            <ul className="flex flex-col">
              {ai.tools.map((t) => (
                <li key={t.id} className={cx("rounded-lg px-2 py-1.5", t.chosen && "bg-surface-2")}>
                  <div className="flex items-center gap-2">
                    <span className={cx("size-2 shrink-0 rounded-full", TOOL_STATE[t.state].dot)} />
                    <span className="flex-1 font-semibold">{t.label}{t.chosen && <span className="ml-1.5 text-xs font-normal text-muted">in use</span>}</span>
                    <span className="text-xs text-muted">{TOOL_STATE[t.state].text}</span>
                  </div>
                  {(t.detail || t.fix) && t.state !== "missing" && <div className="ml-4 text-xs text-muted">{t.detail}</div>}
                  {t.fix && t.state !== "connected" && <code className="ml-4 mt-0.5 block truncate text-[11px] text-muted" title={t.fix}>{t.fix}</code>}
                </li>
              ))}
            </ul>
          )}
          {aiKnown && !ai.chosen && <p className="mt-2 px-2 text-xs text-muted">Choose one in Terminal: <code>ouc ai setup</code></p>}
        </div>
      )}
    </div>
  );
}

/** Ask AI: a round robot button at the bottom right; it opens the chat as a popup over the page. */
function AskAiFab() {
  const { open, setOpen, sessions } = useAssistant();
  const busy = sessions.some((x) => x.busy);
  const ai = useAiStatus();
  if (ai.state === "unavailable") return null;
  return (
    <button type="button" data-ask-ai onClick={() => setOpen(!open)} aria-pressed={open} aria-label={open ? "Close Ask AI" : "Ask AI"} title="Ask AI"
      className={cx("fixed bottom-20 right-4 z-40 flex items-center gap-2 rounded-full bg-ink py-3 pl-3.5 pr-4 text-sm font-semibold text-bg shadow-xl transition hover:scale-105 sm:bottom-6 sm:right-6",
        open && "max-sm:hidden")}>
      <span aria-hidden className={cx("text-xl leading-none", busy && "animate-pulse")}>{open ? "✕" : "🤖"}</span>
      <span>{open ? "Close" : "Ask AI"}</span>
      {busy && !open && <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-bg bg-accent" />}
    </button>
  );
}

/** While the AI makes missing notes and prep packs in the background: a progress bar and what's running. */
function AiWorkBar({ sem }: { sem: string }) {
  const st = usePrepStatus();
  const data = useSemester(sem);
  const { load, setOpen } = useAssistant();
  if (!st?.busy || !st.total) return st?.error && !st.busy && st.total ? (
    <div className="border-t border-line bg-bad-bg px-4 py-1.5 text-center text-xs text-bad">The AI stopped making notes and prep packs: {st.error}</div>
  ) : null;
  const label = (id: string) => workLabel(id, data);
  const pct = Math.round((st.done / st.total) * 100);
  return (
    <div className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs">
        <span className="font-semibold">✨ AI is making notes and prep packs</span>
        <span className="text-muted">{st.done} of {st.total} done{st.queue.length ? ` · ${st.queue.length} waiting` : ""}</span>
        <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {st.running.map((r) => (
            <button key={r.id} type="button" data-ask-ai onClick={() => { setOpen(true); load(r.chatId); }} title="Watch it work"
              className="flex max-w-[16rem] items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 hover:border-muted">
              <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" /><span className="truncate">{label(r.id)}</span>
            </button>
          ))}
        </span>
        <a href={`/${enc(sem)}/ai-work`} target="_blank" rel="noreferrer" title="See everything it's doing in a new window"
          className="rounded-full border border-line bg-surface px-2.5 py-0.5 font-semibold hover:border-muted">Open ↗</a>
      </div>
      <div className="h-1 bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="AI progress">
        <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(pct, 3)}%` }} />
      </div>
    </div>
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
    <div className="flex min-h-screen flex-col">
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
          <select aria-label="Semester" value={sem} onChange={(e) => navigate(`/${enc(e.target.value)}`)}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm">
            {index.semesters.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <AiWorkBar sem={sem} />
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-12 pt-8">{children}</main>
      <footer className="border-t border-line pb-20 sm:pb-0">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 text-xs text-muted">
          <ConnectionDot to={`${base}/updates`} />
          <Link to={`${base}/ai-work`} className="hover:text-ink">AI background work</Link>
        </div>
      </footer>
      <AskAiFab />
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
