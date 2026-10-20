/**
 * Exams from the OUC exam timetable, for when _meta/exams.json is empty.
 *
 * The timetable PDF (one for the whole university, in the course files) has one line per module:
 *   "COS 511     5/12/2026     13:00     11/1/2027     **"
 * code, final exam date and time, repeat exam date and time ("**" = time not announced yet).
 * Each module is listed once per semester, so only the lines whose final exam falls in this semester count.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** An exam as _meta/exams.json stores it. */
export interface RawExam { code: string; kind: string; at: string; notime?: boolean; source?: string }

const LINE = /^\s*([A-ZΑ-Ω]{2,4})\s?(\d{3})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?(?:\s+(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?)?/;
const pad = (n: string | number) => String(n).padStart(2, "0");
const iso = (d: string, m: string, y: string, h?: string, min?: string) => `${y}-${pad(m)}-${pad(d)}T${pad(h ?? 0)}:${pad(min ?? 0)}`;

/** The exams of `codes` in a timetable's text whose final exam is between `start` and 45 days after `end` (YYYY-MM-DD). */
export function parseExamTimetable(text: string, codes: string[], start: string, end: string, source?: string): RawExam[] {
  const want = new Set(codes.map((c) => c.replace(/\s+/g, "").toUpperCase()));
  const last = new Date(new Date(`${end}T00:00`).getTime() + 45 * 86_400_000).toISOString().slice(0, 10);
  const out: RawExam[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (!m) continue;
    const code = `${m[1]}${m[2]}`;
    if (!want.has(code) || seen.has(code)) continue;
    const final = iso(m[3], m[4], m[5], m[6], m[7]);
    if (final.slice(0, 10) < start || final.slice(0, 10) > last) continue;
    seen.add(code);
    out.push({ code, kind: "Final exam", at: final, ...(m[6] ? {} : { notime: true }), source });
    if (m[8]) out.push({ code, kind: "Repeat exam", at: iso(m[8], m[9], m[10], m[11], m[12]), ...(m[11] ? {} : { notime: true }), source });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

const TIMETABLE = /exam.*timetable|timetable.*exam|εξετ/i;

/** The text copy of the exam timetable under text/ (preferring the file named in semester.json), with its path relative to `dir`. */
export function findTimetableText(dir: string, named?: string): { text: string; pdf: string } | undefined {
  const root = join(dir, "text");
  if (!existsSync(root)) return;
  const found: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.toLowerCase().endsWith(".pdf.txt") && TIMETABLE.test(f)) found.push(p);
    }
  };
  walk(root);
  const pick = found.find((p) => named && p.endsWith(`${named}.txt`)) ?? found[0];
  if (!pick) return;
  return { text: readFileSync(pick, "utf8"), pdf: join("courses", relative(root, pick).slice(0, -".txt".length)) };
}
