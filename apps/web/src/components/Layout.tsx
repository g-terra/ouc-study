import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, linkHref, useRouter, enc } from "../lib/router";
import { useIndex, useSemester } from "../lib/data";
import { cx } from "./ui";
import { CONN_LABEL, useConnection } from "../lib/connection";
import { TOOL_STATE, getWhisper, refreshAi, setDefaultModel, setWhisper, useAiStatus, usePrepStatus, workLabel, type WhisperStatus } from "../lib/ai";
import { useAssistant } from "./Assistant";
import { THEMES, setTheme, useTheme, type ThemeChoice } from "../lib/theme";
import { releaseHighlights, useUpdate } from "../lib/update";
import { rememberLook } from "../v2/look";
import { toV2 } from "../v2/paths";
import { isChatPath } from "../lib/chat-path";
import { Bot, Headphones, RefreshCw, Sparkles, X } from "./icons";

/** eClass and the AI coding tools: one summary dot, plus the details shown in Settings. */
export function useConnectionSummary() {
  const c = useConnection();
  const ai = useAiStatus();
  const l = CONN_LABEL[c.state];
  const eclassOk = c.state === "connected";
  const aiKnown = ai.state === "ok";
  const aiOk = aiKnown && !!ai.ready;
  // green: everything works · amber: one of them needs attention · grey: still checking / not set up
  const dot = c.state === "checking" || ai.state === "checking" ? "bg-muted animate-pulse"
    : (eclassOk || c.state === "nokey" || c.state === "unavailable") && (aiOk || !aiKnown || !ai.chosen) ? (eclassOk || aiOk ? "bg-ok" : "bg-muted") : "bg-warn";
  const word = c.syncing ? "Syncing…" : eclassOk && aiOk ? "Connected" : eclassOk ? (aiKnown && ai.chosen ? "AI not ready" : "Connected") : l.text;
  return { c, ai, l, eclassOk, aiKnown, dot, word };
}

/** Claude Code, Codex and opencode: installed, signed in, which one is in use. */
export function AiTools() {
  const { ai, aiKnown } = useConnectionSummary();
  return (
    <>
      <div className="mb-1 flex items-center px-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
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
    </>
  );
}

/** Settings: the model each AI uses unless a chat picks another (saved in .ouc/ai.json). */
export function DefaultModels({ className }: { className?: string }) {
  const ai = useAiStatus();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tools = ai.tools.filter((t) => t.state !== "missing" && t.models?.length);
  if (ai.state !== "ok" || !tools.length) return null;
  const save = async (tool: string, model: string) => {
    setSaving(tool); setError(null);
    setError(await setDefaultModel(tool, model));
    setSaving(null);
  };
  return (
    <div className={className} data-testid="default-models">
      <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Default models</div>
      <p className="mb-2 px-2 text-xs text-muted">What each AI uses unless you pick another model next to Send.</p>
      <ul className="flex flex-col">
        {tools.map((t) => (
          <li key={t.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
            <label htmlFor={`default-model-${t.id}`} className="flex-1 font-semibold">{t.label}</label>
            <select id={`default-model-${t.id}`} value={t.setting ?? ""} disabled={saving === t.id} onChange={(e) => save(t.id, e.target.value)}
              className="min-w-0 max-w-[14rem] truncate rounded-lg border border-line bg-surface py-1 pl-2 pr-1 text-xs disabled:opacity-60">
              <option value="">{t.own ? `${t.label}'s own (${t.own})` : `${t.label}'s own`}</option>
              {t.models!.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-1 px-2 text-xs text-warn">{error}</p>}
    </div>
  );
}

export function ConnectionDetails({ to, onNavigate }: { to: string; onNavigate: () => void }) {
  const { c, l, eclassOk } = useConnectionSummary();
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "");
  return (
    <>
      <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">eClass</div>
      <Link to={to} onClick={onNavigate} className="mb-3 flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2">
        <span className={cx("size-2 shrink-0 rounded-full", l.dot)} />
        <span className="min-w-0 flex-1 truncate">{eclassOk ? `Connected as ${c.user ?? "you"}` : l.text}</span>
        <span className="text-xs text-muted">{when(c.checkedAt)}</span>
      </Link>
      <AiTools />
    </>
  );
}

/** Three dots in a theme's background, text and accent colours. */
function Swatch({ colors }: { colors: readonly string[] }) {
  return (
    <span aria-hidden className="flex size-5 shrink-0 overflow-hidden rounded-full border border-line">
      {colors.map((c, i) => <span key={i} className="h-full flex-1" style={{ background: c }} />)}
    </span>
  );
}

const SYSTEM_SWATCH = [THEMES[0].swatch[0], THEMES[1].swatch[0]];

/** Colour theme picker: System (follows the computer), Light, Dark and a few extras; remembered in this browser. */
export function ThemePicker() {
  const { choice } = useTheme();
  const options: { id: ThemeChoice; label: string; hint?: string; swatch: readonly string[] }[] = [
    { id: "system", label: "System", hint: "Follows your computer", swatch: SYSTEM_SWATCH },
    ...THEMES.map((t) => ({ id: t.id, label: t.label, swatch: t.swatch })),
  ];
  return (
    <div role="radiogroup" aria-label="Colour theme" className="grid grid-cols-2 gap-1">
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={choice === o.id} onClick={() => setTheme(o.id)}
          className={cx("flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ink hover:bg-surface-2", o.hint && "col-span-2", choice === o.id && "bg-surface-2 font-semibold")}>
          <Swatch colors={o.swatch} />
          <span className="flex-1">{o.label}{o.hint && <span className="ml-1.5 text-xs font-normal text-muted">{o.hint}</span>}</span>
          {choice === o.id && <span aria-hidden className="text-accent">✓</span>}
        </button>
      ))}
    </div>
  );
}

/** Settings: a floating gear at the bottom left (mirrors Ask AI on the right) with the connection status and the colour theme. */
function SettingsFab({ to }: { to: string }) {
  const { dot, word } = useConnectionSummary();
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
  return (
    <div ref={box} className="fixed bottom-20 left-4 z-40 sm:bottom-6 sm:left-6">
      <button type="button" onClick={() => { setOpen(!open); if (!open) refreshAi(); }} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`Settings · ${word}`} title={`Settings · ${word}`}
        className="flex items-center gap-2 rounded-full bg-ink py-3 pl-3.5 pr-4 text-sm font-semibold whitespace-nowrap text-bg shadow-xl transition hover:scale-105">
        <span aria-hidden className="relative text-xl leading-none">
          ⚙️
          <span className={cx("absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-ink", dot)} />
        </span>
        <span>Settings</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Settings"
          className="absolute bottom-full left-0 z-50 mb-2 max-h-[calc(100vh-8rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-line bg-surface p-3 text-sm shadow-xl">
          <div className="mb-2 px-2 font-serif text-lg font-semibold">Settings</div>
          <ConnectionDetails to={to} onNavigate={() => setOpen(false)} />
          <DefaultModels className="mt-4 border-t border-line pt-3" />
          <div className="mt-4 mb-1 border-t border-line px-2 pt-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Colour theme</div>
          <ThemePicker />
          <VideoTranscripts head="mt-4 mb-1 border-t border-line px-2 pt-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted" />
          <div className="mt-4 mb-1 border-t border-line px-2 pt-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted">App version</div>
          <AppVersion />
        </div>
      )}
    </div>
  );
}

/**
 * Transcripts of class videos and narrated slides (optional): set Whisper up, or turn them on and off.
 * Hidden when the app runs without its server (nothing to set up then).
 */
export function VideoTranscripts({ head, fallback = null }: { head: string; fallback?: ReactNode }) {
  const [w, setW] = useState<WhisperStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { getWhisper().then(setW); }, []);
  // while installing, check back until it's done
  useEffect(() => {
    if (!w?.installing) return;
    const t = window.setInterval(() => getWhisper().then(setW), 3000);
    return () => window.clearInterval(t);
  }, [w?.installing]);
  if (!w) return <>{fallback}</>;
  const post = async (body: { enabled: boolean } | { setup: true }) => {
    setError(null);
    if ("enabled" in body) setW({ ...w, enabled: body.enabled });   // the switch moves at once
    const r = await setWhisper(body);
    if ("error" in r && !("enabled" in r)) { setError(r.error); getWhisper().then((x) => x && setW(x)); } else setW(r as WhisperStatus);
  };
  const on = w.enabled && !!w.available;
  return (
    <>
      <div className={head}>Video transcripts</div>
      <div className="space-y-2 px-2" data-testid="video-transcripts">
        <p className="text-muted">Optional. Whisper turns class videos and narrated slides into text for your notes, free and on this computer.</p>
        {w.installing ? (
          <p className="flex items-center gap-1.5 font-semibold"><span className="size-1.5 animate-pulse rounded-full bg-accent" />Setting up Whisper… it downloads a speech model once</p>
        ) : w.available ? (
          <label className="flex cursor-pointer items-center justify-between gap-2">
            <span><span className="font-semibold">{on ? "On" : "Off"}</span> <span className="text-xs text-muted">· {w.engine}</span></span>
            <input type="checkbox" role="switch" checked={on} onChange={(e) => post({ enabled: e.target.checked })} aria-label="Make video transcripts" className="size-4 accent-[var(--accent)]" />
          </label>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-sm"><span className="font-semibold">Off</span> <span className="text-muted">· Whisper isn't set up</span></span>
            <button type="button" onClick={() => post({ setup: true })} className="rounded-full bg-ink px-3 py-1 font-semibold text-bg hover:opacity-90">Set up Whisper</button>
            <button type="button" onClick={() => getWhisper(true).then(setW)} className="text-muted underline hover:text-ink">Check again</button>
          </div>
        )}
        {(error ?? w.error) && <p className="text-xs text-bad">{error ?? w.error}</p>}
        {w.error && <p className="text-xs text-muted">By hand: {w.manual}</p>}
      </div>
    </>
  );
}

/** The installed version, the newest release, and the update button when there is one. */
export function AppVersion() {
  const { info, phase, start, check, checking } = useUpdate();
  if (!info) return <p className="px-2 text-muted">Checking…</p>;
  const ahead = !info.available && info.latest && info.current !== info.latest;
  return (
    <div className="space-y-2 px-2" data-testid="app-version">
      <p><span className="font-semibold">v{info.current ?? "?"}</span>{" "}
        <span className="text-muted">
          {info.available ? `· v${info.latest} is available` : ahead ? `· newer than the latest release (v${info.latest})` : info.latest ? "· up to date" : ""}
        </span>
      </p>
      {info.error && <p className="text-xs text-bad">{info.error}</p>}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {info.available && phase === "idle" && (info.canUpdate
          ? <button type="button" onClick={start} className="rounded-full bg-ink px-3 py-1 font-semibold text-bg hover:opacity-90">Update now</button>
          : <span className="text-muted">In Terminal: <code>ouc update</code>, then restart the app</span>)}
        {phase === "updating" && <span className="flex items-center gap-1.5 font-semibold"><span className="size-1.5 animate-pulse rounded-full bg-accent" />Updating… the page reloads when it's done</span>}
        {phase === "slow" && <span className="text-bad">Still not back. In Terminal: <code>ouc status</code></span>}
        {phase === "idle" && (
          <button type="button" onClick={check} disabled={checking} className="rounded-full border border-line px-3 py-1 hover:border-muted disabled:opacity-60">
            {checking ? "Checking…" : "Check for updates"}
          </button>
        )}
        {info.url && <a href={info.url} target="_blank" rel="noreferrer" className="text-muted underline hover:text-ink">Release notes ↗</a>}
      </div>
    </div>
  );
}

/** Ask AI: a round robot button at the bottom right; it opens the chat as a popup over the page. */
export function AskAiFab() {
  const { open, setOpen, sessions } = useAssistant();
  const { path } = useRouter();
  const busy = sessions.some((x) => x.busy);
  const ai = useAiStatus();
  // the full-page chat is already open
  if (ai.state === "unavailable" || isChatPath(path)) return null;
  return (
    <button type="button" data-ask-ai onClick={() => setOpen(!open)} aria-pressed={open} aria-label={open ? "Close Ask AI" : "Ask AI"} title="Ask AI"
      className={cx("fixed bottom-20 right-4 z-40 flex items-center gap-2 rounded-full bg-ink py-3 pl-3.5 pr-4 text-sm font-semibold text-bg shadow-xl transition hover:scale-105 sm:bottom-6 sm:right-6",
        open && "max-sm:hidden")}>
      {open ? <X aria-hidden className="size-5" /> : <Bot aria-hidden className={cx("size-5", busy && "animate-pulse")} />}
      <span>{open ? "Close" : "Ask AI"}</span>
      {busy && !open && <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-bg bg-accent" />}
    </button>
  );
}

const SYNC_STEPS = ["Checking eClass for news", "Downloading new course files", "Building the app data"];

/**
 * Everything running in the background, as one bar: Sync now (its steps and downloads), transcripts of
 * class videos, and the AI making notes and prep packs. One line with a progress bar; Details opens
 * each part (remembered on this computer).
 */
export function AiWorkBar({ sem }: { sem: string }) {
  const st = usePrepStatus();
  const conn = useConnection();
  const data = useSemester(sem);
  const { load, setOpen } = useAssistant();
  const [open, setOpenDetails] = useState(() => { try { return localStorage.getItem("ouc-activity-open") === "1"; } catch { return false; } });
  const toggle = () => { setOpenDetails(!open); try { localStorage.setItem("ouc-activity-open", open ? "0" : "1"); } catch { /* private window */ } };
  const tr = st?.transcribe;
  const syncing = !!conn.syncing, transcribing = !!(tr?.busy && tr.total), ai = !!(st?.busy && st.total);
  if (!syncing && !transcribing && !ai) {
    return st?.error && !st.busy && st.total ? (
      <div className="border-t border-line bg-bad-bg px-4 py-1.5 text-center text-xs text-bad">The AI stopped its background work: {st.error}</div>
    ) : null;
  }
  const label = (id: string) => workLabel(id, data);
  const p = conn.progress;
  const downloading = p?.step === 2 && p.phase === "download" && p.total;
  // the line and the bar follow the first part still running
  const [Icon, title, pct] = syncing
    ? [RefreshCw, `${SYNC_STEPS[(p?.step ?? 1) - 1] ?? "Syncing"}${downloading ? `: ${p.done} of ${p.total}` : "…"}`, downloading ? (p.done! / p.total!) * 100 : ((p?.step ?? 1) - 1) * 33]
    : transcribing ? [Headphones, `Transcribing class videos: ${tr!.done} of ${tr!.total}`, (tr!.done / tr!.total) * 100]
    : [Sparkles, `AI is making notes, prep packs and quizzes: ${st!.done} of ${st!.total} done`, (st!.done / st!.total) * 100];
  const row = "flex flex-wrap items-center gap-x-3 gap-y-1";
  const mark = (state: "done" | "now" | "todo") => <span className={cx("w-4 shrink-0 text-center", state === "done" ? "text-ok" : state === "now" ? "text-accent" : "text-muted")}>{state === "done" ? "✓" : state === "now" ? "●" : "○"}</span>;
  return (
    <div className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs">
        <span className="flex items-center gap-1.5 font-semibold"><Icon aria-hidden className={cx("size-3.5", Icon === RefreshCw && "animate-spin")} />{title}</span>
        {[syncing, transcribing, ai].filter(Boolean).length > 1 && <span className="text-muted">and {[syncing && "sync", transcribing && "transcripts", ai && "AI notes"].filter(Boolean).slice(1).join(", ")} too</span>}
        <span className="flex-1" />
        <button type="button" onClick={toggle} aria-expanded={open} className="rounded-full border border-line bg-surface px-2.5 py-0.5 font-semibold hover:border-muted">{open ? "Hide details ▴" : "Details ▾"}</button>
        {ai && <a href={linkHref(`/${enc(sem)}/ai-work`)} target="_blank" rel="noreferrer" title="See everything the AI is doing in a new window"
          className="rounded-full border border-line bg-surface px-2.5 py-0.5 font-semibold hover:border-muted">Open ↗</a>}
      </div>
      {open && (
        <div className="mx-auto grid max-w-6xl gap-3 px-4 pb-3 text-xs" data-testid="activity-details">
          {syncing && (
            <section>
              <h3 className="mb-1 font-semibold">eClass sync</h3>
              <ol className="grid gap-0.5">
                {SYNC_STEPS.map((s, i) => {
                  const n = i + 1, now = p?.step ?? 1;
                  return (
                    <li key={s} className={row}>
                      {mark(n < now ? "done" : n === now ? "now" : "todo")}<span className={cx(n > now && "text-muted")}>{s}</span>
                      {n === 2 && n === now && p?.detail && <span className="min-w-0 truncate text-muted">{downloading ? `${p.done} of ${p.total} · ` : "reading "}{p.detail}</span>}
                    </li>
                  );
                })}
                <li className={row}>{mark("todo")}<span className="text-muted">Then: transcripts and AI notes for anything new</span></li>
              </ol>
            </section>
          )}
          {tr && (transcribing || tr.made > 0 || tr.failed > 0 || (tr.error && syncing)) && (
            <section>
              <h3 className="mb-1 font-semibold">Transcripts of class videos and narrated slides <span className="font-normal text-muted">(made on this computer)</span></h3>
              <div className={row}>
                {mark(transcribing ? "now" : "done")}
                <span>{tr.done} of {tr.total}{tr.made ? ` · ${tr.made} made` : ""}{tr.failed ? ` · ${tr.failed} failed (tried again tomorrow)` : ""}</span>
                {tr.current && <span className="min-w-0 truncate text-muted">now: {tr.current.split("/").pop()}</span>}
              </div>
              {tr.error && <p className="mt-1 rounded-lg bg-bad-bg px-2 py-1 text-bad">{tr.error}</p>}
            </section>
          )}
          {st && (ai || st.finished.length > 0) && (
            <section>
              <h3 className="mb-1 font-semibold">AI notes, prep packs and quizzes <span className="font-normal text-muted">{st.done} of {st.total} done{st.queue.length ? ` · ${st.queue.length} waiting` : ""}</span></h3>
              <div className="flex flex-wrap gap-1.5">
                {st.running.map((r) => (
                  <button key={r.id} type="button" data-ask-ai onClick={() => { setOpen(true); load(r.chatId); }} title="Watch it work"
                    className="flex max-w-[16rem] items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 hover:border-muted">
                    <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" /><span className="truncate">{label(r.id)}</span>
                  </button>
                ))}
                {st.finished.map((f) => <span key={f.chatId} className="flex max-w-[16rem] items-center gap-1 rounded-full px-2 py-0.5 text-muted"><span className={f.ok ? "text-ok" : "text-bad"}>{f.ok ? "✓" : "✗"}</span><span className="truncate">{label(f.id)}</span></span>)}
                {st.queue.map((id) => <span key={id} className="max-w-[16rem] truncate rounded-full border border-dashed border-line px-2 py-0.5 text-muted">{label(id)}</span>)}
              </div>
            </section>
          )}
        </div>
      )}
      <div className="h-1 bg-surface-2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Background work progress">
        <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(pct, 3)}%` }} />
      </div>
    </div>
  );
}

/** A newer release is out: what's new, and a button that updates and restarts the app. */
export function UpdateBar() {
  const { info, phase, start } = useUpdate();
  const [open, setOpen] = useState(false);
  // ✕ hides this release's bar for the rest of the browser session
  const [dismissed, setDismissed] = useState(() => { try { return sessionStorage.getItem("ouc-update-hidden"); } catch { return null; } });
  if (!info?.available || (dismissed === info.latest && phase === "idle")) return null;
  const items = releaseHighlights(info.notes);
  return (
    <div className="border-t border-line bg-surface-2">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs">
        <span className="font-semibold">⬆️ Update available: v{info.latest}</span>
        <span className="text-muted">you have v{info.current}</span>
        {items.length > 0 && <button type="button" className="text-muted underline hover:text-ink" onClick={() => setOpen(!open)}>{open ? "Hide" : "What's new"}</button>}
        {info.url && <a href={info.url} target="_blank" rel="noreferrer" className="text-muted underline hover:text-ink">Release notes ↗</a>}
        <span className="flex-1" />
        {phase === "idle" && info.canUpdate && (
          <button type="button" onClick={start} className="rounded-full bg-ink px-3 py-1 font-semibold text-bg hover:opacity-90">Update now</button>
        )}
        {phase === "idle" && !info.canUpdate && <span className="text-muted">In Terminal: <code>ouc update</code>, then restart the app</span>}
        {phase === "idle" && (
          <button type="button" aria-label="Hide until next time" className="px-1 text-muted hover:text-ink"
            onClick={() => { setDismissed(info.latest ?? null); try { sessionStorage.setItem("ouc-update-hidden", info.latest ?? ""); } catch {} }}>✕</button>
        )}
        {phase === "updating" && <span className="flex items-center gap-1.5 font-semibold"><span className="size-1.5 animate-pulse rounded-full bg-accent" />Updating and restarting… this page reloads when it's done</span>}
        {phase === "slow" && <span className="text-bad">Still not back. In Terminal: <code>ouc status</code>; details in <code>.ouc/update.log</code></span>}
        {phase === "failed" && <span className="text-bad">{info.error}</span>}
      </div>
      {open && (
        <ul className="mx-auto max-w-6xl list-disc px-8 pb-2 text-xs text-muted">
          {items.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      )}
    </div>
  );
}

const NAV = [
  ["", "Dashboard"],
  ["plan", "Plan"],
  ["timeline", "Timeline"],
  ["courses", "Courses"],
  ["notes", "Notes"],
  ["quizzes", "Quizzes"],
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
          <button type="button" onClick={() => { rememberLook("v2"); navigate(toV2(path)); }} title="A simpler layout with three places (Today, Courses, Calendar), notifications and settings"
            className="whitespace-nowrap rounded-full border border-accent/50 px-3 py-1.5 text-sm font-semibold text-accent hover:bg-surface-2">✨ <span className="hidden md:inline">Try the </span>new look</button>
          <select aria-label="Semester" value={sem} onChange={(e) => navigate(`/${enc(e.target.value)}`)}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm">
            {index.semesters.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <UpdateBar />
        <AiWorkBar sem={sem} />
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-12 pt-8">{children}</main>
      <footer className="border-t border-line pb-20">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 text-xs text-muted">
          <Link to={`${base}/ai-work`} className="hover:text-ink">AI background work</Link>
        </div>
      </footer>
      <SettingsFab to={`${base}/updates`} />
      <AskAiFab />
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-8 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        {NAV.map(([seg, label], i) => (
          <Link key={seg} to={seg ? `${base}/${seg}` : base}
            className={cx("flex flex-col items-center gap-0.5 py-2 text-[10px]", section === seg ? "font-semibold text-ink" : "text-muted")}>
            <span className="text-lg leading-none">{["🏠", "✅", "🗓️", "📚", "📒", "🏆", "📝", "🔔"][i]}</span>{label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
