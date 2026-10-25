# Homework format

An assignment's **interactive version** lives next to it, in `semesters/<semester>/assignments/<COURSE CODE>/<folder>/homework/` (on this computer only, never committed). The app shows it as tasks you answer one by one, with a timeline and a done/left counter.

- `tasks.json`: the brief turned into tasks, written by an AI with the `make-homework` skill. The questions are the brief's own, in the brief's order; **the file never holds answers**. The app makes it in the background for every new assignment (not submitted yet) that has a brief or a task on eClass, after each sync (add `"autoHomework": false` to `.ouc/ai.json` to turn that off), and **Make it interactive** on an assignment's page makes one on request.
- `answers.json`: the student's answers, written by the app as they type (`/api/homework`). For an assignment already submitted, the AI makes the tasks from the student's submission (`my-submission/`) and copies their answers into this file exactly as they wrote them, marked done.
- `polish/<task id>.html`: the AI's more academic wording of one answer (**Make it more academic** under the answer, the `polish-answer` skill), the same ideas in the student's voice. The app shows it next to the answer: **Use this wording** replaces the answer and tags it `"aiEdited": true` (shown as "AI-edited wording"), **Keep mine** drops it.
- `check.json`: the AI's check of the answers (**Check my answers**, or the `check-homework` skill): a verdict and a note per task. See [check.json](#checkjson).
- **Make PDF** prints the tasks and answers to `my-submission/<title> - <name>.pdf` (the print page is `/print/homework/<semester>/<CODE>/<folder>?name=…`).

## tasks.json

```json
{
  "title": "Assignment 3",
  "tasks": [
    { "id": "1", "kind": "written", "title": "What makes it naive", "question": "In your own words, explain what the **naive** part of Naive Bayes means." },
    { "id": "2", "kind": "choice", "title": "The key assumption", "question": "Which assumption makes Naive Bayes naive?",
      "options": ["Features are independent once the class is known", "Every class is equally likely"] },
    { "id": "3a", "kind": "calculation", "title": "Spam probability", "question": "Work out $P(S \\mid O)$ from the table and show your working." }
  ]
}
```

| Field | Required | What it is |
|---|---|---|
| `tasks` | yes | The tasks in the brief's order, at least one. |
| `id` | yes | Unique in the file: letters, digits, dots and dashes (`"1"`, `"2b"`). Answers are saved under it, so keep it when the file is redone. |
| `kind` | yes | `written` (an explanation or essay), `calculation` (working and a result) or `choice` (pick from options). |
| `question` | yes | The task as the brief asks it, in Markdown. Maths in LaTeX: `$…$` inline, `$$…$$` on its own line. Tables and lists are fine. |
| `title` | no | A few words for the timeline. Without it the task is called "Task N". |
| `options` | `choice` only | 2 to 8 option texts, in the brief's order. Nothing marks the right one. |
| `multiple` | `choice` only | `true` when more than one option can be right (the brief says "more than one answer", "select all that apply"…): the student ticks several. A question that says so in its wording counts as `multiple` unless it says `"multiple": false`. The student can change a task's type in the app (**Wrong type? Change it**), which rewrites these fields. |
| `title` (top) | no | The assignment's name as the brief gives it. |

A file with problems isn't used: the app shows what to fix on the homework page.

## answers.json

```json
{ "answers": { "2": { "choice": 0, "why": "Optional reason for the pick.", "done": true, "updated": "2026-10-22T21:40:00.000Z" } } }
```

`text` is the written answer and `why` the optional reason for a picked option, both HTML from the app's editor (paragraphs, bold, italic, underline, colours, highlight, lists, `<code>` and `<pre><code>` blocks; a formula is `<span data-latex="\frac{1}{2}"></span>`; a picture is `<img src="/files/<semester>/assignments/<CODE>/<folder>/homework/images/<hash>.png">`, saved in the `images/` folder next to the answers). Older answers in plain text are still read. `choice` is the index of the picked option; for a `multiple` task, `choices` is the list of picked indexes (`[0, 2]`), and an older `choice` there counts as one pick. `done` is set when the student marks the task done. `aiEdited` is set once the student keeps the AI's more academic wording of the answer.

## check.json

Written by the AI when the student presses **Check my answers** (it runs in the background, no chat; `/api/ai/homework-check`). Check it with `node packages/ai/validate.mjs <path>/homework/check.json`, which reads the `tasks.json` next to it.

```json
{
  "summary": "Good start: task 3 needs another look.",
  "tasks": {
    "1": { "verdict": "right", "note": "Clear, and uses the course's definition." },
    "2": { "verdict": "better", "note": "Right; one sentence on *why* would make it stronger." },
    "3": { "verdict": "wrong", "note": "Not quite: put both fractions over the same denominator first (`semesters/<semester>/text/DEMO101/week-02.pdf.txt`, slide 4)." }
  }
}
```

| Field | Required | What it is |
| --- | --- | --- |
| `tasks` | yes | Every task in `tasks.json`, by id. |
| `verdict` | yes | `right` (right, whatever the wording), `better` (right, with a clearly better way), `wrong` (not right: a hint and where to look, never the answer), `empty` (not answered yet). |
| `note` | yes | Why, in Markdown with `$LaTeX$`. File paths in backticks become links to the material. |
| `summary` | no | One or two sentences on the whole homework. |

The check is lenient: wording, notation and small slips that don't change the result never make an answer wrong. The app shows when it was made (the file's time) and says when answers changed after it.
