---
name: make-notes
description: Make structured study notes for a lecture, week, reading or file and save them to <sem>/notes/<course>/. Use for "make notes on COS514 lecture 5", "summarise week 3 attention", "notes for this PDF".
---

_Paths: `<sem>` = the current semester folder (named in STUDENT.md; otherwise the newest folder under `semesters/`)._

# Make notes

1. Resolve the target: course code + week/lecture number, a topic, or a file path. Use `<sem>/courses/<course>/README.md` to map it to files.
2. **Start from the transcripts** when the week has any: `*.transcript.md` files next to its videos and narrated slides in `<sem>/courses/<course>/<NN>-<week>/` (made on this computer by `ouc transcribe`; a slide deck's transcript has one section per slide). They hold what the lecturer actually said, so build the note's structure and explanations on them, and use the slides and readings for the definitions, figures and formulas. Transcripts are automatic: check names and terms against the slides. If a week has videos but no transcript yet, say so and work from the rest.
3. Read the plain-text copies in `<sem>/text/<course>/` (fast to grep; PDF pages are marked `--- page N ---`, slides `--- slide N ---`). For maths-heavy slides or the COS514 "math" images, open the original file to read the equations.
4. Write it in the **visual format** from `docs/NOTE_FORMAT.md` (cards, mermaid diagram, LaTeX formula cards, compare tables, steps, flashcards). **Cite the material** as its "Sources" section says: a `> [!SOURCE]` line under each topic section and a `## Sources` list at the end, each citation a path with its spot (`…/Reading.pdf#page=12`, `…/Lecture 3.pptx#slide=5`, `…/Lecture 3.mp4#t=12:03`), so the app opens the page, slide or moment. Asked to add sources to an existing note? Add only the citations; don't change what it says. Follow `ai/agents/note-taker.md`, or delegate to the **note-taker** agent when several weeks are requested (one agent per course, run in parallel).
5. Update `memory/glossary.md`, `memory/learning-log.md` and `memory/progress.md`.
6. Reply with the note's path in `backticks` and its 3 key takeaways. It appears in the app under Notes and in the course's week list.
