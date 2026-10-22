---
name: assignment-prep
description: Prepare a study pack for one assignment (what it asks, hints, relevant course material, extra reading, a plan) and save it as PREP.md in the assignment's folder. Use for "prepare assignment 3", "prep pack for the COS514 project", "review the prep for this assignment".
---

_Paths: `<sem>` = the current semester folder (named in STUDENT.md; otherwise the newest folder under `semesters/`)._

# Assignment prep

The app runs this on its own when a sync finds an assignment without a prep pack, and the student can ask another AI to review it, add more, or start over. Nobody answers questions mid-run: make sensible choices and finish.

## Read first
1. The brief: `<sem>/assignments/<CODE>/<folder>/` (PDF/DOCX files) and their text copies in `<sem>/text/`; the description in `<sem>/_meta/eclass-meta.json`.
2. The week it belongs to: `<sem>/courses/<CODE>/` and `<sem>/text/<CODE>/`, plus the student's notes in `<sem>/notes/<CODE>/`.
3. Study links already collected for it in `<sem>/_meta/resources.json` (key `"<CODE>|<assignment name>"`).
4. `STUDENT.md` for how the student learns (default: visual).

## Write `PREP.md` in the assignment's folder
Keep the front matter the app adds (`by`, `updated`, `log`) if the file already has it; don't invent it otherwise. Then these sections:

- `## What it asks`: each question or task in one or two plain sentences, what's being assessed, length/format rules, the due date.
You can use the note blocks from `docs/NOTE_FORMAT.md` (`formula`, `compare`, `steps`, `mermaid`…). Inside them, LaTeX goes in **single quotes** or a `|` block, never "double quotes" (YAML reads `\t` in `"\tau"` as a tab).

- `## Key ideas`: the concepts needed, each with a one-line explanation and where it's taught (the file or note, as a path in `backticks`). Use LaTeX for maths. A `mermaid` diagram if it helps.
- `## Hints`: per question, nudges that point the way (which idea applies, what to look out for, common mistakes). **Never the answer, worked solution or submittable text.**
- `## From your course`: the exact slides, readings and notes to revisit, each as its repo-relative path in `backticks` (the app turns it into a link showing the file name), followed by what to look at in it.
- `## Extra material`: 3–6 good outside sources (textbook chapters, lecture videos, tutorials, papers) with working links and why each helps. Prefer the course's own books. No pirated copies.
- `## Plan`: a few coarse steps (by part of the work, not draft → review → next question) to finish 1–2 days before it's due, never earlier; no submit or upload step. In the week plan the assignment stays one task per assignment.

## Modes (the request says which)
- **new / start over**: write it from scratch. In "start over", don't read the old PREP.md; replace it.
- **review**: check the existing PREP.md critically against the brief and course material: fix mistakes, sharpen vague hints, fill gaps, remove anything that gives away answers. Keep what's good.
- **add more**: keep everything and add depth: more hints, practice questions on the same ideas, more sources, a worked example on a *different* problem.

## Rules
- Academic integrity first: explain and hint, never write answers. Some courses forbid copying (COS514).
- Check every link you add opens. Cite course files by their path in `backticks`, never as plain text, so the app can link them.
- Run `node packages/ai/validate.mjs <the PREP.md path>` and fix every error it reports.
- Finish by replying with the PREP.md path and a 2-line summary.
