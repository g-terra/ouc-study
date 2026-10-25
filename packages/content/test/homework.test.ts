// Interactive homework: checking the tasks file the AI writes, saving answers, and the done/left counts.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyAnswer, checkCounts, mergeCheck, tasksToCheck, homeworkProgress, parseAnswers, parseCheck, parseHomework, pickedOptions, retypeTask, taskLabel } from "../src/homework.ts";
import { allAnswers, allChecks, allPolish, discardPolish, homeworkDir, saveTaskType, polishFile, readAnswers, readHomework, readPolish, saveAnswer, saveImage } from "../src/homework-store.ts";

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

test("a choice task that takes more than one answer says so, from the file or from its question", () => {
  const { homework, problems } = parseHomework({ tasks: [
    { id: "1", kind: "choice", question: "Pick the true ones.", options: ["A", "B", "C"], multiple: true },
    { id: "2", kind: "choice", question: "Rall argued that (there can be more than one answer):", options: ["A", "B"] },
    { id: "3", kind: "choice", question: "Select all that apply.", options: ["A", "B"] },
    { id: "4", kind: "choice", question: "Which one?", options: ["A", "B"] },
    { id: "5", kind: "written", question: "Name more than one answer you'd accept." },
  ] });
  assert.deepEqual(problems, []);
  assert.deepEqual(homework!.tasks.map((t) => t.multiple ?? false), [true, true, true, false, false]);
});

test("a task with more than one answer saves the picked options, in order", () => {
  const { tasks } = parseHomework({ tasks: [
    { id: "m", kind: "choice", question: "Q", options: ["A", "B", "C"], multiple: true },
    { id: "s", kind: "choice", question: "Q", options: ["A", "B"] },
  ] }).homework!;
  const now = new Date("2026-10-25T10:00:00Z");
  let a = applyAnswer(tasks, { m: { choice: 1 } }, { task: "m", choices: [2, 0, 2] }, now);
  assert.deepEqual(a.m, { choices: [0, 2], updated: now.toISOString() });
  a = applyAnswer(tasks, a, { task: "m", choices: [] }, now);
  assert.deepEqual(a.m, { choices: [], updated: now.toISOString() });
  assert.equal(applyAnswer(tasks, a, { task: "m", choices: null }, now).m!.choices, undefined);
  assert.throws(() => applyAnswer(tasks, a, { task: "m", choices: [3] }, now), /Bad choice/);
  assert.throws(() => applyAnswer(tasks, a, { task: "m", choices: 1 }, now), /Bad choice/);
  assert.throws(() => applyAnswer(tasks, a, { task: "s", choices: [0, 1] }, now), /only one/);
  assert.equal(parseAnswers({ answers: { m: { choices: [1, 2] } } }, tasks).answers.m!.choices!.join(), "1,2");
});

test("the options picked are read the same way for one or more answers", () => {
  const { tasks } = parseHomework({ tasks: [
    { id: "m", kind: "choice", question: "Q", options: ["A", "B", "C"], multiple: true },
    { id: "s", kind: "choice", question: "Q", options: ["A", "B"] },
  ] }).homework!;
  assert.deepEqual(pickedOptions(tasks[0]!, { choices: [0, 2] }), [0, 2]);
  assert.deepEqual(pickedOptions(tasks[0]!, { choice: 1 }), [1]); // picked before the task took more than one
  assert.deepEqual(pickedOptions(tasks[1]!, { choice: 1 }), [1]);
  assert.deepEqual(pickedOptions(tasks[1]!, {}), []);
});

test("a task's type can be changed, keeping everything else in the file", () => {
  const raw = { title: "A3", extra: 1, tasks: [
    { id: "1", kind: "written", question: "Pick one: (a) x (b) y", note: "kept" },
    { id: "2", kind: "choice", question: "Which ones? (there can be more than one answer)", options: ["A", "B"] },
  ] };
  const one = retypeTask(raw, { task: "1", type: "choice", options: [" x ", "y", ""] });
  assert.deepEqual(one.tasks[0], { id: "1", kind: "choice", question: "Pick one: (a) x (b) y", note: "kept", options: ["x", "y"], multiple: false });
  assert.equal(one.extra, 1);
  assert.equal(raw.tasks[0]!.kind, "written"); // the old object is left alone
  // a question that says "more than one answer" can still be made single choice
  const single = retypeTask(raw, { task: "2", type: "choice" });
  assert.equal(parseHomework(single).homework!.tasks[1]!.multiple, undefined);
  assert.equal(parseHomework(retypeTask(raw, { task: "2", type: "multiple" })).homework!.tasks[1]!.multiple, true);
  const written = retypeTask(raw, { task: "2", type: "calculation" });
  assert.deepEqual(written.tasks[1], { id: "2", kind: "calculation", question: "Which ones? (there can be more than one answer)" });
  assert.throws(() => retypeTask(raw, { task: "1", type: "choice" }), /2 to 8/);
  assert.throws(() => retypeTask(raw, { task: "9", type: "written" }), /No such task/);
  assert.throws(() => retypeTask(raw, { task: "1", type: "essay" }), /Bad type/);
});

test("changing a task's type is saved in tasks.json, and answers stay", () => {
  const dir = semester();
  saveAnswer(dir, { assignment: "AAA/10-26_Assignment-3", task: "1", text: "kept" });
  const hw = saveTaskType(dir, { assignment: "AAA/10-26_Assignment-3", task: "1", type: "multiple", options: ["A", "B", "C"] });
  assert.equal(hw.tasks[0]!.kind, "choice");
  assert.equal(hw.tasks[0]!.multiple, true);
  assert.deepEqual(readHomework(dir, "AAA/10-26_Assignment-3")!.homework!.tasks[0]!.options, ["A", "B", "C"]);
  assert.equal(readAnswers(dir, "AAA/10-26_Assignment-3")["1"]!.text, "kept");
  assert.throws(() => saveTaskType(dir, { assignment: "AAA/nope", task: "1", type: "written" }), /no interactive version/);
});

const TF = { tasks: [
  { id: "5", kind: "truefalse", title: "Rall model", question: "True or False:", statements: ["Compartment 1 has zero delay.", "Compartment 5 is broader than compartment 7."] },
  { id: "6", kind: "written", question: "Q" },
] };

test("a true-or-false task is one question with its statements", () => {
  const { homework, problems } = parseHomework(TF);
  assert.deepEqual(problems, []);
  assert.deepEqual(homework!.tasks[0]!.statements, ["Compartment 1 has zero delay.", "Compartment 5 is broader than compartment 7."]);
  assert.match(parseHomework({ tasks: [{ id: "1", kind: "truefalse", question: "Q", statements: [] }] }).problems.join(), /"statements" must be a list of 1 to 20/);
});

test("each statement of a true-or-false task gets true or false and an optional explanation", () => {
  const { tasks } = parseHomework(TF).homework!;
  const now = new Date("2026-10-25T10:00:00Z");
  let a = applyAnswer(tasks, {}, { task: "5", tf: { 1: { value: false } } }, now);
  a = applyAnswer(tasks, a, { task: "5", tf: { 1: { why: "<p>Further away is broader.</p>" }, 0: { value: true } } }, now);
  assert.deepEqual(a["5"]!.tf, { 0: { value: true }, 1: { value: false, why: "<p>Further away is broader.</p>" } });
  a = applyAnswer(tasks, a, { task: "5", tf: { 0: { value: null } } }, now);
  assert.deepEqual(a["5"]!.tf![0], {});
  assert.throws(() => applyAnswer(tasks, a, { task: "5", tf: { 2: { value: true } } }, now), /Bad statement/);
  assert.throws(() => applyAnswer(tasks, a, { task: "5", tf: { 0: { value: "yes" } } }, now), /true or false/);
  assert.throws(() => applyAnswer(tasks, a, { task: "6", tf: { 0: { value: true } } }, now), /Bad statement/);
  assert.deepEqual(parseAnswers({ answers: { 5: { tf: { 0: { value: true, why: "x" } }, done: true } } }, tasks).answers["5"]!.tf, { 0: { value: true, why: "x" } });
});

test("a task can be changed to true or false, with one statement per line", () => {
  const raw = { tasks: [{ id: "1", kind: "choice", question: "True or False:", options: ["True", "False"] }] };
  const next = retypeTask(raw, { task: "1", type: "truefalse", statements: ["First.", " Second. ", ""] });
  assert.deepEqual(next.tasks[0], { id: "1", kind: "truefalse", question: "True or False:", statements: ["First.", "Second."] });
  assert.throws(() => retypeTask(raw, { task: "1", type: "truefalse" }), /statement/);
  assert.equal(retypeTask(next, { task: "1", type: "written" }).tasks[0].statements, undefined);
});

test("a check looks again only at new answers, changed ones and ones that weren't right", () => {
  const tasks = parseHomework({ tasks: ["1", "2", "3", "4", "5"].map((id) => ({ id, kind: "written", question: "Q" })) }).homework!.tasks;
  const answers = { 1: { text: "a", updated: "T1" }, 2: { text: "b", updated: "T2-new" }, 3: { text: "c", updated: "T3" }, 4: { text: "d", updated: "T4" } };
  const check = { tasks: {
    1: { verdict: "right" as const, note: "Right.", answered: "T1" },       // right, unchanged: skipped
    2: { verdict: "better" as const, note: "Ok.", answered: "T2" },         // changed since
    3: { verdict: "wrong" as const, note: "No.", answered: "T3" },          // wasn't right
  } };
  assert.deepEqual(tasksToCheck(tasks, answers, check), ["2", "3", "4", "5"]);
  assert.deepEqual(tasksToCheck(tasks, answers, undefined), ["1", "2", "3", "4", "5"]);
  // an older check with no "answered": an answer saved after the check counts as changed
  const old = { checked: "2026-10-25T10:00:00.000Z", tasks: { 1: { verdict: "right" as const, note: "R" }, 2: { verdict: "right" as const, note: "R" } } };
  assert.deepEqual(tasksToCheck(tasks.slice(0, 2), { 1: { updated: "2026-10-25T09:00:00.000Z" }, 2: { updated: "2026-10-25T11:00:00.000Z" } }, old), ["2"]);
});

test("a new check keeps the entries it skipped and notes which answer it checked", () => {
  const prev = { summary: "Old.", tasks: { 1: { verdict: "right" as const, note: "Kept.", answered: "T1" }, 2: { verdict: "wrong" as const, note: "No." } } };
  const next = { summary: "New.", tasks: { 1: { verdict: "wrong" as const, note: "Changed by mistake." }, 2: { verdict: "right" as const, note: "Now right." } } };
  assert.deepEqual(mergeCheck(prev, next, ["2"], { 2: { updated: "T2" } }), {
    summary: "New.",
    tasks: { 1: { verdict: "right", note: "Kept.", answered: "T1" }, 2: { verdict: "right", note: "Now right.", answered: "T2" } },
  });
});

test("a check file keeps which answer each verdict was for", () => {
  const { tasks } = parseHomework(TASKS).homework!;
  const { check } = parseCheck({ tasks: { 1: { verdict: "right", note: "R", answered: "2026-10-25T10:00:00.000Z" }, 2: { verdict: "empty", note: "E" }, 3: { verdict: "right", note: "R", answered: 5 } } }, tasks);
  assert.equal(check!.tasks["1"]!.answered, "2026-10-25T10:00:00.000Z");
  assert.equal(check!.tasks["3"]!.answered, undefined);
});
