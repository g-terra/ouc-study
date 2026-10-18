// Week plans (semesters/<id>/plans/<YYYY>-W<NN>.md, written by the plan-week skill) → data the app shows.
// Also used by the app server (packages/ai/src/api.ts) to tick a task.
import type { Plan, PlanDay, PlanPart, PlanSection } from "./types.ts";

const TASK = /^(\s*[-*+]\s+)\[([ xX])\]\s+(.*)$/;

/** Monday and Sunday (YYYY-MM-DD) of an ISO week. */
export function isoWeekRange(year: number, week: number): { start: string; end: string } {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86_400_000 + (week - 1) * 7 * 86_400_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return { start: day(monday), end: day(new Date(monday.getTime() + 6 * 86_400_000)) };
}

/**
 * Parses a plan file into sections (## headings), sub-sections (### headings, e.g. one per day) and,
 * inside each, Markdown chunks and checkable tasks (`- [ ] …`). Task lines keep their 1-based line
 * number in the file, so a tick in the app can be written back (see setTask).
 */
export function parsePlan(src: string, file: string): Plan {
  const week = file.replace(/\.md$/, "");
  const m = week.match(/^(\d{4})-W(\d{1,2})$/);
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  const fm: Record<string, string> = {};
  if (lines[0] === "---") {
    const close = lines.indexOf("---", 1);
    if (close > 0) {
      for (const l of lines.slice(1, close)) { const kv = l.match(/^(\w+):\s*(.*)$/); if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, ""); }
      i = close + 1;
    }
  }
  const plan: Plan = {
    week, file, title: fm.title || "", ...(m ? isoWeekRange(Number(m[1]), Number(m[2])) : {}),
    updated: fm.updated || undefined, intro: [], sections: [], done: 0, total: 0,
  };
  let section: PlanSection | undefined, sub: PlanDay | undefined, md: string[] = [], inFence = false;
  const target = (): PlanPart[] => (sub ?? section)?.parts ?? plan.intro;
  const flush = () => { const t = md.join("\n").trim(); if (t) target().push({ md: t }); md = []; };
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) inFence = !inFence;
    const h = !inFence && l.match(/^(#{1,3})\s+(.*?)\s*#*\s*$/);
    if (h && h[1] === "#") { flush(); if (!plan.title) plan.title = h[2]; continue; }
    if (h && h[1] === "##") { flush(); section = { title: h[2], parts: [], days: [] }; sub = undefined; plan.sections.push(section); continue; }
    if (h && h[1] === "###" && section) { flush(); sub = { title: h[2], parts: [] }; section.days.push(sub); continue; }
    const t = !inFence && l.match(TASK);
    if (t) {
      flush();
      const done = t[2] !== " ";
      target().push({ task: { line: i + 1, text: t[3].trim(), done } });
      plan.total++; if (done) plan.done++;
      continue;
    }
    md.push(l);
  }
  flush();
  return plan;
}

/** Ticks or unticks the task on `line` (1-based). Returns the new text, or null when that line isn't a task. */
export function setTask(src: string, line: number, done: boolean): string | null {
  const lines = src.split("\n");
  const l = lines[line - 1];
  const t = l?.match(TASK);
  if (!t) return null;
  lines[line - 1] = l.replace(/\[[ xX]\]/, done ? "[x]" : "[ ]");
  return lines.join("\n");
}
