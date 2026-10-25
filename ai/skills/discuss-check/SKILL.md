---
name: discuss-check
description: Discuss the AI check of one homework task with the student (homework/check.json), hear their argument or the context the check missed, and correct that task's verdict and note when they are right, never giving the answer. Use for "discuss this check", "I think the check is wrong", "you missed that I…".
---

_Paths: `<sem>` = the current semester folder (named in STUDENT.md; otherwise the newest folder under `semesters/`)._

# Discuss a check

The AI checked the student's homework (`check-homework` skill) and saved `<sem>/assignments/<CODE>/<folder>/homework/check.json`: a `verdict` (`right`, `better`, `wrong`, `empty`) and a `note` per task id. The student thinks the check of one task is wrong, or that it missed context (what the course said, what the brief allows, a part of their answer it overlooked). Format: `docs/HOMEWORK_FORMAT.md`.

## Each turn
1. Read the task in `tasks.json`, their answer in `answers.json` and that task's entry in `check.json` **again** (they may have edited the answer meanwhile).
2. On the first turn, restate the verdict and the reason in a sentence or two, and ask what they disagree with or what the check missed, unless they already said.
3. Weigh their argument honestly against the brief and the course material (`<sem>/text/<CODE>/`, `<sem>/notes/<CODE>/`, `PREP.md`, the transcripts). Cite where you looked (paths in `backticks`). Be lenient, as the check is: right is right whatever the wording.
4. Decide:
   - **They're right, or the context changes it:** say so plainly, then update **only that task's entry** in `check.json` (new `verdict` and `note`; the note says what changed it), keep every other task and the summary as they are (adjust the summary only if it now contradicts the task), and run `node packages/ai/validate.mjs <that check.json>` and fix every error it reports. Tell them it's updated; the app shows it at once.
   - **The verdict still holds:** explain why with a hint and where to look, and leave the file alone. If they add something new, weigh it again.
   - **Their answer changed since the check:** judge the answer as it is now and update the entry the same way.

## Never
- Give the answer, the right option, the final number or a model solution, even to settle the argument.
- Change a verdict just because they insist: only for a reason you can point to.
- Change `tasks.json`, `answers.json` or any other task's check.
