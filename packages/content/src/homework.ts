/**
 * Interactive homework: the tasks file the AI writes from an assignment's brief
 * (semesters/<id>/assignments/<CODE>/<folder>/homework/tasks.json, see docs/HOMEWORK_FORMAT.md),
 * the student's answers and the done/left counts. No Node imports: the web app uses it too.
 */

export const TASK_KINDS = ["written", "calculation", "choice"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export interface HomeworkTask {
  id: string;
  kind: TaskKind;
  title?: string;        // a few words for the timeline
  question: string;      // Markdown with $LaTeX$, copied from the brief
  options?: string[];    // kind "choice" only
}
export interface Homework { title?: string; tasks: HomeworkTask[] }

/** One task's answer as the app saves it. */
export interface TaskAnswer {
  text?: string;         // the written answer
  choice?: number;       // the picked option (index into options)
  why?: string;          // optional: why that option was picked
  done?: boolean;
  updated?: string;      // ISO datetime
}
/** Task id → answer. */
export type HomeworkAnswers = Record<string, TaskAnswer>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;
const TASK_ID = /^[\w.-]{1,20}$/;
const MAX_TEXT = 200_000;

/** Checks a tasks file. `homework` is null when it can't be used until the problems are fixed. */
export function parseHomework(src: string | Raw): { homework: Homework | null; problems: string[] } {
  const problems: string[] = [];
  let d: Raw = src;
  if (typeof src === "string") {
    try { d = JSON.parse(src); } catch (e) { return { homework: null, problems: [`Not valid JSON: ${(e as Error).message}`] }; }
  }
  if (!d || typeof d !== "object" || !Array.isArray(d.tasks) || !d.tasks.length) return { homework: null, problems: ['The file must be one JSON object with "tasks": a non-empty list.'] };
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const seen = new Set<string>();
  const tasks: HomeworkTask[] = [];
  (d.tasks as Raw[]).forEach((t, i) => {
    const at = `Task ${i + 1}`;
    const id = str(t?.id) || String(i + 1);
    if (!TASK_ID.test(id)) return problems.push(`${at}: "id" may only have letters, digits, dots and dashes.`);
    if (seen.has(id)) return problems.push(`${at}: the id "${id}" is used twice.`);
    seen.add(id);
    if (!TASK_KINDS.includes(t?.kind)) return problems.push(`${at}: "kind" must be one of ${TASK_KINDS.join(", ")}.`);
    const question = str(t.question);
    if (!question) return problems.push(`${at}: needs "question" (the task as the brief asks it).`);
    const task: HomeworkTask = { id, kind: t.kind, question, ...(str(t.title) ? { title: str(t.title) } : {}) };
    if (t.kind === "choice") {
      const options = Array.isArray(t.options) ? (t.options as unknown[]).map(str) : [];
      if (options.length < 2 || options.length > 8 || options.some((o) => !o)) return problems.push(`${at}: "options" must be a list of 2 to 8 texts.`);
      task.options = options;
    }
    tasks.push(task);
  });
  if (problems.length) return { homework: null, problems };
  return { homework: { ...(str(d.title) ? { title: str(d.title) } : {}), tasks }, problems };
}

/** What the timeline calls a task. */
export const taskLabel = (t: HomeworkTask, i: number) => t.title || `Task ${i + 1}`;

/** How many tasks are marked done, and how many are left. Answers to tasks that no longer exist don't count. */
export function homeworkProgress(tasks: HomeworkTask[], answers: HomeworkAnswers): { done: number; total: number; left: number } {
  const done = tasks.filter((t) => answers[t.id]?.done).length;
  return { done, total: tasks.length, left: tasks.length - done };
}

const bad = (m: string): never => { throw new Error(m); };

/**
 * Merges one change ({ task, text?, choice?, why?, done? }) into the saved answers, after checking it.
 * `choice: null` clears the choice. Returns the new answers (the old object is left alone).
 */
export function applyAnswer(tasks: HomeworkTask[], answers: HomeworkAnswers, patch: unknown, now = new Date()): HomeworkAnswers {
  const p = (patch ?? {}) as Record<string, unknown>;
  const task = tasks.find((t) => t.id === p.task) ?? bad("No such task.");
  const next: TaskAnswer = { ...answers[task.id] };
  const text = (k: "text" | "why") => {
    if (p[k] === undefined) return;
    if (typeof p[k] !== "string") bad(`Bad ${k}.`);
    if ((p[k] as string).length > MAX_TEXT) bad("That answer is too long.");
    next[k] = p[k] as string;
  };
  text("text");
  text("why");
  if (p.choice === null) delete next.choice;
  else if (p.choice !== undefined) {
    const n = task.options?.length ?? 0;
    if (!Number.isInteger(p.choice) || (p.choice as number) < 0 || (p.choice as number) >= n) bad("Bad choice.");
    next.choice = p.choice as number;
  }
  if (p.done !== undefined) {
    if (typeof p.done !== "boolean") bad("Say done: true or false.");
    if (p.done) next.done = true; else delete next.done;
  }
  next.updated = now.toISOString();
  return { ...answers, [task.id]: next };
}

/**
 * The AI's check of the answers (homework/check.json, see docs/HOMEWORK_FORMAT.md): a verdict and a note per task.
 * right: right, whatever the wording; better: right, with a better way to put or do it; wrong: not right (a hint, never the answer);
 * empty: not answered yet.
 */
export const VERDICTS = ["right", "better", "wrong", "empty"] as const;
export type Verdict = (typeof VERDICTS)[number];
export interface TaskCheck { verdict: Verdict; note: string }
export interface HomeworkCheck {
  summary?: string;                      // Markdown
  tasks: Record<string, TaskCheck>;      // task id → its check
  checked?: string;                      // ISO datetime, when the file was written
}

/** Reads a check file. `check` keeps the tasks that are fine; `problems` lists what to fix (an empty list means it's complete). */
export function parseCheck(src: string | Raw, tasks: HomeworkTask[]): { check: HomeworkCheck | null; problems: string[] } {
  let d: Raw = src;
  if (typeof src === "string") {
    try { d = JSON.parse(src); } catch (e) { return { check: null, problems: [`Not valid JSON: ${(e as Error).message}`] }; }
  }
  if (!d || typeof d !== "object" || !d.tasks || typeof d.tasks !== "object" || Array.isArray(d.tasks)) return { check: null, problems: ['The file must be one JSON object with "tasks": { <task id>: { verdict, note } }.'] };
  const problems: string[] = [];
  const out: Record<string, TaskCheck> = {};
  for (const id of Object.keys(d.tasks)) if (!tasks.some((t) => t.id === id)) problems.push(`"${id}": no such task in tasks.json.`);
  tasks.forEach((t, i) => {
    const at = `Task ${i + 1} ("${t.id}")`;
    const c = d.tasks[t.id];
    if (c === undefined) return problems.push(`${at}: missing; give every task a verdict.`);
    if (!VERDICTS.includes(c?.verdict)) return problems.push(`${at}: "verdict" must be one of ${VERDICTS.join(", ")}.`);
    const note = typeof c.note === "string" ? c.note.trim() : "";
    if (!note) return problems.push(`${at}: needs a "note" saying why.`);
    out[t.id] = { verdict: c.verdict, note };
  });
  const summary = typeof d.summary === "string" ? d.summary.trim() : "";
  return { check: { ...(summary ? { summary } : {}), tasks: out }, problems };
}

/** How many tasks got each verdict. */
export function checkCounts(tasks: HomeworkTask[], check: HomeworkCheck): Record<Verdict, number> {
  const n: Record<Verdict, number> = { right: 0, better: 0, wrong: 0, empty: 0 };
  for (const t of tasks) { const v = check.tasks[t.id]?.verdict; if (v) n[v]++; }
  return n;
}

/**
 * Reads an answers file ({ answers: { <task id>: { text?, choice?, why?, done? } } }), e.g. one the AI filled in
 * from the student's submitted work. `answers` keeps what's valid; `problems` lists the rest.
 */
export function parseAnswers(src: string | Raw, tasks: HomeworkTask[]): { answers: HomeworkAnswers; problems: string[] } {
  let d: Raw = src;
  if (typeof src === "string") {
    try { d = JSON.parse(src); } catch (e) { return { answers: {}, problems: [`Not valid JSON: ${(e as Error).message}`] }; }
  }
  if (!d || typeof d !== "object" || !d.answers || typeof d.answers !== "object" || Array.isArray(d.answers)) return { answers: {}, problems: ['The file must be one JSON object with "answers": { <task id>: { text, choice, why, done } }.'] };
  const problems: string[] = [];
  let answers: HomeworkAnswers = {};
  for (const [id, a] of Object.entries(d.answers as Record<string, Raw>)) {
    if (!tasks.some((t) => t.id === id)) { problems.push(`"${id}": no such task in tasks.json.`); continue; }
    const { updated, ...rest } = a && typeof a === "object" ? a : ({} as Raw);
    try {
      answers = applyAnswer(tasks, answers, { ...rest, task: id }, typeof updated === "string" && !Number.isNaN(Date.parse(updated)) ? new Date(updated) : undefined);
    } catch (e) { problems.push(`"${id}": ${(e as Error).message.replace(/\.$/, "")} (text and why are HTML strings, choice the index of an option, done true or false).`); }
  }
  return { answers, problems };
}
