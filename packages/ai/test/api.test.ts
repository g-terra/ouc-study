// The /api/ai endpoints end to end, with a fake agent binary instead of a real AI.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAiApi, needsPrep, readPrepMeta, stampQuiz } from "../src/api.ts";
import { setServerModels } from "../src/providers.ts";
import { json, portOf, type Ev } from "./helpers.ts";
import type { Server } from "node:http";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");

function setup(): Promise<{ root: string; server: Server; base: string }> {
  const root = mkdtempSync(join(tmpdir(), "ouc-ai-"));
  cpSync(join(REPO, "ai/skills"), join(root, "ai/skills"), { recursive: true });
  mkdirSync(join(root, ".ouc"));
  writeFileSync(join(root, ".ouc/ai.json"), JSON.stringify({ tool: "claude" }));
  const mw = createAiApi(root, { bin: join(HERE, "fixtures/fake-agent.mjs") });
  const server = http.createServer((req, res) => mw(req, res, () => { res.statusCode = 404; res.end(); }));
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ root, server, base: `http://127.0.0.1:${portOf(server)}` })));
}
async function sse(res: Response): Promise<Ev[]> {
  const events: Ev[] = [];
  const text = await res.text();
  for (const block of text.split("\n\n")) if (block.startsWith("data: ")) events.push(JSON.parse(block.slice(6)));
  return events;
}

test("actions, guard, run and follow-up", async (t) => {
  const { root, server, base } = await setup();
  t.after(() => server.close());

  const { actions } = await json(fetch(`${base}/api/ai/actions`));
  assert.ok(actions.some((a: Ev) => a.id === "plan-week" && a.title === "Plan my week"));

  // without the token, or from another website, nothing runs
  assert.equal((await fetch(`${base}/api/ai/run`, { method: "POST", body: "{}" })).status, 403);
  const { token } = await json(fetch(`${base}/api/ai/status`));
  const post = (path: string, body: object, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-OUC-AI": token, ...headers }, body: JSON.stringify(body) });
  assert.equal((await post("/api/ai/run", { action: "plan-week" }, { Origin: "https://evil.example" })).status, 403);

  // the panel can only pick a tool that exists here
  assert.equal((await post("/api/ai/run", { tool: "gpt-9", message: "hi" })).status, 400);
  assert.equal((await post("/api/ai/run", { tool: "local", message: "hi" })).status, 400); // no local model set up
  assert.match((await json(post("/api/ai/run", { tool: "opencode", message: "hi" }))).error, /ouc ai setup/);

  // missing input is a readable 400
  const bad = await post("/api/ai/run", { action: "research-topic" });
  assert.equal(bad.status, 400);
  assert.match((await json(bad)).error, /topic/i);

  const ev = await sse(await post("/api/ai/run", { action: "plan-week" }));
  const chatId = ev.find((e) => e.type === "chat")?.id;
  assert.deepEqual(ev.filter((e) => e.type === "tool").map((e) => e.label), ["Reading progress.md", "Writing 2026-W42.md"]);
  assert.deepEqual(ev.filter((e) => e.type === "file").map((e) => e.path), ["semesters/2026-Fall/plans/2026-W42.md"]);
  assert.equal(ev.at(-1)?.type, "done");
  assert.equal(ev.at(-1)?.ok, true);

  const ev2 = await sse(await post("/api/ai/run", { chatId, message: "thanks, and next week?" }));
  assert.equal(ev2.filter((e) => e.type === "text").map((e) => e.text).join(""), "Second turn.");

  const chat = await json(fetch(`${base}/api/ai/chats/${chatId}`));
  assert.equal(chat.sessionId, "sess-1");
  assert.equal(chat.messages.length, 4);
  assert.equal(chat.messages[1].text, "Plan saved.");
  assert.match(chat.messages[0].prompt, /plan-week skill/);
  assert.doesNotMatch(chat.messages[2].prompt, /OUC Study app/); // the preamble is only sent once

  const { chats } = await json(fetch(`${base}/api/ai/chats`));
  assert.equal(chats[0].id, chatId);

  // a model the panel offers is passed on; anything else is refused before the agent starts
  const { tools } = await json(fetch(`${base}/api/ai/status`));
  assert.deepEqual(tools.find((x: { id: string }) => x.id === "claude").models, ["sonnet", "opus", "haiku"]);
  const withModel = await sse(await post("/api/ai/run", { chatId, message: "again", model: "opus" }));
  assert.equal(withModel.filter((e) => e.type === "text").map((e) => e.text).join(""), "Second turn. [opus]");
  assert.equal((await post("/api/ai/run", { chatId, message: "again", model: "--dangerously-skip-permissions" })).status, 400);

  // Settings: each AI's default model, saved in .ouc/ai.json and used when a chat picks none
  assert.equal((await post("/api/ai/defaults", { tool: "claude", model: "haiku" }, { "X-OUC-AI": "nope" })).status, 403);
  assert.equal((await post("/api/ai/defaults", { tool: "claude", model: "--yolo" })).status, 400);
  assert.equal((await post("/api/ai/defaults", { tool: "gpt-9", model: "" })).status, 400);
  assert.equal((await json(post("/api/ai/defaults", { tool: "claude", model: "haiku" }))).setting, "haiku");
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".ouc/ai.json"), "utf8")).defaultModels, { claude: "haiku" });
  assert.equal((await json(fetch(`${base}/api/ai/status`))).tools.find((x: { id: string }) => x.id === "claude").model, "haiku");
  const byDefault = await sse(await post("/api/ai/run", { chatId, message: "again" }));
  assert.equal(byDefault.filter((e) => e.type === "text").map((e) => e.text).join(""), "Second turn. [haiku]");
  const picked = await sse(await post("/api/ai/run", { chatId, message: "again", model: "opus" }));   // a pick still wins
  assert.equal(picked.filter((e) => e.type === "text").map((e) => e.text).join(""), "Second turn. [opus]");
  await post("/api/ai/defaults", { tool: "claude", model: "" });   // back to Claude Code's own
  assert.equal(JSON.parse(readFileSync(join(root, ".ouc/ai.json"), "utf8")).defaultModels.claude, undefined);
  const own = await sse(await post("/api/ai/run", { chatId, message: "again" }));
  assert.equal(own.filter((e) => e.type === "text").map((e) => e.text).join(""), "Second turn.");

  // deleting: needs the app's token; one chat, then all of them
  const del = (path: string, t = token) => fetch(`${base}${path}`, { method: "DELETE", headers: { "X-OUC-AI": t } });
  assert.equal((await del(`/api/ai/chats/${chatId}`, "nope")).status, 403);
  assert.equal((await del("/api/ai/chats/not-a-chat")).status, 404);
  const other = (await sse(await post("/api/ai/run", { message: "another one" }))).find((e) => e.type === "chat")?.id;
  assert.deepEqual(await json(del(`/api/ai/chats/${chatId}`)), { deleted: 1, kept: 0 });
  assert.equal((await fetch(`${base}/api/ai/chats/${chatId}`)).status, 404);
  assert.deepEqual((await json(fetch(`${base}/api/ai/chats`))).chats.map((c: { id: string }) => c.id), [other]);
  assert.deepEqual(await json(del("/api/ai/chats")), { deleted: 1, kept: 0 });
  assert.deepEqual((await json(fetch(`${base}/api/ai/chats`))).chats, []);
});

test("opencode can use any model the local server has: it's added to opencode's config", async (t) => {
  const { root, server, base } = await setup();
  t.after(() => server.close());
  const opencode = { kind: "ollama", baseUrl: "http://127.0.0.1:9", model: "qwen3:8b" };
  writeFileSync(join(root, ".ouc/ai.json"), JSON.stringify({ tool: "opencode", opencode }));
  mkdirSync(join(root, ".opencode"));
  writeFileSync(join(root, ".opencode/opencode.json"), "{}");
  setServerModels("opencode", ["qwen3:8b", "gemma3:4b"]);   // what Ollama has (read with the status)
  const { token } = await json(fetch(`${base}/api/ai/status`));
  const post = (body: object) => fetch(`${base}/api/ai/run`, { method: "POST", headers: { "X-OUC-AI": token }, body: JSON.stringify(body) });
  assert.equal((await post({ message: "hi", model: "not-there" })).status, 400);
  await sse(await post({ message: "hi", model: "gemma3:4b" }));
  const oc = JSON.parse(readFileSync(join(root, ".opencode/opencode.json"), "utf8"));
  assert.deepEqual(Object.keys(oc.provider.ollama.models), ["qwen3:8b", "gemma3:4b"]);
  assert.equal(oc.model, "ollama/qwen3:8b");   // its own default stays
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".ouc/ai.json"), "utf8")).opencode.models, ["qwen3:8b", "gemma3:4b"]);
});

test("a failing agent reports its error", async (t) => {
  const { server, base } = await setup();
  t.after(() => server.close());
  const { token } = await json(fetch(`${base}/api/ai/status`));
  const res = await fetch(`${base}/api/ai/run`, { method: "POST", headers: { "X-OUC-AI": token }, body: JSON.stringify({ message: "please FAIL" }) });
  const ev = await sse(res);
  assert.match(ev.find((e) => e.type === "error")?.message, /boom/);
  assert.equal(ev.at(-1)?.ok, false);
});

test("a local model chats without tools", async (t) => {
  const model = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const piece of ["Hello", " there."]) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((ok) => model.listen(0, "127.0.0.1", ok));
  const { root, server, base } = await setup();
  t.after(() => { server.close(); model.close(); });
  writeFileSync(join(root, ".ouc/ai.json"), JSON.stringify({ tool: "local", local: { kind: "openai", baseUrl: `http://127.0.0.1:${portOf(model)}/v1`, model: "m" } }));
  const { token } = await json(fetch(`${base}/api/ai/status`));
  const post = (body: object) => fetch(`${base}/api/ai/run`, { method: "POST", headers: { "X-OUC-AI": token }, body: JSON.stringify(body) });
  assert.equal((await post({ action: "research-topic", params: { topic: "x" } })).status, 400); // needs an agent tool
  const ev = await sse(await post({ message: "hi" }));
  assert.equal(ev.filter((e) => e.type === "text").map((e) => e.text).join(""), "Hello there.");
  assert.equal(ev.at(-1)?.ok, true);
});

test("prep packs: prepared on their own, then reviewed by another AI with the history kept", async (t) => {
  const { root, server, base } = await setup();
  t.after(() => server.close());
  const sem = join(root, "semesters/S");
  const assignment = (id: string, extra?: object) => ({ id, code: "AAA", title: id, fullTitle: id, status: "", submitted: false, question: "Q?", weekIndex: 1, briefs: [], submissions: [], ...extra });
  mkdirSync(join(sem, "assignments/AAA/open"), { recursive: true });
  mkdirSync(join(sem, "assignments/AAA/late"), { recursive: true });
  writeFileSync(join(sem, "semester.json"), JSON.stringify({ start: "2000-01-01", end: "2999-01-01", courses: [] }));
  mkdirSync(join(root, "apps/web/public/data"), { recursive: true });
  writeFileSync(join(root, "apps/web/public/data/S.json"), JSON.stringify({
    courses: [{ code: "AAA", short: "AAA", title: "AAA course", weeks: [] }], notes: [],
    assignments: [assignment("AAA/open", { due: "2999-01-01T23:59:00" }), assignment("AAA/late", { due: "2000-01-01T23:59:00" }), assignment("AAA/done", { submitted: true })],
  }));

  // every assignment not submitted yet needs a pack (even past the deadline)
  assert.deepEqual(needsPrep(root, "S", JSON.parse(readFileSync(join(root, "apps/web/public/data/S.json"), "utf8"))).map((a) => a.id), ["AAA/open", "AAA/late"]);

  const mw = createAiApi(root, { bin: join(HERE, "fixtures/fake-agent.mjs"), status: async () => ({ ready: true }) });
  mw.autoPrep();
  while (!mw.prepIdle()) await new Promise((ok) => setTimeout(ok, 20));
  assert.ok(existsSync(join(sem, "assignments/AAA/late/PREP.md")));  // both made (in parallel)
  const file = join(sem, "assignments/AAA/open/PREP.md");
  let meta = readPrepMeta(readFileSync(file, "utf8"));
  assert.equal(meta.log.length, 1);
  assert.match(meta.log[0], /prepared after a sync/);
  assert.match(readFileSync(file, "utf8"), /Hints for/);

  // the student asks another AI to review it: the history grows
  const { token } = await json(fetch(`${base}/api/ai/status`));
  const res = await fetch(`${base}/api/ai/run`, { method: "POST", headers: { "X-OUC-AI": token }, body: JSON.stringify({ sem: "S", action: "assignment-prep", params: { assignment: "AAA/open", mode: "review" } }) });
  await sse(res);
  meta = readPrepMeta(readFileSync(file, "utf8"));
  assert.equal(meta.log.length, 2);
  assert.match(meta.log[1], /reviewed and improved/);
  assert.equal(JSON.parse(readFileSync(join(root, ".ouc/chats", readdirSync(join(root, ".ouc/chats"))[0]), "utf8")).action, "assignment-prep");
});

test("visuals the AI saved are served sandboxed, and nothing else is", async (t) => {
  const { root, server, base } = await setup();
  t.after(() => server.close());
  mkdirSync(join(root, "visualizations"));
  writeFileSync(join(root, "visualizations/search.html"), "<h1>red circle</h1>");
  writeFileSync(join(root, ".ouc/secret.html"), "no");
  const res = await fetch(`${base}/api/ai/view?path=visualizations/search.html`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-security-policy") ?? "", /^sandbox allow-scripts/);
  assert.equal(await res.text(), "<h1>red circle</h1>");
  assert.equal((await fetch(`${base}/api/ai/view?path=${encodeURIComponent(join(root, "visualizations/search.html"))}`)).status, 200); // an absolute path inside the folder
  for (const bad of [".ouc/secret.html", ".ouc/ai.json", "../etc/passwd.html", "visualizations/missing.html", "/etc/hosts"]) {
    assert.equal((await fetch(`${base}/api/ai/view?path=${encodeURIComponent(bad)}`)).status, 404, bad);
  }
});

test("ticking a task in a week plan writes it to the plan file", async (t) => {
  const { root, server, base } = await setup();
  t.after(() => server.close());
  mkdirSync(join(root, "semesters/2026-Fall/plans"), { recursive: true });
  const file = join(root, "semesters/2026-Fall/plans/2026-W42.md");
  writeFileSync(file, "# Week 42\n\n## Next actions\n- [ ] Read the brief\n- [ ] Draft question 1\n");
  const { token } = await json(fetch(`${base}/api/ai/status`));
  const tick = (body: object, headers: Record<string, string> = { "X-OUC-AI": token }) => fetch(`${base}/api/ai/plan/task`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  assert.equal((await tick({ sem: "2026-Fall", week: "2026-W42", line: 4, done: true }, {})).status, 403);   // no token
  assert.equal((await tick({ sem: "2026-Fall", week: "2026-W42", line: 4, done: true })).status, 200);
  assert.equal(readFileSync(file, "utf8"), "# Week 42\n\n## Next actions\n- [x] Read the brief\n- [ ] Draft question 1\n");
  await tick({ sem: "2026-Fall", week: "2026-W42", line: 4, done: false });
  assert.match(readFileSync(file, "utf8"), /- \[ \] Read the brief/);

  assert.equal((await tick({ sem: "2026-Fall", week: "2026-W42", line: 3, done: true })).status, 409);    // a heading
  for (const bad of [{ sem: "..", week: "2026-W42", line: 4 }, { sem: "2026-Fall", week: "../../x", line: 4 }, { sem: "2026-Fall", week: "2026-W42", line: "4" }]) {
    assert.equal((await tick(bad)).status, 400, JSON.stringify(bad));
  }
});

test("fixing a class time writes it to semester.json", async (t) => {
  const { root, server, base } = await setup();
  t.after(() => server.close());
  mkdirSync(join(root, "semesters/2026-Fall"), { recursive: true });
  const file = join(root, "semesters/2026-Fall/semester.json");
  writeFileSync(file, JSON.stringify({ label: "Fall", start: "2026-09-07", end: "2027-01-17", courses: [{ code: "X1", title: "X", short: "X" }] }));
  const { token } = await json(fetch(`${base}/api/ai/status`));
  const save = (body: object, headers: Record<string, string> = { "X-OUC-AI": token }) => fetch(`${base}/api/ai/classes`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  assert.equal((await save({ sem: "2026-Fall", code: "X1", day: "Thu", time: "19:00" }, {})).status, 403); // no token
  assert.equal((await save({ sem: "2026-Fall", code: "X1", day: "Thu", time: "19:00" })).status, 200);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).courses[0].classes, { day: "Thu", time: "19:00", groups: {} });
  assert.equal((await save({ sem: "2026-Fall", code: "X1", day: "Thu", time: "nope" })).status, 400);
  assert.equal((await save({ sem: "../x", code: "X1", day: "Thu", time: "19:00" })).status, 400);
  assert.equal((await save({ sem: "2027-Spring", code: "X1", day: "Thu", time: "19:00" })).status, 404);
});

/** A semester "S" with one course and one week with a note (the material a quiz is made from). */
function quizSemester(root: string) {
  mkdirSync(join(root, "semesters/S/notes/AAA"), { recursive: true });
  writeFileSync(join(root, "semesters/S/semester.json"), JSON.stringify({ start: "2000-01-01", end: "2999-01-01", courses: [] }));
  writeFileSync(join(root, "semesters/S/notes/AAA/week-01-intro.md"), "---\ntitle: Intro\n---\nThe sky is blue.\n");
  mkdirSync(join(root, "apps/web/public/data"), { recursive: true });
  writeFileSync(join(root, "apps/web/public/data/S.json"), JSON.stringify({
    courses: [{ code: "AAA", short: "AAA", title: "AAA course", weeks: [{ index: 1, name: "Week 1", label: "Intro", items: [] }] }],
    notes: [{ code: "AAA", weekIndex: 1, slug: "week-01-intro", title: "Intro", body: "The sky is blue." }], assignments: [],
  }));
}

test("make a quiz with an agent: it writes the file, the app notes which AI made it", async (t) => {
  const { root, server, base } = await setup();
  t.after(() => server.close());
  quizSemester(root);
  const { token } = await json(fetch(`${base}/api/ai/status`));
  await sse(await fetch(`${base}/api/ai/run`, { method: "POST", headers: { "X-OUC-AI": token }, body: JSON.stringify({ sem: "S", action: "make-quiz", params: { course: "AAA", week: "1" } }) }));
  const quiz = JSON.parse(readFileSync(join(root, "semesters/S/quizzes/AAA/week-01-intro.json"), "utf8"));
  assert.equal(quiz.by, "Claude Code");
  assert.ok(quiz.created);
  assert.equal(quiz.questions.length, 1);
  assert.equal(stampQuiz(root, "semesters/S/quizzes/AAA/week-01-intro.json", "Codex"), false);   // already stamped
});

test("make a quiz with a local model: it answers with the JSON and the app saves it", async (t) => {
  let answer = "";
  const model = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((ok) => model.listen(0, "127.0.0.1", ok));
  const { root, server, base } = await setup();
  t.after(() => { server.close(); model.close(); });
  quizSemester(root);
  writeFileSync(join(root, ".ouc/ai.json"), JSON.stringify({ tool: "local", local: { kind: "openai", baseUrl: `http://127.0.0.1:${portOf(model)}/v1`, model: "m" } }));
  const { token } = await json(fetch(`${base}/api/ai/status`));
  const run = async (body: object) => sse(await fetch(`${base}/api/ai/run`, { method: "POST", headers: { "X-OUC-AI": token }, body: JSON.stringify(body) }));

  answer = 'Here it is:\n```json\n{ "title": "Intro", "scope": "course", "questions": [{ "type": "single", "question": "Colour?", "options": [{ "text": "Blue", "correct": false }] }] }\n```';
  let ev = await run({ sem: "S", action: "make-quiz", params: { course: "AAA" } });
  assert.match(ev.filter((e) => e.type === "text").at(-1)?.text, /couldn't be saved: Question 1: "options" must be a list of 2 to 8/);
  const chatId = ev.find((e) => e.type === "chat")?.id;

  // asked to fix it, it answers again in the same chat: saved where the first try was meant to go
  answer = '{ "title": "Intro", "scope": "course", "questions": [{ "type": "true-false", "question": "Blue?", "answer": true }] }';
  ev = await run({ sem: "S", chatId, message: "Fix it" });
  assert.match(ev.filter((e) => e.type === "text").at(-1)?.text, /Saved the quiz `semesters\/S\/quizzes\/AAA\/course-aaa\.json`: 1 questions/);
  assert.ok(ev.some((e) => e.type === "file" && e.path === "semesters/S/quizzes/AAA/course-aaa.json"));
  const quiz = JSON.parse(readFileSync(join(root, "semesters/S/quizzes/AAA/course-aaa.json"), "utf8"));
  assert.equal(quiz.questions[0].answer, true);
  assert.ok(quiz.by && quiz.created);
  assert.match(JSON.parse(readFileSync(join(root, ".ouc/chats", `${chatId}.json`), "utf8")).quiz, /course-aaa\.json$/);
});

test("the Make a quiz pop-up: the quiz is made in the background, and the page can follow it", async (t) => {
  const { root, server, base } = await setup();
  t.after(() => server.close());
  quizSemester(root);
  const { token } = await json(fetch(`${base}/api/ai/status`));
  const post = (body: object) => fetch(`${base}/api/ai/quiz`, { method: "POST", headers: { "X-OUC-AI": token }, body: JSON.stringify(body) });
  assert.equal((await post({ sem: "S", course: "ZZZ" })).status, 400);
  assert.equal((await fetch(`${base}/api/ai/quiz`, { method: "POST", body: "{}" })).status, 403);   // needs the app's token
  const { jobs: [job] } = await json(post({ sem: "S", course: "AAA", week: 1 }));
  assert.equal(job.running, true);
  assert.equal(job.quiz, "semesters/S/quizzes/AAA/week-01-intro.json");
  let jobs: Ev[] = [];
  for (let i = 0; i < 100 && (!jobs.length || jobs[0].running); i++) { await new Promise((ok) => setTimeout(ok, 20)); jobs = (await json(fetch(`${base}/api/ai/quiz`))).jobs; }
  assert.deepEqual([jobs[0].running, jobs[0].ok, jobs[0].week], [false, true, "1"]);
  assert.ok(existsSync(join(root, job.quiz)));
});

/** quizSemester with a second class that has a note, so "every class" has two to make. */
function twoClasses(root: string) {
  quizSemester(root);
  writeFileSync(join(root, "semesters/S/notes/AAA/week-02-more.md"), "---\ntitle: More\n---\nGrass is green.\n");
  writeFileSync(join(root, "apps/web/public/data/S.json"), JSON.stringify({
    courses: [{ code: "AAA", short: "AAA", title: "AAA course", weeks: [{ index: 1, name: "Week 1", label: "Intro", items: [] }, { index: 2, name: "Week 2", label: "More", items: [] }, { index: 3, name: "Week 3", label: "Empty", items: [] }] }],
    notes: [{ code: "AAA", weekIndex: 1, slug: "week-01-intro", title: "Intro", body: "The sky is blue." }, { code: "AAA", weekIndex: 2, slug: "week-02-more", title: "More", body: "Grass is green." }], assignments: [],
  }));
}

test("Every class: one quiz per class with material, a few at a time, then nothing left to make", async (t) => {
  const { root, server, base } = await setup();
  t.after(() => server.close());
  twoClasses(root);
  writeFileSync(join(root, ".ouc/ai.json"), JSON.stringify({ tool: "claude", parallel: 1 }));
  const { token } = await json(fetch(`${base}/api/ai/status`));
  const post = (body: object) => fetch(`${base}/api/ai/quiz`, { method: "POST", headers: { "X-OUC-AI": token }, body: JSON.stringify(body) });
  const { jobs: made } = await json(post({ sem: "S", course: "AAA", every: true }));
  assert.deepEqual(made.map((j: Ev) => j.week), ["1", "2"]);   // week 3 has no material
  assert.deepEqual(made.map((j: Ev) => [j.running, !!j.queued]), [[true, false], [false, true]]);   // parallel: 1
  let jobs: Ev[] = made;
  for (let i = 0; i < 200 && jobs.some((j) => j.running || j.queued); i++) { await new Promise((ok) => setTimeout(ok, 20)); jobs = (await json(fetch(`${base}/api/ai/quiz`))).jobs; }
  assert.deepEqual(jobs.map((j) => j.ok), [true, true]);
  assert.ok(existsSync(join(root, "semesters/S/quizzes/AAA/week-01-intro.json")) && existsSync(join(root, "semesters/S/quizzes/AAA/week-02-more.json")));
  const again = await post({ sem: "S", course: "AAA", every: true });
  assert.equal(again.status, 400);
  assert.match(((await again.json()) as Ev).error, /already has a quiz/);
});

test("Sync now also makes a quiz for every class without one, unless autoQuiz is off", async () => {
  const root = mkdtempSync(join(tmpdir(), "ouc-ai-"));
  cpSync(join(REPO, "ai/skills"), join(root, "ai/skills"), { recursive: true });
  mkdirSync(join(root, ".ouc"), { recursive: true });
  twoClasses(root);
  const mw = createAiApi(root, { bin: join(HERE, "fixtures/fake-agent.mjs"), status: async () => ({ ready: true }), noAutoPrep: true });
  writeFileSync(join(root, ".ouc/ai.json"), JSON.stringify({ tool: "claude", autoQuiz: false }));
  assert.equal(mw.catchUp().quizzes, 0);
  while (!mw.prepIdle()) await new Promise((ok) => setTimeout(ok, 20));
  assert.ok(!existsSync(join(root, "semesters/S/quizzes")));
  writeFileSync(join(root, ".ouc/ai.json"), JSON.stringify({ tool: "claude" }));
  assert.equal(mw.catchUp().quizzes, 2);
  while (!mw.prepIdle()) await new Promise((ok) => setTimeout(ok, 20));
  assert.ok(existsSync(join(root, "semesters/S/quizzes/AAA/week-01-intro.json")) && existsSync(join(root, "semesters/S/quizzes/AAA/week-02-more.json")));
});

test("Sync now: the videos of the weeks about to get notes are transcribed first", async () => {
  const root = mkdtempSync(join(tmpdir(), "ouc-ai-"));
  cpSync(join(REPO, "ai/skills"), join(root, "ai/skills"), { recursive: true });
  mkdirSync(join(root, ".ouc"));
  writeFileSync(join(root, ".ouc/ai.json"), JSON.stringify({ tool: "claude", autoQuiz: false }));
  const sem = join(root, "semesters/S");
  const video = join(sem, "courses/AAA-Course/01-Week-1/Lesson.mp4");
  mkdirSync(dirname(video), { recursive: true });
  writeFileSync(video, "v");
  writeFileSync(join(sem, "semester.json"), JSON.stringify({ start: "2000-01-01", end: "2999-01-01", courses: [{ code: "AAA", dir: "AAA-Course" }] }));
  mkdirSync(join(root, "apps/web/public/data"), { recursive: true });
  writeFileSync(join(root, "apps/web/public/data/S.json"), JSON.stringify({
    courses: [{ code: "AAA", short: "AAA", title: "AAA course", weeks: [{ index: 1, name: "Week 1", label: "Week 1", estimated: true, summary: "", items: [{ kind: "video", title: "Lesson", href: "/files/S/x.mp4" }] }] },
    ],
    notes: [], assignments: [],
  }));
  const order: string[] = [];
  const mw = createAiApi(root, {
    bin: join(HERE, "fixtures/fake-agent.mjs"), status: async () => ({ ready: true }),
    whisper: () => ({ label: "fake", transcribe: async (files) => { order.push("transcribe"); return files.map(() => [{ start: 0, end: 1, text: "hello" }]); } }),
  });
  assert.deepEqual(mw.catchUp(), { notes: 1, prep: 0, quizzes: 0 });
  while (!mw.prepIdle()) await new Promise((ok) => setTimeout(ok, 20));
  assert.ok(existsSync(join(sem, "courses/AAA-Course/01-Week-1/Lesson.transcript.md")));
  assert.deepEqual(order, ["transcribe"]);
  const chat = JSON.parse(readFileSync(join(root, ".ouc/chats", readdirSync(join(root, ".ouc/chats"))[0]!), "utf8"));
  assert.equal(chat.action, "make-notes");
  assert.match(chat.messages[0].prompt, /transcripts of its videos and narrated slides/);
});

test("Video transcripts in Settings: whether Whisper is set up, set it up, turn it off", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "ouc-ai-"));
  mkdirSync(join(root, ".ouc"));
  let installed = false;
  const mw = createAiApi(root, {
    noAutoPrep: true,
    whisper: () => (installed ? { label: "fake", transcribe: async (files) => files.map(() => null) } : null),
    installWhisper: async () => { installed = true; return { ok: true, message: "fake" }; },
  });
  const server = http.createServer((req, res) => mw(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${portOf(server)}`;
  const { token } = await json(fetch(`${base}/api/ai/status`));
  const post = (body: object, tok = token) => fetch(`${base}/api/ai/transcribe`, { method: "POST", headers: { "Content-Type": "application/json", "X-OUC-AI": tok }, body: JSON.stringify(body) });

  const first = await json(fetch(`${base}/api/ai/transcribe`));
  assert.equal(first.available, false);
  assert.equal(first.enabled, true);
  assert.equal((await post({ setup: true }, "wrong")).status, 403);
  assert.equal((await post({ enabled: "yes" })).status, 400);
  assert.equal((await json(post({ setup: true }))).installing, true);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(await json(fetch(`${base}/api/ai/transcribe`)), { ...first, available: true, engine: "fake" });
  assert.equal((await json(post({ enabled: false }))).enabled, false);
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".ouc/media.json"), "utf8")), { transcribe: false });
});
