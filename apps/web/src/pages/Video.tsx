/**
 * A class video with its transcript beside it: click a line to jump there, the line being said is
 * highlighted (and followed) while it plays, and the video goes full screen. A Panopto recording (a
 * link, not a file here) shows its transcript with each line opening Panopto at that time.
 *
 * /<sem>/video/<path>: the video's path in the semester folder, or the transcript's for a Panopto link.
 * #t=<seconds> starts there (a search result links to the moment a word is said).
 */
import { useEffect, useRef, useState } from "react";
import type { SemesterData, WeekItem } from "@ouc/content/types";
import { Link, enc } from "../lib/router";
import { Card, CourseBadge, cx } from "../components/ui";
import { lineAt, parseTranscript, stamp, type Transcript, type TranscriptLine } from "../lib/transcript";
import { Maximize } from "../components/icons";
import { markDone } from "../lib/progress";
import { findItem } from "@ouc/content/progress";
import { redoTranscript } from "../lib/ai";

const FOLLOW = "ouc-video-follow";
const readFollow = () => { try { return localStorage.getItem(FOLLOW) !== "0"; } catch { return true; } };
const fileHref = (sem: string, rel: string) => `/files/${encodeURIComponent(sem)}/${rel.split("/").map(encodeURIComponent).join("/")}`;
/** A Panopto viewer link that starts at `sec`. */
const panoptoAt = (url: string, sec: number) => { try { const u = new URL(url); u.searchParams.set("start", String(Math.floor(sec))); return u.toString(); } catch { return url; } };

export function VideoPage({ data, file }: { data: SemesterData; file: string }) {
  const base = `/${enc(data.id)}`;
  const parts = file.split("/");
  const course = parts[0] === "courses" ? data.courses.find((c) => parts[1]?.startsWith(c.code)) : undefined;
  const href = fileHref(data.id, file);
  // the week item this is (for its title and, for Panopto, the link)
  let item: WeekItem | undefined, weekLabel: string | undefined, weekIndex: number | undefined;
  for (const w of course?.weeks ?? []) {
    const it = w.items.find((x) => x.href === href || x.transcript === href);
    if (it) { item = it; weekLabel = w.index === 0 ? "General" : w.label; weekIndex = w.index; break; }
  }
  const isTranscript = /\.transcript\.md$/i.test(file);
  const external = isTranscript && item?.external ? item.href : undefined;
  const videoSrc = isTranscript ? undefined : href;
  const transcriptHref = isTranscript ? href : item?.transcript ?? fileHref(data.id, file.replace(/\.[^./]+$/, ".transcript.md"));

  const [t, setT] = useState<Transcript | null>();
  // "Make it again": the old transcript is gone until the new one is written, so check back until it's there
  const [redoing, setRedoing] = useState(false);
  useEffect(() => {
    let live = true, timer: number | undefined;
    if (!redoing) setT(undefined);
    const load = () => fetch(transcriptHref, { cache: "no-store" }).then((r) => (r.ok ? r.text() : null)).catch(() => null).then((md) => {
      if (!live) return;
      if (redoing && !md) { timer = window.setTimeout(load, 4000); return; }
      setT(md ? parseTranscript(md) : null); setRedoing(false);
    });
    timer = window.setTimeout(load, redoing ? 4000 : 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [transcriptHref, redoing]);

  const video = useRef<HTMLVideoElement>(null);
  const [startAt] = useState(() => Number(window.location.hash.match(/^#t=(\d+)/)?.[1]) || 0);
  const [now, setNow] = useState(startAt);
  // before the video has loaded this is where it will start
  useEffect(() => { if (startAt && video.current) video.current.currentTime = startAt; }, [startAt, videoSrc]);
  const [follow, setFollowState] = useState(readFollow);
  const setFollow = (on: boolean) => { setFollowState(on); try { localStorage.setItem(FOLLOW, on ? "1" : "0"); } catch { /* private mode */ } };
  const lines: TranscriptLine[] = t?.sections.flatMap((s) => s.lines) ?? [];
  const current = videoSrc || startAt ? lineAt(lines, now) : -1;
  const seek = (sec: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = sec; setNow(sec);
    v.play().catch(() => { /* the browser wants a click on the video first */ });
  };

  // keep the line being said in view in the transcript panel (without scrolling the page)
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = panel.current, el = box?.querySelector<HTMLElement>(`[data-line="${current}"]`);
    if (!follow || !box || !el) return;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTo({ top: top - box.clientHeight / 3, behavior: "smooth" });
  }, [current, follow]);

  const title = item?.title ?? t?.title ?? parts.at(-1)!.replace(/(\.transcript)?\.\w+$/, "").replace(/[_-]+/g, " ");
  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
        {course && <Link to={`${base}/courses/${enc(course.code)}${weekIndex !== undefined ? `#w${weekIndex}` : ""}`} aria-label={`Back to ${course.short}${weekLabel ? `, ${weekLabel}` : ""}`}><CourseBadge course={course} size="md" /></Link>}
        {weekLabel && <span>{weekLabel}</span>}
        {videoSrc && <a href={videoSrc} download className="ml-auto hover:text-ink">⬇ Download the video</a>}
      </div>
      <h1 className="mb-5 font-serif text-3xl font-semibold leading-tight tracking-tight">{title}</h1>

      <div className={cx("grid gap-4", t !== null && "lg:grid-cols-[minmax(0,1fr)_24rem]")}>
        <div className="min-w-0">
          {videoSrc ? (
            <>
              <video ref={video} src={videoSrc} controls playsInline preload="metadata" data-testid="class-video"
                onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} onSeeked={(e) => setNow(e.currentTarget.currentTime)}
                onEnded={() => { const f = findItem(data.courses, href); if (f) void markDone(data.id, f.course.code, f.week, f.item, true, "watched"); }}
                className="aspect-video w-full rounded-2xl border border-line bg-black" />
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <button type="button" onClick={() => video.current?.requestFullscreen?.()} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 hover:border-muted"><Maximize aria-hidden className="size-3.5" />Full screen</button>
                <span className="text-xs text-muted">Or double-click the video. Esc leaves full screen.</span>
              </div>
            </>
          ) : external ? (
            <Card className="p-6">
              <p className="font-semibold">This recording is on Panopto</p>
              <p className="mt-1 text-sm text-muted">It needs your Panopto sign-in, so it plays there. Each line of the transcript opens Panopto at that moment.</p>
              <a href={external} target="_blank" rel="noreferrer" className="mt-4 inline-block rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white">Watch on Panopto ↗</a>
            </Card>
          ) : null}
        </div>

        {redoing ? (
          <div data-testid="transcript-redoing"><Card className="p-4 text-sm">
            <p className="flex items-center gap-1.5 font-semibold"><span className="size-1.5 animate-pulse rounded-full bg-accent" />Making the transcript again…</p>
            <p className="mt-1 text-muted">Whisper is listening to the recording on this computer. A lecture takes a few minutes; this page shows it when it's ready.</p>
          </Card></div>
        ) : t === undefined ? (
          <Card className="p-4 text-sm text-muted">Loading the transcript…</Card>
        ) : t === null ? (
          <div className="text-sm text-muted">
            <p>No transcript yet. Transcripts are made on this computer when Whisper is set up (Settings → Video transcripts).</p>
            {videoSrc && <Redo file={file} label="Make the transcript" onStarted={() => setRedoing(true)} />}
          </div>
        ) : (
          <Card className="flex max-h-[75vh] min-h-0 flex-col overflow-hidden lg:sticky lg:top-4 lg:self-start">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
              <h2 className="font-semibold">Transcript</h2>
              {videoSrc && (
                <label className="ml-auto flex items-center gap-1.5 text-xs text-muted" title="Scrolls to the line being said">
                  <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow the video
                </label>
              )}
            </div>
            <div ref={panel} className="relative min-h-0 flex-1 overflow-y-auto px-2 py-2" data-testid="transcript">
              {t.note && <p className="px-2 pb-2 text-xs text-muted">{t.note}</p>}
              {lines.length === 0 && <p className="px-2 text-sm text-muted">No speech was found in this recording.</p>}
              {lines.map((l, i) => {
                const cls = cx("block w-full rounded-lg px-2 py-1.5 text-left text-sm leading-relaxed", i === current ? "bg-accent/15 text-ink ring-1 ring-accent/40" : "hover:bg-surface-2");
                const time = l.at !== null && <span className="mr-2 font-mono text-xs text-muted tabular-nums">{stamp(l.at)} </span>;
                if (videoSrc && l.at !== null) {
                  return <button key={i} type="button" data-line={i} aria-current={i === current || undefined} onClick={() => seek(l.at!)} className={cls}>{time}{l.text}</button>;
                }
                if (external && l.at !== null) return <a key={i} data-line={i} href={panoptoAt(external, l.at)} target="_blank" rel="noreferrer" className={cls}>{time}{l.text}</a>;
                return <p key={i} data-line={i} className={cls}>{time}{l.text}</p>;
              })}
            </div>
            <div className="border-t border-line px-4 py-2 text-xs text-muted">
              {t.by && <span>Made with {t.by}{t.made ? ` on ${t.made}` : ""}. </span>}
              <a href={transcriptHref} download className="underline hover:text-ink">⬇ Save the transcript</a>
              {videoSrc && !/panopto/i.test(t.by ?? "") && <Redo file={file} language={t.language} label="Make it again" onStarted={() => setRedoing(true)} />}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

const LANGUAGES: [string, string][] = [["en", "English"], ["el", "Ελληνικά (Greek)"], ["auto", "Let Whisper guess"]];

/** Wrong language or garbled? Makes the transcript again in the language picked (it becomes the course's). */
function Redo({ file, language, label, onStarted }: { file: string; language?: string; label: string; onStarted: () => void }) {
  const [lang, setLang] = useState(language && LANGUAGES.some(([id]) => id === language) ? language : "en");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setError(null);
    const e = await redoTranscript(file, lang);
    setBusy(false);
    if (e) setError(e); else onStarted();
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="transcript-redo">
      <span>Wrong language or garbled? Spoken in</span>
      <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language spoken" className="rounded-lg border border-line bg-surface px-1.5 py-0.5 text-ink">
        {LANGUAGES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
      <button type="button" onClick={go} disabled={busy} className="rounded-full border border-line px-2.5 py-0.5 font-semibold text-ink hover:border-muted disabled:opacity-60">{label}</button>
      {error && <span className="basis-full text-bad">{error}</span>}
    </div>
  );
}
