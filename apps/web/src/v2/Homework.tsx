import { useEffect, useRef, useState } from "react";
import type { Assignment, SemesterData } from "@ouc/content/types";
import { homeworkProgress, taskLabel, type HomeworkTask, type TaskAnswer } from "@ouc/content/homework";
import { Link, enc } from "../lib/router";
import { courseMap } from "../lib/data";
import { at, fmtFull, relative } from "../lib/dates";
import { mdToHtml } from "../lib/markdown";
import { saveAnswer, useHomework, type AnswerPatch } from "../lib/homework";
import { Card, Empty, cx } from "../components/ui";
import { Check, TriangleAlert } from "../components/icons";

const KIND: Record<HomeworkTask["kind"], string> = { written: "Written", calculation: "Calculation", choice: "Multiple choice" };
const LETTERS = "ABCDEFGH";

/** The href of an assignment's homework page ("CODE/folder"). */
export const homeworkHref = (sem: string, id: string) => `/${enc(sem)}/homework/${id.split("/").map(enc).join("/")}`;

/** The done/total line of an assignment's homework, for cards. */
export function useHomeworkCount(sem: string, id: string, tasks: HomeworkTask[]) {
  const { answers } = useHomework(sem);
  return homeworkProgress(tasks, answers[id] ?? {});
}

/** The coloured bar under the title: one piece per task, filled when it's done. */
function Pieces({ tasks, answers }: { tasks: HomeworkTask[]; answers: Record<string, TaskAnswer> }) {
  return (
    <div aria-hidden className="flex min-w-[10rem] flex-1 gap-1">
      {tasks.map((t) => <span key={t.id} className={cx("h-2 flex-1 rounded-full", answers[t.id]?.done ? "bg-ok" : "bg-line")} />)}
    </div>
  );
}

/** Answering an assignment's tasks in the app: a timeline of tasks, the task being answered, done/left. */
export function HomeworkPage({ data, id }: { data: SemesterData; id: string }) {
  const a = data.assignments.find((x) => x.id === id);
  const course = a ? courseMap(data)[a.code] : undefined;
  const { answers: all } = useHomework(data.id);
  const answers = all[id] ?? {};
  const tasks = a?.homework?.tasks ?? [];
  const [cur, setCur] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!a) return <Empty>Assignment not found.</Empty>;
  const base = `/${enc(data.id)}`;
  const back = <Link to={`${base}/courses/${enc(a.code)}#work`} className="text-sm text-muted hover:text-ink">← {course?.short ?? a.code} · Assignments</Link>;
  if (!a.homework) return <div className="grid gap-4">{back}<Empty>This assignment has no interactive version yet.</Empty></div>;
  if (!tasks.length) {
    return (
      <div className="grid gap-4">
        {back}
        <div role="alert" className="rounded-xl bg-bad-bg p-4 text-sm text-bad">
          <b>The interactive version of {a.title} can't be used yet.</b>
          <ul className="mt-1 list-disc pl-5">{a.homework.problems?.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      </div>
    );
  }
  const { done, total, left } = homeworkProgress(tasks, answers);
  const i = Math.min(cur ?? Math.max(0, tasks.findIndex((t) => !answers[t.id]?.done)), tasks.length - 1);
  const task = tasks[i]!;
  const ans = answers[task.id] ?? {};
  const save = (patch: Omit<AnswerPatch, "task">) => saveAnswer(data.id, id, tasks, { task: task.id, ...patch })
    .then(() => setError(null), (e: Error) => setError(e.message));
  const brief = a.briefs.find((f) => f.ext === "pdf") ?? a.briefs[0];

  return (
    <div className="grid gap-4">
      {back}
      <div>
        <h1 className="font-serif text-3xl font-semibold leading-tight">{a.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {a.due ? <>Due {fmtFull(at(a.due))}{!a.submitted && ` · ${relative(at(a.due))}`}</> : "No due date"}
          {brief && <> · <a href={brief.href} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">open the brief</a></>}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Pieces tasks={tasks} answers={answers} />
        <div className="text-sm" data-testid="homework-progress"><b>{done} of {total} done</b><span className="text-muted"> · {left} left</span></div>
      </div>
      {error && <div role="alert" className="flex items-center gap-2 rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad"><TriangleAlert aria-hidden className="size-4 shrink-0" />{error}</div>}

      <div className="flex flex-wrap items-start gap-4">
        <nav aria-label="Tasks" className="w-full rounded-2xl border border-line bg-surface p-2 sm:w-64 sm:shrink-0">
          <div className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Timeline</div>
          {tasks.map((t, n) => {
            const isDone = !!answers[t.id]?.done, now = n === i;
            return (
              <button key={t.id} type="button" onClick={() => setCur(n)} aria-current={now ? "step" : undefined}
                className={cx("flex w-full items-start gap-2.5 rounded-xl px-2 py-2 text-left", now ? "bg-surface-2" : "hover:bg-surface-2")}>
                <span aria-hidden className={cx("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold",
                  now ? "bg-accent text-bg" : isDone ? "bg-ok text-bg" : "border-2 border-line text-muted")}>
                  {isDone && !now ? <Check className="size-3.5" strokeWidth={3} /> : n + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{taskLabel(t, n)}</span>
                  <span className="block text-xs text-muted">{KIND[t.kind]} · {now ? "now" : isDone ? "done" : "to do"}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <Card className="grid min-w-0 flex-[999_1_28rem] gap-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-muted">Task {i + 1} of {total} · {KIND[task.kind]}</span>
            {ans.done && <span className="rounded-full bg-ok-bg px-2.5 py-0.5 text-xs font-semibold text-ok">Done</span>}
          </div>
          <div className="md font-serif text-lg leading-relaxed" dangerouslySetInnerHTML={{ __html: mdToHtml(task.question) }} />

          {task.kind === "choice" ? (
            <>
              <div role="radiogroup" aria-label="Your choice" className="grid gap-2">
                {task.options!.map((o, n) => {
                  const on = ans.choice === n;
                  return (
                    <button key={n} type="button" role="radio" aria-checked={on} onClick={() => save({ choice: n })}
                      className={cx("flex min-h-12 items-center gap-3 rounded-xl border px-4 py-2.5 text-left", on ? "border-2 border-accent bg-accent/5" : "border-line hover:border-muted")}>
                      <span aria-hidden className={cx("grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold", on ? "bg-accent text-bg" : "border border-line text-muted")}>{LETTERS[n]}</span>
                      <span>{o}</span>
                    </button>
                  );
                })}
              </div>
              <Why key={task.id} value={ans.why} onSave={(why) => save({ why })} />
            </>
          ) : (
            <TextAnswer key={task.id} label="Your answer" value={ans.text} onSave={(text) => save({ text })} rows={8} />
          )}

          <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
            <button type="button" onClick={() => setCur(Math.max(0, i - 1))} disabled={i === 0}
              className="min-h-11 rounded-full border border-line px-4 disabled:opacity-40">Previous</button>
            <div className="flex flex-wrap gap-2">
              {ans.done && <button type="button" onClick={() => save({ done: false })} className="min-h-11 rounded-full border border-line px-4">Not done yet</button>}
              <button type="button" onClick={() => { if (!ans.done) save({ done: true }); setCur(Math.min(tasks.length - 1, i + 1)); }}
                className="flex min-h-11 items-center gap-1.5 rounded-full bg-ok px-4 font-semibold text-bg">
                <Check aria-hidden className="size-4" strokeWidth={2.5} />{ans.done ? "Next task" : i === tasks.length - 1 ? "Done" : "Done, next task"}
              </button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** A text box that saves itself a moment after typing stops, and when it's left. */
function TextAnswer({ label, value, onSave, rows }: { label: string; value?: string; onSave: (v: string) => void; rows: number }) {
  const [text, setText] = useState(value ?? "");
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const save = useRef(onSave);
  save.current = onSave;
  const flush = () => { clearTimeout(timer.current); if (pending.current !== null) { save.current(pending.current); pending.current = null; } };
  useEffect(() => flush, []);
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      <textarea value={text} rows={rows} onBlur={flush}
        onChange={(e) => { setText(e.target.value); pending.current = e.target.value; clearTimeout(timer.current); timer.current = setTimeout(flush, 700); }}
        className="w-full rounded-xl border border-line bg-surface px-3.5 py-3 leading-relaxed outline-none focus:border-muted" />
    </label>
  );
}

/** The optional "why I picked it" under a multiple-choice task. */
function Why({ value, onSave }: { value?: string; onSave: (v: string) => void }) {
  const [open, setOpen] = useState(!!value);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="justify-self-start rounded-full border border-dashed border-line px-4 py-2 text-sm text-muted hover:text-ink">
        + Add why I picked it <span className="text-muted">(optional)</span>
      </button>
    );
  }
  return <TextAnswer label="Why I picked it" value={value} onSave={onSave} rows={3} />;
}

/** On an assignment card: how many tasks are done, and the way into the homework page. */
export function HomeworkLink({ sem, a, tasks }: { sem: string; a: Pick<Assignment, "id" | "title">; tasks: HomeworkTask[] }) {
  const { done, total } = useHomeworkCount(sem, a.id, tasks);
  return (
    <span className="flex items-center gap-2">
      <span className="rounded-full bg-info-bg px-2.5 py-0.5 text-xs font-semibold text-info">Interactive</span>
      <span className="text-xs text-muted" data-testid="homework-count">{done} of {total} done</span>
      <Link to={homeworkHref(sem, a.id)} aria-label={`Answer ${a.title} in the app`}
        className="rounded-full bg-ink px-3.5 py-1.5 text-sm font-semibold text-bg hover:opacity-90">{done === 0 ? "Start" : done === total ? "Open" : "Continue"}</Link>
    </span>
  );
}
