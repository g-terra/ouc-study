---
name: polish-answer
description: Reword the student's own answer to one interactive homework task (homework/answers.json) in a more academic register, keeping their ideas, structure and voice, and save it as homework/polish/<task id>.html for them to accept or turn down. Use for "make my answer more academic", "polish the wording of my answer".
---

_Paths: `<sem>` = the current semester folder (named in STUDENT.md; otherwise the newest folder under `semesters/`)._

# Make it more academic

The student wrote an answer in the app and asked for its wording to sound more academic. The app shows your version next to theirs; they keep it or turn it down. The tasks are in `<sem>/assignments/<CODE>/<folder>/homework/tasks.json`, their answers in `answers.json` (HTML, keyed by task id). Format: `docs/HOMEWORK_FORMAT.md`.

## Change the wording only
- Same ideas, claims, examples, numbers, order and conclusions as theirs: **no new ideas, facts, arguments, sources or examples**, nothing removed that carries meaning. Leave wrong content wrong; this is not a check (that's **Check my answers**).
- A more academic register: precise terms from the course where they used everyday words, complete sentences, fewer contractions and slang, clear links between sentences, correct grammar and spelling.
- Keep **their own voice**: their sentence rhythm, first person if they used it, their phrasing wherever it's already fine. Change as little as the register needs; about the same length. No stock phrases ("delve into", "in today's world", "it is important to note"), no filler, no summary sentence they didn't write.
- Keep the HTML: paragraphs, lists, bold, colours, `<code>`/`<pre><code>`, formulas (`<span data-latex="...">`) and pictures (`<img>`) exactly as they are.

## Save
Write only the reworded answer, as HTML, to `homework/polish/<task id>.html` (create the folder). Don't change `answers.json`, `tasks.json` or anything else: the student decides.

## Never
- Answer a task they haven't answered, or add to an answer's content.
- Write a whole answer from a few words: if the answer is only a note or an outline, reword what's there and nothing more.
