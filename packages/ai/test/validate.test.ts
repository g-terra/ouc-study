// The note / prep pack checker: LaTeX quoting, prep packs, --fix.
import test from "node:test";
import assert from "node:assert/strict";
import { fixQuotedLatex, validateHomework, validateNote, validateQuiz } from "../src/validate.ts";

const PREP = `---
by: Codex
---
## Key ideas

\`\`\`formula
tex: "d' = z(\\mathrm{hit\\ rate}) - z(\\mathrm{FA})"
where:
  - ["\\tau", time constant]
\`\`\`

\`\`\`mermaid
flowchart LR
  A["\\alpha"] --> B
\`\`\`
`;

test("a prep pack with LaTeX in double quotes is flagged, and --fix repairs only that", () => {
  const { errors, warnings } = validateNote(PREP, { prep: true });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /double quotes/);
  assert.deepEqual(warnings, []);   // no note sections expected in a prep pack
  const fixed = fixQuotedLatex(PREP);
  assert.match(fixed, /tex: 'd'' = z\(\\mathrm\{hit\\ rate\}\) - z\(\\mathrm\{FA\}\)'/);
  assert.match(fixed, /- \['\\tau', time constant\]/);
  assert.match(fixed, /A\["\\alpha"\]/);   // mermaid untouched
  assert.deepEqual(validateNote(fixed, { prep: true }).errors, []);
});

test("as a note, a prep pack still needs the note front matter", () => {
  assert.ok(validateNote(fixQuotedLatex(PREP)).errors.some((e) => /front matter/i.test(e)));
});

test("a quiz is checked against docs/QUIZ_FORMAT.md, with the course from its folder", () => {
  const quiz = JSON.stringify({ title: "Q", course: "AAA", scope: "course", questions: [{ type: "true-false", question: "Q?", answer: true, explanation: "It is true because the made-up rule always holds here, and the usual mix-up is thinking it only holds sometimes.", source: "y" }] });
  assert.deepEqual(validateQuiz(quiz, "semesters/S/quizzes/AAA/course-aaa.json"), { errors: [], warnings: [] });
  assert.match(validateQuiz(quiz, "semesters/S/quizzes/BBB/course.json").errors[0], /BBB folder/);
  assert.match(validateQuiz(quiz, "semesters/S/notes/AAA/quiz.json").errors[0], /quizzes\/<COURSE CODE>/);
});

test("homework files: the tasks against docs/HOMEWORK_FORMAT.md, answers and a check against the tasks next to them", () => {
  const tasks = JSON.stringify({ tasks: [{ id: "1", kind: "written", question: "Why?" }, { id: "2", kind: "choice", question: "Which?", options: ["A", "B"] }] });
  const sibling = (name: string) => (name === "tasks.json" ? tasks : null);
  assert.deepEqual(validateHomework(tasks, "semesters/S/assignments/AAA/09-28_A1/homework/tasks.json", sibling).errors, []);
  assert.match(validateHomework('{"tasks":[{"id":"1","kind":"essay","question":"?"}]}', "x/homework/tasks.json", sibling).errors[0]!, /kind/);
  const check = JSON.stringify({ summary: "Fine.", tasks: { "1": { verdict: "right", note: "Yes." }, "2": { verdict: "wrong", note: "Look at week 2." } } });
  assert.deepEqual(validateHomework(check, "x/homework/check.json", sibling).errors, []);
  assert.match(validateHomework('{"tasks":{"1":{"verdict":"right","note":"ok"}}}', "x/homework/check.json", sibling).errors[0]!, /Task 2.*missing/);
  assert.match(validateHomework(check, "x/homework/check.json", () => null).errors[0]!, /tasks\.json/);
  assert.deepEqual(validateHomework(JSON.stringify({ answers: { "1": { text: "<p>Mine.</p>", done: true } } }), "x/homework/answers.json", sibling).errors, []);
  assert.match(validateHomework(JSON.stringify({ answers: { "2": { choice: 5 } } }), "x/homework/answers.json", sibling).errors[0]!, /choice/);
});
