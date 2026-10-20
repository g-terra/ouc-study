---
name: make-quiz
description: Make a scored quiz (true/false, single and multiple choice) on what the course material covers, for one lecture or the whole course, saved for the app's Quizzes page. Use for "make a quiz on COS511 week 3", "course quiz for COS514", "test questions I can play".
---

_Paths: `<sem>` = the current semester folder (named in STUDENT.md; otherwise the newest folder under `semesters/`)._

# Make a quiz

The app plays the quiz and keeps the score; you only write the question file. Format: **`docs/QUIZ_FORMAT.md`** (read it first).

1. Resolve the scope: one eClass section (a **lecture quiz**) or the whole course (a **course quiz**). The request names the course, the section and the file to save.
   A **custom quiz** is on topics the student wrote: `"scope": "course"`, the topics in `"description"`. Ask only about those topics. When the request keeps to the course material, leave out what the material doesn't cover; when it allows the web, also use reliable sources (textbooks, university pages, review articles) and stay accurate.
2. Read the course material to learn **what to ask about**: the text copies in `<sem>/text/<course>/` (fast to grep), the original files in `<sem>/courses/` when the text copy is missing or the maths is in images, and the student's notes in `<sem>/notes/<CODE>/`. The material sets the topics and the level; the questions don't have to be lifted from it. Go wider and be creative: related ideas from the same field, everyday examples, short scenarios, "what would happen if…", comparisons between ideas, applying a concept to a new case. Stay on the topics the material covers and only ask what is well established in the field (accurate, not trivia, no trick wording). For a course quiz, spread the questions over every section with material so far.
3. Write **10 questions** for a lecture quiz, **15** for a course quiz (unless asked otherwise): about a third `true-false`, a third `single` and a third `multiple`. Include at least one `single` whose right answer is "All of the above" or "None of the above" when it fits (put it last). Mostly understanding and application rather than recall of a sentence (a small calculation for maths-heavy courses). Wrong options must be plausible: real misconceptions or neighbouring ideas, not jokes.
4. Give every question a **full `explanation`** that teaches on its own, as if the student had no notes open: why the right answer is right, and, for the tempting wrong answers, why they are wrong (usually 3 to 5 sentences, with a concrete example where it helps). Never point to the material instead of explaining: no "the lecture says", "see slide 9" or "as in the notes". `source` is optional: a short topic label (e.g. "Signal detection theory"), never a file path. List the files you used in `sources` (paths relative to `<sem>/`); the app doesn't show them.
5. Save it as JSON at the path given (otherwise `<sem>/quizzes/<CODE>/lecture-NN-<topic>.json` or `<sem>/quizzes/<CODE>/course-<short>.json`; never overwrite an existing quiz: add `-2`, `-3`). Then run `node packages/ai/validate.mjs <the file>` and fix every error it reports.
6. Reply with the file's path in `backticks`, the number of questions and the topics covered. Don't list the answers: the student plays the quiz in the app (Quizzes page, or the course page).

Quizzes test the student on the course's topics; they are not assignment answers. Never base questions on an assignment's questions or the student's submissions.
