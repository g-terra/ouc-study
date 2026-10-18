export const DAY = 86_400_000;

/** "2026-10-12" → local midnight (avoid the UTC parse of date-only strings). */
export function day(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}
/** "2026-10-22T21:59:00" → local time. */
export const at = (s: string) => (s.length <= 10 ? day(s) : new Date(s));

export const startOfWeek = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const daysBetween = (a: Date, b: Date) => Math.round((startDay(b).getTime() - startDay(a).getTime()) / DAY);
const startDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const fmtDay = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
export const fmtShort = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
export const fmtTime = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
export const fmtFull = (d: Date) => `${fmtDay(d)}, ${fmtTime(d)}`;

/** "in 4 days", "tomorrow", "in 6 h", "2 days ago" */
export function relative(target: Date, now = new Date()): string {
  const h = (target.getTime() - now.getTime()) / 3_600_000;
  if (h < 0) {
    const d = Math.ceil(-h / 24);
    return h > -24 ? "earlier today" : `${d} day${d > 1 ? "s" : ""} ago`;
  }
  if (h < 24) return `in ${Math.max(1, Math.round(h))} h`;
  const d = daysBetween(now, target);
  return d <= 1 ? "tomorrow" : `in ${d} days`;
}

export const weekRange = (s: Date) => {
  const e = addDays(s, 6);
  return s.getMonth() === e.getMonth()
    ? `${s.getDate()}–${e.getDate()} ${e.toLocaleDateString("en-GB", { month: "short" })}`
    : `${fmtShort(s)} – ${fmtShort(e)}`;
};
