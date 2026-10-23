---
name: make-homework
description: Turn an assignment into its interactive version (homework/tasks.json) that the student answers in the app, from the eClass task and brief; for an assignment already submitted, from the student's submitted work, with their own answers copied into homework/answers.json. Use for "make this assignment interactive", "convert my assignments", "make the homework for assignment 2".
---

_Paths: `<sem>` = the current semester folder (named in STUDENT.md; otherwise the newest folder under `semesters/`)._

# Make it interactive

An assignment's interactive version lives in `<sem>/assignments/<CODE>/<folder>/homework/`. Format: `docs/HOMEWORK_FORMAT.md`. The request names the assignment and the files to work from.

## The tasks (`tasks.json`)
1. Read the task on eClass (the assignment's entry in `<sem>/_meta/eclass-meta.json`) and the brief (PDF/DOCX in the assignment folder; text copies in `<sem>/text/`). For a submitted assignment, also read the student's submission in `my-submission/` (not the `feedback_*` files).
2. One task per question the student has to answer, in the brief's order. Sub-questions (a), (b)… become their own tasks when each needs its own answer; give them ids like `"2a"`, `"2b"`.
3. `question`: the assignment's own wording, complete enough to answer without the brief: data, tables (Markdown), formulas in `$LaTeX$`. Translate nothing; keep Greek in Greek.
4. `kind`: `choice` when the brief gives options (copy them as `options`, without the letters), `calculation` for working out a number or a derivation, otherwise `written`.
5. `title`: a few words for the timeline.
6. Never put answers, hints, solutions or marks in `tasks.json`.

## A submitted assignment: the student's answers (`answers.json`)
Only when the request says the assignment was submitted:
- For each task, copy the student's answer **exactly as they wrote it** in their submission into `text` as HTML: `<p>` paragraphs, `<ul>/<ol>` lists, `<b>`, `<i>`, `<code>`, `<pre><code>`, and formulas as `<span data-latex="..."></span>`. For a `choice` task, `choice` is the index of the option they picked (and `why` their reason, if they gave one).
- Set `"done": true` on each answered task. A task they didn't answer gets no entry.
- **Copy, never correct, improve or complete** their work, even where it is wrong. Leave out pictures you can't copy, and add `<p><i>(A picture was here in the submission.)</i></p>` in their place.

## Check
Run `node packages/ai/validate.mjs <the tasks.json> [<the answers.json>]` and fix every error it reports.

## Never
- Write answers for an assignment that wasn't submitted.
- Change the student's submission, the brief, or any other file in the assignment folder.
