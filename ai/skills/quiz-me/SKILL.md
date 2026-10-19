---
name: quiz-me
description: Quiz the student on a course, week or topic using the course material, with spaced review of weak spots from memory. Use for "quiz me", "test me on", "flashcards", "revise".
---

_Paths: `<sem>` = the current semester folder (named in STUDENT.md; otherwise the newest folder under `semesters/`)._

# Quiz me

1. Choose the scope: given by the student, or by default the topics marked weak in `memory/learning-log.md`, plus the most recent weeks studied in `memory/progress.md`. Quiz scores from the app are in `<sem>/quizzes/attempts.json` (per question right or wrong; the questions are in `<sem>/quizzes/<CODE>/<name>.json`): questions they got wrong are weak spots too.
2. Build 5-10 questions from `<sem>/notes/` and `<sem>/text/` that mix recall, application and one "explain in your own words" question. For COS512/COS514, include a small calculation (e.g. Naive Bayes posterior, Dijkstra step, LIF membrane equation).
3. Ask one question at a time, wait for their answer, give feedback and the correct reasoning, and track the score.
4. At the end, log the score and weak spots to `memory/learning-log.md`, and suggest which note or file to revisit.

This is a conversation quiz. For a quiz the student can replay in the app with a saved score, use the **make-quiz** skill instead.
