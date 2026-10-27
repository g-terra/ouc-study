/**
 * "Start class": a week's videos, slides, PDFs and links one step at a time, in the app where it can show
 * them. "Done, next" ticks the step off (progress.json, like the week's tick boxes); "Skip" leaves it.
 * /<sem>/class/<course>/<week>/<step>, the steps from lib/class.ts; past the last step, "Class done".
 */
import type { SemesterData, Week, WeekItem } from "@ouc/content/types";
import { itemKey } from "@ouc/content/progress";
import { Link, enc, useRouter } from "../lib/router";
import { classPath, classSteps, startStep, stepView } from "../lib/class";
import { markDone, useProgress } from "../lib/progress";
import { Card, CourseBadge, Empty, cx } from "../components/ui";
import { Check, INLINE, NotebookPen, PartyPopper } from "../components/icons";
import { VideoPage } from "./Video";
import { SlidesPage } from "./Slides";
import { QuizLinks } from "./Courses";

export function ClassPage({ data, code, week, step }: { data: SemesterData; code: string; week: string; step?: string }) {
  const { navigate } = useRouter();
  const progress = useProgress(data.id);
  const c = data.courses.find((x) => x.code === code);
  const w = c?.weeks.find((x) => x.index === Number(week));
  if (!c || !w) return <Empty>This class isn't in the course.</Empty>;
  const steps = classSteps(w);
  const back = `/${enc(data.id)}/courses/${enc(c.code)}#w${w.index}`;
  const weekLabel = w.index === 0 ? "General" : w.label;
  if (!steps.length) return <Empty>Nothing to watch or read in this week. <Link to={back} className="underline">Back to {c.short}</Link></Empty>;

  const n = Math.max(1, Number(step) || startStep(c.code, w, progress.done) + 1);   // 1 = the first step
  const isDone = (it: WeekItem) => Boolean(progress.done[itemKey(c.code, w.index, it)]);
  const go = (to: number) => navigate(classPath(data.id, c.code, w.index, to));
  const it = steps[n - 1];

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
        <Link to={back} aria-label={`Back to ${c.short}, ${weekLabel}`}><CourseBadge course={c} size="md" /></Link>
        <span className="min-w-0 truncate">{weekLabel}</span>
        <span className="ml-auto font-semibold text-ink">{it ? `Step ${n} of ${steps.length}` : "Class done"}</span>
      </div>
      <nav aria-label="Class steps" className="mb-4">
        <ol className="flex flex-wrap gap-1.5">
          {steps.map((s, i) => (
            <li key={itemKey(c.code, w.index, s)} className="min-w-0">
              <Link to={classPath(data.id, c.code, w.index, i + 1)} aria-current={i + 1 === n ? "step" : undefined} aria-label={`${i + 1}. ${s.title}${isDone(s) ? ", done" : ""}`}
                className={cx("flex max-w-[16rem] items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", i + 1 === n ? "border-ink bg-surface font-semibold text-ink" : "border-line text-muted hover:border-muted hover:text-ink")}>
                <span className={cx("grid size-4 shrink-0 place-items-center rounded-full text-[10px]", isDone(s) ? "bg-ok text-white" : "bg-surface-2")}>
                  {isDone(s) ? <Check aria-hidden className="size-3" strokeWidth={3} /> : i + 1}
                </span>
                <span className="truncate">{s.title}</span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      {it ? (
        <>
          <h1 className="mb-5 font-serif text-3xl font-semibold leading-tight tracking-tight">{it.title}</h1>
          <Step key={n} data={data} it={it} />
          <div className="sticky bottom-16 z-20 mt-6 flex flex-wrap items-center gap-2 border-t border-line bg-bg py-3 sm:bottom-0">
            {n > 1 && <Link to={classPath(data.id, c.code, w.index, n - 1)} className="rounded-full border border-line px-3 py-1.5 text-sm hover:border-muted">‹ Previous</Link>}
            <button type="button" onClick={() => go(n + 1)} className="ml-auto rounded-full px-3 py-1.5 text-sm text-muted hover:text-ink">Skip</button>
            <button type="button" onClick={() => { void markDone(data.id, c.code, w, it, true); go(n + 1); }}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white">
              {n < steps.length ? "Done, next ›" : "Done, finish class"}
            </button>
          </div>
        </>
      ) : <Finished data={data} code={c.code} w={w} back={back} short={c.short} done={steps.filter(isDone).length} total={steps.length} />}
    </div>
  );
}

/** One step: a video, slides or a PDF in its viewer; anything else (a link, a Word file) opens in a new tab. */
function Step({ data, it }: { data: SemesterData; it: WeekItem }) {
  const v = stepView(it);
  if (v.kind === "video") return <VideoPage data={data} file={v.file} bare />;
  if (v.kind === "slides" || v.kind === "pdf") return <SlidesPage data={data} file={v.file} bare />;
  return (
    <Card className="p-6">
      <p className="font-semibold">{it.external ? "This one is on another site" : "This file opens outside the app"}</p>
      <p className="mt-1 text-sm text-muted">Open it in a new tab, then come back here for the next step.</p>
      {v.href ? <a href={v.href} target="_blank" rel="noreferrer" className="mt-4 inline-block rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white">Open it ↗</a>
        : <p className="mt-4 text-sm text-muted">It has no link here; look for it on eClass.</p>}
    </Card>
  );
}

function Finished({ data, code, w, back, short, done, total }: { data: SemesterData; code: string; w: Week; back: string; short: string; done: number; total: number }) {
  const notes = w.items.filter((x) => x.kind === "note" && x.noteSlug);
  const quizzes = (data.quizzes ?? []).filter((q) => q.code === code && q.scope === "lecture" && q.section === w.index);
  return (
    <Card className="p-6">
      <h1 className="font-serif text-3xl font-semibold tracking-tight"><PartyPopper aria-hidden className={INLINE} /> Class done</h1>
      <p className="mt-2 text-sm text-muted">{done} of {total} watched or read in this week.</p>
      {(notes.length > 0 || quizzes.length > 0) && <h2 className="mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Go over it</h2>}
      {notes.map((x) => (
        <Link key={x.noteSlug} to={`/${enc(data.id)}/notes/${enc(code)}/${enc(x.noteSlug!)}`} className="mt-1 block rounded-lg px-2 py-1.5 text-sm font-semibold hover:bg-surface-2"><NotebookPen aria-hidden className={INLINE} /> {x.title}</Link>
      ))}
      {quizzes.length > 0 && <div className="mt-1"><QuizLinks sem={data.id} quizzes={quizzes} /></div>}
      <div className="mt-6 flex flex-wrap gap-2">
        <Link to={back} className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white">Back to {short}</Link>
        <Link to={classPath(data.id, code, w.index, 1)} className="rounded-full border border-line px-4 py-1.5 text-sm hover:border-muted">Go through again</Link>
      </div>
    </Card>
  );
}
