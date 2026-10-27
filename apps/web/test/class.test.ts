import { test } from "node:test";
import assert from "node:assert/strict";
import type { Week, WeekItem } from "@ouc/content/types";
import type { Progress } from "@ouc/content/progress";
import { classLabel, classPath, classSteps, startStep, stepView } from "../src/lib/class.ts";

const item = (kind: WeekItem["kind"], title: string, href?: string, extra: Partial<WeekItem> = {}): WeekItem => ({ kind, title, href, ...extra });
const week = (items: WeekItem[]): Week => ({ index: 3, name: "Week 3", label: "Memory", estimated: false, summary: "", items });
const tick = (...hrefs: string[]): Progress => Object.fromEntries(hrefs.map((h) => [h, { course: "C1", week: 3, title: h, kind: "file", at: "2026-10-01T10:00:00Z" }]));

const pdf = item("file", "Reading", "/files/S/courses/C1/03/reading.pdf", { ext: "pdf" });
const deck = item("file", "Slides", "/files/S/courses/C1/03/deck.pptx", { ext: "pptx" });
const vid = item("video", "Lecture", "/files/S/courses/C1/03/lecture.mp4", { ext: "mp4" });
const link = item("link", "Article", "https://example.org/a", { external: true });
const w = week([pdf, item("note", "My notes"), deck, item("assignment", "Homework"), vid, link]);

test("a class goes through what there is to watch, then what there is to read, in the week's order", () => {
  assert.deepEqual(classSteps(w).map((it) => it.title), ["Lecture", "Reading", "Slides", "Article"]);
  assert.deepEqual(classSteps(week([item("note", "n")])), []);
});

test("a class starts at the first step not done yet, or at the beginning when all are done", () => {
  assert.equal(startStep("C1", w, {}), 0);
  assert.equal(startStep("C1", w, tick(vid.href!, pdf.href!)), 2);
  assert.equal(startStep("C1", w, tick(vid.href!, deck.href!)), 1);
  assert.equal(startStep("C1", w, tick(vid.href!, pdf.href!, deck.href!, link.href!)), 0);
});

test("the button says start, continue or go through again", () => {
  assert.equal(classLabel({ done: 0, total: 4 }), "Start class");
  assert.equal(classLabel({ done: 2, total: 4 }), "Continue class");
  assert.equal(classLabel({ done: 4, total: 4 }), "Go through again");
});

test("each step shows in the app when it can: a video or slides in their viewer, a PDF in place, anything else opens", () => {
  assert.deepEqual(stepView(vid), { kind: "video", file: "courses/C1/03/lecture.mp4" });
  assert.deepEqual(stepView(deck), { kind: "slides", file: "courses/C1/03/deck.pptx" });
  assert.deepEqual(stepView(pdf), { kind: "pdf", href: pdf.href });
  assert.deepEqual(stepView(link), { kind: "open", href: link.href });
  assert.deepEqual(stepView(item("file", "Doc", "/files/S/x.docx", { ext: "docx" })), { kind: "open", href: "/files/S/x.docx" });
  // a Panopto recording with a transcript here shows its transcript, each line opening Panopto
  const panopto = item("video", "Recorded", "https://panopto.example/v?id=1", { external: true, transcript: "/files/S/courses/C1/03/Recorded.transcript.md" });
  assert.deepEqual(stepView(panopto), { kind: "video", file: "courses/C1/03/Recorded.transcript.md" });
  assert.deepEqual(stepView(item("video", "Elsewhere", "https://youtube.example/x", { external: true })), { kind: "open", href: "https://youtube.example/x" });
});

test("a class has its own page per step (1 = the first)", () => {
  assert.equal(classPath("2026 Fall", "C1", 3), "/2026%20Fall/class/C1/3");
  assert.equal(classPath("2026 Fall", "C1", 3, 2), "/2026%20Fall/class/C1/3/2");
});
