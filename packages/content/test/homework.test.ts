// Interactive homework: checking the tasks file the AI writes, saving answers, and the done/left counts.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyAnswer, checkCounts, homeworkProgress, parseAnswers, parseCheck, parseHomework, taskLabel } from "../src/homework.ts";
import { allAnswers, allChecks, allPolish, discardPolish, homeworkDir, polishFile, readAnswers, readHomework, readPolish, saveAnswer, saveImage } from "../src/homework-store.ts";

const TASKS = {
  title: "Assignment 3",
  tasks: [
    { id: "1", kind: "written", title: "What makes it naive", question: "Explain the **naive** part." },
    { id: "2", kind: "choice", question: "Which assumption?", options: ["Independent features", "Equal classes"] },
    { id: "3", kind: "calculation", title: "Spam probability", question: "Work out $P(S \\mid O)$." },
  ],
};

test("a valid tasks file is read with every task", () => {
  const { homework, problems } = parseHomework(JSON.stringify(TASKS));
  assert.deepEqual(problems, []);
  assert.equal(homework?.tasks.length, 3);
  assert.deepEqual(homework?.tasks[1]!.options, ["Independent features", "Equal classes"]);
  assert.equal(homework?.tasks[2]!.question, "Work out $P(S \\mid O)$.");
});

test("broken tasks files say what to fix", () => {
  assert.match(parseHomework("{ nope").problems[0]!, /Not valid JSON/);
  const bad = (tasks: unknown[]) => parseHomework({ tasks }).problems.join(" | ");
  assert.match(parseHomework({}).problems.join(), /non-empty/);
  assert.match(bad([{ id: "1", kind: "essay", question: "Q" }]), /Task 1: "kind" must be/);
  assert.match(bad([{ id: "1", kind: "written" }]), /Task 1: needs "question"/);
  assert.match(bad([{ id: "1", kind: "choice", question: "Q", options: ["only one"] }]), /2 to 8/);
  assert.match(bad([{ id: "1", kind: "written", question: "Q" }, { id: "1", kind: "written", question: "R" }]), /Task 2: the id "1" is used twice/);
  assert.match(bad([{ id: "a/b", kind: "written", question: "Q" }]), /letters, digits/);
  assert.equal(parseHomework({ tasks: [{ id: "1", kind: "written" }] }).homework, null);
});

test("a task without a short title is called by its number", () => {
  const { homework } = parseHomework(TASKS);
  assert.equal(taskLabel(homework!.tasks[0]!, 0), "What makes it naive");
  assert.equal(taskLabel(homework!.tasks[1]!, 1), "Task 2");
});

test("done and left count only tasks marked done", () => {
  const { tasks } = parseHomework(TASKS).homework!;
  assert.deepEqual(homeworkProgress(tasks, {}), { done: 0, total: 3, left: 3 });
  assert.deepEqual(homeworkProgress(tasks, { 1: { text: "draft" }, 2: { choice: 0, done: true }, gone: { done: true } }), { done: 1, total: 3, left: 2 });
});

test("an answer is merged into the saved ones and checked", () => {
  const { tasks } = parseHomework(TASKS).homework!;
  const now = new Date("2026-10-22T10:00:00Z");
  let a = applyAnswer(tasks, {}, { task: "1", text: "Words are independent." }, now);
  a = applyAnswer(tasks, a, { task: "1", done: true }, now);
  a = applyAnswer(tasks, a, { task: "2", choice: 1, why: "Because." }, now);
  assert.deepEqual(a, {
    1: { text: "Words are independent.", done: true, updated: now.toISOString() },
    2: { choice: 1, why: "Because.", updated: now.toISOString() },
  });
  assert.equal(applyAnswer(tasks, a, { task: "2", choice: null }, now)[2]!.choice, undefined);
  assert.throws(() => applyAnswer(tasks, a, { task: "9", text: "x" }, now), /No such task/);
  assert.throws(() => applyAnswer(tasks, a, { task: "2", choice: 5 }, now), /Bad choice/);
  assert.throws(() => applyAnswer(tasks, a, { task: "1", choice: 0 }, now), /Bad choice/);
  assert.throws(() => applyAnswer(tasks, a, { task: "1", text: "x".repeat(200_001) }, now), /too long/);
});

function semester() {
  const dir = mkdtempSync(join(tmpdir(), "ouc-hw-"));
  const hw = homeworkDir(dir, "AAA/10-26_Assignment-3");
  mkdirSync(hw, { recursive: true });
  writeFileSync(join(hw, "tasks.json"), JSON.stringify(TASKS));
  return dir;
}

test("answers are saved next to the tasks and read back for the whole semester", () => {
  const dir = semester();
  assert.equal(readHomework(dir, "AAA/10-26_Assignment-3")?.homework?.tasks.length, 3);
  assert.deepEqual(readAnswers(dir, "AAA/10-26_Assignment-3"), {});
  const saved = saveAnswer(dir, { assignment: "AAA/10-26_Assignment-3", task: "3", text: "0.8", done: true }, new Date("2026-10-22T10:00:00Z"));
  assert.equal(saved[3]!.text, "0.8");
  const file = JSON.parse(readFileSync(join(homeworkDir(dir, "AAA/10-26_Assignment-3"), "answers.json"), "utf8"));
  assert.equal(file.answers[3].done, true);
  assert.deepEqual(Object.keys(allAnswers(dir)), ["AAA/10-26_Assignment-3"]);
});

test("answers can't be saved outside an assignment with tasks", () => {
  const dir = semester();
  assert.throws(() => saveAnswer(dir, { assignment: "../../x", task: "1", text: "x" }), /Bad assignment/);
  assert.throws(() => saveAnswer(dir, { assignment: "AAA/..", task: "1", text: "x" }), /Bad assignment/);
  assert.throws(() => saveAnswer(dir, { assignment: "AAA/missing", task: "1", text: "x" }), /no interactive version/);
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("made-up picture")]);

test("a picture in an answer is saved in the homework's images folder, named by its content", () => {
  const dir = semester();
  const name = saveImage(dir, "AAA/10-26_Assignment-3", PNG);
  assert.match(name, /^images\/[0-9a-f]{16}\.png$/);
  assert.ok(existsSync(join(homeworkDir(dir, "AAA/10-26_Assignment-3"), name)));
  assert.equal(saveImage(dir, "AAA/10-26_Assignment-3", PNG), name, "the same picture twice is one file");
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("x")]);
  assert.match(saveImage(dir, "AAA/10-26_Assignment-3", jpg), /\.jpg$/);
});

test("only pictures of a sensible size are saved", () => {
  const dir = semester();
  assert.throws(() => saveImage(dir, "AAA/10-26_Assignment-3", Buffer.from("<svg onload=alert(1)>")), /PNG, JPEG, GIF or WebP/);
  assert.throws(() => saveImage(dir, "AAA/10-26_Assignment-3", Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)])), /too big/);
  assert.throws(() => saveImage(dir, "AAA/missing", PNG), /no interactive version/);
});

test("an AI check gives each task a verdict and a note, and says what's wrong with the file", () => {
  const tasks = parseHomework(TASKS).homework!.tasks;
  const good = {
    summary: "Mostly there.",
    tasks: {
      "1": { verdict: "right", note: "Clear." },
      "2": { verdict: "wrong", note: "Look again at `week 3`." },
      "3": { verdict: "better", note: "Right, but show the steps." },
    },
  };
  const ok = parseCheck(JSON.stringify(good), tasks);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.check!.summary, "Mostly there.");
  assert.equal(ok.check!.tasks["2"]!.verdict, "wrong");
  assert.equal(checkCounts(tasks, ok.check!).right, 1);
  assert.deepEqual(checkCounts(tasks, ok.check!), { right: 1, better: 1, wrong: 1, empty: 0 });

  const bad = parseCheck({ tasks: { "1": { verdict: "perfect", note: "x" }, "2": { verdict: "right" }, "9": { verdict: "right", note: "?" } } }, tasks);
  assert.ok(bad.problems.some((p) => /Task 1.*verdict/.test(p)));
  assert.ok(bad.problems.some((p) => /Task 2.*note/.test(p)));
  assert.ok(bad.problems.some((p) => /"9".*no such task/i.test(p)));
  assert.ok(bad.problems.some((p) => /Task 3.*missing/i.test(p)));
  assert.equal(Object.keys(bad.check!.tasks).length, 0);
  assert.match(parseCheck("{", tasks).problems[0]!, /Not valid JSON/);
  assert.equal(parseCheck("{", tasks).check, null);
});

test("the checks are read with the time they were made", () => {
  const sem = mkdtempSync(join(tmpdir(), "ouc-hw-"));
  const dir = homeworkDir(sem, "DEMO101/09-28_A1");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "tasks.json"), JSON.stringify(TASKS));
  assert.deepEqual(allChecks(sem), {});
  writeFileSync(join(dir, "check.json"), JSON.stringify({ tasks: { "1": { verdict: "right", note: "Good." } } }));
  const all = allChecks(sem);
  assert.equal(all["DEMO101/09-28_A1"]!.tasks["1"]!.verdict, "right");
  assert.match(all["DEMO101/09-28_A1"]!.checked!, /^\d{4}-\d\d-\d\dT/);
});

test("an answers file the AI fills in from a submission is checked against the tasks", () => {
  const tasks = parseHomework(TASKS).homework!.tasks;
  const ok = { answers: { "1": { text: "<p>It assumes <b>independence</b>.</p>", done: true }, "2": { choice: 0, why: "<p>As in week 3.</p>", done: true } } };
  assert.deepEqual(parseAnswers(JSON.stringify(ok), tasks).problems, []);
  assert.equal(parseAnswers(ok, tasks).answers["2"]!.choice, 0);
  const bad = parseAnswers({ answers: { "1": { text: 5 }, "2": { choice: 7 }, "9": { text: "x" } } }, tasks).problems;
  assert.ok(bad.some((p) => /"1".*text/i.test(p)), bad.join("|"));
  assert.ok(bad.some((p) => /"2".*choice/i.test(p)), bad.join("|"));
  assert.ok(bad.some((p) => /"9".*no such task/i.test(p)), bad.join("|"));
  assert.match(parseAnswers("[]", tasks).problems[0]!, /"answers"/);
});

test("an answer whose wording the AI made more academic is marked so, and the mark stays", () => {
  const tasks = parseHomework(TASKS).homework!.tasks;
  let a = applyAnswer(tasks, {}, { task: "1", text: "<p>My answer, put better.</p>", aiEdited: true });
  assert.equal(a[1]!.aiEdited, true);
  a = applyAnswer(tasks, a, { task: "1", text: "<p>My answer, put better, and more.</p>" });
  assert.equal(a[1]!.aiEdited, true);
  assert.throws(() => applyAnswer(tasks, a, { task: "1", aiEdited: "yes" }), /aiEdited/);
});

test("the AI's academic wording of an answer is read per task, for the whole semester, and can be dropped", () => {
  const dir = semester();
  const id = "AAA/10-26_Assignment-3";
  assert.deepEqual(readPolish(dir, id), {});
  const f = polishFile(dir, id, "1");
  assert.match(f, /homework[\\/]polish[\\/]1\.html$/);
  mkdirSync(join(homeworkDir(dir, id), "polish"), { recursive: true });
  writeFileSync(f, "<p>Better put.</p>\n");
  writeFileSync(join(homeworkDir(dir, id), "polish", "9.html"), "<p>No such task.</p>");
  const p = readPolish(dir, id);
  assert.deepEqual(Object.keys(p), ["1"]);
  assert.equal(p[1]!.text, "<p>Better put.</p>");
  assert.match(p[1]!.made, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(Object.keys(allPolish(dir)), [id]);
  discardPolish(dir, id, "1");
  assert.ok(!existsSync(f));
  assert.deepEqual(readPolish(dir, id), {});
  assert.throws(() => polishFile(dir, id, "../x"), /Bad task/);
});
