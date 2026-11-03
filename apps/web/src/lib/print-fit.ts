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

/** A picture in the print page: where it starts and how tall it is, in px from the top of the first page's content. */
export interface Placed { top: number; height: number }

/**
 * For each picture in page order, the height it should print at so pages fill well, or null to keep it as it is.
 * A picture taller than the room left on its page shrinks into that room when it keeps at least `minScale` of its
 * height; otherwise it starts the next page. Nothing prints taller than one page. Each change moves what comes after.
 */
export function fitPictures(pics: Placed[], pageHeight: number, { minScale = 0.5, minPx = 96, margin = 8 } = {}): (number | null)[] {
  let shift = 0;
  return pics.map(({ top, height }) => {
    const y = top + shift;
    let h = Math.min(height, pageHeight - margin);
    const room = pageHeight - (((y % pageHeight) + pageHeight) % pageHeight) - margin;
    if (h > room) {
      if (room >= h * minScale && room >= minPx) h = room;
      else shift += room + margin;   // starts the next page: the gap pushes everything after it down
    }
    shift -= height - h;
    return h < height ? Math.floor(h) : null;
  });
}
