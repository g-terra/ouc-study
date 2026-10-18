#!/usr/bin/env node
/**
 * ouc ai: the study tools with the AI of your choice: Claude Code or Codex (with your own
 * subscription login), opencode on a local model, or a local model directly (Ollama, LM Studio,
 * any OpenAI-compatible server).
 *
 *   ouc ai                     open your AI assistant in this folder
 *   ouc ai setup               choose the AI (saved in .ouc/ai.json)
 *   ouc ai status              what's installed and what's chosen
 *   ouc ai install             (re)install the skills for Claude Code, Codex and opencode
 *   ouc notes [course] [week]  make visual notes for a week (default: the latest week without notes)
 *   ouc plan                   plan this week
 *   ouc quiz [course] [week]   quiz yourself
 *   ouc ai run <skill> "…"     any skill (agent tools)
 *   options: --with claude|codex|opencode|local   --model <name>   --force
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import * as ui from "./lib/tui.mjs";
import { AGENTIC, ALIASES, INSTALL_HINT, TOOL_LABEL, agentEnv, chat, describe, detect, loadConfig, login, loginStatus, runAgent, saveConfig, serverUp, writeOpencodeConfig } from "../packages/ai/providers.mjs";
import { currentSemesterId, findCourse, findWeek, loadData, noteFileName, read, weekMaterial, weekNumber } from "../packages/ai/context.mjs";
import { validateNote } from "../packages/ai/validate.mjs";

const { c } = ui;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pad = (n) => String(n).padStart(2, "0");
const skillBody = (name) => read(join(ROOT, "ai/skills", name, "SKILL.md")).replace(/^---[\s\S]*?---\n/, "");
const agentBody = (name) => read(join(ROOT, "ai/agents", `${name}.md`)).replace(/^---[\s\S]*?---\n/, "");

// ---------------------------------------------------------------------------
export async function chooseAssistant({ quiet = false } = {}) {
  const sp = ui.spinner("Looking for AI tools on this computer…");
  const d = await detect();
  const found = [d.claude && "Claude Code", d.codex && "Codex", d.opencode && "opencode", d.ollama && "Ollama", d.lmstudio && "LM Studio"].filter(Boolean);
  sp.succeed(found.length ? `Found: ${found.join(", ")}` : "No AI tools found yet (you can install one later and run `ouc ai setup`)");
  if (!quiet) {
    ui.say(c.gray("    Any of these can write your notes, plan your week and quiz you. Change it any time: ouc ai setup"));
  }
  const local = [d.ollama && "Ollama", d.lmstudio && "LM Studio"].filter(Boolean).join(" / ");
  const tool = await ui.select("Which AI do you want to use?", [
    { label: "Claude Code", hint: `your Claude subscription · ${d.claude ? "installed" : `not installed: ${INSTALL_HINT.claude}`}`, value: "claude" },
    { label: "Codex (OpenAI)", hint: `your ChatGPT subscription · ${d.codex ? "installed" : `not installed: ${INSTALL_HINT.codex}`}`, value: "codex" },
    { label: "opencode with a local model", hint: `offline, all skills; needs a model with tool calling${local ? ` · ${local} running` : ""}`, value: "opencode" },
    { label: "A local model directly", hint: `offline; notes, plans and quizzes, works with small models${local ? ` · ${local} running` : " · start Ollama or LM Studio first"}`, value: "local" },
    { label: "None for now", value: null },
  ], { initial: d.claude ? 0 : d.codex ? 1 : d.opencode && (d.ollama || d.lmstudio) ? 2 : (d.ollama || d.lmstudio) ? 3 : 0 });
  if (!tool) return null;
  const cfg = { tool };
  if (tool === "opencode" || tool === "local") {
    const s = await pickServer(d);
    const model = await pickModel(s.models, tool === "opencode" ? "gpt-oss:20b" : s.kind === "ollama" ? "qwen2.5:14b" : "");
    const server = { kind: s.kind, baseUrl: s.baseUrl, model, ...(s.apiKeyEnv ? { apiKeyEnv: s.apiKeyEnv } : {}) };
    if (tool === "local") {
      cfg.local = s.kind === "ollama" ? { ...server, ctx: 32768 } : server;
    } else {
      cfg.opencode = server;
      ui.ok(`opencode will use ${c.bold(writeOpencodeConfig(ROOT, { ...server, models: s.models }))} ${c.gray("(.opencode/opencode.json)")}`);
      ui.info("opencode needs a model that can call tools (gpt-oss:20b, qwen3:14b or bigger) and a context window of 32k tokens or more.");
      if (s.kind === "ollama") ui.info(`Ollama: start it with ${c.cyan("OLLAMA_CONTEXT_LENGTH=32768 ollama serve")} (or set Context length in the Ollama app).`);
      if (s.kind === "lmstudio") ui.info("LM Studio: set Context Length to 32768 or more when you load the model.");
      if (!d.opencode) ui.warn(`opencode isn't installed yet: ${INSTALL_HINT.opencode}`);
    }
  } else if (!d[tool]) {
    ui.warn(`${TOOL_LABEL[tool]} isn't installed yet: ${INSTALL_HINT[tool]}. Then run ouc ai setup again to sign in.`);
  } else {
    await ensureLogin(tool);
  }
  saveConfig(ROOT, cfg);
  ui.ok(`AI assistant: ${c.bold(describe(cfg))}`);
  return cfg;
}
async function pickServer(d) {
  const servers = [
    d.ollama && { label: "Ollama", hint: `${d.ollama.models.length} models`, value: { kind: "ollama", ...d.ollama } },
    d.lmstudio && { label: "LM Studio", hint: `${d.lmstudio.models.length} models`, value: { kind: "lmstudio", ...d.lmstudio } },
    !d.ollama && { label: "Ollama (not running yet)", hint: "http://localhost:11434", value: { kind: "ollama", baseUrl: "http://localhost:11434", models: [] } },
    !d.lmstudio && { label: "LM Studio (not running yet)", hint: "http://localhost:1234/v1", value: { kind: "lmstudio", baseUrl: "http://localhost:1234/v1", models: [] } },
    { label: "Another OpenAI-compatible server", hint: "vLLM, llama.cpp, OpenRouter…", value: { kind: "openai" } },
  ].filter(Boolean);
  const s = await ui.select("Which server runs the model?", servers);
  if (s.kind === "openai") {
    s.baseUrl = await ui.ask("Server URL (ending in /v1)", { def: "http://localhost:8080/v1" });
    s.apiKeyEnv = await ui.ask("Name of the environment variable with the API key (blank = none)", { def: "" }) || undefined;
    s.models = [];
  }
  return s;
}
/** Claude Code and Codex run on the student's subscription login, never on API credits. */
async function ensureLogin(tool) {
  const plan = tool === "claude" ? "Claude (Pro or Max)" : "ChatGPT (Plus, Pro, Business…)";
  let st = loginStatus(tool);
  if (st?.subscription) { ui.ok(`${TOOL_LABEL[tool]} is signed in with your ${plan.split(" ")[0]} account`); return true; }
  if (st?.loggedIn) ui.warn(`${TOOL_LABEL[tool]} is signed in with an API key, which uses paid API credits. Sign in with your ${plan} account instead.`);
  else ui.info(`${TOOL_LABEL[tool]} isn't signed in yet. It uses your ${plan} subscription, not API credits.`);
  if (!ui.TTY || !(await ui.confirm(`Sign in to ${TOOL_LABEL[tool]} now? (opens your browser)`, true))) {
    ui.info(`Later: ${tool === "claude" ? "claude auth login" : "codex login"}`);
    return false;
  }
  if (st?.loggedIn) spawnSync(tool, tool === "claude" ? ["auth", "logout"] : ["logout"], { stdio: "inherit", env: agentEnv(tool) });
  login(tool);
  st = loginStatus(tool);
  st?.subscription ? ui.ok(`Signed in to ${TOOL_LABEL[tool]}`) : ui.warn(`Not signed in yet. Try: ${tool === "claude" ? "claude auth login" : "codex login"}`);
  return !!st?.subscription;
}
async function pickModel(models, def) {
  if (models.length) return ui.select("Which model?", models.slice(0, 15).map((m) => ({ label: m, value: m })), { initial: Math.max(0, models.indexOf(def)) });
  return ui.ask("Model name", { def, validate: (v) => (v ? "" : "Type a model name") });
}

export function installSkills() {
  const r = spawnSync(process.execPath, [join(ROOT, "ai/install.mjs")], { cwd: ROOT, encoding: "utf8" });
  return { ok: r.status === 0, msg: (r.stdout || r.stderr).trim() };
}

// ---------------------------------------------------------------------------
function args() {
  const a = process.argv.slice(2), o = { _: [] };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--with") o.with = a[++i];
    else if (a[i] === "--model") o.model = a[++i];
    else if (a[i] === "--force") o.force = true;
    else o._.push(a[i]);
  }
  return o;
}
async function config(o) {
  let cfg = loadConfig(ROOT);
  if (o.with) cfg = { ...(cfg ?? {}), tool: o.with };
  if (cfg?.tool && ALIASES[cfg.tool]) cfg = { ...cfg, tool: ALIASES[cfg.tool] };
  if (!cfg?.tool) { ui.say(c.gray("  First, choose your AI (once):")); cfg = await chooseAssistant({ quiet: true }); if (!cfg) process.exit(0); }
  if (!TOOL_LABEL[cfg.tool]) { ui.fail(`Unknown --with "${cfg.tool}" (claude, codex, opencode, local)`); process.exit(2); }
  if (cfg.tool === "local" || cfg.tool === "opencode") {
    const server = cfg[cfg.tool] ?? (cfg.tool === "opencode" ? cfg.local : null);   // --with opencode can reuse the local model
    if (!server?.model) { ui.fail(`No local model configured for ${TOOL_LABEL[cfg.tool]}. Run: ouc ai setup`); process.exit(2); }
    cfg[cfg.tool] = { ...server, ...(o.model ? { model: o.model } : {}) };
    if (cfg.tool === "opencode" && (o.model || !existsSync(join(ROOT, ".opencode/opencode.json")))) writeOpencodeConfig(ROOT, cfg.opencode);
    if (!(await serverUp(cfg[cfg.tool]))) {
      const s = cfg[cfg.tool];
      ui.fail(`Can't reach ${s.kind === "ollama" ? "Ollama" : s.kind === "lmstudio" ? "LM Studio" : "the model server"} at ${s.baseUrl}. Start it first${s.kind === "ollama" ? " (ollama serve)" : s.kind === "lmstudio" ? " (LM Studio → Developer → Start server)" : ""}.`);
      process.exit(2);
    }
  } else {
    const st = loginStatus(cfg.tool);
    if (!st) { ui.fail(`${TOOL_LABEL[cfg.tool]} isn't installed: ${INSTALL_HINT[cfg.tool]}`); process.exit(2); }
    if (!st.subscription && !(await ensureLogin(cfg.tool))) process.exit(2);
  }
  return cfg;
}
const studentContext = () => read(join(ROOT, "STUDENT.md")).trim();

function semCourseWeek(o, { needWeek = true } = {}) {
  const semId = currentSemesterId(ROOT);
  if (!semId) { ui.fail("No semester set up yet. Run: ouc setup"); process.exit(2); }
  const data = loadData(ROOT, semId);
  const [cq, wq] = o._;
  const course = cq ? findCourse(data, cq) : null;
  if (cq && !course) { ui.fail(`No course matches "${cq}". Try: ${data.courses.map((x) => x.code).join(", ")}`); process.exit(2); }
  return { semId, data, course, week: course && needWeek ? findWeek(course, wq, data.notes) : null, weekQuery: wq };
}
async function pickCourse(data) {
  return ui.select("Which course?", data.courses.map((x) => ({ label: x.short, hint: x.code, value: x })));
}

// ---------- notes ----------
async function notes(o) {
  const cfg = await config(o);
  let { semId, data, course, week, weekQuery } = semCourseWeek(o);
  if (!course) { course = await pickCourse(data); week = findWeek(course, weekQuery, data.notes); }
  if (!week) { ui.fail(`Couldn't find week "${weekQuery}" in ${course.short}.`); process.exit(2); }
  const file = noteFileName(course, week);
  const rel = `semesters/${semId}/notes/${course.code}/${file}`;
  const existing = data.notes.find((n) => n.code === course.code && n.weekIndex === week.index);
  ui.say(`  ${c.hex(course.color)("■")} ${c.bold(course.short)} ${c.gray("·")} ${week.label} ${c.gray(`(section ${week.index}${week.start ? `, ${week.start}` : ""})`)}`);
  ui.say(`  ${c.gray("with")} ${describe(cfg)}`);
  if (existing && !o.force) { ui.warn(`There is already a note for this week: notes/${course.code}/${existing.slug}.md (add --force to write another).`); return; }

  if (AGENTIC.has(cfg.tool)) {
    const prompt = `Use the make-notes skill. Make visual study notes for ${course.title} (${course.code}), eClass section ${week.index} "${week.name}". ` +
      `The week's files are listed in semesters/${semId}/courses/ and their text copies in semesters/${semId}/text/. Save the note as ${rel} (front matter: course ${course.code}, section ${week.index}, week ${weekNumber(week)}). ` +
      `When done, run: node packages/ai/validate.mjs ${rel} and fix every error it reports.`;
    process.exitCode = await runAgent(ROOT, cfg, prompt);
    return;
  }

  // local model: hand it the material, then check and repair the result
  let mat = weekMaterial(ROOT, semId, week, cfg.local.budget ?? 48000);
  if (!mat.sources.length && mat.missing.length) {
    const sp = ui.spinner("Making text copies of the slides first…");
    spawnSync(existsSync("/usr/bin/python3") ? "python3" : "python", ["tools/extract_text.py", semId], { cwd: ROOT, stdio: "ignore" });
    mat = weekMaterial(ROOT, semId, week, cfg.local.budget ?? 48000);
    sp.succeed(`${mat.sources.length} file(s) ready`);
  }
  if (!mat.sources.length) { ui.fail("This week has no readable files (slides/PDFs) to make notes from."); process.exit(1); }
  ui.ok(`Material: ${mat.sources.map((s) => s.rel.split("/").pop()).join(", ")}${mat.missing.length ? c.gray(` (${mat.missing.length} without text)`) : ""}`);
  const sys = [
    "You write study notes for a university student. Output ONLY the note file: Markdown starting with the YAML front matter. No preamble, no closing remarks, no surrounding ``` fence.",
    "Base everything on the course material given. Use LaTeX for all maths. Every fenced visual block must be valid YAML in the exact shapes shown in the format spec.",
    "Quote every mermaid label like A[\"text\"]. Flashcards are self-check questions, never answers to assignments. In `links`, only use links that appear in the material or long-standing sites (Wikipedia, Stanford Encyclopedia of Philosophy, Scholarpedia); otherwise leave the block out.",
    "", "# About the student", studentContext() || "Prefers visual notes.",
    "", "# How to make notes (skill)", skillBody("make-notes"),
    "", "# Note format specification", read(join(ROOT, "docs/NOTE_FORMAT.md")),
  ].join("\n");
  const fm = `---\ncourse: ${course.code}\nsection: ${week.index}\nweek: ${weekNumber(week)}\ntitle: <${/lecture/i.test(file) ? "Lecture" : "Week"} ${weekNumber(week)} · short topic>\nsummary: <one or two sentences>\nsource: ${mat.main ?? ""}\ntags: <3-6 comma-separated tags>\n---`;
  const user = [`Course: ${course.title} (${course.code}). eClass section ${week.index}: "${week.name}" (${week.label}).`,
    `Start the file with this front matter, filling in the <…> parts:\n${fm}`, "", "Course material for this week:",
    ...mat.sources.map((s) => `\n===== ${s.rel.split("/").pop()} =====\n${s.text}`)].join("\n");

  let tokens = 0;
  const gen = async (messages, label) => {
    const sp = ui.spinner(label);
    try {
      const t = await chat(cfg.local, messages, { onToken: (p) => { tokens += p.length; sp.text = `${label} ${c.gray(`${Math.round(tokens / 4)} tokens`)}`; } });
      sp.succeed(`${label.replace(/…$/, "")} done`);
      return t;
    } catch (e) { sp.fail(e.message); process.exit(1); }
  };
  const clean = (t) => {
    let s = t.replace(/^[\s\S]*?(?=^---\s*$)/m, "").trim();                 // drop chatter before the front matter
    s = s.replace(/^```(?:markdown|md)?\n([\s\S]*)\n```\s*$/i, "$1");        // unwrap a whole-file fence
    s = s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();                    // reasoning models
    // enforce the facts we know
    s = s.replace(/^(---\n[\s\S]*?\n---)/, (m) => m
      .replace(/^course:.*$/m, `course: ${course.code}`).replace(/^section:.*$/m, `section: ${week.index}`)
      .replace(/^week:.*$/m, `week: ${weekNumber(week)}`).replace(/^source:.*$/m, `source: ${mat.main ?? ""}`));
    return `${s}\n`;
  };
  const messages = [{ role: "system", content: sys }, { role: "user", content: user }];
  let out = clean(await gen(messages, `Writing the note with ${cfg.local.model}…`));
  let v = validateNote(out);
  for (let round = 1; v.errors.length && round <= 2; round++) {
    ui.warn(`${v.errors.length} format problem(s): asking the model to fix them (${round}/2)`);
    tokens = 0;
    out = clean(await gen([...messages, { role: "assistant", content: out }, { role: "user", content: `The note has these problems:\n${v.errors.map((e) => `- ${e}`).join("\n")}\n\nOutput the complete corrected file.` }], "Fixing…"));
    v = validateNote(out);
  }
  const abs = join(ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, out);
  if (v.errors.length) ui.warn(`Saved, but ${v.errors.length} problem(s) remain: node packages/ai/validate.mjs ${rel}`);
  else ui.ok(`Note saved: ${c.cyan(rel)}${v.warnings.length ? c.gray(` (${v.warnings.length} suggestion(s))`) : ""}`);
  ui.info("Open it in the app: Notes → it appears automatically.");
}

// ---------- plan ----------
async function plan(o) {
  const cfg = await config(o);
  if (AGENTIC.has(cfg.tool)) { process.exitCode = await runAgent(ROOT, cfg, "Use the plan-week skill: plan my study week."); return; }
  const semId = currentSemesterId(ROOT);
  if (!semId) { ui.fail("No semester set up yet. Run: ouc setup"); process.exit(2); }
  const data = loadData(ROOT, semId);
  const now = new Date(), in14 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10), today = now.toISOString().slice(0, 10);
  const weeks = data.courses.flatMap((x) => x.weeks.filter((w) => w.start && w.start <= in14 && (w.end ?? w.start) >= today).map((w) => `- ${x.short}: ${w.label} (${w.start} → ${w.end ?? "?"}), files: ${w.items.filter((i) => i.kind === "file").length}, notes: ${data.notes.some((n) => n.code === x.code && n.weekIndex === w.index) ? "yes" : "no"}`));
  const iso = (() => { const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day); const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); return `${d.getUTCFullYear()}-W${pad(Math.ceil(((d - y) / 864e5 + 1) / 7))}`; })();
  const sys = [agentBody("study-planner"), "", "# About the student", studentContext(), "",
    "You have no tools: everything you need is in the message. Output only the plan in Markdown."].join("\n");
  const user = [`Today is ${now.toDateString()}.`, "", "## Deadlines", read(join(ROOT, "semesters", semId, "DEADLINES.md")),
    "", "## This week and next, per course", ...weeks, "", "## Progress so far", read(join(ROOT, "memory/progress.md"), "_none recorded_")].join("\n");
  ui.say();
  const out = await chat(cfg.local, [{ role: "system", content: sys }, { role: "user", content: user }], { onToken: (t) => process.stdout.write(t) });
  const p = join(ROOT, "semesters", semId, "plans", `${iso}.md`);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${out.replace(/<think>[\s\S]*?<\/think>/g, "").trim()}\n`);
  ui.say(); ui.ok(`Plan saved: semesters/${semId}/plans/${iso}.md`);
}

// ---------- quiz & chat (interactive) ----------
async function repl(cfg, system, opener, { label = "you" } = {}) {
  const messages = [{ role: "system", content: system }, { role: "user", content: opener }];
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = () => new Promise((r) => rl.question(`\n${c.cyan(`${label} ›`)} `, r));
  ui.info("Type your answer; 'quit' to stop.");
  for (;;) {
    process.stdout.write(`\n${c.violet("●")} `);
    const out = await chat(cfg.local, messages, { onToken: (t) => process.stdout.write(t), temperature: 0.5 }).catch((e) => { ui.fail(e.message); process.exit(1); });
    messages.push({ role: "assistant", content: out });
    const a = (await ask()).trim();
    if (!a || /^(quit|exit|q)$/i.test(a)) break;
    messages.push({ role: "user", content: a });
  }
  rl.close();
}
async function quiz(o) {
  const cfg = await config(o);
  let { semId, data, course, week, weekQuery } = semCourseWeek(o);
  if (!course) { course = await pickCourse(data); week = findWeek(course, weekQuery, data.notes); }
  const what = `${course.short}${week ? `, ${week.label}` : ""}`;
  if (AGENTIC.has(cfg.tool)) { process.exitCode = await runAgent(ROOT, cfg, `Use the quiz-me skill: quiz me on ${what} (${course.code}${week ? `, eClass section ${week.index}` : ""}).`, { interactive: true }); return; }
  const note = week && data.notes.find((n) => n.code === course.code && n.weekIndex === week.index);
  const mat = note ? note.body : week ? weekMaterial(ROOT, semId, week, 30000).sources.map((s) => s.text).join("\n\n") : data.notes.filter((n) => n.code === course.code).map((n) => n.body).join("\n\n").slice(0, 30000);
  if (!mat.trim()) { ui.fail("Nothing to quiz from yet: make notes first (ouc notes)."); process.exit(1); }
  const sys = [skillBody("quiz-me"), "", "# About the student", studentContext(), "", "You have no tools. Use only this material:", mat].join("\n");
  ui.say(`  ${c.bold(`Quiz: ${what}`)} ${c.gray(`with ${describe(cfg)}`)}`);
  await repl(cfg, sys, "Start the quiz: ask the first question.");
}
async function chatCmd(cfg) {
  const semId = currentSemesterId(ROOT);
  const sys = [read(join(ROOT, "AGENTS.md")), "", "# About the student", studentContext(), "",
    semId ? `# Deadlines\n${read(join(ROOT, "semesters", semId, "DEADLINES.md"))}` : "", "",
    "You have no tools in this chat. If a task needs files or the web, suggest `ouc notes`, `ouc plan`, `ouc quiz`, or switching to an agent tool with `ouc ai setup`."].join("\n");
  ui.say(`  ${c.bold("Study chat")} ${c.gray(`with ${describe(cfg)}`)}`);
  await repl(cfg, sys, "Say hello in one line and ask what I want to study.");
}

// ---------- main ----------
async function main() {
  const o = args();
  const cmd = o._.shift() ?? "open";
  switch (cmd) {
    case "setup": { await chooseAssistant(); const r = installSkills(); r.ok ? ui.ok(r.msg.replace(/^✓\s*/, "")) : ui.warn(r.msg); break; }
    case "install": { const r = installSkills(); r.ok ? ui.ok(r.msg.replace(/^✓\s*/, "")) : (ui.fail(r.msg), process.exitCode = 1); break; }
    case "status": {
      const d = await detect(), cfg = loadConfig(ROOT);
      ui.say(`  ${c.bold("AI assistant:")} ${describe(cfg)}`);
      const signed = (t) => { if (!d[t]) return ""; const st = loginStatus(t); return c.gray(st?.subscription ? " (signed in)" : st?.loggedIn ? " (API key: use your subscription login)" : " (not signed in)"); };
      ui.say(`  ${d.claude ? ui.sym.ok : ui.sym.off} Claude Code${signed("claude")}   ${d.codex ? ui.sym.ok : ui.sym.off} Codex${signed("codex")}   ${d.opencode ? ui.sym.ok : ui.sym.off} opencode   ${d.ollama ? ui.sym.ok : ui.sym.off} Ollama${d.ollama ? c.gray(` (${d.ollama.models.length} models)`) : ""}   ${d.lmstudio ? ui.sym.ok : ui.sym.off} LM Studio${d.lmstudio ? c.gray(` (${d.lmstudio.models.length} models)`) : ""}`);
      ui.say(`  ${existsSync(join(ROOT, ".claude/skills")) ? ui.sym.ok : ui.sym.off} skills for Claude Code   ${existsSync(join(ROOT, ".agents/skills")) ? ui.sym.ok : ui.sym.off} skills for Codex and opencode   ${existsSync(join(ROOT, ".opencode/agents")) ? ui.sym.ok : ui.sym.off} opencode agents`);
      break;
    }
    case "notes": await notes(o); break;
    case "plan": await plan(o); break;
    case "quiz": await quiz(o); break;
    case "chat": case "open": {
      const cfg = await config(o);
      if (AGENTIC.has(cfg.tool)) process.exitCode = await runAgent(ROOT, cfg, o._.join(" "), { interactive: true });
      else await chatCmd(cfg);
      break;
    }
    case "run": {
      const cfg = await config(o);
      const [skill, ...rest] = o._;
      if (!skill || !existsSync(join(ROOT, "ai/skills", skill))) { ui.fail(`Usage: ouc ai run <skill> "request". Skills: plan-week, make-notes, research-topic, find-material, quiz-me, assignment-helper, sync-eclass`); process.exit(2); }
      if (!AGENTIC.has(cfg.tool)) {
        const alt = { "make-notes": "ouc notes", "plan-week": "ouc plan", "quiz-me": "ouc quiz" }[skill];
        ui.fail(alt ? `With a local model, use: ${alt}` : `"${skill}" needs an AI that can use files and the web. Use --with opencode (local) or claude/codex.`);
        process.exit(2);
      }
      process.exitCode = await runAgent(ROOT, cfg, `Use the ${skill} skill: ${rest.join(" ")}`, { interactive: true });
      break;
    }
    default:
      ui.fail(`Unknown command "${cmd}". Try: ouc ai [setup|status|install|chat|run], ouc notes, ouc plan, ouc quiz`);
      process.exitCode = 2;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { ui.fail(e.message); process.exit(1); });
