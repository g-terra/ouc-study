import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrompt, chatSystem, listActions, quizPath, weeksWithoutNotes, weeksWithoutQuiz } from "../src/actions.ts";
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
  // a name given in the pop-up: the file is named after it and the AI is told to use it as the title
  const named = buildPrompt({ root, semId: "S", data: quizData, action: "make-quiz", params: { course: "AAA", week: "1", title: "Lecture 1 · Ψ and more!" }, first: false });
  assert.match(named, /Save it as semesters\/S\/quizzes\/AAA\/lecture-1-and-more\.json \("title": "Lecture 1 · Ψ and more!", "course": "AAA", "scope": "lecture", "section": 1\)/);
  // a second quiz for the same week gets its own file
  mkdirSync(join(root, "semesters/S/quizzes/AAA"), { recursive: true });
  writeFileSync(join(root, "semesters/S/quizzes/AAA/week-01-note.json"), "{}");
  assert.equal(quizPath(root, "S", quizData.courses[0], quizData.courses[0].weeks[1]), "semesters/S/quizzes/AAA/week-01-note-2.json");
  // nothing to make it from
  assert.throws(() => buildPrompt({ root, semId: "S", data: quizData, action: "make-quiz", params: { course: "AAA", week: "2" } }), /No material for AAA, Week 2 yet/);
  assert.throws(() => buildPrompt({ root, semId: "S", data: quizData, action: "make-quiz", params: {} }), /Choose course first/);
});

test("a custom quiz: the student's topics, from the course material only or with the web too", () => {
  const root = mkdtempSync(join(tmpdir(), "ouc-quiz-"));
  const slides = { kind: "file", title: "slides", href: "/files/S/courses/AAA-dir/01-Week-1/slides.pdf" };
  const quizData = fixture({ courses: [course("AAA", [[1, "2026-09-01", [slides]]])], notes: [], assignments: [] });
  const ask = (params: object) => buildPrompt({ root, semId: "S", data: quizData, action: "make-quiz", params: { course: "AAA", ...params }, first: false });
  const own = ask({ topics: "Signal detection and\nd-prime", title: "SDT drill" });
  assert.match(own, /custom quiz for AAA course \(AAA\) on these topics:\n> Signal detection and\n> d-prime/);
  assert.match(own, /Keep to the subjects the course material covers/);
  assert.doesNotMatch(own, /search the web/i);
  assert.match(own, /`semesters\/S\/courses\/AAA-dir\/01-Week-1\/slides\.pdf`/);   // the whole course's material
  assert.match(own, /Save it as semesters\/S\/quizzes\/AAA\/sdt-drill\.json \("title": "SDT drill", "course": "AAA", "scope": "course", "description": "Signal detection and d-prime"\)/);
  const web = ask({ topics: "Signal detection", web: true });
  assert.match(web, /Search the web too/);
  assert.match(web, /Save it as semesters\/S\/quizzes\/AAA\/custom-signal-detection\.json/);   // no name: after the topics
  // without material it still works from the web, but not from the material alone
  const empty = fixture({ courses: [course("AAA", [[1, "2026-09-01", []]])], notes: [], assignments: [] });
  assert.match(buildPrompt({ root, semId: "S", data: empty, action: "make-quiz", params: { course: "AAA", topics: "x", web: true }, first: false }), /custom quiz/);
  assert.throws(() => buildPrompt({ root, semId: "S", data: empty, action: "make-quiz", params: { course: "AAA", topics: "x" } }), /No material for AAA/);
});

test("a class whose quiz is on disk but not yet in the app data still counts as having a quiz", () => {
  const root = mkdtempSync(join(tmpdir(), "ouc-quiz-"));
  const slides = { kind: "file", title: "slides", href: "/files/S/courses/AAA-dir/01-Week-1/slides.pdf" };
  const data = fixture({ courses: [course("AAA", [[1, "2026-09-01", [slides]], [2, "2026-09-08", [slides]]])], notes: [], assignments: [] });
  mkdirSync(join(root, "semesters/S/quizzes/AAA"), { recursive: true });
  // named in the pop-up, so not week-01-….json
  writeFileSync(join(root, "semesters/S/quizzes/AAA/lecture-1-my-name.json"), JSON.stringify({ title: "Mine", scope: "lecture", section: 1, questions: [] }));
  writeFileSync(join(root, "semesters/S/quizzes/AAA/broken.json"), "{");
  assert.deepEqual(weeksWithoutQuiz(root, "S", data, data.courses[0]).map((w) => w.index), [2]);
});

test("make a quiz is an action every AI can do, local models included", () => {
  const a = listActions(join(dirname(fileURLToPath(import.meta.url)), "../../..")).find((x) => x.id === "make-quiz");
  assert.equal(a?.title, "Make a quiz");
  assert.equal(a?.agentOnly, false);
  assert.deepEqual(a?.fields.map((f) => f.key), ["course"]);
});

test("every action shows the student a plain summary: no file paths, no fixed number of courses", () => {
  const actions = listActions(join(dirname(fileURLToPath(import.meta.url)), "../../.."));
  assert.ok(actions.length >= 10);
  for (const a of actions) {
    assert.ok(a.description.length > 20, a.id);
    assert.doesNotMatch(a.description, /<sem>|<course>|\.md\b|memory\/|\b(two|three|four) courses\b/, a.id);
  }
  assert.equal(actions.find((a) => a.id === "plan-week")?.description, "Plans your week across your courses from your deadlines and what you've done so far.");
});

test("every chat is told to draw flows as Mermaid diagrams", () => {
  const first = buildPrompt({ root: ".", semId: "S", data, message: "how does a neuron fire?" });
  assert.match(first, /```mermaid diagram/);
  assert.doesNotMatch(buildPrompt({ root: ".", semId: "S", data, message: "and then?", first: false }), /mermaid/);   // said once per chat
  assert.match(chatSystem({ root: ".", semId: "S", data }), /```mermaid diagram/);   // local models too
});

test("a plain chat starts lean: ask how to help, read files only when needed", () => {
  const hello = buildPrompt({ root: ".", semId: "S", data, message: "hi there" });
  assert.match(hello, /ask how you can help/);
  assert.match(hello, /only when the question needs them/);
  assert.match(hello, /never write answers the student could submit/);
  assert.doesNotMatch(buildPrompt({ root: ".", semId: "S", data, action: "plan-week" }), /ask how you can help/);   // an action is a task
  assert.doesNotMatch(buildPrompt({ root: ".", semId: "S", data, message: "and?", first: false }), /ask how you can help/);   // said once
  // a local model gets a short guide, not all of AGENTS.md
  const root = mkdtempSync(join(tmpdir(), "ouc-chat-"));
  writeFileSync(join(root, "AGENTS.md"), "# Repository map\nlots of detail");
  writeFileSync(join(root, "STUDENT.md"), "Name: Sam");
  const system = chatSystem({ root, semId: "", data });
  assert.match(system, /Name: Sam/);
  assert.match(system, /ask how you can help/);
  assert.doesNotMatch(system, /Repository map/);
});

test("important dates: an action for one course that points the AI at the dates file", () => {
  const a = listActions(join(dirname(fileURLToPath(import.meta.url)), "../../..")).find((x) => x.id === "important-dates");
  assert.equal(a?.title, "Important dates");
  assert.deepEqual(a?.fields.map((f) => [f.key, f.required ?? false]), [["course", false]]);
  const p = buildPrompt({ root: ".", semId: "S", data, action: "important-dates", params: { course: "AAA" }, message: "final exam on 5 Dec at 13:00" });
  assert.match(p, /important-dates skill/);
  assert.match(p, /AAA course \(AAA\)/);
  assert.match(p, /semesters\/S\/_meta\/dates\.json/);
  assert.match(p, /The student adds: final exam on 5 Dec at 13:00/);
  assert.match(buildPrompt({ root: ".", semId: "S", data, action: "important-dates" }), /Ask me which dates/);
});

const hw = fixture({
  courses: [course("AAA", [[1, "2026-09-01", [file]]])], notes: [],
  assignments: [{ id: "AAA/09-28_A1", code: "AAA", title: "A1", fullTitle: "AAA Assignment 1", due: "2026-10-01T23:59", briefs: [],
    homework: { tasks: [{ id: "1", kind: "written", title: "Bayes", question: "Explain Bayes' rule." }, { id: "2", kind: "choice", question: "Which?", options: ["A", "B"] }] } }],
});

test("the homework tutor knows the task being answered and where the answers are, and never answers it", () => {
  const p = buildPrompt({ root: ".", semId: "S", data: hw, action: "homework-tutor", params: { assignment: "AAA/09-28_A1", task: "1" }, first: false });
  assert.match(p, /homework-tutor skill/);
  assert.match(p, /task 1 of 2 \("Bayes"\)/i);
  assert.match(p, /Explain Bayes' rule\./);
  assert.match(p, /`semesters\/S\/assignments\/AAA\/09-28_A1\/homework\/answers\.json`/);
  assert.match(p, /never write the answer/i);
  // without a task: the whole homework
  assert.doesNotMatch(buildPrompt({ root: ".", semId: "S", data: hw, action: "homework-tutor", params: { assignment: "AAA/09-28_A1" }, first: false }), /task 1 of 2/i);
  assert.throws(() => buildPrompt({ root: ".", semId: "S", data: hw, action: "homework-tutor", params: { assignment: "AAA/nope" } }), /isn't in the app data/);
});

test("checking the homework: lenient, saved as check.json and validated", () => {
  const p = buildPrompt({ root: ".", semId: "S", data: hw, action: "check-homework", params: { assignment: "AAA/09-28_A1" }, first: false });
  assert.match(p, /check-homework skill/);
  assert.match(p, /Save the check as `semesters\/S\/assignments\/AAA\/09-28_A1\/homework\/check\.json`/);
  assert.match(p, /node packages\/ai\/validate\.mjs semesters\/S\/assignments\/AAA\/09-28_A1\/homework\/check\.json/);
  assert.match(p, /not picky/i);
  const acts = listActions(join(dirname(fileURLToPath(import.meta.url)), "../../.."));
  assert.equal(acts.find((a) => a.id === "homework-tutor")?.title, "Homework tutor");
  assert.equal(acts.find((a) => a.id === "check-homework")?.title, "Check my homework");
  assert.deepEqual(acts.find((a) => a.id === "check-homework")?.fields.map((f) => [f.key, f.required ?? false]), [["course", false], ["assignment", true]]);
});
