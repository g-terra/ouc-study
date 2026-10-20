# Quiz format

Quizzes live in `semesters/<semester>/quizzes/<COURSE CODE>/<name>.json`. The app plays them under **Quizzes** and keeps the scores in `semesters/<semester>/quizzes/attempts.json` (on this computer only, never committed).
An AI makes them with the `make-quiz` skill. The course material (the downloaded files, their text copies and the student's notes) decides the **topics**; the questions can go wider than the material (examples, scenarios, related ideas from the same field) as long as they are accurate.

- A **lecture quiz** covers one eClass section (one week or lecture): `"scope": "lecture"` and its `"section"` index. Name it like the note for that week, e.g. `lecture-03-attention.json`.
- A **course quiz** covers the whole course so far: `"scope": "course"`, no section. Name it `course-<short-name>.json`.
- A **custom quiz** is on topics the student wrote in the app (from the course material only, or the web too): `"scope": "course"`, with the topics in `"description"`. The app names the file after the quiz's name.

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
      "explanation": "Broadbent's filter model says the brain first registers only physical features of every message (pitch, loudness, location) and lets one message through to be analysed for meaning. So the filter sits early, before meaning. Late-selection theories put it after meaning has been analysed, which is why hearing your own name in another conversation was a problem for Broadbent's model.",
      "source": "Early vs late selection"
    },
    {
      "type": "single",
      "question": "Which effect shows that unattended speech can still be processed for meaning?",
      "options": [
        { "text": "The Stroop effect", "correct": false },
        { "text": "The cocktail-party effect", "correct": true },
        { "text": "Change blindness", "correct": false }
      ],
      "explanation": "At a noisy party you follow one conversation, yet you notice your name in another one. That means the ignored speech was still processed far enough to recognise its meaning. The Stroop effect is about reading interfering with naming a colour, and change blindness is failing to see a change in a scene, so neither shows meaning being picked up from an unattended message.",
      "source": "Cocktail-party effect"
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
      "explanation": "Inattentional blindness (missing the gorilla while counting passes) and the attentional blink (missing a second target shortly after a first) both show what we fail to notice because attention is limited. Iconic memory is a very brief visual sensory store that holds the whole scene for a fraction of a second, so it is not a limit of attention. Since one option is wrong, \"All of the above\" is wrong too.",
      "source": "Limits of attention"
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

Every question needs a full `explanation`, shown after answering. It teaches on its own: why the right answer is right and why the tempting wrong ones are wrong, usually 3 to 5 sentences. Don't point to the material instead ("see slide 9", "as the lecture says"). `source` is optional: a short topic label, not a file path.

## Scoring

- 10 points per right answer, plus 20 for a perfect score. Points add up over every attempt.
- Each quiz shows the student's best score; a perfect best score marks it **mastered**.
- The streak counts the days in a row with at least one finished quiz.

## Check a quiz

```bash
node packages/ai/validate.mjs semesters/<semester>/quizzes/<CODE>/<name>.json
node packages/ai/validate.mjs --all     # every note, prep pack and quiz
```
