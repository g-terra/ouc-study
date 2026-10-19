---
name: make-quiz
description: Make a scored quiz (true/false, single and multiple choice) from the course material, for one lecture or the whole course, saved for the app's Quizzes page. Use for "make a quiz on COS511 week 3", "course quiz for COS514", "test questions I can play".
---

_Paths: `<sem>` = the current semester folder (named in STUDENT.md; otherwise the newest folder under `semesters/`)._

# Make a quiz

The app plays the quiz and keeps the score; you only write the question file. Format: **`docs/QUIZ_FORMAT.md`** (read it first).

1. Resolve the scope: one eClass section (a **lecture quiz**) or the whole course (a **course quiz**). The request names the course, the section and the file to save.
2. Read **only the course material**: the text copies in `<sem>/text/<course>/` (fast to grep), the original files in `<sem>/courses/` when the text copy is missing or the maths is in images, and the student's notes in `<sem>/notes/<CODE>/`. Every question must be answerable from that material; never add facts from elsewhere. For a course quiz, spread the questions over every section with material so far.
3. Write **10 questions** for a lecture quiz, **15** for a course quiz (unless asked otherwise): about a third `true-false`, a third `single` and a third `multiple`. Include at least one `single` whose right answer is "All of the above" or "None of the above" when the material supports it (put it last). Mix recall with understanding and application (a small calculation for maths-heavy courses). Wrong options must be plausible, taken from neighbouring ideas in the material, not jokes.
4. Give every question an `explanation` (why, in one or two sentences) and a `source` (file and slide or page). List the files used in `sources` (paths relative to `<sem>/`).
5. Save it as JSON at the path given (otherwise `<sem>/quizzes/<CODE>/lecture-NN-<topic>.json` or `<sem>/quizzes/<CODE>/course-<short>.json`; never overwrite an existing quiz: add `-2`, `-3`). Then run `node packages/ai/validate.mjs <the file>` and fix every error it reports.
6. Reply with the file's path in `backticks`, the number of questions and the topics covered. Don't list the answers: the student plays the quiz in the app (Quizzes page, or the course page).

Quizzes test the student on the course material; they are not assignment answers. Never base questions on an assignment's questions or the student's submissions.
