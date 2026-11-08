/**
 * Scanned books often put two pages side by side on one wide PDF page, too small to read on a screen.
 * The PDF viewer (pages/Slides.tsx) can show each half as its own reading page; this decides when, and
 * maps the PDF's pages to the reading pages (links and the address bar keep the PDF's page numbers).
 */

export type Size = { width: number; height: number };
/** What the viewer learns from a page: its size, whether it draws a picture, and how much text it has. */
export type PageLook = Size & { image: boolean; textChars: number };
export type ReadingPage = { page: number; half?: "left" | "right" };

/** Wider than tall by a clear margin (a square-ish page is never split). */
export const isWide = ({ width, height }: Size) => width > height * 1.2;

/** A picture-only wide page that isn't 16:9 (picture-only slides are), as a scanned double page is. */
const scanSpread = (p: PageLook) => isWide(p) && p.image && p.textChars < 50 && p.width / p.height < 1.7;

/** Splits on its own when most of the sampled wide pages look like scanned double pages. */
export function looksScanned(sample: PageLook[]): boolean {
  const wide = sample.filter(isWide);
  return wide.length > 0 && wide.filter(scanSpread).length * 3 >= wide.length * 2;
}

/** The pages to read, in order: split, each wide page gives its left then its right half. */
export const readingPages = (sizes: Size[], split: boolean): ReadingPage[] =>
  sizes.flatMap((s, i): ReadingPage[] => (split && isWide(s) ? [{ page: i + 1, half: "left" }, { page: i + 1, half: "right" }] : [{ page: i + 1 }]));

/** The reading page (from 1) that shows the start of PDF page `pdfPage`; 1 when there's no such page. */
export const readingPageOf = (pages: ReadingPage[], pdfPage: number) => pages.findIndex((p) => p.page === pdfPage) + 1 || 1;

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };
const KEY = "ouc-pdf-split";
export const splitKey = (sem: string, file: string) => `${sem}/${file}`;

const readAll = (ls: Store): Record<string, boolean> => {
  try { const v = JSON.parse(ls.getItem(KEY) ?? "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
};
/** The student's own choice for this file, if they made one. */
export const readSplitChoice = (ls: Store, key: string): boolean | undefined => readAll(ls)[key];
export function writeSplitChoice(ls: Store, key: string, split: boolean) {
  try { ls.setItem(KEY, JSON.stringify({ ...readAll(ls), [key]: split })); } catch { /* private mode */ }
}
