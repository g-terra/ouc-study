// Quiz scores on this computer: semesters/<id>/quizzes/attempts.json (git-ignored with the rest of semesters/).
// The app saves an attempt when a quiz is finished (POST /api/quiz/attempts in apps/web/vite.config.ts);
// the AI reads the file to see weak spots (ai/skills/quiz-me).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeAttempt } from "./quiz.ts";
import type { QuizAttempt } from "./types.ts";

export const attemptsFile = (semDir: string) => join(semDir, "quizzes", "attempts.json");

export function readAttempts(semDir: string): QuizAttempt[] {
  const f = attemptsFile(semDir);
  if (!existsSync(f)) return [];
  try { const j = JSON.parse(readFileSync(f, "utf8")); return Array.isArray(j?.attempts) ? j.attempts : []; } catch { return []; }
}

/** Checks and appends one attempt (written to a temp file first, so a crash never loses the history). */
export function addAttempt(semDir: string, body: unknown, now = new Date()): QuizAttempt {
  const attempt = makeAttempt(body, now);
  const all = [...readAttempts(semDir), attempt];
  const f = attemptsFile(semDir);
  mkdirSync(join(semDir, "quizzes"), { recursive: true });
  writeFileSync(`${f}.tmp`, `${JSON.stringify({ attempts: all }, null, 1)}\n`);
  renameSync(`${f}.tmp`, f);
  return attempt;
}
