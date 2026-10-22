import { useEffect, useState, type ReactNode } from "react";
import type { Course, SemesterData, Week } from "@ouc/content/types";
import { useAiStatus } from "../lib/ai";
import { dismissJob, makeQuiz, useQuizJobs, type QuizJob } from "../lib/quiz";
import { proposedCustomQuizName, proposedQuizName } from "@ouc/content/quiz";
import { Link, enc } from "../lib/router";
import { cx, isMaterial } from "./ui";
import { Hourglass, Settings, TriangleAlert, Trophy, X } from "./icons";

/** The classes a quiz can be made for: weeks with files or a note. */
export const quizWeeks = (data: SemesterData, c: Course): Week[] =>
  c.weeks.filter((w) => w.items.some(isMaterial) || data.notes.some((n) => n.code === c.code && n.weekIndex === w.index));

/** Pop-up: pick one class, the whole course or a custom quiz on your topics; the AI makes it in the background (no chat opens). */
function MakeQuizDialog({ data, course, week, onClose }: { data: SemesterData; course?: string; week?: string; onClose: () => void }) {
  const [code, setCode] = useState(course ?? data.courses[0]?.code ?? "");
  const c = data.courses.find((x) => x.code === code);
  const weeks = c ? quizWeeks(data, c) : [];
  const [scope, setScope] = useState<"course" | "class" | "custom">(week !== undefined ? "class" : "course");
  const [pick, setPick] = useState(week ?? "");
  const [topics, setTopics] = useState("");
  const [web, setWeb] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const sel = scope === "class" ? (weeks.some((w) => String(w.index) === pick) ? pick : String(weeks[0]?.index ?? "")) : undefined;
  // the proposed name follows the choice until the student types their own (emptying the box brings it back)
  const [typed, setTyped] = useState<string>();
  const proposed = !c ? "" : scope === "custom" ? proposedCustomQuizName(c, topics) : proposedQuizName(c, scope === "class" ? weeks.find((w) => String(w.index) === sel) ?? null : null);
  const name = typed ?? proposed;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, []);
  const submit = async () => {
    setBusy(true); setError(undefined);
    const title = name.trim() || proposed;
    try { await makeQuiz(data.id, code, scope === "custom" ? { title, topics, web } : { week: sel, title }); onClose(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  };
  const box = (on: boolean, disabled = false) => cx("flex cursor-pointer items-start gap-3 rounded-xl border-2 px-4 py-3", on ? "border-ink bg-surface-2" : "border-line", disabled && "cursor-not-allowed opacity-50");
  const radio = (v: "course" | "class" | "custom", label: string, hint: string, disabled = false) => (
    <label className={box(scope === v, disabled)}>
      <input type="radio" name="quiz-scope" className="mt-1" checked={scope === v} disabled={disabled} onChange={() => setScope(v)} />
      <span><span className="block font-semibold">{label}</span><span className="text-xs text-muted">{hint}</span></span>
    </label>
  );
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Make a quiz" className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-xl">
        <h2 className="mb-1 font-serif text-2xl font-semibold">Make a quiz</h2>
        <p className="mb-5 text-sm text-muted">Your AI writes it in the background. It shows up under Quizzes when it's ready.</p>
        <label className="mb-4 block text-sm">
          <span className="mb-1 block font-semibold">Course</span>
          <select aria-label="Course" value={code} onChange={(e) => { setCode(e.target.value); setPick(""); }} className="w-full rounded-lg border border-line bg-surface px-3 py-2">
            {data.courses.map((x) => <option key={x.code} value={x.code}>{x.short} ({x.code})</option>)}
          </select>
        </label>
        <div className="mb-4 grid gap-2 text-sm">
          {radio("course", "Whole course", "Questions from every class so far")}
          {radio("class", "One class", weeks.length ? "Questions from one week or lecture" : "No class has material yet", !weeks.length)}
          {radio("custom", "Custom", "Questions on the topics you write")}
        </div>
        {scope === "class" && weeks.length > 0 && (
          <label className="mb-4 block text-sm">
            <span className="mb-1 block font-semibold">Class</span>
            <select aria-label="Class" value={sel} onChange={(e) => setPick(e.target.value)} className="w-full rounded-lg border border-line bg-surface px-3 py-2">
              {weeks.map((w) => <option key={w.index} value={w.index}>{w.index === 0 ? "General" : w.label}</option>)}
            </select>
          </label>
        )}
        {scope === "custom" && (
          <>
            <label className="mb-4 block text-sm">
              <span className="mb-1 block font-semibold">Topics</span>
              <textarea aria-label="Topics" value={topics} rows={3} maxLength={2000} onChange={(e) => setTopics(e.target.value)}
                placeholder="e.g. signal detection theory, d′ and the ROC curve; mix in a few calculations"
                className="w-full rounded-lg border border-line bg-surface px-3 py-2" />
            </label>
            <fieldset className="mb-4 grid gap-2 text-sm">
              <legend className="mb-1 font-semibold">Sources</legend>
              <label className={box(!web)}>
                <input type="radio" name="quiz-sources" className="mt-1" checked={!web} onChange={() => setWeb(false)} />
                <span><span className="block font-semibold">Course material only</span><span className="text-xs text-muted">Only what the course covers</span></span>
              </label>
              <label className={box(web)}>
                <input type="radio" name="quiz-sources" className="mt-1" checked={web} onChange={() => setWeb(true)} />
                <span><span className="block font-semibold">Course material and the web</span><span className="text-xs text-muted">Your AI can look things up beyond the course</span></span>
              </label>
            </fieldset>
          </>
        )}
        <label className="mb-4 block text-sm">
          <span className="mb-1 block font-semibold">Name</span>
          <input type="text" aria-label="Name" value={name} maxLength={120} onChange={(e) => setTyped(e.target.value || undefined)} className="w-full rounded-lg border border-line bg-surface px-3 py-2" />
        </label>
        {error && <p className="mb-4 rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-line px-4 py-2 text-sm font-semibold">Cancel</button>
          <button type="button" onClick={submit} disabled={busy || !code || (scope === "custom" && !topics.trim())} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40">{busy ? "Starting…" : "Make quiz"}</button>
        </div>
      </div>
    </div>
  );
}

/** A button that opens the Make a quiz pop-up (hidden when the app can't reach an AI). */
export function MakeQuizButton({ data, course, week, children, className }: { data: SemesterData; course?: string; week?: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ai = useAiStatus();
  if (ai.state === "unavailable") return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={cx("inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink transition hover:border-muted", className)}>
        <Trophy aria-hidden className="size-4 text-muted" />{children}
      </button>
      {open && <MakeQuizDialog data={data} course={course} week={week} onClose={() => setOpen(false)} />}
    </>
  );
}

/** What a running quiz job is doing, for its spinning-gears line. */
export const quizPhase = (j: { queued?: boolean; phase?: string }) => j.queued ? "Waiting its turn…" : j.phase === "writing" ? "Creating the quiz…" : "Planning the quiz…";

/**
 * Quizzes the AI is making right now (and ones that failed), for one course or all.
 * `week`: only that class's (shown in place, under the week's Practice), or null for whole-course quizzes only.
 */
export function QuizJobs({ data, course, week }: { data: SemesterData; course?: string; week?: string | null }) {
  const all = useQuizJobs(data.id, course);
  const jobs = week === undefined ? all : all.filter((j) => (week === null ? j.week === undefined : j.week === week));
  if (!jobs.length) return null;
  if (week) return (
    <div className="grid gap-1.5 px-2">
      {jobs.map((j) => (
        <div key={j.id} className={cx("flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 text-sm", j.running || j.queued ? "text-muted" : "bg-bad-bg")} role="status">
          {j.running ? <Settings aria-hidden className="size-4 shrink-0 animate-spin text-accent [animation-duration:2.5s]" />
            : j.queued ? <Hourglass aria-hidden className="size-4 shrink-0" /> : <TriangleAlert aria-hidden className="size-4 shrink-0 text-bad" />}
          <span className="min-w-0 flex-1">{j.running || j.queued ? quizPhase(j) : <>The quiz wasn't made: {j.error}</>}</span>
          {j.chatId && <WorkLink sem={data.id} running={j.running} />}
          {!j.running && !j.queued && <button type="button" aria-label="Dismiss" className="px-1 text-muted hover:text-ink" onClick={() => dismissJob(j.id)}><X aria-hidden className="size-4" /></button>}
        </div>
      ))}
    </div>
  );
  return <QuizJobList data={data} jobs={jobs} />;
}

/** Quizzes run in the background, with no chat: their steps are on the AI background work page. */
export const WorkLink = ({ sem, running }: { sem: string; running: boolean }) => (
  <Link to={`/${enc(sem)}/ai-work`} className="text-xs text-muted underline hover:text-ink">{running ? "Watch it work" : "See what happened"}</Link>
);

/** What a quiz job is for: "Artificial Intelligence · Foundations of AI" or "… · whole course". */
export const quizJobLabel = (data: SemesterData, code: string, week?: string) => {
  const c = data.courses.find((x) => x.code === code);
  const w = week !== undefined ? c?.weeks.find((x) => String(x.index) === week) : undefined;
  return `${c?.short ?? code}${w ? ` · ${w.index === 0 ? "General" : w.label}` : " · whole course"}`;
};

function QuizJobList({ data, jobs }: { data: SemesterData; jobs: QuizJob[] }) {
  const what = (code: string, week?: string) => quizJobLabel(data, code, week);
  // classes waiting their turn share one line
  const waiting = jobs.filter((j) => j.queued);
  return (
    <div className="mb-4 grid gap-2">
      {jobs.filter((j) => !j.queued).map((j) => (
        <div key={j.id} className={cx("flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm", j.running ? "border-line bg-surface" : "border-bad/40 bg-bad-bg")} role="status">
          {j.running ? <Settings aria-hidden className="size-4 shrink-0 animate-spin text-accent [animation-duration:2.5s]" /> : <TriangleAlert aria-hidden className="size-4 shrink-0 text-bad" />}
          <span className="min-w-0 flex-1">
            {j.running ? <><b>{(j.title ?? what(j.course, j.week))}</b>: {quizPhase(j)}</> : <>The quiz for <b>{(j.title ?? what(j.course, j.week))}</b> wasn't made: {j.error}</>}
          </span>
          {j.chatId && <WorkLink sem={data.id} running={j.running} />}
          {!j.running && <button type="button" aria-label="Dismiss" className="px-1 text-muted hover:text-ink" onClick={() => dismissJob(j.id)}><X aria-hidden className="size-4" /></button>}
        </div>
      ))}
      {waiting.length > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2 text-sm text-muted" role="status">
          <Hourglass aria-hidden className="size-4 shrink-0" />
          <span>Waiting their turn ({waiting.length}): {waiting.map((j) => (j.title ?? what(j.course, j.week))).join(", ")}</span>
        </div>
      )}
    </div>
  );
}
