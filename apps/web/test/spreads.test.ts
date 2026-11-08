// Scanned PDFs with two book pages on one wide PDF page: when to split them, and the reading pages that makes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { couldBeSpread, isWide, looksScanned, pageLook, readingPages, readingPageOf, splitKey, readSplitChoice, writeSplitChoice } from "../src/lib/spreads.ts";

const portrait = { width: 420, height: 595 };
const spread = { width: 842, height: 595 }; // two A5 pages side by side
const slide = { width: 960, height: 540 }; // 16:9

test("a page is wide when it is clearly wider than tall", () => {
  assert.equal(isWide(spread), true);
  assert.equal(isWide(slide), true);
  assert.equal(isWide(portrait), false);
  assert.equal(isWide({ width: 600, height: 595 }), false);
});

test("only pages shaped like two book pages side by side are offered for splitting, not 16:9 slides", () => {
  assert.equal(couldBeSpread(spread), true);
  assert.equal(couldBeSpread({ width: 720, height: 540 }), true); // 4:3 could be either
  assert.equal(couldBeSpread(slide), false);
  assert.equal(couldBeSpread(portrait), false);
});

// pdf.js operator ids (pdfjs-dist's OPS) the page check reads
const OPS = { save: 10, restore: 11, transform: 12, setTextRenderingMode: 38, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, paintImageXObject: 85, paintInlineImageXObject: 86, paintImageMaskXObject: 83 };
const ops = (...list: [number, unknown[]][]) => ({ fnArray: list.map(([f]) => f), argsArray: list.map(([, a]) => a) });
const fullPicture = ops([OPS.save, []], [OPS.transform, [842, 0, 0, 595, 0, 0]], [OPS.paintImageXObject, ["img1", 3000, 2100]], [OPS.restore, []]);

test("a page drawn as one picture covering it is seen as a picture page", () => {
  assert.deepEqual(pageLook(spread, fullPicture, OPS, 0), { ...spread, cover: 1, textChars: 0 });
});

test("two pictures side by side, each in its own form, cover the page together", () => {
  const half = (x: number): [number, unknown[]][] => [[OPS.paintFormXObjectBegin, [[1, 0, 0, 1, x, 0], null]], [OPS.transform, [421, 0, 0, 595, 0, 0]], [OPS.paintImageXObject, ["i", 1, 1]], [OPS.paintFormXObjectEnd, []]];
  assert.equal(pageLook(spread, ops(...half(0), ...half(421)), OPS, 0).cover, 1);
});

test("a small picture on a slide covers little of it", () => {
  const small = ops([OPS.save, []], [OPS.transform, [200, 0, 0, 100, 50, 50]], [OPS.paintImageXObject, ["i", 1, 1]], [OPS.restore, []], [OPS.paintImageXObject, ["i", 1, 1]]);
  assert.ok(pageLook(slide, small, OPS, 300).cover < 0.05);
});

test("an OCR layer's invisible text doesn't count as text", () => {
  const ocr = ops(...fullPicture.fnArray.map((f, i): [number, unknown[]] => [f, fullPicture.argsArray[i]]), [OPS.setTextRenderingMode, [3]]);
  assert.equal(pageLook(spread, ocr, OPS, 1800).textChars, 0);
  const visible = ops([OPS.setTextRenderingMode, [3]], [OPS.setTextRenderingMode, [0]]);
  assert.equal(pageLook(spread, visible, OPS, 1800).textChars, 1800);
});

test("a PDF looks like a scanned book when its wide pages are pictures with no visible text", () => {
  const scan = { ...spread, cover: 0.98, textChars: 0 };
  assert.equal(looksScanned([{ ...portrait, cover: 1, textChars: 0 }, scan, scan, scan]), true);
});

test("lecture slides are not taken for scans, even with a picture-only slide among them", () => {
  const withText = { ...slide, cover: 1, textChars: 240 };
  assert.equal(looksScanned([withText, { ...slide, cover: 1, textChars: 0 }, withText, withText]), false);
  // 16:9 picture-only slides are slides, not two book pages
  assert.equal(looksScanned([{ ...slide, cover: 1, textChars: 0 }, { ...slide, cover: 1, textChars: 0 }]), false);
  // a 4:3 slide with a small picture and no words isn't a scan either
  assert.equal(looksScanned([{ width: 720, height: 540, cover: 0.2, textChars: 0 }]), false);
});

test("a PDF with no wide pages is never split", () => {
  assert.equal(looksScanned([{ ...portrait, cover: 1, textChars: 0 }]), false);
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
