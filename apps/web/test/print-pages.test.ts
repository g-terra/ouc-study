// The homework PDF's pages: where each page starts, worked out in the app so the preview and the PDF agree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { paginate as layout } from "../src/lib/print-pages.ts";

const paginate = (...a: Parameters<typeof layout>) => layout(...a).starts;

const PAGE = 1000;

test("parts that fit on one page make one page", () => {
  assert.deepEqual(paginate([{ top: 0 }, { top: 300 }, { top: 600 }], 900, PAGE), []);
});

test("a part that doesn't fit in the room left starts the next page", () => {
  // the second part runs from 600 to 1100: it moves whole to page 2
  assert.deepEqual(paginate([{ top: 0 }, { top: 600 }, { top: 1100 }], 1300, PAGE), [1]);
});

test("each page is measured from where it starts", () => {
  // page 2 starts at 600, so it holds 600..1600; the part at 1500 runs to 1700 and starts page 3
  assert.deepEqual(paginate([{ top: 0 }, { top: 600 }, { top: 1100 }, { top: 1500 }], 1700, PAGE), [1, 3]);
});

test("a part the student moved starts a new page even when it would fit", () => {
  assert.deepEqual(paginate([{ top: 0 }, { top: 200, manual: true }, { top: 400 }], 500, PAGE), [1]);
});

test("a break asked for on a part that already starts a page changes nothing", () => {
  assert.deepEqual(paginate([{ top: 0, manual: true }, { top: 600 }], 1100, PAGE), [1]);
  assert.deepEqual(paginate([{ top: 0 }, { top: 600, manual: true }, { top: 700 }], 1100, PAGE), [1]);
});

test("a question that fits on a page but not in the room left moves whole to the next page", () => {
  // the question runs from 700 to 1200; its first part alone would fit, but the question is kept whole
  assert.deepEqual(paginate([{ top: 0 }, { top: 700, keep: 1200 }, { top: 800 }, { top: 900 }], 1200, PAGE), [1]);
});

test("a question longer than a page isn't kept whole: its parts flow over the pages", () => {
  assert.deepEqual(paginate([{ top: 0 }, { top: 700, keep: 1900 }, { top: 800 }, { top: 1300 }], 1900, PAGE), [2, 3]);
});

test("a part taller than a page runs over several pages, and what follows goes on where it ends", () => {
  // the first part runs to 2300: page 1 is 0..1000, page 2 1000..2000, page 3 2000..; the part at 2300 fits on page 3
  assert.deepEqual(paginate([{ top: 0 }, { top: 2300 }], 2600, PAGE), []);
  // a big part after a small one starts a page of its own, then runs over
  assert.deepEqual(paginate([{ top: 0 }, { top: 100 }, { top: 2600 }], 2700, PAGE), [1]);
});

test("the page count includes the pages a part runs over", () => {
  assert.equal(layout([{ top: 0 }, { top: 300 }], 900, PAGE).pages, 1);
  assert.equal(layout([{ top: 0 }, { top: 600, manual: true }], 900, PAGE).pages, 2);
  assert.equal(layout([{ top: 0 }, { top: 100 }, { top: 2600 }], 2700, PAGE).pages, 4);   // page 1, then 100..2600 over three
  assert.equal(layout([], 0, PAGE).pages, 1);
});
