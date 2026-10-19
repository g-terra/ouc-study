// The note / prep pack checker: LaTeX quoting, prep packs, --fix.
import test from "node:test";
import assert from "node:assert/strict";
import { fixQuotedLatex, validateNote, validateQuiz } from "../src/validate.ts";

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
  const quiz = JSON.stringify({ title: "Q", course: "AAA", scope: "course", questions: [{ type: "true-false", question: "Q?", answer: true, explanation: "x", source: "y" }] });
  assert.deepEqual(validateQuiz(quiz, "semesters/S/quizzes/AAA/course-aaa.json"), { errors: [], warnings: [] });
  assert.match(validateQuiz(quiz, "semesters/S/quizzes/BBB/course.json").errors[0], /BBB folder/);
  assert.match(validateQuiz(quiz, "semesters/S/notes/AAA/quiz.json").errors[0], /quizzes\/<COURSE CODE>/);
});
