import { useEffect } from "react";
import { taskLabel } from "@ouc/content/homework";
import { Loading, Problem, courseMap, useSemester } from "../lib/data";
import { useHomework } from "../lib/homework";
import { mdToHtml } from "../lib/markdown";
import { AnswerView } from "../components/RichEditor";

const LETTERS = "ABCDEFGH";

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
  useEffect(() => { document.title = a ? `${a.title}${name ? ` - ${name}` : ""}` : "Homework"; }, [a, name]);
  useEffect(() => {
    if (!ready || !params.has("print")) return;
    const t = setTimeout(() => window.print(), 600);   // after the formulas and pictures are drawn
    return () => clearTimeout(t);
  }, [ready]);
  if (data === undefined) return <Loading />;
  if (!data || !a) return <Problem msg="Assignment not found." />;
  if (!a.homework?.tasks.length) return <Problem msg="This assignment has no interactive version." />;
  const course = courseMap(data)[a.code];
  const answers = all[id] ?? {};
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="homework-print min-h-screen bg-white text-[#1c1b19]" data-ready={ready ? "1" : undefined}>
      <div className="mx-auto max-w-[46rem] px-10 py-12 font-serif text-[15px] leading-relaxed">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b-2 border-[#1c1b19] pb-4">
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
          return (
            <section key={t.id} className="mb-7 break-inside-avoid-page">
              <h2 className="mb-1 font-bold">Task {i + 1}{t.title ? ` · ${taskLabel(t, i)}` : ""}</h2>
              <div className="md mb-3 italic text-[#4a4741]" dangerouslySetInnerHTML={{ __html: mdToHtml(t.question, sem) }} />
              {t.kind === "choice" ? (
                <>
                  {ans.choice !== undefined && t.options?.[ans.choice] !== undefined
                    ? <p><b>Answer: {LETTERS[ans.choice]}.</b> {t.options[ans.choice]}</p>
                    : <p className="text-[#6e6a62]">No answer.</p>}
                  {ans.why && <div className="mt-2 border-l-2 border-[#e4e0d6] pl-3"><span className="text-[#6e6a62]">Why: </span><AnswerView html={ans.why} /></div>}
                </>
              ) : ans.text ? <AnswerView html={ans.text} className="font-sans" /> : <p className="text-[#6e6a62]">No answer.</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
