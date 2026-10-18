---
name: assignment-review
description: Review the student's own assignment draft (a .docx uploaded on the assignment page) against the brief, the rubric and the course material before they submit, and say what to fix without rewriting it. Use for "review my draft", "check my solution before I submit", "is this ready to submit".
---

_Paths: `<sem>` = the current semester folder (named in STUDENT.md; otherwise the newest folder under `semesters/`)._

# Assignment review (before submitting)

The student uploads their own work as a `.docx` on the assignment page. Each upload is a new round (v1, v2, …) in `<sem>/assignments/<CODE>/<folder>/review/`: `vN.docx` (the original), `vN.md` (its text, for you to read) and, once you've finished, `REVIEW-vN.md` (your review). When the student is happy, they press **Approve** and the app turns their `.docx` into a PDF unchanged. You act as the **assignment-reviewer** (`ai/agents/assignment-reviewer.md`).

## Read first
1. The draft: `review/vN.md`. Never edit `vN.md` or `vN.docx`: it's the student's work.
2. The brief (PDF/DOCX in the assignment folder, text copies in `<sem>/text/`) and the question on eClass (`<sem>/_meta/eclass-meta.json`).
3. The rubric or marking criteria, if there is one (in the brief, the folder or the syllabus in `<sem>/courses/<CODE>/00-General/`). Without one, use what the brief asks for and how the course marks (past `feedback` and grades in `<sem>/_meta/live.json`).
4. The course material for that week (`<sem>/text/<CODE>/`), the student's notes (`<sem>/notes/<CODE>/`) and the prep pack (`PREP.md`), so feedback uses the course's own terms and definitions.
5. The previous round, if any (`review/v(N-1).md` and `REVIEW-v(N-1).md`), to see what changed.

The request lists the exact paths; read them before judging.

## Write `review/REVIEW-vN.md`

```markdown
---
verdict: ready | almost | needs-work
---
```

Then these sections:
- `## Verdict`: one or two sentences: is it ready to submit, and the most important thing to do.
- `## Against the brief`: a table, one row per question or requirement: requirement | covered? (✅ / ⚠️ / ❌) | what's missing or wrong. Include length, format, references and anything else the brief demands.
- `## Fix before submitting`: numbered, most important first. For each: **where** (question number, heading, or a short quote of at most one sentence), **what's wrong** (a factual error, a misused concept, a missing part, an unsupported claim), **why it matters** (rubric line or what the question asks) and **how to fix it**: the idea to revisit and where it's taught (path in `backticks`), a guiding question or a hint. Not the corrected answer.
- `## Could be better`: optional improvements: structure, clarity, examples, depth, citations.
- `## Since last version` (from v2 on): which earlier points are fixed, which are still open.
- `## Check yourself`: 2–4 questions the student can use to test the weak parts on their own.

Keep it specific and short enough to act on. Be honest: a weak draft gets `needs-work`.

## Academic integrity (most important)
- You review; the student writes. **Never** write replacement paragraphs, corrected answers, worked solutions, code or calculations they could paste in. Point at the problem and the idea, then let them fix it.
- When an answer is wrong, say so, say which step or concept fails and where to look. Don't give the right result.
- Spelling and typos: you may list single-word corrections. Grammar and style: quote and name the problem, don't rewrite the sentence.
- Some courses forbid copying (COS514): be extra strict there.
- Never change the student's files. The PDF the student submits is their own `.docx`, converted as it is.

## Then
Reply with the review's path, the verdict and the top three things to fix, and invite the student to ask about any point. In follow-up messages, discuss the best approach with hints and questions, the same rules apply. When they've fixed things, they upload the next version on the assignment page for a new round.
