/**
 * "Start class": a week's videos, slides, PDFs and links, one step at a time, each ticked off as you go
 * to the next (ticks in progress.json, like the week's tick boxes). The page is src/pages/Class.tsx.
 */
import type { Week, WeekItem } from "@ouc/content/types";
import { itemKey, tracked, type Count, type Progress } from "@ouc/content/progress";
import { pdfPage, slidesPage, videoPage } from "./links";

/** The class's steps: what there is to watch, then what there is to read, each in the week's order. */
export const classSteps = (w: Week): WeekItem[] =>
  [...w.items.filter((it) => tracked(it) && it.kind === "video"), ...w.items.filter((it) => tracked(it) && it.kind !== "video")];

/** Where the class picks up: the first step not done yet (from the start when all are done). */
export function startStep(code: string, w: Week, done: Progress): number {
  const i = classSteps(w).findIndex((it) => !done[itemKey(code, w.index, it)]);
  return Math.max(i, 0);
}

export const classLabel = (c: Count) => (c.done === 0 ? "Start class" : c.done < c.total ? "Continue class" : "Go through again");

export type StepView = { kind: "video"; file: string } | { kind: "slides"; file: string } | { kind: "pdf"; file: string } | { kind: "open"; href?: string };

/** How a step shows: in the video page, slide viewer or PDF viewer (by its path in the semester folder); the rest opens. */
export function stepView(it: WeekItem): StepView {
  const rel = (href: string) => decodeURIComponent(href.replace(/^\/files\/[^/]+\//, ""));
  if (it.href && videoPage(it.href)) return { kind: "video", file: rel(it.href) };
  // a Panopto recording plays there; its transcript here opens Panopto at each line
  if (it.external && it.transcript) return { kind: "video", file: rel(it.transcript) };
  if (it.href && slidesPage(it.href)) return { kind: "slides", file: rel(it.href) };
  if (it.href && pdfPage(it.href)) return { kind: "pdf", file: rel(it.href) };
  return { kind: "open", href: it.href };
}

/** The class's page: /<sem>/class/<course>/<week>[/<step, 1 = the first>]. */
export const classPath = (sem: string, code: string, week: number, step?: number) =>
  `/${encodeURIComponent(sem)}/class/${encodeURIComponent(code)}/${week}${step ? `/${step}` : ""}`;
