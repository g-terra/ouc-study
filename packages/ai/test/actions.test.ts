import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrompt, chatSystem, listActions, quizPath, weeksWithoutNotes } from "../src/actions.ts";
import type { Course, SemesterData } from "../../content/src/types.ts";

// made-up data with only the fields these prompts read
const fixture = (d: object) => d as SemesterData;

const file = { kind: "file", title: "slides" };
const course = (code: string, weeks: [number, string | null, object[]][]): Course => ( ({ code, short: code, title: `${code} course`, weeks: weeks.map(([index, start, items]) => ({ index, name: `Week ${index}`, label: `Week ${index}`, start, items })) }) as Course);
const data = fixture({
  courses: [
    course("AAA", [[0, null, [file]], [1, "2026-09-01", [file]], [2, "2026-09-08", [file]], [3, "2099-01-01", [file]]]),
    course("BBB", [[1, "2026-09-01", []], [2, "2026-09-08", [file]]]),
  ],
  notes: [{ code: "AAA", weekIndex: 1 }],
  assignments: [],
});

test("weeks without notes: with files and no note yet, started or not", () => {
  assert.deepEqual(weeksWithoutNotes(data, data.courses).map(({ course: c, week: w }) => `${c.code}/${w.index}`), ["AAA/2", "AAA/3", "BBB/2"]);
});

test("make notes for all courses lists every missing week", () => {
  const p = buildPrompt({ root: ".", semId: "S", data, action: "make-notes", params: {}, first: false });
  assert.match(p, /3 weeks/);
  assert.match(p, /AAA section 2/);
  assert.match(p, /AAA section 3/);
  assert.match(p, /BBB section 2/);
  assert.doesNotMatch(p, /AAA section 1 /);
});

test("make notes for one course, or one week from a shortcut", () => {
  assert.match(buildPrompt({ root: ".", semId: "S", data, action: "make-notes", params: { course: "BBB" }, first: false }), /BBB course \(BBB\), eClass section 2/);
  assert.match(buildPrompt({ root: ".", semId: "S", data, action: "make-notes", params: { course: "AAA", week: "1" }, first: false }), /eClass section 1/);
  assert.throws(() => buildPrompt({ root: ".", semId: "S", data: fixture({ ...data, notes: [...data.notes, { code: "AAA", weekIndex: 2 }, { code: "AAA", weekIndex: 3 }] }), action: "make-notes", params: { course: "AAA" } }), /AAA: all 3 weeks with files have notes/);
});

test("a course with files only in General gets a note for it, and an empty course says why", () => {
  const general = fixture({ courses: [course("GEN", [[0, null, [file]], [1, "2026-09-01", []]]), course("NIL", [[1, "2026-09-01", []]])], notes: [], assignments: [] });
  assert.deepEqual(weeksWithoutNotes(general, general.courses).map(({ course: c, week: w }) => `${c.code}/${w.index}`), ["GEN/0"]);
  assert.throws(() => buildPrompt({ root: ".", semId: "S", data: general, action: "make-notes", params: { course: "NIL" } }), /NIL: no downloaded files yet/);
});

test("make a quiz: a lecture quiz from a week's files, or a course quiz; never over an existing quiz", () => {
  const root = mkdtempSync(join(tmpdir(), "ouc-quiz-"));
  const slides = { kind: "file", title: "slides", href: "/files/S/courses/AAA-dir/01-Week-1/slides.pdf" };
  const quizData = fixture({ courses: [course("AAA", [[0, null, []], [1, "2026-09-01", [slides]], [2, "2026-09-08", []]])], notes: [{ code: "AAA", weekIndex: 1, slug: "week-01-intro" }], assignments: [] });
  const lecture = buildPrompt({ root, semId: "S", data: quizData, action: "make-quiz", params: { course: "AAA", week: "1" }, first: false });
  assert.match(lecture, /lecture quiz for AAA course \(AAA\) covering eClass section 1/);
  assert.match(lecture, /decide the topics and the level; the questions can go wider[\s\S]*never a pointer to the material/);
  assert.match(lecture, /`semesters\/S\/courses\/AAA-dir\/01-Week-1\/slides\.pdf`/);
  assert.match(lecture, /`semesters\/S\/notes\/AAA\/week-01-intro\.md`/);
  assert.match(lecture, /Save it as semesters\/S\/quizzes\/AAA\/week-01-note\.json \("course": "AAA", "scope": "lecture", "section": 1\)/);
  assert.match(buildPrompt({ root, semId: "S", data: quizData, action: "make-quiz", params: { course: "AAA" }, first: false }), /course quiz .* covering the whole course so far[\s\S]*Save it as semesters\/S\/quizzes\/AAA\/course-aaa\.json \("course": "AAA", "scope": "course"\)/);
  // a second quiz for the same week gets its own file
  mkdirSync(join(root, "semesters/S/quizzes/AAA"), { recursive: true });
  writeFileSync(join(root, "semesters/S/quizzes/AAA/week-01-note.json"), "{}");
  assert.equal(quizPath(root, "S", quizData.courses[0], quizData.courses[0].weeks[1]), "semesters/S/quizzes/AAA/week-01-note-2.json");
  // nothing to make it from
  assert.throws(() => buildPrompt({ root, semId: "S", data: quizData, action: "make-quiz", params: { course: "AAA", week: "2" } }), /No material for AAA, Week 2 yet/);
  assert.throws(() => buildPrompt({ root, semId: "S", data: quizData, action: "make-quiz", params: {} }), /Choose course first/);
});

test("make a quiz is an action every AI can do, local models included", () => {
  const a = listActions(join(dirname(fileURLToPath(import.meta.url)), "../../..")).find((x) => x.id === "make-quiz");
  assert.equal(a?.title, "Make a quiz");
  assert.equal(a?.agentOnly, false);
  assert.deepEqual(a?.fields.map((f) => f.key), ["course"]);
});

test("every chat is told to draw flows as Mermaid diagrams", () => {
  const first = buildPrompt({ root: ".", semId: "S", data, message: "how does a neuron fire?" });
  assert.match(first, /```mermaid diagram/);
  assert.doesNotMatch(buildPrompt({ root: ".", semId: "S", data, message: "and then?", first: false }), /mermaid/);   // said once per chat
  assert.match(chatSystem({ root: ".", semId: "S", data }), /```mermaid diagram/);   // local models too
});
