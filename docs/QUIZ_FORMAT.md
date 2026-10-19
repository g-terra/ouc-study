# Quiz format

Quizzes live in `semesters/<semester>/quizzes/<COURSE CODE>/<name>.json`. The app plays them under **Quizzes** and keeps the scores in `semesters/<semester>/quizzes/attempts.json` (on this computer only, never committed).
An AI makes them with the `make-quiz` skill, **only from the course material** (the downloaded files, their text copies and the student's notes).

- A **lecture quiz** covers one eClass section (one week or lecture): `"scope": "lecture"` and its `"section"` index. Name it like the note for that week, e.g. `lecture-03-attention.json`.
- A **course quiz** covers the whole course so far: `"scope": "course"`, no section. Name it `course-<short-name>.json`.

```json
{
  "title": "Lecture 3 · What determines our attention",
  "course": "COS511",
  "scope": "lecture",
  "section": 4,
  "description": "Selective attention, bottlenecks and the cocktail-party effect.",
  "sources": ["courses/COS511-Cognitive-Psychology/04-Week-3.-September-28/What determines our attention_audio.pptx"],
  "questions": [
    {
      "type": "true-false",
      "question": "Early-selection theories put the attention filter before meaning is analysed.",
      "answer": true,
      "explanation": "Broadbent's filter selects on physical features (pitch, location) before semantic analysis.",
      "source": "What determines our attention, slide 9"
    },
    {
      "type": "single",
      "question": "Which effect shows that unattended speech can still be processed for meaning?",
      "options": [
        { "text": "The Stroop effect", "correct": false },
        { "text": "The cocktail-party effect", "correct": true },
        { "text": "Change blindness", "correct": false }
      ],
      "explanation": "Hearing your own name in an unattended conversation means it was analysed for meaning.",
      "source": "slide 14"
    },
    {
      "type": "multiple",
      "question": "Which of these are limits on attention named in the lecture? (Select all that apply.)",
      "options": [
        { "text": "Inattentional blindness", "correct": true },
        { "text": "The attentional blink", "correct": true },
        { "text": "Iconic memory", "correct": false },
        { "text": "All of the above", "correct": false }
      ],
      "explanation": "Iconic memory is a sensory store, not a limit of attention.",
      "source": "slides 20-24"
    }
  ]
}
```

## Question types

| `type` | Shape | Right when |
|---|---|---|
| `true-false` | `"answer": true` or `false` (no quotes) | the student picks that value |
| `single` | 2–8 `options`, exactly one `"correct": true` | they pick that option |
| `multiple` | 2–8 `options`, one or more `"correct": true` | they tick exactly the right options, no more and no fewer |

"All of the above" and "None of the above" are ordinary options: put them **last** (the app shuffles the other options and keeps these at the end) and mark them `correct` when they are.

Every question should have an `explanation` (why the answer is right, shown after answering) and a `source` (the file and slide or page it comes from).

## Scoring

- 10 points per right answer, plus 20 for a perfect score. Points add up over every attempt.
- Each quiz shows the student's best score; a perfect best score marks it **mastered**.
- The streak counts the days in a row with at least one finished quiz.

## Check a quiz

```bash
node packages/ai/validate.mjs semesters/<semester>/quizzes/<CODE>/<name>.json
node packages/ai/validate.mjs --all     # every note, prep pack and quiz
```
