import { useMemo, useState } from "react";
import type { SemesterData } from "@ouc/content/types";
import { Link, enc } from "../lib/router";
import { courseMap, stateOf } from "../lib/data";
import { addDays, at, day, fmtFull, fmtShort, startOfWeek, weekRange } from "../lib/dates";
import { Card, CourseDot, PageHeader, cx } from "../components/ui";

type Ev =
  | { kind: "due"; code: string; t: Date; title: string; href: string; done: boolean; state: string }
  | { kind: "exam"; code: string; t: Date; title: string; noTime?: boolean; href?: string };

export function Timeline({ data }: { data: SemesterData }) {
  const now = new Date();
  const base = `/${enc(data.id)}`;
  const C = courseMap(data);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [topics, setTopics] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [showPast, setShowPast] = useState(false);

  const events: Ev[] = useMemo(() => [
    ...data.assignments.filter((a) => a.due).map((a) => ({
      kind: "due" as const, code: a.code, t: at(a.due!), title: a.title, done: a.submitted, state: stateOf(a, now),
      href: `${base}/assignments/${a.id.split("/").map(enc).join("/")}`,
    })),
    ...data.exams.map((e) => ({ kind: "exam" as const, code: e.code, t: at(e.at), title: e.kind, noTime: e.noTime, href: e.source })),
  ].sort((a, b) => a.t.getTime() - b.t.getTime()), [data]);

  const visible = events.filter((e) => !hidden.has(e.code) && (showDone || e.kind === "exam" || !e.done));

  // weeks from semester start to last event
  const first = startOfWeek(day(data.start));
  const last = startOfWeek(events.length ? events[events.length - 1].t : day(data.end));
  const weeks: Date[] = [];
  for (let w = first; w <= last; w = addDays(w, 7)) weeks.push(w);
  const thisWeek = startOfWeek(now).getTime();

  // overview strip: semester start → last final exam
  const finals = data.exams.filter((e) => e.kind === "Final exam");
  const stripEnd = finals.length ? at(finals[finals.length - 1].at) : day(data.end);
  const span = stripEnd.getTime() - first.getTime();
  const months: Date[] = [];
  for (let m = new Date(first.getFullYear(), first.getMonth() + 1, 1); m < stripEnd; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) months.push(m);
  const pos = (d: Date) => `${Math.min(100, Math.max(0, ((d.getTime() - first.getTime()) / span) * 100))}%`;

  const topicFor = (w: Date, code: string) =>
    C[code]?.weeks.find((x) => x.start && Math.abs(startOfWeek(addDays(day(x.start), 3)).getTime() - w.getTime()) < 86_400_000);

  const toggle = (code: string) => setHidden((h) => { const n = new Set(h); n.has(code) ? n.delete(code) : n.add(code); return n; });

  const pastWeeks = weeks.filter((w) => w.getTime() < thisWeek);
  const shown = showPast ? weeks : weeks.filter((w) => w.getTime() >= thisWeek);
  let lastMonth = -1;

  return (
    <>
      <PageHeader title="Timeline" eyebrow={data.label}>Deadlines and exams week by week. Turn on topics to see what each course covers.</PageHeader>

      {/* overview strip */}
      <Card className="mb-6 p-5 pb-8">
        <div className="mb-4 flex items-center justify-between text-xs text-muted">
          <span>{fmtShort(first)}</span><span>Semester at a glance</span><span>{fmtShort(stripEnd)}</span>
        </div>
        <div className="relative h-10">
          <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-surface-2" />
          <div className="absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-ink/25" style={{ width: pos(now) }} />
          {visible.filter((e) => e.kind === "due" && e.t <= stripEnd).map((e, i) => (
            <span key={i} title={`${C[e.code]?.short}: ${e.title}, ${fmtFull(e.t)}`}
              className={cx("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface", e.kind === "due" && e.done && "opacity-35")}
              style={{ left: pos(e.t), background: C[e.code]?.color }} />
          ))}
          {finals.filter((e) => !hidden.has(e.code)).map((e) => (
            <span key={e.code} title={`${C[e.code]?.short} final exam, ${fmtFull(at(e.at))}`} className="absolute -top-1 -translate-x-1/2 text-lg" style={{ left: pos(at(e.at)) }}>🎓</span>
          ))}
          <span className="absolute top-0 h-full w-0.5 -translate-x-1/2 bg-accent" style={{ left: pos(now) }} />
          <span className="absolute -top-4 -translate-x-1/2 text-[10px] font-semibold text-accent" style={{ left: pos(now) }}>today</span>
          {/* a tick and label at the start of each month */}
          {months.map((m) => (
            <span key={m.getTime()} className="absolute top-full -translate-x-1/2" style={{ left: pos(m) }}>
              <span className="mx-auto block h-1.5 w-px bg-line" />
              <span className="block text-[10px] text-muted">{m.toLocaleDateString("en-GB", { month: "short" })}</span>
            </span>
          ))}
        </div>
      </Card>

      {/* controls */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {data.courses.map((c) => (
          <button key={c.code} onClick={() => toggle(c.code)}
            className={cx("flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition", hidden.has(c.code) ? "border-line text-muted line-through opacity-60" : "border-line bg-surface")}>
            <CourseDot color={c.color} /> {c.short}
          </button>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
        <Toggle on={topics} set={setTopics}>Show topics</Toggle>
        <Toggle on={showDone} set={setShowDone}>Show submitted</Toggle>
      </div>

      {pastWeeks.length > 0 && (
        <button onClick={() => setShowPast((v) => !v)} className="mb-4 w-full rounded-xl border border-dashed border-line py-2.5 text-sm text-muted hover:text-ink">
          {showPast ? "Hide past weeks" : `Show ${pastWeeks.length} past weeks`}
        </button>
      )}

      {/* agenda */}
      <ol className="relative">
        <span className="absolute bottom-2 left-[8rem] top-2 hidden w-px bg-line sm:block" />
        {groupQuiet(shown, (w) => visible.some((e) => e.t >= w && e.t < addDays(w, 7)) || (topics && data.courses.some((c) => !hidden.has(c.code) && topicFor(w, c.code)))).map((g) => {
          if (Array.isArray(g)) {
            const mh = g[0].getMonth() !== lastMonth ? (lastMonth = g[0].getMonth(), g[0].toLocaleDateString("en-GB", { month: "long", year: "numeric" })) : null;
            return (
              <li key={g[0].getTime()}>
              {mh && <div className="mb-2 mt-8 font-serif text-lg font-semibold sm:pl-36">{mh}</div>}
              <div className="relative grid gap-2 py-1.5 sm:grid-cols-[7rem_1fr] sm:gap-8">
                <div className="text-xs text-muted/70 sm:text-right">{g.length > 1 ? `${fmtShort(g[0])} – ${fmtShort(addDays(g[g.length - 1], 6))}` : weekRange(g[0])}</div>
                <span className="absolute left-[8rem] top-3 hidden size-1.5 -translate-x-1/2 rounded-full bg-line sm:block" />
                <span className="text-xs text-muted/70">{g.length > 1 ? `${g.length} quiet weeks` : "Quiet week"}</span>
              </div>
              </li>
            );
          }
          const w = g;
          const end = addDays(w, 7);
          const evs = visible.filter((e) => e.t >= w && e.t < end);
          const isNow = w.getTime() === thisWeek;
          const past = w.getTime() < thisWeek;
          const month = w.getMonth();
          const monthHeader = month !== lastMonth ? (lastMonth = month, w.toLocaleDateString("en-GB", { month: "long", year: "numeric" })) : null;
          const tps = topics ? data.courses.filter((c) => !hidden.has(c.code)).map((c) => [c, topicFor(w, c.code)] as const).filter(([, t]) => t) : [];
          const quiet = evs.length === 0 && tps.length === 0;
          return (
            <li key={w.getTime()}>
              {monthHeader && <div className="mb-2 mt-8 font-serif text-lg font-semibold first:mt-0 sm:pl-36">{monthHeader}</div>}
              <div className={cx("relative grid gap-2 sm:grid-cols-[7rem_1fr] sm:gap-8", quiet ? "py-1.5" : "py-3", past && "opacity-60")}>
                <div className="flex items-center gap-2 sm:block sm:pt-0.5 sm:text-right">
                  <div className={cx("text-sm", isNow ? "font-semibold text-accent" : "text-muted")}>{weekRange(w)}</div>
                  {isNow && <div className="text-[11px] font-bold uppercase tracking-wider text-accent">This week</div>}
                </div>
                <span className={cx("absolute left-[8rem] top-4 hidden -translate-x-1/2 rounded-full sm:block", isNow ? "size-3.5 bg-accent ring-4 ring-accent/20" : evs.length ? "size-2.5 bg-ink/60" : "size-1.5 bg-line")} />
                <div className={cx(isNow && "rounded-2xl border border-accent/30 bg-surface p-3 sm:-ml-3")}>
                  {quiet ? <span className="text-xs text-muted/70">Quiet week</span> : (
                    <div className="flex flex-col gap-2">
                      {evs.map((e, i) => <EventChip key={i} e={e} color={C[e.code]?.color ?? "#888"} course={C[e.code]?.short ?? e.code} />)}
                      {tps.length > 0 && (
                        <div className={cx("grid gap-1", evs.length > 0 && "mt-1 border-t border-line pt-2")}>
                          {tps.map(([c, t]) => (
                            <Link key={c.code} to={`${base}/courses/${enc(c.code)}#w${t!.index}`} className="flex items-baseline gap-2 text-sm text-muted hover:text-ink">
                              <CourseDot color={c.color} className="translate-y-[1px]" /> <span className="truncate">{t!.label}</span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function Toggle({ on, set, children }: { on: boolean; set: (v: boolean) => void; children: string }) {
  return (
    <button onClick={() => set(!on)} aria-pressed={on}
      className={cx("flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition", on ? "border-ink bg-ink text-bg" : "border-line bg-surface text-muted")}>
      <span className={cx("size-2 rounded-full", on ? "bg-bg" : "bg-line")} /> {children}
    </button>
  );
}

function EventChip({ e, color, course }: { e: Ev; color: string; course: string }) {
  const when = e.kind === "exam" && e.noTime ? e.t.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" }) : fmtFull(e.t);
  const finalExam = e.kind === "exam" && e.title === "Final exam";
  const body = (
    <span style={finalExam ? { background: `${color}1f`, borderColor: `${color}66` } : undefined} className={cx("flex items-center gap-3 rounded-xl border px-3 py-2 transition hover:border-muted",
      e.kind === "exam" ? (e.title === "Final exam" ? "border-transparent text-ink" : "border-dashed border-line bg-transparent text-muted") : e.done ? "border-line bg-surface opacity-60" : e.state === "soon" ? "border-warn/50 bg-warn-bg" : "border-line bg-surface")}>
      <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{e.kind === "exam" ? `🎓 ${course} · ${e.title}` : e.title}</span>
        <span className="block text-xs text-muted">{e.kind === "due" && `${course} · `}{when}</span>
      </span>
      {e.kind === "due" && <span className="text-xs">{e.done ? "✓" : "⏰"}</span>}
    </span>
  );
  if (e.kind === "due") return <Link to={e.href}>{body}</Link>;
  return e.href ? <a href={e.href} target="_blank" rel="noreferrer">{body}</a> : body;
}

/** Groups consecutive weeks for which busy(w) is false into arrays (rendered as one compact row). */
function groupQuiet(weeks: Date[], busy: (w: Date) => boolean): (Date | Date[])[] {
  const out: (Date | Date[])[] = [];
  const now = startOfWeek(new Date()).getTime();
  for (const w of weeks) {
    const quiet = !busy(w) && w.getTime() !== now;
    const last = out[out.length - 1];
    if (quiet && Array.isArray(last) && last[0].getMonth() === w.getMonth()) last.push(w);
    else out.push(quiet ? [w] : w);
  }
  return out;
}
