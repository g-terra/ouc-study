#!/usr/bin/env node
// Stands in for `claude -p … --output-format stream-json` in tests: prints a short canned run.
const args = process.argv.slice(2);
const prompt = args[args.indexOf("-p") + 1] ?? "";
const resume = args.includes("--resume") ? args[args.indexOf("--resume") + 1] : null;
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : null;
const out = (j) => console.log(JSON.stringify(j));
out({ type: "system", subtype: "init", session_id: resume ?? "sess-1" });
// a prep pack request: write the file it names, like a real agent would
const prep = prompt.match(/save the pack as (\S+PREP\.md)/)?.[1];
if (prep) (await import("node:fs")).writeFileSync(`${process.cwd()}/${prep}`, `# Prep\n\nHints for ${prep}\n`);
// a draft review: write the review it asks for
const review = prompt.match(/Save the review as `(\S+REVIEW-v\d+\.md)`/)?.[1];
if (review) (await import("node:fs")).writeFileSync(`${process.cwd()}/${review}`, "---\nverdict: almost\n---\n\n## Verdict\nNearly there.\n");
// a quiz: write the file it names (without "by", which the app adds)
const quiz = prompt.match(/Save it as (\S+\.json) /)?.[1];
if (quiz) {
  const fs = await import("node:fs");
  fs.mkdirSync(`${process.cwd()}/${quiz.split("/").slice(0, -1).join("/")}`, { recursive: true });
  fs.writeFileSync(`${process.cwd()}/${quiz}`, JSON.stringify({ title: "Quiz", course: "AAA", scope: "lecture", section: 1, questions: [{ type: "true-false", question: "Q?", answer: true }] }));
}
// a homework check: right for every task in the tasks.json next to it
const check = prompt.match(/Save the check as `(\S+check\.json)`/)?.[1];
if (check) {
  const fs = await import("node:fs");
  const { tasks } = JSON.parse(fs.readFileSync(`${process.cwd()}/${check.replace(/check\.json$/, "tasks.json")}`, "utf8"));
  fs.writeFileSync(`${process.cwd()}/${check}`, JSON.stringify({ summary: "All good.", tasks: Object.fromEntries(tasks.map((t) => [t.id, { verdict: "right", note: "Right." }])) }));
}
// an interactive version: one task
const tasksFile = prompt.match(/Save the tasks as `(\S+tasks\.json)`/)?.[1];
if (tasksFile) {
  const fs = await import("node:fs");
  fs.mkdirSync(`${process.cwd()}/${tasksFile.replace(/\/tasks\.json$/, "")}`, { recursive: true });
  fs.writeFileSync(`${process.cwd()}/${tasksFile}`, JSON.stringify({ tasks: [{ id: "1", kind: "written", question: "Q?" }] }));
}
// a more academic wording of one answer
const polish = prompt.match(/Save the new wording as `(\S+\.html)`/)?.[1];
if (polish) {
  const fs = await import("node:fs");
  fs.mkdirSync(`${process.cwd()}/${polish.split("/").slice(0, -1).join("/")}`, { recursive: true });
  fs.writeFileSync(`${process.cwd()}/${polish}`, "<p>Put more academically.</p>\n");
}
// a run that strays into the app's code (the guard must undo it) next to a note it may write
if (prompt.includes("TOUCH_CODE")) {
  const fs = await import("node:fs");
  fs.writeFileSync(`${process.cwd()}/app.ts`, "export const x = 2;\n");
  fs.mkdirSync(`${process.cwd()}/tools`, { recursive: true });
  fs.writeFileSync(`${process.cwd()}/tools/new.py`, "print(1)\n");
  fs.mkdirSync(`${process.cwd()}/semesters/2026-Fall/notes/AAA`, { recursive: true });
  fs.writeFileSync(`${process.cwd()}/semesters/2026-Fall/notes/AAA/week-01.md`, "# Week 1\n");
}
if (prompt.includes("FAIL")) { console.error("boom: something broke"); process.exit(3); }
out({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: `${process.cwd()}/memory/progress.md` } }] } });
out({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: `${process.cwd()}/semesters/2026-Fall/plans/2026-W42.md`, content: "x" } }] } });
out({ type: "assistant", message: { content: [{ type: "text", text: `${resume ? "Second turn." : "Plan saved."}${model ? ` [${model}]` : ""}` }] } });
out({ type: "result", subtype: "success", is_error: false, result: "Plan saved.", session_id: resume ?? "sess-1" });
