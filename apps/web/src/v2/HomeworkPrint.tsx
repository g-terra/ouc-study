import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { pickedOptions } from "@ouc/content/homework";
import { Loading, Problem, courseMap, useSemester } from "../lib/data";
import { Link } from "../lib/router";
import { makePdf, saveBreaks, useHomework } from "../lib/homework";
import { mdToHtml } from "../lib/markdown";
import { AnswerView } from "../components/RichEditor";
import { FileLink, cx } from "../components/ui";
import { FileText } from "../components/icons";
import { fitSections, type Placed } from "../lib/print-fit";
import { paginate, type BreakPoint } from "../lib/print-pages";
import { homeworkHref } from "./Homework";

const LETTERS = "ABCDEFGH";
// the PDF is A4 with 12 mm margins (index.css), and the page is laid out at that width on screen too, so the
// pictures can be fitted and the pages worked out before printing
const MM = 96 / 25.4;
const PAGE_HEIGHT = (297 - 2 * 12) * MM;
// in the page preview, from one page's content to the next: the margins and a gap between the sheets
const PITCH = PAGE_HEIGHT + 24 * MM + 24;
// the parts a page can start at, besides a question (data-part): each paragraph, picture row or formula of an
// answer, each item of a list
const PARTS = "[data-part], .answer-text > :not(ul):not(ol), .answer-text > ul > li, .answer-text > ol > li";

/**
 * The homework as it goes into the PDF (/print/homework/<sem>/<CODE>/<folder>?name=…): the student's name, the course,
 * the assignment's title and date, then every task in full with its answer. White paper, no app frame.
 * Chrome prints it headless (packages/ai/src/homework-pdf.ts); with ?print=1 it opens the print window itself.
 * With ?pages=1 it is the page preview: the pages as sheets, and a click on a part moves it to the next page.
 */
export function HomeworkPrint({ sem, id }: { sem: string; id: string }) {
  const data = useSemester(sem);
  const { answers: all, state, layouts } = useHomework(sem);
  const params = new URLSearchParams(window.location.search);
  const name = params.get("name") ?? "";
  const preview = params.has("pages");
  const a = data?.assignments.find((x) => x.id === id);
  const ready = !!a?.homework?.tasks.length && state !== "loading";
  const breaks = layouts[id]?.breaks ?? [];
  const paper = useRef<HTMLDivElement>(null);
  const [laid, setLaid] = useState<{ pages: number } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState("");
  const fitted = !!laid;
  useEffect(() => { document.title = a ? `${a.title}${name ? ` - ${name}` : ""}` : "Homework"; }, [a, name]);
  useEffect(() => {
    if (!ready) return;
    let gone = false;
    const t = setTimeout(async () => {   // after the formulas and pictures are drawn
      const imgs = [...(paper.current?.querySelectorAll<HTMLImageElement>(".answer-text img[src]") ?? [])];
      await Promise.all([document.fonts?.ready, ...imgs.map((i) => i.decode().catch(() => {}))]);
      if (gone || !paper.current) return;
      setLaid({ pages: layOut(paper.current, imgs, new Set(breaks), preview) });
    }, fitted ? 0 : 300);
    return () => { gone = true; clearTimeout(t); };
  }, [ready, breaks.join(",")]);
  useEffect(() => {
    if (!fitted || !params.has("print")) return;
    const t = setTimeout(() => window.print(), 100);
    return () => clearTimeout(t);
  }, [fitted]);
  // the part picked in the preview: outlined, and named in the bar with what can be done with it
  const [chosen, setChosen] = useState<Chosen | null>(null);
  useLayoutEffect(() => {
    const el = picked ? paper.current?.querySelector<HTMLElement>(`[data-part-key="${CSS.escape(picked)}"]`) : null;
    if (!el) return setChosen(null);
    el.dataset.chosen = "1";
    setChosen({ key: picked!, startsPage: !!el.dataset.pageStart, text: (el.textContent ?? "").replace(/\s+/g, " ").trim() });
    return () => { delete el.dataset.chosen; };
  }, [picked, laid]);
  const move = (next: string[]) => { setError(""); saveBreaks(sem, id, next).catch((e: Error) => setError(e.message)); };
  if (data === undefined) return <Loading />;
  if (!data || !a) return <Problem msg="Assignment not found." />;
  if (!a.homework?.tasks.length) return <Problem msg="This assignment has no interactive version." />;
  const course = courseMap(data)[a.code];
  const answers = all[id] ?? {};
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className={cx("homework-print min-h-screen text-[#1c1b19]", preview ? "bg-[#d9d5cc]" : "bg-white px-4 py-12")} data-pages={preview ? "1" : undefined}
      data-ready={ready ? "1" : undefined} data-fitted={fitted ? "1" : undefined}>
      {preview && <PagesBar sem={sem} id={id} title={a.title} name={name} pages={laid?.pages} breaks={breaks} error={error} onUndoAll={() => move([])}
        chosen={chosen && { ...chosen, moved: breaks.includes(chosen.key) }} onMove={(k) => move([...breaks, k])} onBack={(k) => move(breaks.filter((b) => b !== k))}
        onClose={() => setPicked(null)} />}
      {/* the preview scrolls sideways on its own on a narrow screen: the pages keep the PDF's width */}
      <div className={preview ? "overflow-x-auto px-[16mm] pb-[16mm] pt-[20mm]" : undefined}>
        <div ref={paper} className={cx("relative isolate mx-auto w-[186mm] font-serif text-[15px] leading-relaxed", !preview && "max-w-full")}
          onPointerDown={preview ? (e) => setPicked((e.target as HTMLElement).closest<HTMLElement>("[data-part-key]")?.dataset.partKey ?? null) : undefined}
          onFocus={preview ? (e) => { const k = (e.target as HTMLElement).dataset?.partKey; if (k) setPicked(k); } : undefined}>
          {preview && laid && Array.from({ length: laid.pages }, (_, n) => (
            <div key={n} data-testid="sheet" aria-hidden className="absolute -z-10 bg-white shadow-md"
              style={{ top: n * PITCH - 12 * MM, left: -12 * MM, width: 210 * MM, height: 297 * MM }}>
              <span className="absolute bottom-[4mm] right-[12mm] font-sans text-xs text-[#6e6a62]">Page {n + 1} of {laid.pages}</span>
            </div>
          ))}
          <header className="mb-3 flex flex-wrap items-start justify-between gap-4 border-b-2 border-[#1c1b19] pb-4">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-[0.1em] text-[#6e6a62]">Open University of Cyprus · {a.code}{course?.title && course.title !== a.code ? ` · ${course.title}` : ""}</div>
              <h1 className="mt-1 text-2xl font-bold">{a.title}</h1>
            </div>
            <div className="text-right text-sm">
              <div className="font-bold" data-testid="print-name">{name}</div>
              <div className="text-[#6e6a62]">{today}</div>
            </div>
          </header>
          {a.homework.tasks.map((t, i) => {
            const ans = answers[t.id] ?? {};
            const none = <p data-part className="text-[#6e6a62]">No answer.</p>;
            return (
              <section key={t.id} data-question data-task={t.id} aria-label={`Question ${i + 1}`} className={cx("py-5", i > 0 && "border-t border-[#d8d3c8]")}>
                <div className="mb-3 flex gap-2 font-semibold break-inside-avoid break-after-avoid">
                  <span>{i + 1}.</span>
                  <div className="md min-w-0 flex-1 [&>*:first-child]:mt-0" dangerouslySetInnerHTML={{ __html: mdToHtml(t.question, sem) }} />
                </div>
                {t.kind === "choice" ? (
                  <>
                    {/* every option, the picked ones struck through in red, as on a paper answer sheet */}
                    <ol className="grid gap-1 pl-6">
                      {t.options!.map((o, n) => {
                        const on = pickedOptions(t, ans).includes(n);
                        return <li key={n} data-part data-picked={on ? "1" : undefined} className={on ? "font-semibold text-[#c8102e] line-through decoration-2" : undefined}>{LETTERS[n]}. {o}</li>;
                      })}
                    </ol>
                    {!pickedOptions(t, ans).length && <p data-part className="mt-1 pl-6 text-[#6e6a62]">No option picked.</p>}
                    {ans.why && <Explanation html={ans.why} />}
                  </>
                ) : t.kind === "truefalse" ? (
                  <ol className="grid gap-3 pl-6">
                    {t.statements!.map((st, n) => {
                      const sa = ans.tf?.[n] ?? {};
                      return (
                        <li key={n} data-part>
                          <p>{n + 1}. {st}</p>
                          {sa.value === undefined
                            ? <p className="text-[#6e6a62]">No answer.</p>
                            : <p data-testid="tf-answer" className="font-semibold text-[#c8102e]">{sa.value ? "True" : "False"}</p>}
                          {sa.why && <Explanation html={sa.why} />}
                        </li>
                      );
                    })}
                  </ol>
                ) : ans.text ? <AnswerView html={ans.text} className="font-sans" /> : none}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Explanation({ html }: { html: string }) {
  return <div data-part className="mt-2 border-l-2 border-[#e4e0d6] pl-3"><span className="text-[#6e6a62]">Why: </span><AnswerView html={html} /></div>;
}

/**
 * Lays the homework out on A4 pages, from the page as drawn: fits the pictures (fitToPages), then works out where each
 * page starts (paginate) and marks those parts break-before: page, so the PDF breaks exactly there. `breaks` are the
 * parts the student moved to a new page ("<task id>:<n>", n counting the question's parts, the question itself 0).
 * In the preview, each page start is pushed down to the top of its sheet. Returns the number of pages.
 */
function layOut(paper: HTMLElement, imgs: HTMLImageElement[], breaks: Set<string>, preview: boolean): number {
  for (const el of paper.querySelectorAll<HTMLElement>("[data-part-key]")) {
    el.style.removeProperty("break-before");
    el.style.removeProperty("margin-top");
    delete el.dataset.pageStart;
    delete el.dataset.moved;
  }
  for (const i of imgs) { i.style.removeProperty("width"); i.style.removeProperty("height"); }
  const parts: { el: HTMLElement; forced: boolean }[] = [];
  let forced = false;   // a page break typed in an answer: the next part starts a page
  for (const sec of paper.querySelectorAll<HTMLElement>("section[data-question]")) {
    delete sec.dataset.keep;
    let n = 0;
    for (const el of [sec, ...sec.querySelectorAll<HTMLElement>(PARTS)]) {
      if (el.matches("[data-page-break]")) { forced = true; continue; }
      const key = `${sec.dataset.task}:${n++}`;
      el.dataset.partKey = key;
      if (preview) el.tabIndex = 0;
      if (breaks.has(key)) el.dataset.moved = "1";
      parts.push({ el, forced });
      forced = false;
    }
  }
  fitToPages(paper, imgs);
  const top = () => paper.getBoundingClientRect().top;
  const t0 = top();
  const points: BreakPoint[] = parts.map(({ el, forced }) => {
    const r = el.getBoundingClientRect();
    const p: BreakPoint = { top: r.top - t0, manual: forced || !!el.dataset.moved };
    if (el.tagName === "SECTION" && !el.querySelector("[data-moved], [data-page-break]")) p.keep = r.bottom - t0;
    return p;
  });
  const { starts, pages } = paginate(points, paper.getBoundingClientRect().bottom - t0, PAGE_HEIGHT);
  for (const i of starts) {
    const el = parts[i]!.el;
    el.style.breakBefore = "page";
    el.dataset.pageStart = "1";
    if (!preview) continue;
    for (let k = 0; k < 2; k++) {   // twice: a margin can collapse into the one before it
      const y = el.getBoundingClientRect().top - top(), off = Math.ceil(y / PITCH - 0.001) * PITCH - y;
      if (off < 0.5) break;
      el.style.marginTop = `${parseFloat(getComputedStyle(el).marginTop) + off}px`;
    }
  }
  return pages;
}

/**
 * Lays the questions out on A4 pages before printing: a question that fits on a page is kept whole (data-keep), its
 * pictures shrinking a little when that saves moving it to the next page; a longer one splits, a picture that
 * wouldn't fit in the room left shrinking into it (when it stays big enough) instead of leaving a gap. No picture
 * is taller than a page, and pictures side by side shrink together.
 */
function fitToPages(paper: HTMLElement, imgs: HTMLImageElement[]) {
  const top = paper.getBoundingClientRect().top;
  type Row = Placed & { imgs: { el: HTMLImageElement; width: number; height: number }[] };
  const els = [...paper.querySelectorAll<HTMLElement>("section[data-question]")];
  const sections = els.map((sec) => {
    const box = sec.getBoundingClientRect();
    const rows: Row[] = [];
    // a question moved to the next page starts with a page break
    if (sec.dataset.moved) rows.push({ top: box.top - top, height: 0, pageBreak: true, imgs: [] });
    for (const el of sec.querySelectorAll<HTMLElement>(".answer-text img[src], .answer-text [data-page-break], [data-moved]")) {
      const r = el.getBoundingClientRect();
      if (el.dataset.moved) { rows.push({ top: r.top - top, height: 0, pageBreak: true, imgs: [] }); continue; }
      if (el.tagName !== "IMG") { rows.push({ top: r.bottom - top, height: 0, pageBreak: true, imgs: [] }); continue; }
      if (!imgs.includes(el as HTMLImageElement)) continue;
      const last = rows[rows.length - 1];
      const pic = { el: el as HTMLImageElement, width: r.width, height: r.height };
      if (last && !last.pageBreak && Math.abs(last.top - (r.top - top)) < 2) { last.imgs.push(pic); last.height = Math.max(last.height, r.height); }
      else rows.push({ top: r.top - top, height: r.height, imgs: [pic] });
    }
    return { top: box.top - top, height: box.height, items: rows };
  });
  const { keep, heights } = fitSections(sections, PAGE_HEIGHT);
  sections.forEach((sec, n) => {
    if (keep[n]) els[n].dataset.keep = "1";
    heights[n].forEach((h, k) => {
      const row = sec.items[k];
      if (h === null || !row.height) return;
      for (const p of row.imgs) {
        p.el.style.width = `${(p.width * h) / row.height}px`;
        p.el.style.height = `${(p.height * h) / row.height}px`;
      }
    });
  });
}

type Chosen = { key: string; startsPage: boolean; text: string };

/** The page preview's bar: how many pages, the picked part (move it to the next page or bring it back), Undo all and Make PDF. */
function PagesBar({ sem, id, title, name, pages, breaks, error, chosen, onMove, onBack, onClose, onUndoAll }: {
  sem: string; id: string; title: string; name: string; pages?: number; breaks: string[]; error: string;
  chosen: (Chosen & { moved: boolean }) | null; onMove: (key: string) => void; onBack: (key: string) => void; onClose: () => void; onUndoAll: () => void;
}) {
  const [st, setSt] = useState<{ busy?: boolean; pdf?: string; error?: string }>({});
  const make = () => {
    setSt({ busy: true });
    makePdf(sem, id, title, name).then((pdf) => setSt({ pdf }), (e: Error) => setSt({ error: e.message }));
  };
  const button = "min-h-11 rounded-full px-4 text-sm font-semibold";
  return (
    <div className="sticky top-0 z-20 border-b border-line bg-surface font-sans text-ink shadow-sm print:hidden">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link to={homeworkHref(sem, id)} className="text-sm text-muted underline underline-offset-2 hover:text-ink">Back to the homework</Link>
        <div className="min-w-48 flex-1">
          <h2 className="font-serif text-lg font-semibold">Pages of the PDF <span className="font-sans text-sm font-normal text-muted" data-testid="page-count">{pages === undefined ? "" : `${pages} page${pages === 1 ? "" : "s"}`}</span></h2>
        </div>
        <div className="flex gap-2">
          {breaks.length > 0 && <button type="button" onClick={onUndoAll} className={cx(button, "border border-line font-normal hover:bg-surface-2")}>Undo all</button>}
          <button type="button" onClick={make} disabled={st.busy} className={cx(button, "flex items-center gap-1.5 bg-ink text-bg hover:opacity-90 disabled:opacity-60")}>
            <FileText aria-hidden className="size-4" />{st.busy ? "Making the PDF…" : st.pdf ? "Make it again" : "Make PDF"}
          </button>
        </div>
      </div>
      {/* always there, so the pages don't jump when a part is picked */}
      <div role="group" aria-label="Picked part" className="mx-auto flex min-h-14 max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-4 pb-3 text-sm">
        {!chosen ? <span className="text-muted">Click a part to move it to the next page.</span> : <>
          <span className="min-w-0 flex-1 truncate text-muted">Picked: <span className="text-ink">“{chosen.text || "a picture"}”</span></span>
          {chosen.moved ? <button type="button" onClick={() => onBack(chosen.key)} className={cx(button, "bg-ink text-bg hover:opacity-90")}>Bring it back</button>
            : chosen.startsPage ? <span className="text-muted">It already starts a page.</span>
            : <button type="button" onClick={() => onMove(chosen.key)} className={cx(button, "bg-ink text-bg hover:opacity-90")}>Move to next page</button>}
          <button type="button" onClick={onClose} className="min-h-11 px-2 text-muted underline underline-offset-2">Close</button>
        </>}
      </div>
      {(st.pdf || st.error || error) && (
        <div className="mx-auto max-w-5xl px-4 pb-3 text-sm">
          {st.pdf && <p className="text-ok">Saved as <b className="break-all">{decodeURIComponent(st.pdf.split("/").pop() ?? "")}</b>. <FileLink href={st.pdf} className="font-semibold underline">Open the PDF</FileLink></p>}
          {(st.error || error) && <p role="alert" className="text-bad">{st.error || error}</p>}
        </div>
      )}
    </div>
  );
}
