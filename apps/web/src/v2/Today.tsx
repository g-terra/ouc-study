import type { SemesterData } from "@ouc/content/types";
import { Link, enc } from "../lib/router";
import { courseMap } from "../lib/data";
import { at, daysBetween, fmtFull, relative } from "../lib/dates";
import { Card, CourseBadge, SectionTitle } from "../components/ui";
import { AskAiButton } from "../components/Assistant";
import { ClassCard, upcomingClasses } from "../components/Classes";
import { PlanCard, currentPlan } from "../pages/Plan";
import { ORDER, UpdateRow } from "../pages/Updates";
import { DayGroups, EvRow, agenda, assignmentHref } from "./agenda";
import { unreadItems } from "./Notifications";
import { GraduationCap, INLINE, PartyPopper } from "../components/icons";

/**
 * Today: what to do next and nothing else. Overdue work first (only when there is some), then the next deadline and class, this week's plan, the next 7 days,
 * and what's new on eClass only when something is. Everything else is one tap away (Courses, Calendar, the bell).
 */
export function Today({ data }: { data: SemesterData }) {
  const now = new Date();
  const base = `/v2/${enc(data.id)}`;
  const C = courseMap(data);
  const next = data.assignments.find((a) => !a.submitted && a.due && at(a.due) > now);
  // the soonest class of any course (data.classes is ordered course by course)
  const nextClass = upcomingClasses(data, now).filter((c) => c.status !== "cancelled").sort((a, b) => at(a.at).getTime() - at(b.at).getTime())[0];
  const exam = data.exams.find((e) => e.kind === "Final exam" && at(e.at) >= now);
  const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  const all = agenda(data, now).filter((e) => !e.done);
  // past due and not handed in: first on Today, as on the Calendar
  const overdue = all.filter((e) => e.kind === "due" && e.t < now);
  const week = all.filter((e) => !(e.kind === "due" && e.t < now) && e.t >= new Date(now.getTime() - 3_600_000) && e.t < weekEnd);
  const fresh = unreadItems(data).sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
  const hour = now.getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      <header className="mb-6">
        <div className="mb-1 text-sm text-muted">{now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">{greet}.</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <AskAiButton action="plan-week">{currentPlan(data) ? "Update my plan" : "Plan my week"}</AskAiButton>
          {exam && (
            <span className="rounded-full bg-surface-2 px-3 py-1.5 text-sm text-muted" title={fmtFull(at(exam.at))}>
              <GraduationCap aria-hidden className={INLINE} /> First final in <b className="text-ink">{daysBetween(now, at(exam.at))} days</b> · {C[exam.code]?.short}
            </span>
          )}
        </div>
      </header>

      {overdue.length > 0 && (
        <section className="mb-4" aria-label="Overdue">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-bad">Overdue · {overdue.length}</h2>
          <Card className="grid grid-cols-1 gap-0.5 border-bad/40 p-2">{overdue.map((e, i) => <EvRow key={i} e={e} course={C[e.code]} now={now} />)}</Card>
        </section>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {next ? (
          <Link to={assignmentHref(data.id, next.id)} className="group">
            <Card className="relative h-full overflow-hidden p-4 transition group-hover:border-muted">
              <div className="absolute inset-y-0 left-0 w-1" style={{ background: C[next.code]?.color }} />
              <div className="text-xs font-semibold uppercase tracking-wider text-muted">Next deadline</div>
              <div className="mt-1 font-serif text-xl font-semibold leading-snug">{next.title}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
                <CourseBadge course={C[next.code]} /> {fmtFull(at(next.due!))} · <b className="text-ink">{relative(at(next.due!), now)}</b>
              </div>
            </Card>
          </Link>
        ) : <Card className="grid place-items-center p-4 text-muted"><span className="flex items-center gap-2"><PartyPopper aria-hidden className="size-4" />Nothing due right now.</span></Card>}
        {nextClass && (
          <div>
            <div className="sr-only">Next live class</div>
            <ClassCard c={nextClass} data={data} now={now} />
          </div>
        )}
      </div>

      <PlanCard data={data} className="mt-3" />

      <SectionTitle right={<Link to={`${base}/calendar`} className="text-sm text-muted hover:text-ink">Calendar →</Link>}>Next 7 days</SectionTitle>
      <Card className="p-2 sm:p-3">
        {week.length ? <DayGroups events={week} data={data} now={now} /> : <p className="p-4 text-center text-muted">A quiet week: nothing due and no live classes.</p>}
      </Card>

      {fresh.length > 0 && (
        <>
          <SectionTitle right={<Link to={`${base}/notifications`} className="text-sm text-muted hover:text-ink">All notifications →</Link>}>New on eClass · {fresh.length}</SectionTitle>
          <div className="grid gap-2">
            {fresh.slice(0, 3).map((u, i) => <UpdateRow key={i} u={u} data={data} compact />)}
          </div>
        </>
      )}
    </>
  );
}
