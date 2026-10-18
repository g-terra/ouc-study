// The /api/ai endpoints end to end, with a fake agent binary instead of a real AI.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAiApi, needsPrep, readPrepMeta } from "../api.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");

function setup() {
  const root = mkdtempSync(join(tmpdir(), "ouc-ai-"));
  cpSync(join(REPO, "ai/skills"), join(root, "ai/skills"), { recursive: true });
  mkdirSync(join(root, ".ouc"));
  writeFileSync(join(root, ".ouc/ai.json"), JSON.stringify({ tool: "claude" }));
  const mw = createAiApi(root, { bin: join(HERE, "fixtures/fake-agent.mjs") });
  const server = http.createServer((req, res) => mw(req, res, () => { res.statusCode = 404; res.end(); }));
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ root, server, base: `http://127.0.0.1:${server.address().port}` })));
}
async function sse(res) {
  const events = [];
  const text = await res.text();
  for (const block of text.split("\n\n")) if (block.startsWith("data: ")) events.push(JSON.parse(block.slice(6)));
  return events;
}

test("actions, guard, run and follow-up", async (t) => {
  const { server, base } = await setup();
  t.after(() => server.close());

  const { actions } = await (await fetch(`${base}/api/ai/actions`)).json();
  assert.ok(actions.some((a) => a.id === "plan-week" && a.title === "Plan my week"));

  // without the token, or from another website, nothing runs
  assert.equal((await fetch(`${base}/api/ai/run`, { method: "POST", body: "{}" })).status, 403);
  const { token } = await (await fetch(`${base}/api/ai/status`)).json();
  const post = (path, body, headers = {}) => fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-OUC-AI": token, ...headers }, body: JSON.stringify(body) });
  assert.equal((await post("/api/ai/run", { action: "plan-week" }, { Origin: "https://evil.example" })).status, 403);

  // the panel can only pick a tool that exists here
  assert.equal((await post("/api/ai/run", { tool: "gpt-9", message: "hi" })).status, 400);
  assert.equal((await post("/api/ai/run", { tool: "local", message: "hi" })).status, 400); // no local model set up
  assert.match((await (await post("/api/ai/run", { tool: "opencode", message: "hi" })).json()).error, /ouc ai setup/);

  // missing input is a readable 400
  const bad = await post("/api/ai/run", { action: "research-topic" });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /topic/i);

  const ev = await sse(await post("/api/ai/run", { action: "plan-week" }));
  const chatId = ev.find((e) => e.type === "chat").id;
  assert.deepEqual(ev.filter((e) => e.type === "tool").map((e) => e.label), ["Reading progress.md", "Writing 2026-W42.md"]);
  assert.deepEqual(ev.filter((e) => e.type === "file").map((e) => e.path), ["semesters/2026-Fall/plans/2026-W42.md"]);
  assert.equal(ev.at(-1).type, "done");
  assert.equal(ev.at(-1).ok, true);

  const ev2 = await sse(await post("/api/ai/run", { chatId, message: "thanks, and next week?" }));
  assert.equal(ev2.filter((e) => e.type === "text").map((e) => e.text).join(""), "Second turn.");

  const chat = await (await fetch(`${base}/api/ai/chats/${chatId}`)).json();
  assert.equal(chat.sessionId, "sess-1");
  assert.equal(chat.messages.length, 4);
  assert.equal(chat.messages[1].text, "Plan saved.");
  assert.match(chat.messages[0].prompt, /plan-week skill/);
  assert.doesNotMatch(chat.messages[2].prompt, /OUC Study app/); // the preamble is only sent once

  const { chats } = await (await fetch(`${base}/api/ai/chats`)).json();
  assert.equal(chats[0].id, chatId);
});

test("a failing agent reports its error", async (t) => {
  const { server, base } = await setup();
  t.after(() => server.close());
  const { token } = await (await fetch(`${base}/api/ai/status`)).json();
  const res = await fetch(`${base}/api/ai/run`, { method: "POST", headers: { "X-OUC-AI": token }, body: JSON.stringify({ message: "please FAIL" }) });
  const ev = await sse(res);
  assert.match(ev.find((e) => e.type === "error").message, /boom/);
  assert.equal(ev.at(-1).ok, false);
});

test("a local model chats without tools", async (t) => {
  const model = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const piece of ["Hello", " there."]) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise((ok) => model.listen(0, "127.0.0.1", ok));
  const { root, server, base } = await setup();
  t.after(() => { server.close(); model.close(); });
  writeFileSync(join(root, ".ouc/ai.json"), JSON.stringify({ tool: "local", local: { kind: "openai", baseUrl: `http://127.0.0.1:${model.address().port}/v1`, model: "m" } }));
  const { token } = await (await fetch(`${base}/api/ai/status`)).json();
  const post = (body) => fetch(`${base}/api/ai/run`, { method: "POST", headers: { "X-OUC-AI": token }, body: JSON.stringify(body) });
  assert.equal((await post({ action: "research-topic", params: { topic: "x" } })).status, 400); // needs an agent tool
  const ev = await sse(await post({ message: "hi" }));
  assert.equal(ev.filter((e) => e.type === "text").map((e) => e.text).join(""), "Hello there.");
  assert.equal(ev.at(-1).ok, true);
});

test("prep packs: prepared on their own, then reviewed by another AI with the history kept", async (t) => {
  const { root, server, base } = await setup();
  t.after(() => server.close());
  const sem = join(root, "semesters/S");
  const assignment = (id, extra) => ({ id, code: "AAA", title: id, fullTitle: id, status: "", submitted: false, question: "Q?", weekIndex: 1, briefs: [], submissions: [], ...extra });
  mkdirSync(join(sem, "assignments/AAA/open"), { recursive: true });
  mkdirSync(join(sem, "assignments/AAA/late"), { recursive: true });
  writeFileSync(join(sem, "semester.json"), JSON.stringify({ start: "2000-01-01", end: "2999-01-01", courses: [] }));
  mkdirSync(join(root, "apps/web/public/data"), { recursive: true });
  writeFileSync(join(root, "apps/web/public/data/S.json"), JSON.stringify({
    courses: [{ code: "AAA", short: "AAA", title: "AAA course", weeks: [] }], notes: [],
    assignments: [assignment("AAA/open", { due: "2999-01-01T23:59:00" }), assignment("AAA/late", { due: "2000-01-01T23:59:00" }), assignment("AAA/done", { submitted: true })],
  }));

  // only the open one needs a pack, and once tried it isn't retried straight away
  assert.deepEqual(needsPrep(root, "S", JSON.parse(readFileSync(join(root, "apps/web/public/data/S.json"), "utf8"))).map((a) => a.id), ["AAA/open"]);

  const mw = createAiApi(root, { bin: join(HERE, "fixtures/fake-agent.mjs"), status: async () => ({ ready: true }) });
  mw.autoPrep();
  while (!mw.prepIdle()) await new Promise((ok) => setTimeout(ok, 20));
  const file = join(sem, "assignments/AAA/open/PREP.md");
  let meta = readPrepMeta(readFileSync(file, "utf8"));
  assert.equal(meta.log.length, 1);
  assert.match(meta.log[0], /prepared after a sync/);
  assert.match(readFileSync(file, "utf8"), /Hints for/);

  // the student asks another AI to review it: the history grows
  const { token } = await (await fetch(`${base}/api/ai/status`)).json();
  const res = await fetch(`${base}/api/ai/run`, { method: "POST", headers: { "X-OUC-AI": token }, body: JSON.stringify({ sem: "S", action: "assignment-prep", params: { assignment: "AAA/open", mode: "review" } }) });
  await sse(res);
  meta = readPrepMeta(readFileSync(file, "utf8"));
  assert.equal(meta.log.length, 2);
  assert.match(meta.log[1], /reviewed and improved/);
  assert.equal(JSON.parse(readFileSync(join(root, ".ouc/chats", readdirSync(join(root, ".ouc/chats"))[0]), "utf8")).action, "assignment-prep");
});
