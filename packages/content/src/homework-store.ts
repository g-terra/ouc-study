// Interactive homework on this computer, next to each assignment (git-ignored with the rest of semesters/):
//   assignments/<CODE>/<folder>/homework/tasks.json    the tasks, written by the AI from the brief
//   assignments/<CODE>/<folder>/homework/answers.json  { answers: { <task id>: { text, choice, why, done, updated } } }
// The app saves answers through POST /api/homework (apps/web/vite.config.ts).
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyAnswer, parseHomework, type Homework, type HomeworkAnswers } from "./homework.ts";

const SEGMENT = /^(?!\.)[^/\\]{1,120}$/;

/** The homework folder of an assignment ("CODE/folder"); throws on an id that could leave the assignments folder. */
export function homeworkDir(semDir: string, assignment: string): string {
  const parts = String(assignment).split("/");
  if (parts.length !== 2 || !/^[\w-]{1,40}$/.test(parts[0]!) || !SEGMENT.test(parts[1]!)) throw new Error("Bad assignment.");
  return join(semDir, "assignments", parts[0]!, parts[1]!, "homework");
}

export function readHomework(semDir: string, assignment: string): { homework: Homework | null; problems: string[] } | undefined {
  const f = join(homeworkDir(semDir, assignment), "tasks.json");
  return existsSync(f) ? parseHomework(readFileSync(f, "utf8")) : undefined;
}

export function readAnswers(semDir: string, assignment: string): HomeworkAnswers {
  const f = join(homeworkDir(semDir, assignment), "answers.json");
  if (!existsSync(f)) return {};
  try { const j = JSON.parse(readFileSync(f, "utf8")); return j?.answers && typeof j.answers === "object" && !Array.isArray(j.answers) ? j.answers : {}; } catch { return {}; }
}

/** Every assignment's answers in the semester, by assignment id. */
export function allAnswers(semDir: string): Record<string, HomeworkAnswers> {
  const out: Record<string, HomeworkAnswers> = {};
  const root = join(semDir, "assignments");
  const dirs = (p: string) => { try { return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name); } catch { return []; } };
  for (const code of dirs(root)) for (const folder of dirs(join(root, code))) {
    if (existsSync(join(root, code, folder, "homework", "answers.json"))) out[`${code}/${folder}`] = readAnswers(semDir, `${code}/${folder}`);
  }
  return out;
}

/** Checks and saves one change to an answer ({ assignment, task, text?, choice?, why?, done? }); returns the assignment's answers. */
export function saveAnswer(semDir: string, body: unknown, now = new Date()): HomeworkAnswers {
  const b = (body ?? {}) as Record<string, unknown>;
  const assignment = String(b.assignment ?? "");
  const dir = homeworkDir(semDir, assignment);
  const hw = readHomework(semDir, assignment)?.homework;
  if (!hw) throw Object.assign(new Error("This assignment has no interactive version."), { code: 404 });
  const answers = applyAnswer(hw.tasks, readAnswers(semDir, assignment), b, now);
  const f = join(dir, "answers.json");
  writeFileSync(`${f}.tmp`, `${JSON.stringify({ answers }, null, 1)}\n`);
  renameSync(`${f}.tmp`, f);
  return answers;
}
