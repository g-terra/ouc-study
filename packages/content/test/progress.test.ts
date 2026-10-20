// Watched and read: which week items get a tick, counts per week and course, and saving ticks to progress.json.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { courseProgress, findItem, itemKey, openItems, tracked, weekProgress } from "../src/progress.ts";
import { progressFile, readProgress, setDone } from "../src/progress-store.ts";
import type { Course, Week } from "../src/types.ts";

const week = (index: number, items: Week["items"]): Week => ({ index, name: `Week ${index}`, label: `Week ${index}`, estimated: false, summary: "", items });
const W1 = week(1, [
  { kind: "video", title: "Lecture 1", href: "/files/S/courses/AAA/02-w1/lecture.mp4", transcript: "/files/S/courses/AAA/02-w1/lecture.transcript.md" },
  { kind: "file", title: "Slides 1", href: "/files/S/courses/AAA/02-w1/slides.pptx", ext: "pptx" },
  { kind: "link", title: "Reading" },
  { kind: "note", title: "My note", noteSlug: "w1" },
  { kind: "assignment", title: "Assignment 1", assignmentId: "AAA/a1" },
]);
const W2 = week(2, [{ kind: "video", title: "Lecture 2", href: "https://panopto.example/2", external: true }]);
const COURSE = { code: "AAA", weeks: [W1, W2] } as unknown as Course;

test("videos, files and links get a tick box; notes and assignments don't", () => {
  assert.deepEqual(W1.items.map(tracked), [true, true, true, false, false]);
});

test("an item is named by its link, or by course, week and title without one", () => {
  assert.equal(itemKey("AAA", 1, W1.items[0]!), W1.items[0]!.href);
  assert.equal(itemKey("AAA", 1, W1.items[2]!), "AAA/1/Reading");
});

test("counts per week and course, and what's still open", () => {
  const done = { [W1.items[0]!.href!]: { course: "AAA", week: 1, title: "Lecture 1", kind: "video", at: "2026-10-20T10:00:00.000Z" } };
  assert.deepEqual(weekProgress("AAA", W1, done), { done: 1, total: 3 });
  assert.deepEqual(weekProgress("AAA", W1, {}), { done: 0, total: 3 });
  assert.deepEqual(courseProgress(COURSE, done), { done: 1, total: 4 });
  assert.deepEqual(openItems("AAA", W1, done).map((i) => i.title), ["Slides 1", "Reading"]);
});

test("a video or its transcript finds its week item", () => {
  assert.equal(findItem([COURSE], W1.items[0]!.transcript!)?.item.title, "Lecture 1");
  assert.equal(findItem([COURSE], W1.items[1]!.href!)?.week.index, 1);
  assert.equal(findItem([COURSE], "/files/S/nothing.mp4"), undefined);
});

test("ticks are saved to progress.json, keep their first time, and untick", () => {
  const dir = mkdtempSync(join(tmpdir(), "ouc-progress-"));
  assert.deepEqual(readProgress(dir), {});
  const body = { key: "k1", done: true, course: "AAA", week: 1, title: "Lecture 1", kind: "video", how: "watched" };
  setDone(dir, body, new Date("2026-10-20T10:00:00Z"));
  const again = setDone(dir, { ...body, how: "ticked" }, new Date("2026-10-21T10:00:00Z"));
  assert.deepEqual(again.k1, { course: "AAA", week: 1, title: "Lecture 1", kind: "video", at: "2026-10-20T10:00:00.000Z", how: "watched" });
  assert.match(readFileSync(progressFile(dir), "utf8"), /"done"/);
  assert.deepEqual(setDone(dir, { key: "k1", done: false }), {});
  assert.deepEqual(readProgress(dir), {});
});

test("bad ticks are refused and a broken file reads as nothing done", () => {
  const dir = mkdtempSync(join(tmpdir(), "ouc-progress-"));
  const ok = { key: "k", done: true, course: "AAA", week: 1, title: "T", kind: "file" };
  assert.throws(() => setDone(dir, { ...ok, key: "" }), /Bad item/);
  assert.throws(() => setDone(dir, { ...ok, done: "yes" }), /done/);
  assert.throws(() => setDone(dir, { ...ok, course: "../x" }), /Bad course/);
  assert.throws(() => setDone(dir, { ...ok, week: -1 }), /Bad week/);
  assert.throws(() => setDone(dir, { ...ok, how: "guessed" }), /Bad how/);
  assert.equal(setDone(dir, ok).k?.how, "ticked");
  writeFileSync(progressFile(dir), "not json");
  assert.deepEqual(readProgress(dir), {});
});
