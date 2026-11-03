// The homework PDF's picture sizing: a picture that would leave a big gap at the bottom of a page shrinks to fit there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PICTURE_SIZES, fitPictures } from "../src/lib/print-fit.ts";

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

test("the picture sizes the editor offers", () => {
  assert.deepEqual(PICTURE_SIZES.map((s) => s.value), [null, "small", "medium", "large", "full"]);
});
