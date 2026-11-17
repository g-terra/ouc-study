// The homework PDF's pages, worked out by the app so the page preview and the PDF agree: the print page marks
// each page start with break-before: page, and every page holds only what fits on it.

/**
 * A place the page can start at (a question, a paragraph, a list item, an option…), in px from the top of the
 * first page's content. `manual`: the student moved it to the next page. `keep`: a question starts here that is
 * kept whole when it fits on a page; it ends at that y.
 */
export interface BreakPoint { top: number; manual?: boolean; keep?: number }

/**
 * Where the pages start: `starts`, the points that start a new page (indices, the first page's start left out),
 * and how many `pages` there are. A part (from its point to the next,
 * or to `end`) that doesn't fit in the room left starts the next page; so does a question kept whole that doesn't
 * fit, and a part the student moved. A part taller than a page runs over the pages it needs.
 */
export function paginate(points: BreakPoint[], end: number, pageHeight: number): { starts: number[]; pages: number } {
  const starts: number[] = [];
  let pageTop = 0, pages = 1;
  points.forEach((p, i) => {
    const next = points[i + 1]?.top ?? end;
    const keep = p.keep !== undefined && p.keep - p.top <= pageHeight && p.keep - pageTop > pageHeight;
    if (p.top > pageTop && (p.manual || keep || next - pageTop > pageHeight)) {
      starts.push(i);
      pageTop = p.top;
      pages++;
    }
    while (next - pageTop > pageHeight) { pageTop += pageHeight; pages++; }
  });
  return { starts, pages };
}
