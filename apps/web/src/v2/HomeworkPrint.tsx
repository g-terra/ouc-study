import { useEffect, useRef, useState } from "react";
import { pickedOptions } from "@ouc/content/homework";
import { Loading, Problem, courseMap, useSemester } from "../lib/data";
import { useHomework } from "../lib/homework";
import { mdToHtml } from "../lib/markdown";
import { AnswerView } from "../components/RichEditor";
import { cx } from "../components/ui";
import { fitPictures } from "../lib/print-fit";

const LETTERS = "ABCDEFGH";
// the PDF is A4 with 12 mm margins (index.css), and the page is laid out at that width on screen too, so the
// pictures can be fitted to the pages before printing
const PAGE_HEIGHT = ((297 - 2 * 12) * 96) / 25.4;

/**
 * The homework as it goes into the PDF (/print/homework/<sem>/<CODE>/<folder>?name=…): the student's name, the course,
 * the assignment's title and date, then every task in full with its answer. White paper, no app frame.
 * Chrome prints it headless (packages/ai/src/homework-pdf.ts); with ?print=1 it opens the print window itself.
 */
export function HomeworkPrint({ sem, id }: { sem: string; id: string }) {
  const data = useSemester(sem);
  const { answers: all, state } = useHomework(sem);
  const params = new URLSearchParams(window.location.search);
  const name = params.get("name") ?? "";
  const a = data?.assignments.find((x) => x.id === id);
  const ready = !!a?.homework?.tasks.length && state !== "loading";
  const paper = useRef<HTMLDivElement>(null);
  const [fitted, setFitted] = useState(false);
  useEffect(() => { document.title = a ? `${a.title}${name ? ` - ${name}` : ""}` : "Homework"; }, [a, name]);
  useEffect(() => {
    if (!ready) return;
    let gone = false;
    const t = setTimeout(async () => {   // after the formulas and pictures are drawn
      const imgs = [...(paper.current?.querySelectorAll<HTMLImageElement>(".answer-text img") ?? [])];
      await Promise.all([document.fonts?.ready, ...imgs.map((i) => i.decode().catch(() => {}))]);
      if (gone || !paper.current) return;
      fitToPages(paper.current, imgs);
      setFitted(true);
    }, 300);
    return () => { gone = true; clearTimeout(t); };
  }, [ready]);
  useEffect(() => {
    if (!fitted || !params.has("print")) return;
    const t = setTimeout(() => window.print(), 100);
    return () => clearTimeout(t);
  }, [fitted]);
  if (data === undefined) return <Loading />;
  if (!data || !a) return <Problem msg="Assignment not found." />;
  if (!a.homework?.tasks.length) return <Problem msg="This assignment has no interactive version." />;
  const course = courseMap(data)[a.code];
  const answers = all[id] ?? {};
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="homework-print min-h-screen bg-white px-4 py-12 text-[#1c1b19]" data-ready={ready ? "1" : undefined} data-fitted={fitted ? "1" : undefined}>
      <div ref={paper} className="mx-auto w-[186mm] max-w-full font-serif text-[15px] leading-relaxed">
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
          const none = <p className="text-[#6e6a62]">No answer.</p>;
          return (
            <section key={t.id} aria-label={`Question ${i + 1}`} className={cx("py-5", i > 0 && "border-t border-[#d8d3c8]")}>
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
                      return <li key={n} data-picked={on ? "1" : undefined} className={on ? "font-semibold text-[#c8102e] line-through decoration-2" : undefined}>{LETTERS[n]}. {o}</li>;
                    })}
                  </ol>
                  {!pickedOptions(t, ans).length && <p className="mt-1 pl-6 text-[#6e6a62]">No option picked.</p>}
                  {ans.why && <Explanation html={ans.why} />}
                </>
              ) : t.kind === "truefalse" ? (
                <ol className="grid gap-3 pl-6">
                  {t.statements!.map((st, n) => {
                    const sa = ans.tf?.[n] ?? {};
                    return (
                      <li key={n}>
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
  );
}

function Explanation({ html }: { html: string }) {
  return <div className="mt-2 border-l-2 border-[#e4e0d6] pl-3"><span className="text-[#6e6a62]">Why: </span><AnswerView html={html} /></div>;
}

/**
 * Smart picture sizing: a picture that wouldn't fit in the room left on its page shrinks into it (when it stays
 * big enough) instead of jumping to the next page and leaving a gap, and none is taller than a page.
 */
function fitToPages(paper: HTMLElement, imgs: HTMLImageElement[]) {
  const top = paper.getBoundingClientRect().top;
  const placed = imgs.map((i) => { const r = i.getBoundingClientRect(); return { top: r.top - top, height: r.height, width: r.width }; });
  fitPictures(placed, PAGE_HEIGHT).forEach((h, n) => {
    if (h === null) return;
    imgs[n].style.width = `${(placed[n].width * h) / placed[n].height}px`;
    imgs[n].style.height = `${h}px`;
  });
}
