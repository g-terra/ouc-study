# Homework format

An assignment's **interactive version** lives next to it, in `semesters/<semester>/assignments/<COURSE CODE>/<folder>/homework/` (on this computer only, never committed). The app shows it as tasks you answer one by one, with a timeline and a done/left counter.

- `tasks.json`: the brief turned into tasks, written by an AI. The questions are the brief's own, in the brief's order; **the file never holds answers**.
- `answers.json`: the student's answers, written by the app as they type (`/api/homework`).
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
| `kind` | yes | `written` (an explanation or essay), `calculation` (working and a result) or `choice` (pick one option). |
| `question` | yes | The task as the brief asks it, in Markdown. Maths in LaTeX: `$…$` inline, `$$…$$` on its own line. Tables and lists are fine. |
| `title` | no | A few words for the timeline. Without it the task is called "Task N". |
| `options` | `choice` only | 2 to 8 option texts, in the brief's order. Nothing marks the right one. |
| `title` (top) | no | The assignment's name as the brief gives it. |

A file with problems isn't used: the app shows what to fix on the homework page.

## answers.json

```json
{ "answers": { "2": { "choice": 0, "why": "Optional reason for the pick.", "done": true, "updated": "2026-10-22T21:40:00.000Z" } } }
```

`text` is the written answer and `why` the optional reason for a picked option, both HTML from the app's editor (paragraphs, bold, italic, underline, colours, highlight, lists, `<code>` and `<pre><code>` blocks; a formula is `<span data-latex="\frac{1}{2}"></span>`; a picture is `<img src="/files/<semester>/assignments/<CODE>/<folder>/homework/images/<hash>.png">`, saved in the `images/` folder next to the answers). Older answers in plain text are still read. `choice` is the index of the picked option, `done` is set when the student marks the task done.
