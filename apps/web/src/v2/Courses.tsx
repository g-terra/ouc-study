import { useEffect, useState } from "react";
import type { SemesterData } from "@ouc/content/types";
import { Link, enc, useRouter } from "../lib/router";
import { currentWeek, stateOf } from "../lib/data";
import { at, fmtFull, fmtShort, fmtWhen, plural, relative } from "../lib/dates";
import { useAttempts } from "../lib/quiz";
import { Card, Empty, PageHeader, ProgressRing, StatePill, cx } from "../components/ui";
import { ClassCard, ClassTimeEditor, upcomingClasses } from "../components/Classes";
import { MakeQuizButton, QuizJobs } from "../components/MakeQuiz";
import { QuizLinks, WeekRow } from "../pages/Courses";
import { assignmentHref } from "./agenda";
import { DoneCount } from "../components/Progress";
import { useProgress } from "../lib/progress";
import { courseProgress, weekProgress } from "@ouc/content/progress";
import { Flame, GraduationCap, INLINE, NotebookPen, Trophy, Video } from "../components/icons";

/** Courses: one row per course with where it's at. Notes and quizzes live inside each course. */
export function CourseList({ data }: { data: SemesterData }) {
  const now = new Date();
  const { stats } = useAttempts(data.id);
  const progress = useProgress(data.id);
  return (
    <>
      <PageHeader title="Courses" eyebrow={data.label}>
        Each course has its weeks, notes, quizzes and assignments in one place.
        {stats.points > 0 && <> <span className="whitespace-nowrap"><Trophy aria-hidden className={INLINE} /> {stats.points} quiz points{stats.streak > 0 && <> · <Flame aria-hidden className={INLINE} /> {stats.streak}-day streak</>}</span></>}
      </PageHeader>
      <div className="grid gap-3">
        {data.courses.map((c) => {
          const as = data.assignments.filter((a) => a.code === c.code);
          const done = as.filter((a) => a.submitted).length;
          const wk = currentWeek(c, now);
          const nd = as.find((a) => !a.submitted && a.due && at(a.due) >= now);
          const notes = data.notes.filter((n) => n.code === c.code).length;
          const quizzes = (data.quizzes ?? []).filter((q) => q.code === c.code).length;
          const exam = data.exams.find((e) => e.code === c.code && at(e.at) >= now);
          return (
            <Link key={c.code} to={`/v2/${enc(data.id)}/courses/${enc(c.code)}`} className="group">
              <Card className="relative flex items-center gap-4 overflow-hidden p-4 pl-5 transition group-hover:border-muted">
                <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: c.color }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2"><span className="font-serif text-xl font-semibold">{c.short}</span><span className="text-xs text-muted">{c.code}</span></div>
                  <div className="mt-1 text-sm"><span className="text-muted">This week:</span> {wk?.label ?? "between weeks"}{wk && progress.state === "ok" && <DoneCount count={weekProgress(c.code, wk, progress.done)} long className="ml-2 text-xs" />}</div>
                  <div className="text-sm"><span className="text-muted">Next due:</span> {nd ? `${nd.title}, ${relative(at(nd.due!), now)}` : "nothing open"}</div>
                  <div className="text-sm"><span className="text-muted">Exam:</span> {exam ? `${exam.kind}, ${exam.noTime ? fmtShort(at(exam.at)) : fmtFull(at(exam.at))} (${relative(at(exam.at), now)})` : "no date yet"}</div>
                  <div className="mt-1.5 text-xs text-muted"><NotebookPen aria-hidden className={INLINE} /> {plural(notes, "note")} · <Trophy aria-hidden className={INLINE} /> {plural(quizzes, "quiz", "quizzes")}{progress.state === "ok" && (() => { const p = courseProgress(c, progress.done); return p.total > 0 && <> · {p.done} of {p.total} watched or read</>; })()}</div>
                </div>
                <div className="flex shrink-0 flex-col items-center" title={`${done} of ${as.length} assignments handed in`}>
                  <ProgressRing value={as.length ? done / as.length : 0} color={c.color} label={`${done}/${as.length}`} />
                  <span className="mt-0.5 text-[11px] text-muted">assignments</span>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}

const TABS = [["weeks", "Weeks"], ["work", "Assignments"], ["notes", "Notes"], ["quizzes", "Quizzes"]] as const;
type Tab = (typeof TABS)[number][0];

/** One course: a slim header and tabs, instead of a long page with a sidebar. */
export function CourseView({ data, code }: { data: SemesterData; code: string }) {
  const { path, navigate } = useRouter();
  const hash = path.split("#")[1] ?? "";
  const hashWeek = /^w\d+$/.test(hash) ? Number(hash.slice(1)) : NaN;
  const tab: Tab = (TABS.find(([k]) => k === hash)?.[0]) ?? "weeks";
  const c = data.courses.find((x) => x.code === code);
  const now = new Date();
  const cur = c && currentWeek(c, now);
  const [open, setOpen] = useState<Set<number>>(() => new Set([Number.isFinite(hashWeek) ? hashWeek : cur?.index ?? -1]));
  useEffect(() => {
    if (!Number.isFinite(hashWeek)) return;
    setOpen((o) => new Set([...o, hashWeek]));
    setTimeout(() => document.getElementById(`w${hashWeek}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, [hashWeek]);
  if (!c) return <Empty>Course not found.</Empty>;

  const self = `/v2/${enc(data.id)}/courses/${enc(code)}`;
  const base = `/${enc(data.id)}`;
  const as = data.assignments.filter((a) => a.code === code);
  const notes = data.notes.filter((n) => n.code === code);
  const quizzes = (data.quizzes ?? []).filter((q) => q.code === code);
  const classes = (data.classes ?? []).filter((x) => x.code === code);
  const nextClass = upcomingClasses(data, now).find((x) => x.code === code && x.status !== "cancelled");
  const exam = data.exams.find((e) => e.code === code && e.kind === "Final exam");
  const toggle = (i: number) => setOpen((o) => { const n = new Set(o); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const count: Record<Tab, number | undefined> = { weeks: undefined, work: as.length, notes: notes.length, quizzes: quizzes.length };

  return (
    <>
      <Link to={`/v2/${enc(data.id)}/courses`} className="text-sm text-muted hover:text-ink">← Courses</Link>
      <header className="mt-2 mb-4 flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm text-muted"><span className="size-2.5 rounded-full" style={{ background: c.color }} />{c.code}{exam && <> · <GraduationCap aria-hidden className={INLINE} /> Final {fmtWhen(at(exam.at), exam.noTime)}</>}</div>
          <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight">{c.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {c.joinUrl && <a href={c.joinUrl} target="_blank" rel="noreferrer" className="rounded-full border border-line bg-surface px-3 py-1.5 hover:border-muted"><Video aria-hidden className={INLINE} /> Webconference ↗</a>}
          {c.eclassUrl && <a href={c.eclassUrl} target="_blank" rel="noreferrer" className="rounded-full border border-line bg-surface px-3 py-1.5 hover:border-muted">eClass ↗</a>}
        </div>
      </header>

      <nav role="tablist" aria-label="Course" data-tour="course-tabs" className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => navigate(k === "weeks" ? self : `${self}#${k}`)}
            className={cx("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm", tab === k ? "border-ink font-semibold text-ink" : "border-transparent text-muted hover:text-ink")}>
            {label}{count[k] !== undefined && <span className="ml-1 opacity-60">{count[k]}</span>}
          </button>
        ))}
      </nav>

      {tab === "weeks" && (
        <>
          {nextClass && (
            <div className="mb-4">
              <ClassCard c={nextClass} data={data} now={now} showCourse={false} />
              <ClassTimeEditor data={data} code={code} current={nextClass} source={c.classTimeFrom} />
            </div>
          )}
          <Card className="overflow-hidden">
            {c.weeks.map((w) => <WeekRow key={w.index} w={w} isOpen={open.has(w.index)} isNow={w.index === cur?.index} color={c.color} onToggle={() => toggle(w.index)} base={base} code={code} classes={classes.filter((x) => x.weekIndex === w.index)} quizzes={quizzes.filter((q) => q.scope === "lecture" && q.section === w.index)} data={data} />)}
          </Card>
        </>
      )}

      {tab === "work" && (
        <div className="grid gap-2">
          {as.length === 0 && <Empty>No assignments in this course.</Empty>}
          {as.map((a) => (
            <Link key={a.id} to={assignmentHref(data.id, a.id)} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition hover:border-muted">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{a.title}</span>
                <span className="text-xs text-muted">{a.due ? fmtFull(at(a.due)) : "No due date"}{!a.submitted && a.due && ` · ${relative(at(a.due), now)}`}{a.grade && <> · Grade <b className="text-ink">{a.grade}</b></>}</span>
              </span>
              <StatePill state={stateOf(a, now)} />
            </Link>
          ))}
          {c.grades && c.grades.length > 0 && (
            <Card className="mt-4 overflow-hidden">
              <div className="border-b border-line px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Grades on eClass</div>
              {c.grades.map((g, i) => (
                <div key={i} className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2 text-sm last:border-0" title={g.feedback}>
                  <span className="min-w-0 truncate">{g.item}</span><b className="shrink-0">{g.grade}</b>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {tab === "notes" && (notes.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {notes.map((n) => (
            <Link key={n.slug} to={`${base}/notes/${enc(code)}/${enc(n.slug)}`} className="rounded-xl border border-line bg-surface px-4 py-3 transition hover:border-muted">
              <span className="block font-semibold"><NotebookPen aria-hidden className={INLINE} /> {n.title}</span>
              {n.summary && <span className="mt-0.5 line-clamp-2 block text-sm text-muted">{n.summary}</span>}
            </Link>
          ))}
        </div>
      ) : <Empty>No notes yet. Open a week and press “Make notes”, or ask the AI.</Empty>)}

      {tab === "quizzes" && (
        <>
          <div className="mb-3 flex justify-end"><MakeQuizButton data={data} course={code}>Make a quiz</MakeQuizButton></div>
          <QuizJobs data={data} course={code} />
          {quizzes.length ? <Card className="p-2"><QuizLinks sem={data.id} quizzes={quizzes} withScope /></Card>
            : <Empty>No quizzes yet. Press “Make a quiz” to make one for one class or the whole course.</Empty>}
        </>
      )}
    </>
  );
}
