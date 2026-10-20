import type { ClassSession, Course, SemesterData } from "@ouc/content/types";
import { Link, enc } from "../lib/router";
import { courseMap, stateOf, type State } from "../lib/data";
import { at, fmtTime, relative } from "../lib/dates";
import { JoinButton } from "../components/Classes";
import { CourseDot, StatePill, cx } from "../components/ui";
import { GraduationCap, INLINE } from "../components/icons";

/** One dated thing: a deadline, a live class or an exam. */
export type Ev =
  | { kind: "due"; code: string; t: Date; title: string; href: string; done: boolean; state: State; grade?: string }
  | { kind: "class"; code: string; t: Date; title: string; href: string; done: boolean; session: ClassSession }
  | { kind: "exam"; code: string; t: Date; title: string; href?: string; done: boolean; noTime?: boolean };

export const assignmentHref = (sem: string, id: string) => `/${enc(sem)}/assignments/${id.split("/").map(enc).join("/")}`;

/** Everything dated in the semester, oldest first (links are classic paths; the v2 router maps them). */
export function agenda(data: SemesterData, now = new Date()): Ev[] {
  const C = courseMap(data);
  const base = `/${enc(data.id)}`;
  return [
    ...data.assignments.filter((a) => a.due).map((a): Ev => ({
      kind: "due", code: a.code, t: at(a.due!), title: a.title, done: a.submitted, state: stateOf(a, now), grade: a.grade,
      href: assignmentHref(data.id, a.id),
    })),
    ...(data.classes ?? []).filter((c) => c.status !== "cancelled").map((c): Ev => ({
      kind: "class", code: c.code, t: at(c.at), session: c, done: new Date(c.end) < now,
      title: C[c.code]?.weeks.find((w) => w.index === c.weekIndex)?.label ?? "Live class",
      href: `${base}/courses/${enc(c.code)}${c.weekIndex !== undefined ? `#w${c.weekIndex}` : ""}`,
    })),
    ...data.exams.map((e): Ev => ({ kind: "exam", code: e.code, t: at(e.at), title: e.kind, noTime: e.noTime, href: e.source, done: at(e.at) < now })),
  ].sort((a, b) => a.t.getTime() - b.t.getTime());
}

const KIND = { due: "Due", class: "Live class", exam: "Exam" } as const;

/** One row of the agenda: time, course, what, and its state or join button. */
export function EvRow({ e, course, now = new Date() }: { e: Ev; course?: Course; now?: Date }) {
  const body = (
    <>
      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted">{e.kind === "exam" && e.noTime ? "" : fmtTime(e.t)}</span>
      <CourseDot color={course?.color ?? "#999"} />
      <span className="min-w-0 flex-1">
        <span className={cx("block truncate text-sm", e.kind !== "class" && "font-semibold", e.done && "text-muted line-through decoration-muted/50")}>
          {e.kind === "exam" ? <><GraduationCap aria-hidden className={INLINE} /> {course?.short ?? e.code} · {e.title}</> : e.title}
        </span>
        <span className="block text-xs text-muted">{course?.short} · {KIND[e.kind]}{!e.done && ` · ${relative(e.t, now)}`}</span>
      </span>
      {e.kind === "due" && <StatePill state={e.state} grade={e.grade} />}
    </>
  );
  const cls = cx("flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-surface-2",
    e.kind === "due" && e.state === "soon" && "bg-warn-bg/60", e.kind === "due" && e.state === "late" && "bg-bad-bg/60", e.kind === "exam" && "bg-surface-2");
  return (
    <div className="flex min-w-0 items-center gap-2">
      {e.href && e.kind === "exam" ? <a href={e.href} target="_blank" rel="noreferrer" className={cx(cls, "flex-1")}>{body}</a>
        : e.href ? <Link to={e.href} className={cx(cls, "min-w-0 flex-1")}>{body}</Link>
        : <div className={cx(cls, "flex-1")}>{body}</div>}
      {e.kind === "class" && !e.done && <JoinButton c={e.session} now={now} />}
    </div>
  );
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Events grouped by day, with "Today" and "Tomorrow" spelled out. */
export function DayGroups({ events, data, now = new Date() }: { events: Ev[]; data: SemesterData; now?: Date }) {
  const C = courseMap(data);
  const groups: { key: string; d: Date; evs: Ev[] }[] = [];
  for (const e of events) {
    const k = dayKey(e.t);
    if (groups[groups.length - 1]?.key === k) groups[groups.length - 1].evs.push(e);
    else groups.push({ key: k, d: e.t, evs: [e] });
  }
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const name = (d: Date) => dayKey(d) === dayKey(now) ? "Today" : dayKey(d) === dayKey(tomorrow) ? "Tomorrow"
    : d.toLocaleDateString("en-GB", { weekday: "long" });
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.key}>
          <h3 className="mb-1 flex items-baseline gap-2 px-3 text-sm font-semibold">
            {name(g.d)}<span className="font-normal text-muted">{g.d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
          </h3>
          <div className="grid grid-cols-1 gap-0.5">{g.evs.map((e, i) => <EvRow key={i} e={e} course={C[e.code]} now={now} />)}</div>
        </section>
      ))}
    </div>
  );
}
