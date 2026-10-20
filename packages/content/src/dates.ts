// Important dates the student adds to a course (exams, talks, anything with a day): semesters/<id>/_meta/dates.json
// (git-ignored with the rest of semesters/). The app saves them (/api/dates in apps/web/vite.config.ts); the AI edits
// the same file (ai/skills/important-dates). Exams written by hand in the old _meta/exams.json are read until the first change.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { ImportantDate } from "./types.ts";

/** One date as dates.json stores it. */
export interface StoredDate { id: string; code: string; title: string; kind: "exam" | "other"; date: string; time?: string; topics?: string }

export const datesFile = (semDir: string) => join(semDir, "_meta", "dates.json");
const KINDS = ["exam", "other"];
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const read = (f: string): unknown => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return undefined; } };

/** The semester's dates in the order they were added. */
export function readDates(semDir: string): StoredDate[] {
  const f = datesFile(semDir);
  if (existsSync(f)) {
    const j = read(f) as { dates?: unknown };
    // a date written by hand may have no id: it gets one from its place in the list
    return Array.isArray(j?.dates) ? j.dates.map((d, i) => (d?.id ? d : { ...d, id: `n-${i + 1}` })).filter((d) => d.code && d.date) : [];
  }
  const old = read(join(semDir, "_meta", "exams.json")) as any;
  const list: any[] = Array.isArray(old) ? old : Array.isArray(old?.exams) ? old.exams : [];
  return list.filter((e) => e?.code && typeof e.at === "string" && DAY.test(e.at.slice(0, 10))).map((e, i): StoredDate => {
    const time = e.notime ? undefined : e.at.slice(11, 16);
    return { id: `exam-${i + 1}`, code: e.code, title: e.kind ?? "Exam", kind: "exam", date: e.at.slice(0, 10), ...(time && TIME.test(time) ? { time } : {}) };
  });
}

function writeDates(semDir: string, dates: StoredDate[]) {
  const f = datesFile(semDir);
  writeFileSync(`${f}.tmp`, `${JSON.stringify({ dates }, null, 1)}\n`);
  renameSync(`${f}.tmp`, f);
}

const bad = (m: string, code = 400): never => { throw Object.assign(new Error(m), { code }); };
const realDay = (s: string) => {
  const m = DAY.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
};

/** Adds a date ({ code, title, kind, date, time?, topics? }), or changes the one with that `id`. Returns them all. */
export function saveDate(semDir: string, body: unknown, codes: string[]): StoredDate[] {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
  const code = codes.includes(str("code")) ? str("code") : bad("Pick one of this semester's courses.");
  const title = str("title") ? str("title").slice(0, 200) : bad("Give the date a title.");
  const kind = (KINDS.includes(str("kind")) ? str("kind") : bad("The kind is exam or other.")) as StoredDate["kind"];
  const date = realDay(str("date")) ? str("date") : bad("The date is a day like 2026-12-05.");
  const time = !str("time") || TIME.test(str("time")) ? str("time") : bad("The time is like 13:00 (24-hour).");
  const topics = str("topics").slice(0, 2000);
  const all = readDates(semDir);
  const id = str("id");
  const i = id ? all.findIndex((d) => d.id === id) : all.length;
  if (i < 0) bad("That date doesn't exist any more.", 404);
  all[i] = { id: id || newId(all), code, title, kind, date, ...(time ? { time } : {}), ...(topics ? { topics } : {}) };
  writeDates(semDir, all);
  return all;
}

const newId = (all: StoredDate[]): string => {
  const id = `d-${randomBytes(4).toString("hex")}`;
  return all.some((d) => d.id === id) ? newId(all) : id;
};

/** Removes the date with this id. Returns the rest. */
export function removeDate(semDir: string, id: string): StoredDate[] {
  const all = readDates(semDir);
  const rest = all.filter((d) => d.id !== id);
  if (rest.length === all.length) bad("That date doesn't exist any more.", 404);
  writeDates(semDir, rest);
  return rest;
}

/** The dates as the app shows them: oldest first, with a local datetime. */
export function importantDates(dates: StoredDate[]): ImportantDate[] {
  return dates.map(({ id, code, title, kind, date, time, topics }): ImportantDate => ({
    id, code, title, kind, at: `${date}T${time ?? "00:00"}:00`, noTime: !time, ...(topics ? { topics } : {}),
  })).sort((a, b) => a.at.localeCompare(b.at));
}
