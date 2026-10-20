// Quiz scores on this computer: semesters/<id>/quizzes/attempts.json (git-ignored with the rest of semesters/).
// The app saves an attempt when a quiz is finished (POST /api/quiz/attempts in apps/web/vite.config.ts);
// the AI reads the file to see weak spots (ai/skills/quiz-me).
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeAttempt } from "./quiz.ts";
import type { QuizAttempt } from "./types.ts";

export const attemptsFile = (semDir: string) => join(semDir, "quizzes", "attempts.json");

export function readAttempts(semDir: string): QuizAttempt[] {
  const f = attemptsFile(semDir);
  if (!existsSync(f)) return [];
  try { const j = JSON.parse(readFileSync(f, "utf8")); return Array.isArray(j?.attempts) ? j.attempts : []; } catch { return []; }
}

function writeAttempts(semDir: string, all: QuizAttempt[]) {
  const f = attemptsFile(semDir);
  mkdirSync(join(semDir, "quizzes"), { recursive: true });
  writeFileSync(`${f}.tmp`, `${JSON.stringify({ attempts: all }, null, 1)}\n`);
  renameSync(`${f}.tmp`, f);
}

const QUIZ_ID = /^([\w-]+)\/([\w.-]+)$/;

/** Starts a quiz over (clears its attempts), or every quiz when `quiz` is left out. Returns how many attempts were cleared. */
export function resetAttempts(semDir: string, quiz?: string): number {
  if (quiz !== undefined && !QUIZ_ID.test(quiz)) throw new Error("Bad quiz id.");
  const all = readAttempts(semDir);
  const kept = quiz === undefined ? [] : all.filter((a) => a.quiz !== quiz);
  if (kept.length !== all.length) writeAttempts(semDir, kept);
  return all.length - kept.length;
}

/** Deletes a quiz file (quizzes/<CODE>/<name>.json) and its attempts. */
export function removeQuiz(semDir: string, quiz: string): void {
  const m = quiz.match(QUIZ_ID);
  if (!m || m[2]!.startsWith(".")) throw new Error("Bad quiz id.");
  const f = join(semDir, "quizzes", m[1]!, `${m[2]}.json`);
  if (!existsSync(f)) throw Object.assign(new Error("That quiz doesn't exist."), { code: 404 });
  rmSync(f);
  resetAttempts(semDir, quiz);
}

/** Deletes every quiz of a course (quizzes/<CODE>/*.json) and their attempts. Returns how many quizzes were removed. */
export function removeCourseQuizzes(semDir: string, code: string): number {
  if (!/^[\w-]+$/.test(code)) throw new Error("Bad course code.");
  const dir = join(semDir, "quizzes", code);
  const names = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith(".")) : [];
  for (const f of names) rmSync(join(dir, f));
  const ids = new Set(names.map((f) => `${code}/${f.slice(0, -5)}`));
  const all = readAttempts(semDir);
  const kept = all.filter((a) => !ids.has(a.quiz));
  if (kept.length !== all.length) writeAttempts(semDir, kept);
  return names.length;
}

/** Checks and appends one attempt (written to a temp file first, so a crash never loses the history). */
export function addAttempt(semDir: string, body: unknown, now = new Date()): QuizAttempt {
  const attempt = makeAttempt(body, now);
  writeAttempts(semDir, [...readAttempts(semDir), attempt]);
  return attempt;
}
