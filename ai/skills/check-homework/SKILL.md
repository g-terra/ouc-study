---
name: check-homework
description: Check the student's answers to an interactive homework (homework/answers.json against homework/tasks.json) leniently and save the verdicts as homework/check.json, with hints for what's not right, never the answers. Use for "check my homework", "are my answers right", "validate my answers".
---

_Paths: `<sem>` = the current semester folder (named in STUDENT.md; otherwise the newest folder under `semesters/`)._

# Check my homework

The student answered an assignment's tasks in the app: `<sem>/assignments/<CODE>/<folder>/homework/tasks.json` (the tasks) and `answers.json` (their answers, HTML, keyed by task id; `choice` is the index of the picked option, `choices` the picked options of a task marked `multiple`, `why` the optional reason; pictures in `images/`). Format: `docs/HOMEWORK_FORMAT.md`.

## Read first
1. `tasks.json` and `answers.json`.
2. The brief in the assignment folder (text copies in `<sem>/text/`) and the course material it draws on (`<sem>/text/<CODE>/`, the notes in `<sem>/notes/<CODE>/`, `PREP.md`), so you judge by what the course teaches.

## Judge each task: lenient, not picky
- **right**: the answer is correct. Wording, notation, order, length and style don't matter; small slips that don't change the result don't either. Say briefly what makes it right.
- **better**: correct, and there's a clearly better way: a missing step the brief asks to show, a cleaner method, a sharper term. Say what, in a sentence or two. Don't use it for taste.
- **wrong**: not right: a wrong result, a wrong option, a misunderstanding, or a big part of the task missing. Say plainly what's off and give a **hint** and where to look (file paths in backticks), never the correct answer, number or option.
- **empty**: no answer yet (nothing typed, or no option picked).

## Save `homework/check.json`

```json
{
  "summary": "One or two sentences on the whole homework (Markdown).",
  "tasks": {
    "<task id>": { "verdict": "right | better | wrong | empty", "note": "Why, in Markdown with $LaTeX$" }
  }
}
```

Every task in `tasks.json` gets an entry. Then run `node packages/ai/validate.mjs <that check.json>` and fix every error it reports.

## Never
- Write the answer or a model solution, in a note or anywhere else.
- Change `tasks.json` or `answers.json`.
