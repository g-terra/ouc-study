// What the student has watched and read, week by week: which week items count, how an item is named
// in progress.json, and "N of M done" for a week or a course. Shared by the app and the server.
import type { Course, Week, WeekItem } from "./types.ts";

/** One ticked item in semesters/<id>/progress.json. */
export interface DoneEntry {
  course: string;
  week: number;           // Week.index (eClass section)
  title: string;
  kind: string;           // WeekItem.kind
  at: string;             // ISO datetime it was ticked
  how?: "ticked" | "watched" | "viewed";   // by hand, played to the end, or looked through to the last slide
}
export type Progress = Record<string, DoneEntry>;

/** Items with a tick box: what there is to watch (videos) and read (files and links). */
export const tracked = (it: WeekItem) => it.kind === "video" || it.kind === "file" || it.kind === "link";

/** The item's name in progress.json: its link, or course, week and title for one without a link. */
export const itemKey = (code: string, week: number, it: Pick<WeekItem, "href" | "title">) => it.href ?? `${code}/${week}/${it.title}`;

export interface Count { done: number; total: number }

export function weekProgress(code: string, w: Week, done: Progress): Count {
  const items = w.items.filter(tracked);
  return { done: items.filter((it) => done[itemKey(code, w.index, it)]).length, total: items.length };
}

/** The items of a week still to watch or read. */
export const openItems = (code: string, w: Week, done: Progress) => w.items.filter((it) => tracked(it) && !done[itemKey(code, w.index, it)]);

export function courseProgress(c: Course, done: Progress): Count {
  return c.weeks.reduce<Count>((s, w) => { const p = weekProgress(c.code, w, done); return { done: s.done + p.done, total: s.total + p.total }; }, { done: 0, total: 0 });
}

/** The week item with this link (a video, slides or a transcript of one), to tick it when it's played or viewed. */
export function findItem(courses: Course[], href: string): { course: Course; week: Week; item: WeekItem } | undefined {
  for (const course of courses) for (const week of course.weeks) {
    const item = week.items.find((x) => tracked(x) && (x.href === href || x.transcript === href));
    if (item) return { course, week, item };
  }
  return undefined;
}
