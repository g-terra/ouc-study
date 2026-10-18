/**
 * Live classes (webconferences): eClass has no dated schedule for them, only one join link per course
 * and the weekly time in the tutors' announcements. So the time comes from semester.json:
 *
 *   "classes": {
 *     "day": "Tue", "time": "19:00", "minutes": 60,          weekly slot, in the semester's timezone
 *     "groups": { "F.02": { "time": "20:00" }, "F.03": {} }, optional: teaching groups with their own slot
 *     "group": "F.03",                                        optional: your group (else read from eClass)
 *     "joinUrl": "https://…",                                  optional: else the course's Webconference link
 *     "changes": [{ "date": "2026-09-29", "to": "2026-10-01T20:00" }, { "date": "2026-12-08", "cancelled": true }]
 *   }
 *
 * One session is placed in every dated week that contains that weekday, and linked to the week's material.
 * Plain JavaScript (types in classes.d.mts) so node:test can import it without a TypeScript loader.
 */

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const pad = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utcDay = (s) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };

/** "Monday" | "mon" | 1 → 1 (Sunday = 0), or -1 */
export function weekday(v) {
  if (typeof v === "number") return v >= 0 && v <= 6 ? v : -1;
  return DAYS.indexOf(String(v ?? "").trim().slice(0, 3).toLowerCase());
}

/** UTC offset of a time zone at a local wall-clock time: ("2026-10-19T18:00", "Europe/Nicosia") → "+03:00" */
export function zoneOffset(local, timeZone) {
  const asUtc = new Date(`${local.slice(0, 16)}:00Z`);
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(asUtc)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = name.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] ?? "00"}` : "+00:00";
}
/** "2026-10-19T18:00" in that zone → "2026-10-19T18:00:00+03:00" (the browser shows it in the student's own time) */
export const zoned = (local, timeZone) => `${local.slice(0, 16)}:00${zoneOffset(local, timeZone)}`;

/** Which configured group the student is in: the setting, else an eClass group whose name ends with the key. */
export function pickGroup(cfg, eclassGroups = []) {
  const keys = Object.keys(cfg.groups ?? {});
  if (cfg.group) return cfg.group;
  return keys.find((k) => eclassGroups.some((g) => g === k || g.endsWith(k) || g.endsWith(`_${k}`)));
}

/**
 * @param {object} o
 * @param {string} o.code               course code
 * @param {object} [o.cfg]              the course's "classes" block from semester.json
 * @param {{index:number,name:string,start?:string,end?:string}[]} o.weeks   dated weeks of the course
 * @param {string} [o.joinUrl]          Webconference link found on eClass
 * @param {string[]} [o.groups]         the student's eClass group names for this course
 * @param {{title:string,href?:string,ext?:string}[]} [o.general]  General-section files (meeting agendas)
 * @param {string} [o.timeZone]
 */
export function buildClasses({ code, cfg, weeks, joinUrl, groups = [], general = [], timeZone = "Europe/Nicosia" }) {
  if (!cfg) return [];
  const group = pickGroup(cfg, groups);
  const slot = { day: cfg.day, time: cfg.time ?? "18:00", minutes: cfg.minutes ?? 60, ...(group ? cfg.groups?.[group] : {}) };
  const wd = weekday(slot.day);
  if (wd < 0 || !/^\d{1,2}:\d{2}$/.test(slot.time)) return [];
  const time = slot.time.padStart(5, "0");

  // one date per dated week; overlapping week ranges keep the week that starts later
  const byDate = new Map();
  for (const w of weeks) {
    if (!w.start || !w.end || w.index === 0) continue;
    const s = utcDay(w.start), e = utcDay(w.end);
    const d = new Date(s.getTime() + ((wd - s.getUTCDay() + 7) % 7) * 86_400_000);
    if (d > e) continue;
    const key = isoDate(d);
    const had = byDate.get(key);
    if (!had || had.start < w.start) byDate.set(key, w);
  }

  const changes = new Map((cfg.changes ?? []).map((c) => [String(c.date).slice(0, 10), c]));
  const url = cfg.joinUrl || joinUrl || undefined;
  const out = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, w], i) => {
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
      note: ch?.note, extras,
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
