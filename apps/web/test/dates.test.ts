import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtDay, fmtFull, fmtWhen, plural } from "../src/lib/dates.ts";

test("an exam with a date but no time shows no made-up 00:00", () => {
  const d = new Date(2027, 0, 15);
  assert.equal(fmtWhen(d, true), fmtDay(d));
  assert.doesNotMatch(fmtWhen(d, true), /00:00/);
  assert.equal(fmtWhen(new Date(2027, 0, 15, 9, 30)), fmtFull(new Date(2027, 0, 15, 9, 30)));
  assert.match(fmtWhen(new Date(2027, 0, 15, 9, 30)), /09:30$/);
});

test("counts read naturally", () => {
  assert.equal(plural(1, "note"), "1 note");
  assert.equal(plural(0, "note"), "0 notes");
  assert.equal(plural(1, "quiz", "quizzes"), "1 quiz");
  assert.equal(plural(3, "quiz", "quizzes"), "3 quizzes");
});
