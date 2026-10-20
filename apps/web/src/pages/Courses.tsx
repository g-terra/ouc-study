import { useEffect, useState } from "react";
import type { ClassSession, Quiz, SemesterData, Week } from "@ouc/content/types";
import { Link, enc, useRouter } from "../lib/router";
import { currentWeek, stateOf } from "../lib/data";
import { at, day, fmtDay, fmtFull, fmtShort, fmtTime, relative } from "../lib/dates";
import { Card, Empty, FileLink, PageHeader, ProgressRing, SectionTitle, StatePill, cx, isMaterial, kindIcon } from "../components/ui";
import { AskAiButton } from "../components/Assistant";
import { ClassCard, ClassTimeEditor, JoinButton, upcomingClasses } from "../components/Classes";
import { quizHref, quizScopeLabel } from "./Quizzes";
import { MakeQuizButton, QuizJobs } from "../components/MakeQuiz";
import { pct, useAttempts } from "../lib/quiz";

export function Courses({ data }: { data: SemesterData }) {
  const base = `/${enc(data.id)}`;
  return (
    <>
      <PageHeader title="Courses" eyebrow={data.label}>{data.courses.length} courses this semester.</PageHeader>
      <div className="grid gap-4 md:grid-cols-3">
        {data.courses.map((c) => {
          const as = data.assignments.filter((a) => a.code === c.code);
          const done = as.filter((a) => a.submitted).length;
          const wk = currentWeek(c);
          return (
            <Link key={c.code} to={`${base}/courses/${enc(c.code)}`} className="group">
              <Card className="h-full overflow-hidden transition group-hover:border-muted">
                <div className="flex h-24 items-end p-5 text-white" style={{ background: `linear-gradient(135deg, ${c.color}, ${c.color}cc)` }}>
                  <div><div className="text-xs opacity-80">{c.code}</div><div className="font-serif text-xl font-semibold">{c.short}</div></div>
                </div>
                <div className="flex items-center gap-4 p-5">
                  <ProgressRing value={as.length ? done / as.length : 0} color={c.color} label={`${done}/${as.length}`} />
                  <div className="text-sm"><div className="text-muted">Now</div><div className="font-medium leading-snug">{wk?.label ?? "Between weeks"}</div></div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}

export function CoursePage({ data, code }: { data: SemesterData; code: string }) {
  const { path } = useRouter();
  const c = data.courses.find((x) => x.code === code);
  const base = `/${enc(data.id)}`;
  const now = new Date();
  const hashWeek = Number(path.split("#w")[1]);
  const cur = c && currentWeek(c, now);
  const [open, setOpen] = useState<Set<number>>(() => new Set([Number.isFinite(hashWeek) ? hashWeek : cur?.index ?? -1]));
  useEffect(() => {
    if (Number.isFinite(hashWeek)) {
      setOpen((o) => new Set([...o, hashWeek]));
      setTimeout(() => document.getElementById(`w${hashWeek}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  }, [hashWeek]);
  if (!c) return <Empty>Course not found.</Empty>;

  const as = data.assignments.filter((a) => a.code === code);
  const notes = data.notes.filter((n) => n.code === code);
  const quizzes = (data.quizzes ?? []).filter((q) => q.code === code);
  const exams = data.exams.filter((e) => e.code === code);
  const upcoming = as.filter((a) => !a.submitted && a.due && at(a.due) >= now);
  const classes = (data.classes ?? []).filter((x) => x.code === code);
  const nextClass = upcomingClasses(data, now).find((x) => x.code === code && x.status !== "cancelled");
  const toggle = (i: number) => setOpen((o) => { const n = new Set(o); n.has(i) ? n.delete(i) : n.add(i); return n; });

  return (
    <>
      <div className="-mt-8 mb-8 overflow-hidden rounded-b-3xl px-6 pb-8 pt-10 text-white sm:px-8" style={{ background: `linear-gradient(135deg, ${c.color}, ${c.color}bb)` }}>
        <Link to={`${base}/courses`} className="text-sm opacity-80 hover:opacity-100">← All courses</Link>
        <div className="mt-3 text-sm opacity-80">{c.code} · {data.label}</div>
        <h1 className="font-serif text-3xl font-semibold sm:text-4xl">{c.title}</h1>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-white/20 px-3 py-1">{as.filter((a) => a.submitted).length}/{as.length} assignments submitted</span>
          <span className="rounded-full bg-white/20 px-3 py-1">📒 {notes.length} notes</span>
          {exams.filter((e) => e.kind === "Final exam").map((e) => <span key={e.at} className="rounded-full bg-white/20 px-3 py-1">🎓 Final {fmtFull(at(e.at))}</span>)}
          {c.joinUrl && <a href={c.joinUrl} target="_blank" rel="noreferrer" className="rounded-full bg-white/20 px-3 py-1 hover:bg-white/30">🎥 Webconference ↗</a>}
          {c.eclassUrl && <a href={c.eclassUrl} target="_blank" rel="noreferrer" className="rounded-full bg-white px-3 py-1 font-semibold" style={{ color: c.color }}>Open on eClass ↗</a>}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <section>
          <SectionTitle right={<button className="text-sm text-muted hover:text-ink" onClick={() => setOpen(open.size > 1 ? new Set() : new Set(c.weeks.map((w) => w.index)))}>{open.size > 1 ? "Collapse all" : "Expand all"}</button>}>Week by week</SectionTitle>
          <Card className="overflow-hidden">
            {c.weeks.map((w) => <WeekRow key={w.index} w={w} isOpen={open.has(w.index)} isNow={w.index === cur?.index} color={c.color} onToggle={() => toggle(w.index)} base={base} code={code} classes={classes.filter((x) => x.weekIndex === w.index)} quizzes={quizzes.filter((q) => q.scope === "lecture" && q.section === w.index)} data={data} />)}
          </Card>
        </section>
        <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          {nextClass && (
            <div>
              <SectionTitle>Next live class</SectionTitle>
              <ClassCard c={nextClass} data={data} now={now} showCourse={false} />
              <ClassTimeEditor data={data} code={code} current={nextClass} source={c.classTimeFrom} />
            </div>
          )}
          <div>
            <SectionTitle>Upcoming</SectionTitle>
            {upcoming.length ? (
              <div className="grid gap-2">
                {upcoming.slice(0, 5).map((a) => (
                  <Link key={a.id} to={`${base}/assignments/${a.id.split("/").map(enc).join("/")}`} className="rounded-xl border border-line bg-surface px-3 py-2.5 transition hover:border-muted">
                    <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold">{a.title}</span><StatePill state={stateOf(a, now)} /></div>
                    <div className="mt-0.5 text-xs text-muted">{fmtFull(at(a.due!))} · {relative(at(a.due!), now)}</div>
                  </Link>
                ))}
              </div>
            ) : <Empty>Nothing open.</Empty>}
          </div>
          {c.grades && c.grades.length > 0 && (
            <div>
              <SectionTitle>Grades</SectionTitle>
              <div className="overflow-hidden rounded-xl border border-line bg-surface">
                {c.grades.map((g, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-3 border-b border-line px-3 py-2 text-sm last:border-0" title={g.feedback}>
                    <span className="min-w-0 truncate">{g.item}</span><b className="shrink-0">{g.grade}</b>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <SectionTitle right={<MakeQuizButton data={data} course={code}>Make a quiz</MakeQuizButton>}>Quizzes</SectionTitle>
            <QuizJobs data={data} course={code} />
            {quizzes.length ? <QuizLinks sem={data.id} quizzes={quizzes} withScope /> : <Empty>No quizzes yet. Press “Make a quiz” to make one for one class or the whole course.</Empty>}
          </div>
          <div>
            <SectionTitle>Notes</SectionTitle>
            {notes.length ? (
              <div className="grid gap-1.5">
                {notes.map((n) => (
                  <Link key={n.slug} to={`${base}/notes/${enc(code)}/${enc(n.slug)}`} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                    <span>📒</span><span className="leading-snug">{n.title}</span>
                  </Link>
                ))}
              </div>
            ) : <Empty>No notes yet. Open a week and press “Make notes”, or ask the AI.</Empty>}
          </div>
        </aside>
      </div>
    </>
  );
}

/** Links to quizzes with the best score so far. */
export function QuizLinks({ sem, quizzes, withScope = false }: { sem: string; quizzes: Quiz[]; withScope?: boolean }) {
  const { stats } = useAttempts(sem);
  return (
    <div className="grid gap-1.5">
      {quizzes.map((q) => {
        const b = stats.best[q.id];
        return (
          <Link key={q.id} to={quizHref(sem, q)} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
            <span aria-hidden>🏆</span>
            <span className="min-w-0 flex-1 leading-snug">{withScope && q.scope === "course" ? `${quizScopeLabel(q)}: ` : ""}{q.title}</span>
            <span className={cx("shrink-0 text-xs", b?.pct === 1 ? "font-semibold text-ok" : "text-muted")}>{b ? `best ${pct(b.pct)}` : `${q.questions.length} questions`}</span>
          </Link>
        );
      })}
    </div>
  );
}

export function WeekRow({ w, isOpen, isNow, color, onToggle, base, code, classes, quizzes, data }: { w: Week; isOpen: boolean; isNow: boolean; color: string; onToggle: () => void; base: string; code: string; classes: ClassSession[]; quizzes: Quiz[]; data: SemesterData }) {
  const dates = w.start ? `${fmtShort(day(w.start))} – ${fmtShort(day(w.end!))}${w.estimated ? " (est.)" : ""}` : "";
  const counts = w.items.reduce<Record<string, number>>((m, i) => ((m[i.kind] = (m[i.kind] ?? 0) + 1), m), {});
  return (
    <div id={`w${w.index}`} className={cx("scroll-mt-24 border-b border-line last:border-0", isNow && "bg-warn-bg/50")}>
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-2/60">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg text-xs font-bold" style={isNow ? { background: color, color: "white" } : { background: "var(--surface-2)" }}>
          {w.index === 0 ? "★" : w.index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{w.label}</span>
          <span className="block text-xs text-muted">
            {dates}
            {classes.map((x) => <span key={x.at} className={cx("ml-2", x.status === "cancelled" && "line-through")}>🎥 {fmtDay(at(x.at))} {fmtTime(at(x.at))}</span>)}
            {isNow && <b className="ml-2 uppercase tracking-wider text-accent">This week</b>}
          </span>
        </span>
        <span className="hidden gap-2 text-xs text-muted sm:flex">
          {counts.note && <span>📒{counts.note}</span>}
          {counts.file && <span>📄{counts.file}</span>}
          {counts.video && <span>🎬{counts.video}</span>}
          {counts.assignment && <span>📝{counts.assignment}</span>}
          {quizzes.length > 0 && <span>🏆{quizzes.length}</span>}
        </span>
        <span className={cx("text-muted transition", isOpen && "rotate-90")}>›</span>
      </button>
      {isOpen && (
        <div className="px-4 pb-4 pl-[3.75rem]">
          {w.summary && <p className="mb-3 text-sm text-muted">{w.summary}</p>}
          {classes.map((x) => (
            <div key={x.at} className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <span className={cx(x.status === "cancelled" && "line-through")}>🎥 Live class {fmtDay(at(x.at))}, {fmtTime(at(x.at))}</span>
              {x.status !== "scheduled" && <span className="text-xs text-warn">{x.status}{x.note ? ` · ${x.note}` : ""}</span>}
              {x.extras.map((f) => <FileLink key={f.href} href={f.href} className="text-xs underline">{f.title}</FileLink>)}
              <JoinButton c={x} className="ml-auto" />
            </div>
          ))}
          <ul className="grid gap-1">
            {w.items.map((it, i) => {
              const href = it.kind === "note" ? `${base}/notes/${enc(code)}/${enc(it.noteSlug!)}`
                : it.kind === "assignment" && it.assignmentId ? `${base}/assignments/${it.assignmentId.split("/").map(enc).join("/")}` : it.href;
              const internal = it.kind === "note" || it.kind === "assignment";
              const cls = cx("flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2", it.kind === "note" && "font-semibold");
              const inner = <><span>{kindIcon(it.kind, it.ext)}</span><span className="leading-snug">{it.kind === "note" ? `My notes: ${it.title}` : it.title}{it.external && <span className="text-muted"> ↗</span>}</span></>;
              const link = !href ? <span className={cls}>{inner}</span> : internal ? <Link to={href} className={cls}>{inner}</Link> : <FileLink href={href} className={cls}>{inner}</FileLink>;
              return <li key={i} className={cx(it.transcript && "flex items-start gap-2")}>{link}{it.transcript && <a href={it.transcript} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-muted underline hover:text-ink">Transcript</a>}</li>;
            })}
          </ul>
          {w.items.length === 0 && <p className="text-sm text-muted">Nothing posted for this week.</p>}
          {quizzes.length > 0 && <div className="mt-2"><QuizLinks sem={data.id} quizzes={quizzes} /></div>}
          {w.index > 0 && w.items.some(isMaterial) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {!w.items.some((i) => i.kind === "note") && <AskAiButton action="make-notes" params={{ course: code, week: String(w.index) }}>Make notes</AskAiButton>}
              <AskAiButton action="quiz-me" params={{ course: code, week: String(w.index) }}>Quiz me</AskAiButton>
              <MakeQuizButton data={data} course={code} week={String(w.index)}>{quizzes.length ? "Make another quiz" : "Make a quiz"}</MakeQuizButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

