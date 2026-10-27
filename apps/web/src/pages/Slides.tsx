/**
 * The slide and PDF viewer: a course PowerPoint or PDF, shown page by page in the app (no new tab), with
 * the narration recorded into each slide. The server turns the .pptx into a PDF with LibreOffice on first
 * view (packages/ai/src/slides.ts); pdf.js draws its pages here. When the deck has a transcript, what's
 * said on each slide shows under it. A PDF needs no converting: pdf.js opens the file itself.
 */
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { SemesterData } from "@ouc/content/types";
import { Link, enc } from "../lib/router";
import { Card, CourseBadge, cx } from "../components/ui";
import { parseTranscript, type Transcript } from "../lib/transcript";
import { FileText, INLINE, Maximize, Presentation, Volume2 } from "../components/icons";
import { markDone } from "../lib/progress";
import { findItem } from "@ouc/content/progress";

type Info =
  | { ok: true; pdf: string; download: string; slides: { n: number; audio: string[] }[] }
  | { ok: false; error: string; download?: string; needsConverter?: boolean };

let pdfjs: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | undefined;
/** pdf.js and its worker, loaded the first time slides are opened (the legacy build also runs in older Safari and Chrome). */
const loadPdfjs = () => (pdfjs ??= Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")]).then(([lib, worker]) => {
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  return lib;
}));

const LECTURE = "ouc-slides-lecture";
/** The page a link asks for: "#3" (slides) or "#page=3" (PDFs, as browsers write it). */
const pageFromHash = (hash: string) => Number(hash.match(/^#(?:page=)?(\d+)$/)?.[1]) || 1;

const readLecture = () => { try { return localStorage.getItem(LECTURE) === "1"; } catch { return false; } };

/** `bare`: inside a class (src/pages/Class.tsx), which shows the course, week and title itself. */
export function SlidesPage({ data, file, bare = false }: { data: SemesterData; file: string; bare?: boolean }) {
  const base = `/${enc(data.id)}`;
  const isPdf = /\.pdf$/i.test(file);
  const noun = isPdf ? "page" : "slide", Noun = isPdf ? "Page" : "Slide";
  const href = `/files/${encodeURIComponent(data.id)}/${file.split("/").map(encodeURIComponent).join("/")}`;
  const parts = file.split("/");
  const name = parts.at(-1)!.replace(/\.\w+$/, "").replace(/_/g, " ");
  const course = parts[0] === "courses" ? data.courses.find((c) => parts[1]?.startsWith(c.code)) : undefined;
  const week = course && parts.length > 3 ? parts[2].replace(/^\d+-/, "").replace(/[-.]+/g, " ").trim() : undefined;
  // the course week these slides are in, for the way back
  const weekIndex = course?.weeks.find((w) => w.items.some((i) => { try { return !!i.href && decodeURIComponent(i.href).endsWith(`/${file}`); } catch { return false; } }))?.index;

  const [info, setInfo] = useState<Info>();
  const [doc, setDoc] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [lecture, setLectureState] = useState(readLecture);
  // a PDF's portrait page fits the window, or the width to read small print
  const [fitWidth, setFitWidth] = useState(false);
  const setLecture = (on: boolean) => { setLectureState(on); try { localStorage.setItem(LECTURE, on ? "1" : "0"); } catch { /* private mode */ } };

  useEffect(() => {
    let live = true, task: { destroy(): Promise<void> } | undefined;
    setInfo(undefined); setDoc(undefined); setPage(pageFromHash(location.hash));
    const got: Promise<Info> = isPdf ? Promise.resolve({ ok: true, pdf: href, download: href, slides: [] })
      : fetch(`/api/slides/info?file=${enc(`${data.id}/${file}`)}`).then((r) => r.json());
    got
      .then(async (i: Info) => {
        if (!live) return;
        setInfo(i);
        if (!i.ok) return;
        const lib = await loadPdfjs();
        const t = (task = lib.getDocument({ url: i.pdf }));
        const d = await t.promise;
        if (live) setDoc(d);
      })
      .catch((e) => live && setInfo({ ok: false, error: `Couldn't open the ${isPdf ? "PDF" : "slides"}: ${e.message ?? e}`, ...(isPdf && { download: href }) }));
    return () => { live = false; task?.destroy(); };
  }, [data.id, file, isPdf, href]);

  const pages = doc?.numPages ?? 0;
  const go = (n: number) => { if (pages) setPage(Math.max(1, Math.min(pages, n))); };
  useEffect(() => { if (pages) history.replaceState(history.state, "", isPdf ? `#page=${page}` : `#${page}`); }, [page, pages, isPdf]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]")) return;
      if (["ArrowRight", "PageDown"].includes(e.key)) { e.preventDefault(); go(page + 1); }
      else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); go(page - 1); }
      else if (e.key === "Home") go(1);
      else if (e.key === "End") go(pages);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // reaching the last page ticks the deck or PDF off as read
  useEffect(() => {
    if (!pages || page < pages) return;
    const f = findItem(data.courses, href);
    if (f) void markDone(data.id, f.course.code, f.week, f.item, true, "viewed");
  }, [page, pages, href, data.id, data.courses]);
  // the deck's transcript (made from its narration), if it has one
  const transcriptHref = data.courses.flatMap((c) => c.weeks.flatMap((w) => w.items)).find((it) => it.href === href)?.transcript;
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  useEffect(() => {
    let live = true;
    setTranscript(null);
    if (transcriptHref) fetch(transcriptHref).then((r) => (r.ok ? r.text() : null)).then((md) => live && md && setTranscript(parseTranscript(md))).catch(() => {});
    return () => { live = false; };
  }, [transcriptHref]);
  const said = transcript?.sections.find((s) => s.slide === page)?.lines ?? [];

  const stage = useRef<HTMLDivElement>(null);
  const audio = info?.ok ? info.slides[page - 1]?.audio ?? [] : [];
  const withAudio = info?.ok ? info.slides.filter((s) => s.audio.length).length : 0;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
        {!bare && course && <Link to={`${base}/courses/${enc(course.code)}${weekIndex !== undefined ? `#w${weekIndex}` : ""}`} aria-label={`Back to ${course.short}${week ? `, ${week}` : ""}`}><CourseBadge course={course} size="md" /></Link>}
        {!bare && week && <span>{week}</span>}
        <span className="ml-auto flex gap-3">
          {isPdf && <a href={href} target="_blank" rel="noreferrer" className="hover:text-ink" title="The browser's own PDF viewer, to search or copy text">Open in a new tab ↗</a>}
          {info?.download && <a href={info.download} download className="hover:text-ink">⬇ Download the .{file.split(".").pop()}</a>}
        </span>
      </div>
      {!bare && <h1 className="mb-5 font-serif text-3xl font-semibold leading-tight tracking-tight">{name}</h1>}

      {!info || (isPdf && info.ok && !doc) ? (
        <Card className="p-10 text-center text-muted" >
          {isPdf ? <FileText aria-hidden className="mx-auto mb-2 size-8 text-muted" /> : <Presentation aria-hidden className="mx-auto mb-2 size-8 text-muted" />}
          <p className="font-semibold text-ink">{isPdf ? "Opening the PDF…" : "Getting the slides ready…"}</p>
          {!isPdf && <p className="mt-1 text-sm">The first time can take a minute for big presentations. After that they open straight away.</p>}
        </Card>
      ) : !info.ok ? (
        <Card className="p-6">
          <p className="font-semibold">{info.needsConverter ? "These slides can't be shown here yet" : `Couldn't show ${isPdf ? "this PDF" : "these slides"}`}</p>
          <p className="mt-2 text-sm text-muted">{info.error}</p>
          {info.download && <a href={info.download} download className="mt-4 inline-block rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white">⬇ Download instead</a>}
        </Card>
      ) : (
        <>
          <div ref={stage} className={cx("overflow-hidden rounded-2xl border border-line [&:fullscreen]:flex [&:fullscreen]:items-center [&:fullscreen]:rounded-none", isPdf ? "bg-surface-2 py-3 [&:fullscreen]:bg-black/90" : "bg-black/90")}>
            {doc ? <SlideCanvas doc={doc} page={page} label={`${Noun} ${page}`} fitPage={isPdf && !fitWidth} onClick={(fwd) => go(page + (fwd ? 1 : -1))} /> : <div className="aspect-video" />}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={() => go(page - 1)} disabled={page <= 1} className="rounded-full border border-line px-3 py-1 text-sm disabled:opacity-40" aria-label={`Previous ${noun}`}>‹ Prev</button>
            <span className="min-w-24 text-center text-sm tabular-nums" data-testid="slide-counter">{Noun} {page} / {pages || "…"}</span>
            <button onClick={() => go(page + 1)} disabled={!pages || page >= pages} className="rounded-full border border-line px-3 py-1 text-sm disabled:opacity-40" aria-label={`Next ${noun}`}>Next ›</button>
            {withAudio > 0 && (
              <label className="ml-2 flex items-center gap-1.5 text-sm" title="Plays each slide's narration and moves on when it ends">
                <input type="checkbox" checked={lecture} onChange={(e) => setLecture(e.target.checked)} /> Play as a lecture
              </label>
            )}
            {isPdf && <button onClick={() => setFitWidth(!fitWidth)} aria-pressed={fitWidth} className="ml-auto rounded-full border border-line px-3 py-1 text-sm">{fitWidth ? "Fit page" : "Fit width"}</button>}
            <button onClick={() => (document.fullscreenElement ? document.exitFullscreen() : stage.current?.requestFullscreen())} className={cx("inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm", !isPdf && "ml-auto")}><Maximize aria-hidden className="size-3.5" />Full screen</button>
          </div>

          <Narration key={page} clips={audio} lecture={lecture} onEnded={() => page < pages && go(page + 1)} />
          {said.length > 0 && (
            <div className="mt-3 rounded-xl border border-line bg-surface p-3" data-testid="slide-transcript">
              <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                <FileText aria-hidden className={INLINE} /> What's said on this slide
              </div>
              {said.map((l, i) => <p key={i} className="text-sm leading-relaxed">{l.text}</p>)}
            </div>
          )}

          {pages > 1 && (
            <nav className="mt-4 flex flex-wrap gap-1" aria-label={isPdf ? "Pages" : "Slides"}>
              {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
                <button key={n} onClick={() => go(n)} aria-label={`${Noun} ${n}`} aria-current={n === page || undefined} title={info.slides[n - 1]?.audio.length ? "Has narration" : undefined}
                  className={cx("min-w-9 rounded-lg px-2 py-1 text-xs tabular-nums", n === page ? "bg-ink font-semibold text-surface" : "bg-surface-2 text-muted hover:text-ink")}>
                  {n}{info.slides[n - 1]?.audio.length ? <> <Volume2 aria-hidden className={INLINE} /></> : ""}
                </button>
              ))}
            </nav>
          )}
          <p className="mt-4 text-xs text-muted">{isPdf ? "← → to move between pages." : "← → to move between slides. Animations and videos inside the slides don't play here; download the file for those."}</p>
        </>
      )}
    </div>
  );
}

/**
 * One PDF page, drawn to fit the width (and the height in full screen; with `fitPage`, the window's height
 * too, so a portrait page and the buttons under it show whole). Click the right/left part for next/previous.
 */
function SlideCanvas({ doc, page, label, fitPage, onClick }: { doc: PDFDocumentProxy; page: number; label: string; fitPage: boolean; onClick: (forward: boolean) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(0);
  useEffect(() => {
    const box = canvas.current?.parentElement;
    if (!box) return;
    const ro = new ResizeObserver(() => setSize(box.clientWidth * 10000 + box.clientHeight));
    ro.observe(box);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    let task: RenderTask | undefined, live = true;
    doc.getPage(page).then((p) => {
      const el = canvas.current, box = el?.parentElement;
      if (!live || !el || !box) return;
      const v = p.getViewport({ scale: 1 });
      const full = document.fullscreenElement;
      const scale = Math.min(box.clientWidth / v.width, full ? full.clientHeight / v.height : fitPage ? Math.max(300, window.innerHeight - 300) / v.height : Infinity);
      const dpr = window.devicePixelRatio || 1;
      const vp = p.getViewport({ scale: scale * dpr });
      el.width = vp.width; el.height = vp.height;
      el.style.width = `${vp.width / dpr}px`; el.style.height = `${vp.height / dpr}px`;
      task = p.render({ canvas: el, viewport: vp });
      task.promise.catch(() => { /* replaced by the next slide */ });
    });
    return () => { live = false; task?.cancel(); };
  }, [doc, page, size, fitPage]);
  return (
    <div className="flex w-full justify-center" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onClick(e.clientX - r.left > r.width / 3); }}>
      <canvas ref={canvas} className="block cursor-pointer bg-white" aria-label={label} />
    </div>
  );
}

/** The current slide's narration; in lecture mode it plays by itself and moves on when the last clip ends. */
function Narration({ clips, lecture, onEnded }: { clips: string[]; lecture: boolean; onEnded: () => void }) {
  const refs = useRef<(HTMLAudioElement | null)[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!lecture) return;
    // a slide with no narration stays up a few seconds
    if (!clips.length) { timer.current = setTimeout(onEnded, 4000); return () => clearTimeout(timer.current); }
    refs.current[0]?.play().catch(() => { /* the browser wants a click first */ });
  }, [lecture]);
  if (!clips.length) return null;
  return (
    <div className="mt-3 grid gap-2 rounded-xl bg-surface-2 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted"><Volume2 aria-hidden className={INLINE} /> Narration for this slide</div>
      {clips.map((src, i) => (
        <audio key={src} ref={(el) => { refs.current[i] = el; }} src={src} controls preload="metadata" className="w-full"
          onEnded={() => (i + 1 < clips.length ? refs.current[i + 1]?.play() : lecture && onEnded())} />
      ))}
    </div>
  );
}
