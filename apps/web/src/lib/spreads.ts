/**
 * Scanned books often put two pages side by side on one wide PDF page, too small to read on a screen.
 * The PDF viewer (pages/Slides.tsx) can show each half as its own reading page; this decides when, and
 * maps the PDF's pages to the reading pages (links and the address bar keep the PDF's page numbers).
 */

export type Size = { width: number; height: number };
/** What the viewer learns from a page: its size, how much of it pictures cover (0–1), and how much text you can see on it. */
export type PageLook = Size & { cover: number; textChars: number };
export type ReadingPage = { page: number; half?: "left" | "right" };

/** Wider than tall by a clear margin (a square-ish page is never split). */
export const isWide = ({ width, height }: Size) => width > height * 1.2;

type OpList = { fnArray: number[]; argsArray: unknown[] };
type Ops = Record<"save" | "restore" | "transform" | "setTextRenderingMode" | "paintFormXObjectBegin" | "paintFormXObjectEnd" | "paintImageXObject" | "paintInlineImageXObject" | "paintImageMaskXObject", number>;

/**
 * Reads a page's pdf.js operator list: how much of the page its pictures cover (an image fills its unit
 * square under the current transform, so its area is the transform's determinant), and whether its text
 * is only an OCR layer (drawn invisible, rendering mode 3 or 7) on top of a scan.
 */
export function pageLook(size: Size, { fnArray, argsArray }: OpList, OPS: Ops, textChars: number): PageLook {
  const det = (m: unknown) => (Array.isArray(m) && m.length >= 4 ? Math.abs(m[0] * m[3] - m[1] * m[2]) : 1);
  const pictures = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject]);
  const stack: number[] = [];
  let scale = 1, area = 0, hidden = false, shown = false;
  fnArray.forEach((f, i) => {
    const args = argsArray[i] as unknown[] | null;
    if (f === OPS.save) stack.push(scale);
    else if (f === OPS.restore || f === OPS.paintFormXObjectEnd) scale = stack.pop() ?? 1;
    else if (f === OPS.transform) scale *= det(args);
    else if (f === OPS.paintFormXObjectBegin) { stack.push(scale); scale *= det(args?.[0]); }
    else if (pictures.has(f)) area += scale;
    else if (f === OPS.setTextRenderingMode) { if ([3, 7].includes(Number(args?.[0]))) hidden = true; else shown = true; }
  });
  return { ...size, cover: Math.min(1, area / (size.width * size.height)), textChars: hidden && !shown ? 0 : textChars };
}

/** Wide, but not as wide as a 16:9 slide: shaped like two book pages side by side. */
export const couldBeSpread = (s: Size) => isWide(s) && s.width / s.height < 1.7;

/** A spread-shaped page that is one big picture with no text to see: a scanned double page. */
const scanSpread = (p: PageLook) => couldBeSpread(p) && p.cover > 0.6 && p.textChars < 50;

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
