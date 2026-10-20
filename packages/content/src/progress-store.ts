// Ticks on this computer: semesters/<id>/progress.json (git-ignored with the rest of semesters/).
// The app saves a tick (POST /api/progress in apps/web/vite.config.ts); the AI reads the file to see
// what's been watched and read (ai/skills/plan-week).
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DoneEntry, Progress } from "./progress.ts";

export const progressFile = (semDir: string) => join(semDir, "progress.json");

export function readProgress(semDir: string): Progress {
  const f = progressFile(semDir);
  if (!existsSync(f)) return {};
  try { const j = JSON.parse(readFileSync(f, "utf8")); return j?.done && typeof j.done === "object" && !Array.isArray(j.done) ? j.done : {}; } catch { return {}; }
}

function writeProgress(semDir: string, done: Progress) {
  const f = progressFile(semDir);
  writeFileSync(`${f}.tmp`, `${JSON.stringify({ done }, null, 1)}\n`);
  renameSync(`${f}.tmp`, f);
}

const HOW = ["ticked", "watched", "viewed"];
const bad = (m: string) => { throw new Error(m); };

/**
 * Ticks an item ({ key, done: true, course, week, title, kind, how? }) or unticks it ({ key, done: false }).
 * An item already ticked keeps its first tick (playing a video again doesn't move it). Returns the whole list.
 */
export function setDone(semDir: string, body: unknown, now = new Date()): Progress {
  const b = (body ?? {}) as Record<string, unknown>;
  const key = typeof b.key === "string" && b.key.length > 0 && b.key.length <= 1000 ? b.key : bad("Bad item.");
  const all = readProgress(semDir);
  if (b.done === false) {
    if (all[key]) { delete all[key]; writeProgress(semDir, all); }
    return all;
  }
  if (b.done !== true) bad("Say done: true or false.");
  if (all[key]) return all;
  const entry: DoneEntry = {
    course: typeof b.course === "string" && /^[\w-]{1,40}$/.test(b.course) ? b.course : bad("Bad course."),
    week: Number.isInteger(b.week) && (b.week as number) >= 0 ? (b.week as number) : bad("Bad week."),
    title: typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 300) : bad("Bad title."),
    kind: typeof b.kind === "string" && /^\w{1,20}$/.test(b.kind) ? b.kind : bad("Bad kind."),
    at: now.toISOString(),
    how: b.how === undefined ? "ticked" : HOW.includes(b.how as string) ? (b.how as DoneEntry["how"]) : bad("Bad how."),
  };
  all[key] = entry;
  writeProgress(semDir, all);
  return all;
}
