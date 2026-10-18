/**
 * Live classes (webconferences): eClass has no dated schedule for them, only one join link per course
 * and the weekly time in the tutors' announcements. The slot has this shape (semester.json "classes"):
 *
 *   "classes": {
 *     "day": "Tue", "time": "19:00", "minutes": 60,          weekly slot, in the semester's timezone
 *     "groups": { "F.02": { "time": "20:00" }, "F.03": {} }, optional: teaching groups with their own slot
 *     "group": "F.03",                                        optional: your group (else read from eClass)
 *     "joinUrl": "https://…",                                  optional: else the course's Webconference link
 *     "changes": [{ "date": "2026-09-29", "to": "2026-10-01T20:00", "group": "F.02" }, { "date": "2026-12-08", "cancelled": true }]
 *   }
 *
 * Usually nothing needs writing: detectClasses() reads the slot from eClass (the Webconference description
 * and the tutors' posts) and the build uses it; a "classes" block in semester.json overrides it.
 * One session is placed in every dated week that contains that weekday, and linked to the week's material.
 */
import type { ClassSession } from "./types.ts";

/** A course's weekly live-class slot (semester.json "classes", or read from eClass). */
export interface ClassesConfig {
  day: string | number;
  time?: string;
  minutes?: number;
  groups?: Record<string, { day?: string | number; time?: string; minutes?: number }>;
  group?: string;
  joinUrl?: string;
  changes?: ClassChange[];
}
export interface ClassChange { date: string; to?: string; cancelled?: boolean; note?: string; group?: string }
interface DatedWeek { index: number; name: string; start?: string; end?: string }
interface GeneralFile { title: string; href?: string; ext?: string }
/** The parts of a course in eclass-meta.json that the class time is read from (loosely typed: it is eClass text). */
interface ClassesMeta { secs?: { summary?: string; acts?: { type?: string; name?: string; desc?: unknown; threads?: { posts?: { text?: unknown; at?: string }[] }[] }[] }[] }

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utcDay = (s: string) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };

/** "Monday" | "mon" | 1 → 1 (Sunday = 0), or -1 */
export function weekday(v: string | number | undefined): number {
  if (typeof v === "number") return v >= 0 && v <= 6 ? v : -1;
  return DAYS.indexOf(String(v ?? "").trim().slice(0, 3).toLowerCase());
}

/** UTC offset of a time zone at a local wall-clock time: ("2026-10-19T18:00", "Europe/Nicosia") → "+03:00" */
export function zoneOffset(local: string, timeZone: string): string {
  const asUtc = new Date(`${local.slice(0, 16)}:00Z`);
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(asUtc)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = name.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] ?? "00"}` : "+00:00";
}
/** "2026-10-19T18:00" in that zone → "2026-10-19T18:00:00+03:00" (the browser shows it in the student's own time) */
export const zoned = (local: string, timeZone: string): string => `${local.slice(0, 16)}:00${zoneOffset(local, timeZone)}`;

/** Which configured group the student is in: the setting, else an eClass group whose name ends with the key. */
export function pickGroup(cfg: ClassesConfig, eclassGroups: string[] = []): string | undefined {
  const keys = Object.keys(cfg.groups ?? {});
  if (cfg.group) return cfg.group;
  return keys.find((k) => eclassGroups.some((g) => g === k || g.endsWith(k) || g.endsWith(`_${k}`)));
}

/** The dated sessions of one course. */
export function buildClasses({ code, cfg, weeks, joinUrl, groups = [], general = [], timeZone = "Europe/Nicosia" }: {
  code: string;               // course code
  cfg?: ClassesConfig;        // the course's "classes" block from semester.json
  weeks: DatedWeek[];         // dated weeks of the course
  joinUrl?: string;           // Webconference link found on eClass
  groups?: string[];          // the student's eClass group names for this course
  general?: GeneralFile[];    // General-section files (meeting agendas)
  timeZone?: string;
}): ClassSession[] {
  if (!cfg) return [];
  const group = pickGroup(cfg, groups);
  const slot = { day: cfg.day, time: cfg.time ?? "18:00", minutes: cfg.minutes ?? 60, ...(group ? cfg.groups?.[group] : {}) };
  const wd = weekday(slot.day);
  if (wd < 0 || !/^\d{1,2}:\d{2}$/.test(slot.time)) return [];
  const time = slot.time.padStart(5, "0");
  const unknownGroup = !group && Object.keys(cfg.groups ?? {}).length > 1
    ? `Times differ by teaching group (${Object.keys(cfg.groups ?? {}).join(", ")}); yours isn't known yet, this is ${Object.keys(cfg.groups ?? {})[0]}'s` : undefined;

  // one date per dated week; overlapping week ranges keep the week that starts later
  const byDate = new Map<string, DatedWeek>();
  for (const w of weeks) {
    if (!w.start || !w.end || w.index === 0) continue;
    const s = utcDay(w.start), e = utcDay(w.end);
    const d = new Date(s.getTime() + ((wd - s.getUTCDay() + 7) % 7) * 86_400_000);
    if (d > e) continue;
    const key = isoDate(d);
    const had = byDate.get(key);
    if (!had || (had.start ?? "") < w.start) byDate.set(key, w);
  }

  // a change for one teaching group applies only to that group
  const changes = new Map((cfg.changes ?? []).filter((c) => !c.group || c.group === group).map((c) => [String(c.date).slice(0, 10), c]));
  const url = cfg.joinUrl || joinUrl || undefined;
  const out = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, w], i): ClassSession => {
    const n = Number(w.name.match(/\bWeek\s*(\d+)/i)?.[1] ?? i + 1);
    const ch = changes.get(date);
    const local = ch?.to ? String(ch.to) : `${date}T${time}`;
    const at = zoned(local, timeZone);
    const end = new Date(new Date(at).getTime() + slot.minutes * 60_000).toISOString();
    // "Webconference 6 Meeting Agenda", "Meeting 6 …" in the General section belong to session 6
    const extras = general.filter((f) => f.href && Number(f.title.match(/\b(?:webconference|meeting)\s*#?\s*(\d+)/i)?.[1]) === n)
      .map((f) => ({ title: f.title.replace(/^Forum attachment:\s*/i, ""), href: f.href, ext: f.ext }));
    return {
      code, n, at, end, weekIndex: w.index, group, joinUrl: url,
      status: ch?.cancelled ? "cancelled" : ch?.to ? "moved" : "scheduled",
      movedFrom: ch?.to ? zoned(`${date}T${time}`, timeZone) : undefined,
      note: ch?.note ?? unknownGroup, extras,
    };
  });
  // a change for a date with no regular session is an extra class
  for (const [date, ch] of changes) {
    if (byDate.has(date) || !ch.to) continue;
    const at = zoned(String(ch.to), timeZone);
    const w = [...weeks].reverse().find((x) => x.start && x.end && x.start <= date && date <= x.end);
    out.push({ code, n: 0, at, end: new Date(new Date(at).getTime() + slot.minutes * 60_000).toISOString(), weekIndex: w?.index, group, joinUrl: url, status: "extra", note: ch.note, extras: [] });
  }
  return out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

// ---------- reading the class time from eClass ----------
const DAY_RE = /\b(mon|tues|wednes|thurs|fri|satur|sun)days?\b/i;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const GROUP_RE = /\b(?:\d{4}_[A-Z]+\d+_)?(F\.\d{2})\b/g;
const MEETING_RE = /\b(meeting|session|class|lecture|webconference|web conference|live)s?\b/i;

/** "6pm", "6 pm", "18:00", "20:00–21:00" → "18:00" (the first time in the text) */
export function findTime(s: string): string | undefined {
  const m = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b/i) ?? s.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!m) return undefined;
  let h = Number(m[1]);
  if (m[3]) h = (h % 12) + (/p/i.test(m[3]) ? 12 : 0);
  return h < 24 ? `${pad(h)}:${m[2] ?? "00"}` : undefined;
}
const dayOf = (s: string) => { const m = s.match(DAY_RE); return m ? DAYS[weekday(m[1])] : undefined; };
/** "Tuesday, 29 September 2026, 4:18 AM" → "2026-09-29" */
function postDate(s = ""): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/(\d{1,2}) (\w+) (\d{4})/);
  const mo = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1;
  return !m || mo < 0 ? undefined : `${m[3]}-${pad(mo + 1)}-${pad(Number(m[1]))}`;
}

/**
 * Finds the weekly live-class slot in a course's eClass texts (eclass-meta.json): the Webconference
 * activity's description (a table of teaching groups and times), then announcements and forum posts
 * ("our first live meeting is this Monday at 6pm", "our meeting will be on Thursdays at 6pm").
 * Posts that move a class ("my F.02 lecture has been rescheduled for Thursday, 1 October, at 20:00")
 * become changes. Returns undefined when nothing is found.
 */
export function detectClasses(meta: unknown): (ClassesConfig & { source?: string }) | undefined {
  const acts = ((meta as ClassesMeta | null)?.secs ?? []).flatMap((s) => s.acts ?? []);
  const confDesc = acts.filter((a) => a.type === "lti" && /web\s*-?\s*confer|τηλεσυν/i.test(a.name ?? "")).map((a) => String(a.desc ?? "")).join("\n");
  const posts = acts.flatMap((a) => (a.threads ?? []).flatMap((t) => (t.posts ?? []).map((p) => ({ text: String(p.text ?? ""), date: postDate(p.at) }))))
    .sort((a, b) => (a.date ?? "9").localeCompare(b.date ?? "9"));

  let found: (ClassesConfig & { day: string; time: string; source?: string }) | undefined;
  // 1. a table of teaching groups with a time each, under "Every Tuesday"
  const day = dayOf(confDesc);
  const keys = [...confDesc.matchAll(GROUP_RE)];
  const groups: Record<string, { time: string }> = {};
  keys.forEach((k, i) => {
    const t = findTime(confDesc.slice(k.index + k[0].length, keys[i + 1]?.index ?? k.index + 200));
    if (t && !groups[k[1]]) groups[k[1]] = { time: t };
  });
  if (day && Object.keys(groups).length) {
    const first = Object.values(groups)[0];
    found = { day, time: first.time, groups, source: confDesc.split("\n").find((l) => DAY_RE.test(l))?.trim() };
  } else if (day && findTime(confDesc)) found = { day, time: findTime(confDesc)!, source: confDesc.trim().slice(0, 160) };

  // 2. the first sentence that names a weekday, a time and a meeting (not office hours, not a one-off)
  const sentences = posts.flatMap((p) => p.text.split(/(?<=[.!?])\s+|\n+/).map((s) => ({ s: s.trim(), date: p.date })));
  if (!found) {
    for (const { s } of sentences) {
      if (!MEETING_RE.test(s) || /office hours?|reschedul|cancel|instead|not take place|deadline|due\b/i.test(s)) continue;
      if (new RegExp(`\\b\\d{1,2}(st|nd|rd|th)?\\s+(${MONTHS.join("|")})\\b|\\b(${MONTHS.join("|")})\\s+\\d{1,2}\\b`, "i").test(s)) continue;
      const d = dayOf(s), t = findTime(s);
      if (d && t) { found = { day: d, time: t, source: s.slice(0, 200) }; break; }
    }
  }
  if (!found) return undefined;

  // 3. one-off moves announced in posts
  const changes: ClassChange[] = [];
  const wd = weekday(found.day);
  for (const { s, date } of sentences) {
    if (!date || !/reschedul|moved to|will take place on/i.test(s)) continue;
    const m = s.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join("|")})|(${MONTHS.join("|")})\\s+(\\d{1,2})`, "i"));
    const t = findTime(s);
    if (!m || !t) continue;
    const mo = MONTHS.indexOf((m[2] ?? m[3]).toLowerCase()), dd = Number(m[1] ?? m[4]);
    const posted = utcDay(date);
    let y = posted.getUTCFullYear();
    if (mo < posted.getUTCMonth() - 6) y++;
    // the regular class this replaces: the first class day on or after the post
    const orig = new Date(posted.getTime() + ((wd - posted.getUTCDay() + 7) % 7) * 86_400_000);
    const group = s.match(/\bF\.\d{2}\b/)?.[0];
    if (changes.some((c) => c.date === isoDate(orig) && c.group === group)) continue;
    changes.push({ date: isoDate(orig), to: `${y}-${pad(mo + 1)}-${pad(dd)}T${t}`, note: "moved by the tutor (eClass announcement)", ...(group ? { group } : {}) });
  }
  return { ...found, ...(changes.length ? { changes } : {}) };
}

/**
 * The student's own correction from the app ("Fix the time"): sets the course's "classes" slot in a parsed
 * semester.json, keeping any changes already written there (the time is in the semester's time zone).
 * Returns the new config, or throws on bad input.
 */
export function setClassTime<T extends { courses?: { code: string; classes?: ClassesConfig }[] }>(cfg: T, code: string, { day, time, group }: { day: string; time: string; group?: string }): T {
  const course = cfg?.courses?.find((c) => c.code === code);
  if (!course) throw new Error(`No course ${code} in semester.json`);
  if (weekday(day) < 0 || !/^\d{1,2}:\d{2}$/.test(String(time)) || Number(String(time).split(":")[0]) > 23) throw new Error("Pick a day and a time like 18:00");
  if (group && !/^[\w.-]{1,20}$/.test(group)) throw new Error("Bad group name");
  const day3 = DAYS[weekday(day)];
  // groups: {} so a time read from eClass for another teaching group doesn't win over yours
  course.classes = { ...course.classes, day: day3[0].toUpperCase() + day3.slice(1), time: String(time).padStart(5, "0"), groups: {}, ...(group ? { group } : {}) };
  return cfg;
}
