import { useEffect, useRef, useState } from "react";
import type { Assignment, SemesterData } from "@ouc/content/types";
import { checkCounts, homeworkProgress, taskLabel, type HomeworkAnswers, type HomeworkCheck, type HomeworkTask, type TaskAnswer, type Verdict } from "@ouc/content/homework";
import { Link, enc } from "../lib/router";
import { courseMap } from "../lib/data";
import { at, fmtFull, relative } from "../lib/dates";
import { mdToHtml } from "../lib/markdown";
import { checkAnswers, dismissJob, makeInteractive, makePdf, printHref, saveAnswer, uploadPicture, useCheckJobs, useHomework, useMakeJobs, type AnswerPatch, type HomeworkJob } from "../lib/homework";
import { useAiStatus } from "../lib/ai";
import { useConnection } from "../lib/connection";
import { Card, Empty, cx } from "../components/ui";
import { RichEditor } from "../components/RichEditor";
import { AskAiButton, Markdown } from "../components/Assistant";
import { WorkLink } from "../components/MakeQuiz";
import { Check, FileText, Settings, Sparkles, TriangleAlert, X } from "../components/icons";

const KIND: Record<HomeworkTask["kind"], string> = { written: "Written", calculation: "Calculation", choice: "Multiple choice" };
const LETTERS = "ABCDEFGH";
// the AI check's verdicts: lenient, so "better" is still right
const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  right: { label: "Right", cls: "bg-ok-bg text-ok" },
  better: { label: "Right, could be better", cls: "bg-info-bg text-info" },
  wrong: { label: "Not right yet", cls: "bg-bad-bg text-bad" },
  empty: { label: "Not answered", cls: "bg-surface-2 text-muted" },
};
const VerdictTag = ({ v, className }: { v: Verdict; className?: string }) => (
  <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-semibold", VERDICT[v].cls, className)}>{VERDICT[v].label}</span>
);

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
  const { answers: all, checks, state } = useHomework(data.id);
  const answers = all[id] ?? {};
  const check = checks[id];
  const tasks = a?.homework?.tasks ?? [];
  const [cur, setCur] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"saving" | "saved" | null>(null);
  const saves = useRef(0);
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
  // the answer boxes start from the saved answers, so wait for them
  if (state === "loading") return <div className="grid gap-4">{back}<p className="text-sm text-muted">Loading your answers…</p></div>;
  const { done, total, left } = homeworkProgress(tasks, answers);
  const i = Math.min(cur ?? Math.max(0, tasks.findIndex((t) => !answers[t.id]?.done)), tasks.length - 1);
  const task = tasks[i]!;
  const ans = answers[task.id] ?? {};
  // typed but not sent yet: "Saving…" until the save after it comes back
  const dirty = () => { saves.current++; setSaving("saving"); };
  const save = (patch: Omit<AnswerPatch, "task">) => {
    setSaving("saving");
    const n = ++saves.current;
    return saveAnswer(data.id, id, tasks, { task: task.id, ...patch }).then(
      () => { setError(null); if (n === saves.current) setSaving("saved"); },
      (e: Error) => { setError(e.message); setSaving(null); });
  };
  const upload = (f: File) => uploadPicture(data.id, id, f);
  const brief = a.briefs.find((f) => f.ext === "pdf") ?? a.briefs[0];

  return (
    <div className="grid gap-4">
      {back}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
        <h1 className="font-serif text-3xl font-semibold leading-tight">{a.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {a.due ? <>Due {fmtFull(at(a.due))}{!a.submitted && ` · ${relative(at(a.due))}`}</> : "No due date"}
          {brief && <> · <a href={brief.href} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">open the brief</a></>}
        </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CheckButton sem={data.id} id={id} checked={!!check} />
          <MakePdfButton sem={data.id} id={id} title={a.title} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Pieces tasks={tasks} answers={answers} />
        <div className="text-sm" data-testid="homework-progress"><b>{done} of {total} done</b><span className="text-muted"> · {left} left</span></div>
      </div>
      {error && <div role="alert" className="flex items-center gap-2 rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad"><TriangleAlert aria-hidden className="size-4 shrink-0" />{error}</div>}
      <CheckJobs sem={data.id} id={id} />
      {check && <CheckSummary sem={data.id} tasks={tasks} check={check} answers={answers} />}

      <div className="flex flex-wrap items-start gap-4">
        <nav aria-label="Tasks" className="w-full rounded-2xl border border-line bg-surface p-2 sm:w-64 sm:shrink-0">
          <div className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Timeline</div>
          {tasks.map((t, n) => {
            const isDone = !!answers[t.id]?.done, now = n === i, v = check?.tasks[t.id]?.verdict;
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
                  {v && <VerdictTag v={v} className="mt-1 inline-block" />}
                </span>
              </button>
            );
          })}
        </nav>

        <Card className="grid min-w-0 flex-[999_1_28rem] gap-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-muted">Task {i + 1} of {total} · {KIND[task.kind]}</span>
            {ans.done && <span className="rounded-full bg-ok-bg px-2.5 py-0.5 text-xs font-semibold text-ok">Done</span>}
            <span className="ml-auto text-xs text-muted" data-testid="save-state" aria-live="polite">{saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : ""}</span>
            <AskAiButton action="homework-tutor" params={{ course: a.code, assignment: id, task: task.id }} className="py-1 text-xs">Ask AI about this task</AskAiButton>
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
              <Why key={task.id} value={ans.why} onSave={(why) => save({ why })} onDirty={dirty} upload={upload} onError={setError} />
            </>
          ) : (
            <TextAnswer key={task.id} label="Your answer" value={ans.text} onSave={(text) => save({ text })} onDirty={dirty} upload={upload} onError={setError} />
          )}

          {check?.tasks[task.id] && (
            <section aria-label="AI check of this task" className="grid gap-1.5 rounded-xl border border-line bg-surface-2/50 p-3 text-sm">
              <div className="flex items-center gap-2"><Sparkles aria-hidden className="size-4 text-accent" /><span className="font-semibold">AI check</span><VerdictTag v={check.tasks[task.id]!.verdict} /></div>
              <Markdown text={check.tasks[task.id]!.note} sem={data.id} diagrams={false} className="text-sm" />
            </section>
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

/** Check my answers: the AI checks them in the background (no chat), leniently. */
function CheckButton({ sem, id, checked }: { sem: string; id: string; checked: boolean }) {
  const ai = useAiStatus();
  const running = useCheckJobs(sem, id).some((j) => j.running);
  const [error, setError] = useState<string | null>(null);
  if (ai.state === "unavailable") return null;
  return (
    <>
      <button type="button" disabled={running} onClick={() => { setError(null); checkAnswers(sem, id).catch((e: Error) => setError(e.message)); }}
        className="flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-4 font-semibold hover:border-muted disabled:opacity-60">
        <Sparkles aria-hidden className="size-4 text-accent" />{running ? "Checking…" : checked ? "Check again" : "Check my answers"}
      </button>
      {error && <div role="alert" className="basis-full rounded-xl bg-bad-bg px-3 py-2 text-sm text-bad">{error}</div>}
    </>
  );
}

/** The check being made, in place, or why the last one failed. */
function CheckJobs({ sem, id }: { sem: string; id: string }) {
  return <JobRows sem={sem} jobs={useCheckJobs(sem, id)} running="The AI is checking your answers…" failed="Your answers weren't checked" />;
}

/** Background homework work in place: spinning gears while it runs, then why it failed (until dismissed). */
function JobRows({ sem, jobs, running, failed }: { sem: string; jobs: HomeworkJob[]; running: string; failed: string }) {
  return jobs.map((j) => (
    <div key={j.id} role={j.running ? "status" : "alert"} className={cx("flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm", j.running ? "border-line bg-surface" : "border-bad/40 bg-bad-bg")}>
      {j.running ? <Settings aria-hidden className="size-4 shrink-0 animate-spin text-accent [animation-duration:2.5s]" /> : <TriangleAlert aria-hidden className="size-4 shrink-0 text-bad" />}
      <span className="min-w-0 flex-1">{j.running ? running : <>{failed}: {j.error}</>}</span>
      {j.chatId && <WorkLink sem={sem} running={j.running} />}
      {!j.running && <button type="button" aria-label="Dismiss" className="px-1 text-muted hover:text-ink" onClick={() => dismissJob(j.id)}><X aria-hidden className="size-4" /></button>}
    </div>
  ));
}

/** The AI check of the whole homework: how many are right, its summary, and whether answers changed since. */
function CheckSummary({ sem, tasks, check, answers }: { sem: string; tasks: HomeworkTask[]; check: HomeworkCheck; answers: HomeworkAnswers }) {
  const n = checkCounts(tasks, check);
  const changed = check.checked && tasks.some((t) => (answers[t.id]?.updated ?? "") > check.checked!);
  return (
    <section aria-label="AI check" data-testid="homework-check" className="grid gap-2 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Sparkles aria-hidden className="size-4 text-accent" />
        <b>AI check</b>
        {check.checked && <span className="text-muted">{fmtFull(new Date(check.checked))}</span>}
        <span className="flex flex-wrap gap-1.5">
          {(Object.keys(VERDICT) as Verdict[]).filter((v) => n[v]).map((v) => <span key={v} className={cx("rounded-full px-2.5 py-0.5 text-xs font-semibold", VERDICT[v].cls)}>{n[v]} {VERDICT[v].label.toLowerCase()}</span>)}
        </span>
      </div>
      {check.summary && <Markdown text={check.summary} sem={sem} diagrams={false} className="text-sm" />}
      {changed && <p className="text-xs text-muted">You've changed answers since this check. Check again to see where they stand.</p>}
    </section>
  );
}

/** A rich answer box that saves itself a moment after typing stops, and when it's closed. */
function TextAnswer({ label, value, onSave, onDirty, upload, onError, minHeight }: {
  label: string; value?: string; onSave: (v: string) => void; onDirty: () => void; upload: (f: File) => Promise<string>; onError: (msg: string) => void; minHeight?: string;
}) {
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const save = useRef(onSave);
  save.current = onSave;
  const flush = () => { clearTimeout(timer.current); if (pending.current !== null) { save.current(pending.current); pending.current = null; } };
  useEffect(() => flush, []);
  return (
    <div onBlur={flush}>
      <RichEditor label={label} value={value} minHeight={minHeight} upload={upload} onError={onError}
        onChange={(html) => { pending.current = html; onDirty(); clearTimeout(timer.current); timer.current = setTimeout(flush, 700); }} />
    </div>
  );
}

/** The optional "why I picked it" under a multiple-choice task. */
function Why({ value, ...rest }: { value?: string; onSave: (v: string) => void; onDirty: () => void; upload: (f: File) => Promise<string>; onError: (msg: string) => void }) {
  const [open, setOpen] = useState(!!value);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="justify-self-start rounded-full border border-dashed border-line px-4 py-2 text-sm text-muted hover:text-ink">
        + Add why I picked it <span className="text-muted">(optional)</span>
      </button>
    );
  }
  return <TextAnswer label="Why I picked it" value={value} {...rest} minHeight="4.5rem" />;
}

/**
 * On an assignment without an interactive version: the AI makes one in the background (from the eClass task,
 * or for a submitted assignment from the submission, with its answers filled in).
 */
export function MakeInteractive({ sem, a }: { sem: string; a: Pick<Assignment, "id" | "submitted"> }) {
  const ai = useAiStatus();
  const jobs = useMakeJobs(sem, a.id);
  const [error, setError] = useState<string | null>(null);
  if (ai.state === "unavailable") return null;
  const busy = jobs.some((j) => j.running);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted">{a.submitted ? "Have the AI turn your submission into tasks here, with your answers filled in." : "Have the AI turn the assignment into tasks you answer here, one by one."}</span>
        <button type="button" disabled={busy} onClick={() => { setError(null); makeInteractive(sem, a.id).catch((e: Error) => setError(e.message)); }}
          className="flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-4 font-semibold hover:border-muted disabled:opacity-60">
          <Sparkles aria-hidden className="size-4 text-accent" />{busy ? "Making it…" : "Make it interactive"}
        </button>
      </div>
      {error && <div role="alert" className="rounded-xl bg-bad-bg px-3 py-2 text-sm text-bad">{error}</div>}
      <JobRows sem={sem} jobs={jobs} running="The AI is making the interactive version…" failed="The interactive version wasn't made" />
    </div>
  );
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

const NAME_KEY = "ouc-pdf-name";

/** Make PDF: asks for the name on it (eClass's name, or the last one used), then saves the PDF into my-submission/. */
function MakePdfButton({ sem, id, title }: { sem: string; id: string; title: string }) {
  const conn = useConnection();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => { try { return localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; } });
  const [st, setSt] = useState<{ busy?: boolean; pdf?: string; error?: string; printed?: boolean }>({});
  useEffect(() => { if (!name && conn.user) setName(conn.user); }, [conn.user]);
  const go = () => {
    try { localStorage.setItem(NAME_KEY, name.trim()); } catch {}
    setSt({ busy: true });
    makePdf(sem, id, title, name.trim()).then((pdf) => setSt({ pdf }), (e: Error & { noBrowser?: boolean }) => {
      // no Chrome or Edge: the print window can still save a PDF
      if (e.noBrowser) window.open(`${printHref(sem, id, name.trim())}&print=1`, "_blank");
      setSt({ error: e.message, printed: e.noBrowser });
    });
  };
  return (
    <>
      <button type="button" onClick={() => { setSt({}); setOpen(true); }} className="flex min-h-11 items-center gap-1.5 rounded-full bg-ink px-4 font-semibold text-bg hover:opacity-90">
        <FileText aria-hidden className="size-4" />Make PDF
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Make the PDF" className="relative w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-xl">
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute right-3 top-3 grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2"><X aria-hidden className="size-4" /></button>
            <h2 className="mb-1 font-serif text-2xl font-semibold">Make the PDF</h2>
            <p className="mb-4 text-sm text-muted">Every task in full with your answers, your name and the assignment's title. It's saved in this assignment's my-submission folder, ready to upload on eClass.</p>
            <label className="mb-4 grid gap-1 text-sm">
              <span className="font-semibold">Name on the PDF</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl border border-line bg-bg px-3 py-2 outline-none focus:border-muted" />
            </label>
            {st.pdf && (
              <div className="mb-4 rounded-xl bg-ok-bg p-3 text-sm text-ok">
                Saved as <b className="break-all">{decodeURIComponent(st.pdf.split("/").pop() ?? "")}</b>.{" "}
                <a href={st.pdf} target="_blank" rel="noreferrer" className="font-semibold underline">Open the PDF</a>
              </div>
            )}
            {st.error && <div role="alert" className="mb-4 rounded-xl bg-bad-bg p-3 text-sm text-bad">{st.error}</div>}
            <div className="flex justify-end gap-2">
              <a href={printHref(sem, id, name.trim())} target="_blank" rel="noreferrer" className="grid min-h-11 place-items-center rounded-full border border-line px-4 text-sm">Preview</a>
              <button type="button" onClick={go} disabled={st.busy} className="min-h-11 rounded-full bg-ink px-5 font-semibold text-bg disabled:opacity-60">
                {st.busy ? "Making the PDF…" : st.pdf ? "Make it again" : "Make PDF"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
