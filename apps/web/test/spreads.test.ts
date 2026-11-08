// Scanned PDFs with two book pages on one wide PDF page: when to split them, and the reading pages that makes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isWide, looksScanned, readingPages, readingPageOf, splitKey, readSplitChoice, writeSplitChoice } from "../src/lib/spreads.ts";

const portrait = { width: 420, height: 595 };
const spread = { width: 842, height: 595 }; // two A5 pages side by side
const slide = { width: 960, height: 540 }; // 16:9

test("a page is wide when it is clearly wider than tall", () => {
  assert.equal(isWide(spread), true);
  assert.equal(isWide(slide), true);
  assert.equal(isWide(portrait), false);
  assert.equal(isWide({ width: 600, height: 595 }), false);
});

test("a PDF looks like a scanned book when its wide pages are pictures with no text", () => {
  const scan = { ...spread, image: true, textChars: 0 };
  assert.equal(looksScanned([{ ...portrait, image: true, textChars: 0 }, scan, scan, scan]), true);
});

test("lecture slides are not taken for scans, even with a picture-only slide among them", () => {
  const withText = { ...slide, image: true, textChars: 240 };
  assert.equal(looksScanned([withText, { ...slide, image: true, textChars: 0 }, withText, withText]), false);
  // 16:9 picture-only slides are slides, not two book pages
  assert.equal(looksScanned([{ ...slide, image: true, textChars: 0 }, { ...slide, image: true, textChars: 0 }]), false);
});

test("a PDF with no wide pages is never split", () => {
  assert.equal(looksScanned([{ ...portrait, image: true, textChars: 0 }]), false);
  assert.equal(looksScanned([]), false);
});

test("split, every wide page becomes its left then its right half, and portrait pages stay whole", () => {
  assert.deepEqual(readingPages([portrait, spread, spread], true), [
    { page: 1 },
    { page: 2, half: "left" }, { page: 2, half: "right" },
    { page: 3, half: "left" }, { page: 3, half: "right" },
  ]);
});

test("not split, the reading pages are the PDF's pages", () => {
  assert.deepEqual(readingPages([portrait, spread], false), [{ page: 1 }, { page: 2 }]);
});

test("a link to a PDF page opens the first reading page made from it", () => {
  const pages = readingPages([portrait, spread, spread], true);
  assert.equal(readingPageOf(pages, 1), 1);
  assert.equal(readingPageOf(pages, 3), 4);
  assert.equal(readingPageOf(pages, 99), 1);
});

test("the split choice is remembered per file", () => {
  const store = new Map<string, string>();
  const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  const a = splitKey("2026-Fall", "courses/X/book.pdf"), b = splitKey("2026-Fall", "courses/X/other.pdf");
  assert.equal(readSplitChoice(ls, a), undefined);
  writeSplitChoice(ls, a, false);
  writeSplitChoice(ls, b, true);
  assert.equal(readSplitChoice(ls, a), false);
  assert.equal(readSplitChoice(ls, b), true);
  assert.equal(readSplitChoice({ getItem: () => "not json", setItem: () => {} }, a), undefined);
});
