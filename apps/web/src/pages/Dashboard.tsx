import type { SemesterData } from "@ouc/content/types";
import { Link, enc } from "../lib/router";
import { courseMap, currentWeek, stateOf } from "../lib/data";
import { at, daysBetween, fmtFull, relative } from "../lib/dates";
import { ORDER, SyncStatus, UpdateRow } from "./Updates";
import { Card, CourseBadge, CourseDot, PageHeader, ProgressRing, SectionTitle, StatePill, cx } from "../components/ui";
import { AskAiButton } from "../components/Assistant";
import { ClassCard, nextClassPerCourse } from "../components/Classes";

export function Dashboard({ data }: { data: SemesterData }) {
  const now = new Date();
  const base = `/${enc(data.id)}`;
  const C = courseMap(data);
  const open = data.assignments.filter((a) => !a.submitted && a.due && at(a.due) > new Date(now.getTime() - 86_400_000));
  const soon = open.filter((a) => daysBetween(now, at(a.due!)) <= 14);
  const finals = data.exams.filter((e) => e.kind === "Final exam" && at(e.at) >= now);
  const nextExam = finals[0];
  const next = open[0];
  const classes = nextClassPerCourse(data, now);
  const hour = now.getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader eyebrow={<span>{data.label} · {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</span>} title={`${greet}.`}>
        {next ? <>Next up: <b className="text-ink">{next.title}</b> for {C[next.code]?.short}, {relative(at(next.due!))}.</> : "Nothing due right now."}
        <div className="mt-4"><AskAiButton action="plan-week">Plan my week</AskAiButton></div>
      </PageHeader>

      {/* hero strip: next deadline + exam countdown */}
      <div className="grid gap-3 md:grid-cols-3">
        {next && (
          <Link to={`${base}/assignments/${next.id.split("/").map(enc).join("/")}`} className="group md:col-span-2">
            <Card className="relative h-full overflow-hidden p-5 transition group-hover:border-muted">
              <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: C[next.code]?.color }} />
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted">Next deadline</div>
                  <div className="mt-1 font-serif text-2xl font-semibold">{next.title}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted"><CourseBadge course={C[next.code]} /> {fmtFull(at(next.due!))}</div>
                </div>
                <div className="text-right">
                  <div className="font-serif text-4xl font-semibold">{Math.max(0, daysBetween(now, at(next.due!)))}</div>
                  <div className="text-xs text-muted">days left</div>
                </div>
              </div>
              {next.opened && (() => {
                const o = at(next.opened).getTime(), d = at(next.due!).getTime();
                const pct = Math.min(100, Math.max(0, ((now.getTime() - o) / (d - o)) * 100));
                return (
                  <div className="mt-5">
                    <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: C[next.code]?.color }} /></div>
                    <div className="mt-1.5 flex justify-between text-[11px] text-muted"><span>Opened {at(next.opened).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span><span>{Math.round(pct)}% of the time used</span></div>
                  </div>
                );
              })()}
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                {next.resources && <span className="rounded-full bg-surface-2 px-2.5 py-1">📚 {next.resources.links.length} study links</span>}
                {next.briefs.length > 0 && <span className="rounded-full bg-surface-2 px-2.5 py-1">📕 brief attached</span>}
                {data.notes.some((n) => n.code === next.code && n.weekIndex === next.weekIndex) && <span className="rounded-full bg-surface-2 px-2.5 py-1">📒 notes for this week</span>}
              </div>
            </Card>
          </Link>
        )}
        {nextExam && (
          <Card className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">🎓 First final exam</div>
            <div className="mt-1 font-serif text-2xl font-semibold">{C[nextExam.code]?.short}</div>
            <div className="mt-1 text-sm text-muted">{fmtFull(at(nextExam.at))}</div>
            <div className="mt-3 flex gap-1.5">
              {finals.map((e) => (
                <div key={e.code} className="flex-1 rounded-lg bg-surface-2 px-2 py-1.5 text-center" title={`${C[e.code]?.short}: ${fmtFull(at(e.at))}`}>
                  <CourseDot color={C[e.code]?.color ?? "#999"} />
                  <div className="text-xs font-semibold">{at(e.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-xs text-muted">{daysBetween(now, at(nextExam.at))} days to go</div>
          </Card>
        )}
      </div>

      {classes.length > 0 && (
        <>
          <SectionTitle right={<Link to={`${base}/timeline`} className="text-sm text-muted hover:text-ink">All classes →</Link>}>Next live classes</SectionTitle>
          <div className="grid gap-3 md:grid-cols-3">
            {classes.map((c) => <ClassCard key={c.code} c={c} data={data} now={now} />)}
          </div>
        </>
      )}

      {(() => {
        const latest = data.updates.days[0];
        const recent = latest && daysBetween(new Date(latest.date + "T12:00:00"), now) <= 3 ? latest : undefined;
        return (
          <>
            <SectionTitle right={<Link to={`${base}/updates`} className="text-sm text-muted hover:text-ink">All updates →</Link>}>
              What's new on eClass <span className="ml-2 normal-case tracking-normal"><SyncStatus data={data} /></span>
            </SectionTitle>
            {recent ? (
              <div className="grid gap-2">
                {[...recent.items].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type)).slice(0, 4).map((u, i) => <UpdateRow key={i} u={u} data={data} compact />)}
                {recent.items.length > 4 && <Link to={`${base}/updates`} className="text-center text-sm text-muted hover:text-ink">+{recent.items.length - 4} more</Link>}
              </div>
            ) : (
              <Card className="p-5 text-sm text-muted">
                {data.updates.status?.ok ? "Nothing new in the last few days." : <>Daily updates aren't set up yet. <Link to={`${base}/updates`} className="underline">Set them up</Link> to see new grades, feedback and materials here.</>}
              </Card>
            )}
          </>
        );
      })()}

      <SectionTitle right={<Link to={`${base}/timeline`} className="text-sm text-muted hover:text-ink">Full timeline →</Link>}>Coming up · next 14 days</SectionTitle>
      {soon.length ? (
        <div className="grid grid-cols-1 gap-2">
          {soon.map((a) => {
            const st = stateOf(a, now);
            return (
              <Link key={a.id} to={`${base}/assignments/${a.id.split("/").map(enc).join("/")}`}
                className={cx("flex items-center gap-4 rounded-xl border bg-surface px-4 py-3 transition hover:border-muted", st === "soon" ? "border-warn/50" : "border-line")}>
                <div className="w-16 shrink-0 text-center">
                  <div className="text-[11px] uppercase text-muted">{at(a.due!).toLocaleDateString("en-GB", { weekday: "short" })}</div>
                  <div className="font-serif text-2xl font-semibold leading-none">{at(a.due!).getDate()}</div>
                  <div className="text-[11px] text-muted">{at(a.due!).toLocaleDateString("en-GB", { month: "short" })}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{a.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <CourseBadge course={C[a.code]} /> {relative(at(a.due!), now)}
                    {a.resources && <span>· 📚 {a.resources.links.length} study links</span>}
                  </div>
                </div>
                <StatePill state={st} />
              </Link>
            );
          })}
        </div>
      ) : <Card className="p-6 text-center text-muted">Nothing due in the next two weeks. 🎉</Card>}

      <SectionTitle>Your courses</SectionTitle>
      <div className="grid gap-3 md:grid-cols-3">
        {data.courses.map((c) => {
          const as = data.assignments.filter((a) => a.code === c.code);
          const done = as.filter((a) => a.submitted).length;
          const wk = currentWeek(c, now);
          const nd = as.find((a) => !a.submitted && a.due && at(a.due) >= now);
          const notes = data.notes.filter((n) => n.code === c.code).length;
          return (
            <Link key={c.code} to={`${base}/courses/${enc(c.code)}`} className="group">
              <Card className="h-full overflow-hidden transition group-hover:border-muted">
                <div className="h-1.5" style={{ background: c.color }} />
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-muted">{c.code}</div>
                      <div className="font-serif text-xl font-semibold leading-tight">{c.short}</div>
                    </div>
                    <ProgressRing value={as.length ? done / as.length : 0} color={c.color} label={`${done}/${as.length}`} />
                  </div>
                  <dl className="mt-4 space-y-2 text-sm">
                    <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">This week</dt><dd className="leading-snug">{wk?.label ?? "No class this week"}</dd></div>
                    <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">Next due</dt><dd>{nd ? `${nd.title}, ${relative(at(nd.due!), now)}` : "Nothing open"}</dd></div>
                  </dl>
                  <div className="mt-4 text-xs text-muted">📒 {notes} notes · {c.weeks.filter((w) => w.items.length).length} weeks of material</div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}
