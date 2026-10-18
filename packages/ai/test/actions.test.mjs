import test from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, weeksWithoutNotes } from "../actions.mjs";

const file = { kind: "file", title: "slides" };
const course = (code, weeks) => ({ code, short: code, title: `${code} course`, weeks: weeks.map(([index, start, items]) => ({ index, name: `Week ${index}`, label: `Week ${index}`, start, items })) });
const data = {
  courses: [
    course("AAA", [[0, null, [file]], [1, "2026-09-01", [file]], [2, "2026-09-08", [file]], [3, "2099-01-01", [file]]]),
    course("BBB", [[1, "2026-09-01", []], [2, "2026-09-08", [file]]]),
  ],
  notes: [{ code: "AAA", weekIndex: 1 }],
  assignments: [],
};

test("weeks without notes: started, with files, no note yet", () => {
  assert.deepEqual(weeksWithoutNotes(data, data.courses, "2026-10-18").map(({ course: c, week: w }) => `${c.code}/${w.index}`), ["AAA/2", "BBB/2"]);
});

test("make notes for all courses lists every missing week", () => {
  const p = buildPrompt({ root: ".", semId: "S", data, action: "make-notes", params: {}, first: false });
  assert.match(p, /2 weeks/);
  assert.match(p, /AAA section 2/);
  assert.match(p, /BBB section 2/);
  assert.doesNotMatch(p, /section 3/);
});

test("make notes for one course, or one week from a shortcut", () => {
  assert.match(buildPrompt({ root: ".", semId: "S", data, action: "make-notes", params: { course: "BBB" }, first: false }), /BBB course \(BBB\), eClass section 2/);
  assert.match(buildPrompt({ root: ".", semId: "S", data, action: "make-notes", params: { course: "AAA", week: "1" }, first: false }), /eClass section 1/);
  assert.throws(() => buildPrompt({ root: ".", semId: "S", data: { ...data, notes: [...data.notes, { code: "AAA", weekIndex: 2 }] }, action: "make-notes", params: { course: "AAA" } }), /AAA: all 2 started weeks with files have notes/);
});

test("a course with files only in General gets a note for it, and an empty course says why", () => {
  const general = { courses: [course("GEN", [[0, null, [file]], [1, "2026-09-01", []]]), course("NIL", [[1, "2026-09-01", []]])], notes: [], assignments: [] };
  assert.deepEqual(weeksWithoutNotes(general, general.courses, "2026-10-18").map(({ course: c, week: w }) => `${c.code}/${w.index}`), ["GEN/0"]);
  assert.throws(() => buildPrompt({ root: ".", semId: "S", data: general, action: "make-notes", params: { course: "NIL" } }), /NIL: no downloaded files yet/);
});
