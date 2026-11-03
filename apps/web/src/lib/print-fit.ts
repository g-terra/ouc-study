// Pictures in the homework PDF: the size the student picked in the editor, and "smart" sizing so a picture
// doesn't leave a big empty gap at the bottom of a page by jumping whole to the next one.

/** The sizes a picture in an answer can have (saved as data-size on the <img>); null = its own size, up to the full width. */
export const PICTURE_SIZES = [
  { value: null, label: "Own size" },
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "full", label: "Full width" },
] as const;

export type PictureSize = (typeof PICTURE_SIZES)[number]["value"];

/**
 * A picture (or a row of pictures side by side) in the print page: where it starts and how tall it is, in px from
 * the top of the first page's content. A page break is given as one too, with `pageBreak`: what follows starts a page.
 */
export interface Placed { top: number; height: number; pageBreak?: boolean }

type Opts = { minScale?: number; minPx?: number; margin?: number };
const below = (y: number, page: number) => ((y % page) + page) % page;

/**
 * For each picture in page order, the height it should print at so pages fill well, or null to keep it as it is.
 * A picture taller than the room left on its page shrinks into that room when it keeps at least `minScale` of its
 * height; otherwise it starts the next page. Nothing prints taller than one page. Each change moves what comes after.
 */
export function fitPictures(pics: Placed[], pageHeight: number, opts: Opts = {}): (number | null)[] {
  return run(pics, pageHeight, opts, 0).heights;
}

function run(pics: Placed[], pageHeight: number, { minScale = 0.5, minPx = 96, margin = 8 }: Opts, start: number) {
  let shift = start;
  const heights = pics.map(({ top, height, pageBreak }) => {
    const y = top + shift;
    if (pageBreak) {
      const off = below(y, pageHeight);
      if (off > 0) shift += pageHeight - off;
      return null;
    }
    let h = Math.min(height, pageHeight - margin);
    const room = pageHeight - below(y, pageHeight) - margin;
    if (h > room) {
      if (room >= h * minScale && room >= minPx) h = room;
      else shift += room + margin;   // starts the next page: the gap pushes everything after it down
    }
    shift -= height - h;
    return h < height ? Math.floor(h) : null;
  });
  return { heights, shift };
}

/** A question in the print page, with its pictures (rows side by side) and page breaks in order, positioned as in Placed. */
export interface Section { top: number; height: number; items: Placed[] }

/**
 * Lays the questions out on the pages. A question that fits on one page is kept whole (`keep`): if it doesn't fit
 * in the room left, its pictures shrink a little to make it fit (each keeping `minScale` of its height), or else it
 * moves whole to the next page. A longer question, or one with a page break, splits across pages and its pictures
 * are fitted one by one as in fitPictures. `heights` is, per question, each item's new height or null.
 */
export function fitSections(sections: Section[], pageHeight: number, opts: Opts = {}): { keep: boolean[]; heights: (number | null)[][] } {
  const { minScale = 0.5, minPx = 96, margin = 8 } = opts;
  let shift = 0;
  const keep: boolean[] = [], heights: (number | null)[][] = [];
  for (const sec of sections) {
    const y = sec.top + shift, off = below(y, pageHeight), room = pageHeight - off;
    const whole = sec.height <= pageHeight - margin && !sec.items.some((i) => i.pageBreak);
    keep.push(whole);
    if (!whole) {
      const r = run(sec.items, pageHeight, opts, shift);
      heights.push(r.heights);
      shift = r.shift;
      continue;
    }
    if (sec.height <= room) { heights.push(sec.items.map(() => null)); continue; }
    const total = sec.items.reduce((n, i) => n + i.height, 0), need = sec.height - room + margin;
    if (total > 0 && need <= total * (1 - minScale) && room >= minPx) {
      const scale = (total - need) / total;
      const hs = sec.items.map((i) => Math.floor(i.height * scale));
      heights.push(hs);
      shift -= sec.items.reduce((n, i, k) => n + i.height - hs[k], 0);
    } else {
      heights.push(sec.items.map(() => null));
      shift += room;   // moves whole to the next page
    }
  }
  return { keep, heights };
}
