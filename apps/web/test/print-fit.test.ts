// The homework PDF's picture sizing: a picture that would leave a big gap at the bottom of a page shrinks to fit there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PICTURE_SIZES, fitPictures, fitSections } from "../src/lib/print-fit.ts";

const PAGE = 1000;

test("a picture that fits where it is keeps its size", () => {
  assert.deepEqual(fitPictures([{ top: 100, height: 300 }], PAGE), [null]);
});

test("a picture a little too tall for the room left on the page shrinks to fit there instead of jumping to the next page", () => {
  const [h] = fitPictures([{ top: 300, height: 800 }], PAGE);
  assert.ok(h !== null && h <= 700 && h >= 680, `got ${h}`);
});

test("a picture that would have to shrink too much starts the next page at its own size", () => {
  assert.deepEqual(fitPictures([{ top: 850, height: 600 }], PAGE), [null]);
});

test("a picture taller than a whole page is cut down to one page", () => {
  const [h] = fitPictures([{ top: 0, height: 2500 }], PAGE);
  assert.ok(h !== null && h <= PAGE && h >= PAGE - 20, `got ${h}`);
});

test("later pictures are placed where the earlier ones left them", () => {
  // the first shrinks by about 100, so the second moves up into the room it would have overflowed
  const [a, b] = fitPictures([{ top: 300, height: 800 }, { top: 1150, height: 400 }], PAGE);
  assert.ok(a !== null);
  assert.equal(b, null);
  // the first jumps to the next page (a gap of 150), so the second now overflows page 2 and shrinks
  const [c, d] = fitPictures([{ top: 850, height: 600 }, { top: 1500, height: 500 }], PAGE);
  assert.equal(c, null);
  assert.ok(d !== null && d < 500, `got ${d}`);
});

test("a page break starts the next page, so a picture after it doesn't need to shrink", () => {
  assert.deepEqual(fitPictures([{ top: 300, height: 800 }], PAGE).map((h) => h !== null), [true]);
  assert.deepEqual(fitPictures([{ top: 300, height: 0, pageBreak: true }, { top: 350, height: 800 }], PAGE), [null, null]);
});

test("a question that fits on a page but not in the room left moves whole to the next page", () => {
  const r = fitSections([{ top: 900, height: 300, items: [] }, { top: 1200, height: 300, items: [] }], PAGE);
  assert.deepEqual(r.keep, [true, true]);
  // the first moved to page 2 (0..300), so the second (300..600) fits after it
  assert.deepEqual(r.heights, [[], []]);
});

test("a question with a picture stays where it is when shrinking the picture a little makes it fit", () => {
  const r = fitSections([{ top: 300, height: 750, items: [{ top: 350, height: 600 }] }], PAGE);
  assert.deepEqual(r.keep, [true]);
  const [[h]] = r.heights;
  assert.ok(h !== null && h <= 550 && h >= 530, `got ${h}`);
});

test("a question with a picture that would have to shrink too much moves whole to the next page", () => {
  const r = fitSections([{ top: 800, height: 750, items: [{ top: 850, height: 600 }] }], PAGE);
  assert.deepEqual(r.keep, [true]);
  assert.deepEqual(r.heights, [[null]]);
});

test("a question longer than a page, or with a page break, is split across pages, its pictures fitted one by one", () => {
  const long = fitSections([{ top: 300, height: 1500, items: [{ top: 300, height: 800 }] }], PAGE);
  assert.deepEqual(long.keep, [false]);
  assert.ok(long.heights[0][0] !== null && long.heights[0][0]! <= 700);
  const broken = fitSections([{ top: 100, height: 400, items: [{ top: 200, height: 0, pageBreak: true }] }], PAGE);
  assert.deepEqual(broken.keep, [false]);
});

test("the picture sizes the editor offers", () => {
  assert.deepEqual(PICTURE_SIZES.map((s) => s.value), [null, "small", "medium", "large", "full"]);
});
