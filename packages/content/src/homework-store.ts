// Interactive homework on this computer, next to each assignment (git-ignored with the rest of semesters/):
//   assignments/<CODE>/<folder>/homework/tasks.json    the tasks, written by the AI from the brief
//   assignments/<CODE>/<folder>/homework/answers.json  { answers: { <task id>: { text, choice, why, done, updated } } }
//   assignments/<CODE>/<folder>/homework/images/       pictures added to answers, named by their content
//   assignments/<CODE>/<folder>/homework/check.json    the AI's check of the answers (Check my answers)
// The app saves answers through POST /api/homework (apps/web/vite.config.ts).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyAnswer, parseCheck, parseHomework, type Homework, type HomeworkAnswers, type HomeworkCheck } from "./homework.ts";

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

// "CODE/folder" of every assignment with that file in its homework folder
function withFile(semDir: string, file: string): string[] {
  const root = join(semDir, "assignments");
  const dirs = (p: string) => { try { return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name); } catch { return []; } };
  return dirs(root).flatMap((code) => dirs(join(root, code)).filter((f) => existsSync(join(root, code, f, "homework", file))).map((f) => `${code}/${f}`));
}

/** Every assignment's answers in the semester, by assignment id. */
export function allAnswers(semDir: string): Record<string, HomeworkAnswers> {
  return Object.fromEntries(withFile(semDir, "answers.json").map((id) => [id, readAnswers(semDir, id)]));
}

/** The AI's check of an assignment's answers, with when it was made; undefined if there's none (or no tasks). */
export function readCheck(semDir: string, assignment: string): HomeworkCheck | undefined {
  const f = join(homeworkDir(semDir, assignment), "check.json");
  const hw = readHomework(semDir, assignment)?.homework;
  if (!hw || !existsSync(f)) return undefined;
  const { check } = parseCheck(readFileSync(f, "utf8"), hw.tasks);
  return check ? { ...check, checked: statSync(f).mtime.toISOString() } : undefined;
}

/** Every assignment's check in the semester, by assignment id. */
export function allChecks(semDir: string): Record<string, HomeworkCheck> {
  return Object.fromEntries(withFile(semDir, "check.json").map((id) => [id, readCheck(semDir, id)]).filter(([, c]) => c));
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

export const MAX_IMAGE = 10 * 1024 * 1024;
const IMAGE_TYPES: [number[], string][] = [[[0x89, 0x50, 0x4e, 0x47], "png"], [[0xff, 0xd8, 0xff], "jpg"], [[0x47, 0x49, 0x46, 0x38], "gif"], [[0x52, 0x49, 0x46, 0x46], "webp"]];

/** Saves a picture added to an answer; returns its path in the homework folder ("images/<hash>.<ext>"). */
export function saveImage(semDir: string, assignment: string, buf: Buffer): string {
  const dir = homeworkDir(semDir, assignment);
  if (!readHomework(semDir, assignment)?.homework) throw Object.assign(new Error("This assignment has no interactive version."), { code: 404 });
  if (buf.length > MAX_IMAGE) throw new Error("That picture is too big (10 MB at most).");
  const ext = IMAGE_TYPES.find(([magic, e]) => magic.every((b, i) => buf[i] === b) && (e !== "webp" || buf.subarray(8, 12).toString() === "WEBP"))?.[1];
  if (!ext) throw new Error("Pictures must be PNG, JPEG, GIF or WebP.");
  const name = `images/${createHash("sha256").update(buf).digest("hex").slice(0, 16)}.${ext}`;
  const f = join(dir, name);
  if (!existsSync(f)) { mkdirSync(join(dir, "images"), { recursive: true }); writeFileSync(f, buf); }
  return name;
}
