import { useEffect, useState } from "react";
import type { Plan, PlanPart, PlanSection, SemesterData } from "@ouc/content/types";
import { Link, enc } from "../lib/router";
import { day, fmtShort } from "../lib/dates";
import { mdInline, mdToHtml } from "../lib/markdown";
import { setPlanTask } from "../lib/ai";
import { Card, PageHeader, SectionTitle, cx } from "../components/ui";
import { AskAiButton } from "../components/Assistant";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => ymd(new Date());
/** The plan for the week we're in, else the newest one. */
export function currentPlan(data: SemesterData): Plan | undefined {
  const plans = data.plans ?? [];
  const t = today();
  return plans.find((p) => p.start && p.end && p.start <= t && t <= p.end) ?? plans[0];
}
const weekNo = (p: Plan) => Number(p.week.split("-W")[1]);
const range = (p: Plan) => (p.start && p.end ? `${fmtShort(day(p.start))} – ${fmtShort(day(p.end))}` : "");

/** Ticks made here show at once; the file is saved in the background and the data reloads after. */
function useTicks(sem: string, plan: Plan | undefined) {
  const [ticks, setTicks] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string>();
  useEffect(() => { setTicks({}); }, [plan]);
  const isDone = (line: number, done: boolean) => ticks[line] ?? done;
  const toggle = async (line: number, done: boolean) => {
    if (!plan) return;
    setTicks((t) => ({ ...t, [line]: done }));
    const err = await setPlanTask(sem, plan.week, line, done);
    setError(err ?? undefined);
    if (err) setTicks((t) => ({ ...t, [line]: !done }));
  };
  return { isDone, toggle, error };
}
type Ticks = ReturnType<typeof useTicks>;

function Task({ line, text, done, ticks }: { line: number; text: string; done: boolean; ticks: Ticks }) {
  const on = ticks.isDone(line, done);
  return (
    <label className="group flex cursor-pointer items-start gap-2.5 rounded-lg px-1.5 py-1 hover:bg-surface-2">
      <input type="checkbox" checked={on} onChange={(e) => ticks.toggle(line, e.target.checked)}
        className="mt-1 size-4 shrink-0 cursor-pointer accent-[var(--accent)]" />
      <span className={cx("md min-w-0 flex-1 leading-6", on && "text-muted line-through decoration-muted/60")} dangerouslySetInnerHTML={{ __html: mdInline(text) }} />
    </label>
  );
}

export function Parts({ parts, ticks }: { parts: PlanPart[]; ticks: Ticks }) {
  return (
    <div className="flex flex-col gap-0.5">
      {parts.map((p, i) => p.task
        ? <Task key={p.task.line} {...p.task} ticks={ticks} />
        : <div key={i} className="md min-w-0 overflow-x-auto text-[14.5px] leading-6 [&_table]:my-1 [&>p]:my-1.5" dangerouslySetInnerHTML={{ __html: mdToHtml(p.md!) }} />)}
    </div>
  );
}

/** "Mon 19 Oct" (or just "Monday") → that day's date in the plan's week. */
function dayDate(title: string, plan: Plan): string | undefined {
  if (!plan.start) return;
  const start = day(plan.start);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const short = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const wd = d.toLocaleDateString("en-GB", { weekday: "short" });
    if (title.includes(short) || new RegExp(`^${wd}`, "i").test(title)) return ymd(d);
  }
}

const isActions = (s: PlanSection) => /next|action|to ?do/i.test(s.title);
const isRisks = (s: PlanSection) => /risk|watch|warning/i.test(s.title);

function Section({ s, plan, ticks }: { s: PlanSection; plan: Plan; ticks: Ticks }) {
  const t = today();
  return (
    <section className="mt-8 first:mt-0">
      <SectionTitle>{s.title}</SectionTitle>
      {(s.parts.length > 0 || !s.days.length) && (
        <Card className={cx("p-4", isActions(s) && "border-accent/40", isRisks(s) && "border-warn/40 bg-warn-bg")}>
          <Parts parts={s.parts} ticks={ticks} />
        </Card>
      )}
      {s.days.length > 0 && (
        <div className={cx("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", s.parts.length > 0 && "mt-3")}>
          {s.days.map((d) => {
            const date = dayDate(d.title, plan);
            return (
              <Card key={d.title} className={cx("p-4", date === t && "border-accent ring-1 ring-accent/30", date && date < t && "opacity-70")}>
                <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
                  {d.title}
                  {date === t && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] uppercase tracking-wider text-bg">Today</span>}
                </div>
                <Parts parts={d.parts} ticks={ticks} />
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Progress({ plan, ticks }: { plan: Plan; ticks: Ticks }) {
  const all = [...plan.intro, ...plan.sections.flatMap((s) => [...s.parts, ...s.days.flatMap((d) => d.parts)])].flatMap((p) => (p.task ? [p.task] : []));
  const done = all.filter((x) => ticks.isDone(x.line, x.done)).length;
  if (!all.length) return null;
  return (
    <div className="flex items-center gap-3 text-sm text-muted">
      <div className="h-2 w-40 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={done} aria-valuemax={all.length} aria-label="Tasks done">
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(done / all.length) * 100}%` }} />
      </div>
      {done} of {all.length} tasks done
    </div>
  );
}

export function PlanPage({ data, week }: { data: SemesterData; week?: string }) {
  const plans = data.plans ?? [];
  const plan = week ? plans.find((p) => p.week === week) : currentPlan(data);
  const ticks = useTicks(data.id, plan);
  const base = `/${enc(data.id)}`;
  if (!plan) {
    return (
      <>
        <PageHeader eyebrow={data.label} title="Week plan">{week ? `There's no plan for ${week}.` : "No week plan yet. Your AI makes one from your deadlines, progress and course weeks."}</PageHeader>
        <AskAiButton action="plan-week">Plan my week</AskAiButton>
      </>
    );
  }
  const i = plans.indexOf(plan);
  const [newer, older] = [plans[i - 1], plans[i + 1]];
  const sections = [...plan.sections.filter(isActions), ...plan.sections.filter((s) => !isActions(s))];
  return (
    <>
      <PageHeader eyebrow={<span>{data.label} · Week {weekNo(plan)}{range(plan) && ` · ${range(plan)}`}</span>} title={plan.title || `Week ${weekNo(plan)} plan`}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Progress plan={plan} ticks={ticks} />
          <AskAiButton action="plan-week">Update the plan</AskAiButton>
          <span className="flex gap-3 text-sm">
            {older && <Link to={`${base}/plan/${older.week}`} className="hover:text-ink">← Week {weekNo(older)}</Link>}
            {newer && <Link to={`${base}/plan/${newer.week}`} className="hover:text-ink">Week {weekNo(newer)} →</Link>}
          </span>
        </div>
      </PageHeader>
      {ticks.error && <p className="mb-4 rounded-xl bg-bad-bg px-3 py-2 text-sm text-bad">{ticks.error}</p>}
      {plan.intro.length > 0 && <Card className="mb-6 p-4"><Parts parts={plan.intro} ticks={ticks} /></Card>}
      <div className="flex flex-col">{sections.map((s) => <Section key={s.title} s={s} plan={plan} ticks={ticks} />)}</div>
      <p className="mt-8 text-xs text-muted">Ticks are saved to <code>plans/{plan.file}</code>, so your AI sees them when it updates the plan.</p>
    </>
  );
}

/** Dashboard card: this week's next actions, ticked off right there. */
export function PlanCard({ data, className }: { data: SemesterData; className?: string }) {
  const plan = currentPlan(data);
  const ticks = useTicks(data.id, plan);
  if (!plan) return null;
  const actions = plan.sections.find(isActions);
  const tasks = (actions?.parts ?? []).filter((p) => p.task);
  // no "Next actions" list: the first open tasks of the plan
  const shown = tasks.length ? actions!.parts : [...plan.intro, ...plan.sections.flatMap((s) => [...s.parts, ...s.days.flatMap((d) => d.parts)])].filter((p) => p.task && !p.task.done).slice(0, 4);
  return (
    <Card className={cx("p-5", className)}>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">This week's plan · Week {weekNo(plan)}</div>
          <div className="mt-0.5 font-serif text-xl font-semibold">{actions?.title ?? "Next up"}</div>
        </div>
        <Progress plan={plan} ticks={ticks} />
      </div>
      {shown.length ? <Parts parts={shown} ticks={ticks} /> : <p className="text-sm text-muted">Everything in this plan is done. 🎉</p>}
      <Link to={`/${enc(data.id)}/plan/${plan.week}`} className="mt-3 inline-block text-sm font-semibold hover:underline">Open the full plan →</Link>
    </Card>
  );
}
