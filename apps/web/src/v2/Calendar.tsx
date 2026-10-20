import { useState, type ReactNode } from "react";
import type { SemesterData } from "@ouc/content/types";
import { courseMap } from "../lib/data";
import { addDays, startOfWeek, weekRange } from "../lib/dates";
import { Card, CourseDot, Empty, PageHeader, cx } from "../components/ui";
import { DayGroups, EvRow, agenda, type Ev } from "./agenda";

type Show = "all" | "due" | "class" | "exam";
type View = "upcoming" | "done";

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cx("flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm", on ? "border-ink bg-ink text-bg" : "border-line bg-surface text-muted hover:text-ink")}>
      {children}
    </button>
  );
}

/**
 * Calendar: the classic Timeline and Assignments pages in one. Upcoming deadlines, live classes and exams,
 * week by week; "Submitted" lists the work handed in, with grades.
 */
export function Calendar({ data }: { data: SemesterData }) {
  const now = new Date();
  const C = courseMap(data);
  const [view, setView] = useState<View>("upcoming");
  const [show, setShow] = useState<Show>("all");
  const [course, setCourse] = useState("all");
  const all = agenda(data, now).filter((e) => course === "all" || e.code === course);
  const open = data.assignments.filter((a) => !a.submitted).length;

  const upcoming = all.filter((e) => !e.done && (show === "all" || e.kind === show));
  const overdue = upcoming.filter((e) => e.kind === "due" && e.t < now);
  const ahead = upcoming.filter((e) => !(e.kind === "due" && e.t < now));
  const weeks: { start: Date; evs: Ev[] }[] = [];
  for (const e of ahead) {
    const s = startOfWeek(e.t);
    const last = weeks[weeks.length - 1];
    if (last && last.start.getTime() === s.getTime()) last.evs.push(e);
    else weeks.push({ start: s, evs: [e] });
  }
  const thisWeek = startOfWeek(now).getTime();
  const weekName = (s: Date) => s.getTime() === thisWeek ? "This week" : s.getTime() === addDays(new Date(thisWeek), 7).getTime() ? "Next week" : `Week of ${weekRange(s)}`;
  const done = all.filter((e) => e.kind === "due" && e.done).reverse();

  return (
    <>
      <PageHeader title="Calendar" eyebrow={data.label}>{open} assignment{open === 1 ? "" : "s"} still to hand in. Deadlines, live classes and exams, week by week.</PageHeader>
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="View">
        <Chip on={view === "upcoming"} onClick={() => setView("upcoming")}>Upcoming</Chip>
        <Chip on={view === "done"} onClick={() => setView("done")}>Submitted <span className="opacity-60">{data.assignments.length - open}</span></Chip>
      </div>
      {/* courses on one line of their own (scrolls sideways inside the page if they don't fit) */}
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Course">
        {[["all", "All courses"] as const, ...data.courses.map((c) => [c.code, c.short] as const)].map(([k, label]) => (
          <Chip key={k} on={course === k} onClick={() => setCourse(k)}>{k !== "all" && <CourseDot color={C[k].color} />}{label}</Chip>
        ))}
      </div>
      {view === "upcoming" && (
        <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Show">
          {(["all", "due", "class", "exam"] as const).map((k) => (
            <Chip key={k} on={show === k} onClick={() => setShow(k)}>{{ all: "Everything", due: "📝 Deadlines", class: "🎥 Classes", exam: "🎓 Exams" }[k]}</Chip>
          ))}
        </div>
      )}
      {view === "done" && <div className="mb-3" />}

      {view === "upcoming" ? (
        <div className="space-y-6">
          {overdue.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-bad">Overdue</h2>
              <Card className="grid grid-cols-1 gap-0.5 p-2">{overdue.map((e, i) => <EvRow key={i} e={e} course={C[e.code]} now={now} />)}</Card>
            </section>
          )}
          {weeks.map((w) => (
            <section key={w.start.getTime()}>
              <h2 className={cx("mb-2 text-xs font-semibold uppercase tracking-[0.12em]", w.start.getTime() === thisWeek ? "text-accent" : "text-muted")}>
                {weekName(w.start)} <span className="ml-1 font-normal normal-case tracking-normal">{w.evs.length} item{w.evs.length === 1 ? "" : "s"}</span>
              </h2>
              <Card className={cx("p-2 sm:p-3", w.start.getTime() === thisWeek && "border-accent/50")}>
                <DayGroups events={w.evs} data={data} now={now} />
              </Card>
            </section>
          ))}
          {!weeks.length && !overdue.length && <Empty>Nothing coming up.</Empty>}
        </div>
      ) : (
        <Card className="grid grid-cols-1 gap-0.5 p-2">
          {done.length ? done.map((e, i) => <EvRow key={i} e={e} course={C[e.code]} now={now} />) : <Empty>Nothing submitted yet.</Empty>}
        </Card>
      )}
    </>
  );
}
