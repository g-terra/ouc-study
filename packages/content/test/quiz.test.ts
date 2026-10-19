// Quizzes: checking the file the AI writes, answers, points and streaks, and saving attempts.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isCorrect, makeAttempt, parseQuiz, pointsFor, quizStats, shuffledOptions } from "../src/quiz.ts";
import { addAttempt, attemptsFile, readAttempts, removeQuiz, resetAttempts } from "../src/quiz-store.ts";
import type { QuizAttempt, QuizQuestion } from "../src/types.ts";

const where = { code: "AAA", name: "lecture-01-intro" };
const opt = (text: string, correct = false) => ({ text, correct });
const QUIZ = {
  title: "Lecture 1", course: "AAA", scope: "lecture", section: 2,
  questions: [
    { type: "true-false", question: "Sky is blue?", answer: true, explanation: "Rayleigh.", source: "slide 1" },
    { type: "single", question: "Pick B", options: [opt("A"), opt("B", true), opt("All of the above")], explanation: "B.", source: "slide 2" },
    { type: "multiple", question: "Pick A and C", options: [opt("A", true), opt("B"), opt("C", true)], explanation: "A, C.", source: "slide 3" },
  ],
};

test("a valid quiz is read with its id from where the file is", () => {
  const { quiz, errors, warnings } = parseQuiz(JSON.stringify(QUIZ), where);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(quiz?.id, "AAA/lecture-01-intro");
  assert.equal(quiz?.section, 2);
  assert.equal(quiz?.questions.length, 3);
});

test("broken quizzes say what to fix", () => {
  assert.match(parseQuiz("{ nope", where).errors[0], /Not valid JSON/);
  const bad = (patch: object, q?: object) => parseQuiz({ ...QUIZ, ...patch, ...(q ? { questions: [q] } : {}) }, where).errors.join(" | ");
  assert.match(bad({ course: "BBB" }), /AAA folder/);
  assert.match(bad({ scope: "week" }), /"scope" must be/);
  assert.match(bad({ section: undefined }), /needs "section"/);
  assert.match(bad({ questions: [] }), /non-empty/);
  assert.match(bad({}, { type: "true-false", question: "Q", answer: "true" }), /true or false \(no quotes\)/);
  assert.match(bad({}, { type: "single", question: "Q", options: [opt("A", true), opt("B", true)] }), /exactly one/);
  assert.match(bad({}, { type: "multiple", question: "Q", options: [opt("A"), opt("B")] }), /at least one/);
  assert.match(bad({}, { type: "single", question: "Q", options: [opt("A", true), opt("a")] }), /same text/);
  assert.match(bad({}, { type: "essay", question: "Q" }), /"type" must be one of/);
  // a course quiz needs no section
  assert.deepEqual(parseQuiz({ ...QUIZ, scope: "course", section: undefined }, where).errors, []);
  // works, but could be better
  const { warnings } = parseQuiz({ ...QUIZ, questions: [{ type: "multiple", question: "Q", options: [opt("None of the above"), opt("A", true)] }] }, where);
  assert.equal(warnings.length, 4);   // no explanation, no source, one right option, "None of the above" not last
});

test("answers: true/false, one option, and exactly the right set for multiple", () => {
  const [tf, single, multi] = parseQuiz(QUIZ, where).quiz!.questions as QuizQuestion[];
  assert.equal(isCorrect(tf, true), true);
  assert.equal(isCorrect(tf, false), false);
  assert.equal(isCorrect(tf, undefined), false);
  assert.equal(isCorrect(single, [1]), true);
  assert.equal(isCorrect(single, [0]), false);
  assert.equal(isCorrect(multi, [2, 0]), true);
  assert.equal(isCorrect(multi, [0]), false);          // missed one
  assert.equal(isCorrect(multi, [0, 1, 2]), false);    // ticked one too many
});

test("points: 10 per right answer, 20 more for a perfect score", () => {
  assert.equal(pointsFor([true, false, true]), 20);
  assert.equal(pointsFor([true, true, true]), 50);
  assert.equal(pointsFor([]), 0);
});

test("stats: best score per quiz, mastered, and a streak of days in a row", () => {
  const now = new Date(2026, 9, 19, 12);
  const on = (d: number, quiz: string, score: number, total = 4): QuizAttempt => ({ quiz, title: quiz, at: new Date(2026, 9, d, 10).toISOString(), score, total, points: score * 10, results: [] });
  const s = quizStats([on(16, "A/x", 1), on(17, "A/x", 4), on(18, "A/y", 2), on(18, "A/x", 3)], now);
  assert.deepEqual(s.best["A/x"], { score: 4, total: 4, pct: 1, attempts: 3, last: on(18, "A/x", 3).at });
  assert.equal(s.mastered, 1);
  assert.equal(s.points, 100);
  assert.equal(s.streak, 3);           // 16, 17, 18: still alive today, not played yet
  assert.equal(s.playedToday, false);
  assert.equal(quizStats([on(19, "A/x", 1), on(18, "A/x", 1), on(16, "A/x", 1)], now).streak, 2);
  assert.equal(quizStats([on(17, "A/x", 1)], now).streak, 0);   // missed yesterday
});

test("shuffling keeps \"All of the above\" last", () => {
  const texts = ["A", "B", "C", "All of the above"];
  for (let i = 0; i < 20; i++) {
    const order = shuffledOptions(4, texts);
    assert.equal(order.at(-1), 3);
    assert.deepEqual([...order].sort(), [0, 1, 2, 3]);
  }
});

test("attempts: checked, points worked out on the server, appended to attempts.json", () => {
  assert.throws(() => makeAttempt({ quiz: "../x", results: [true] }), /Bad quiz id/);
  assert.throws(() => makeAttempt({ quiz: "A/x", results: [] }), /Bad results/);
  const dir = mkdtempSync(join(tmpdir(), "ouc-quiz-"));
  assert.deepEqual(readAttempts(dir), []);
  const a = addAttempt(dir, { quiz: "AAA/lecture-01-intro", title: "Lecture 1", results: [true, true], points: 9999 }, new Date("2026-10-19T09:00:00Z"));
  assert.equal(a.points, 40);
  assert.equal(a.score, 2);
  addAttempt(dir, { quiz: "AAA/lecture-01-intro", results: [false, "yes"] });
  const all = readAttempts(dir);
  assert.equal(all.length, 2);
  assert.deepEqual(all[1].results, [false, false]);
  assert.match(readFileSync(attemptsFile(dir), "utf8"), /"attempts"/);
});

test("reset one quiz's progress or all of it, and remove a quiz with its scores", () => {
  const dir = mkdtempSync(join(tmpdir(), "ouc-quiz-"));
  for (const quiz of ["AAA/one", "AAA/one", "AAA/two", "BBB/three"]) addAttempt(dir, { quiz, results: [true] });
  assert.equal(resetAttempts(dir, "AAA/one"), 2);
  assert.deepEqual(readAttempts(dir).map((a) => a.quiz), ["AAA/two", "BBB/three"]);
  assert.equal(resetAttempts(dir, "AAA/none"), 0);
  assert.throws(() => resetAttempts(dir, "../x"), /Bad quiz id/);

  mkdirSync(join(dir, "quizzes/AAA"), { recursive: true });
  writeFileSync(join(dir, "quizzes/AAA/two.json"), "{}");
  removeQuiz(dir, "AAA/two");
  assert.equal(existsSync(join(dir, "quizzes/AAA/two.json")), false);
  assert.deepEqual(readAttempts(dir).map((a) => a.quiz), ["BBB/three"]);
  assert.throws(() => removeQuiz(dir, "AAA/two"), /doesn't exist/);
  assert.throws(() => removeQuiz(dir, "AAA/../../x"), /Bad quiz id/);
  assert.throws(() => removeQuiz(dir, "AAA/.hidden"), /Bad quiz id/);

  assert.equal(resetAttempts(dir), 1);
  assert.deepEqual(readAttempts(dir), []);
});
