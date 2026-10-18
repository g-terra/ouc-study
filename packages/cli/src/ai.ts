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
import { spawn, spawnSync } from "node:child_process";
import { homedir, totalmem } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import * as ui from "./tui.ts";
import { AGENTIC, ALIASES, INSTALL_HINT, TOOL_LABEL, agentEnv, chat, describe, detect, loadConfig, login, loginStatus, runAgent, saveConfig, serverUp, spawnCliSync, writeOpencodeConfig } from "../../ai/providers.mjs";
import { currentSemesterId, findCourse, findWeek, loadData, noteFileName, read, weekMaterial, weekNumber } from "../../ai/context.mjs";
import { validateNote } from "../../ai/validate.mjs";
import { notesPrompt } from "../../ai/actions.mjs";

const { c } = ui;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
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
    { label: "opencode with a local model", hint: `free and offline, all skills · Ollama or LM Studio${local ? ` (${local} running)` : ", set up for you"}`, value: "opencode" },
    { label: "A local model directly", hint: `free and offline; notes, plans and quizzes, lighter · Ollama or LM Studio${local ? ` (${local} running)` : ""}`, value: "local" },
    { label: "None for now", value: null },
  ], { initial: d.claude ? 0 : d.codex ? 1 : d.opencode && (d.ollama || d.lmstudio) ? 2 : (d.ollama || d.lmstudio) ? 3 : 0 });
  if (!tool) return null;
  const cfg = { tool };
  if ((tool === "claude" || tool === "codex" || tool === "opencode") && !d[tool] && !(await installTool(tool))) {
    ui.warn(`${TOOL_LABEL[tool]} isn't installed yet: ${INSTALL_HINT[tool]}, then run ouc ai setup again.`);
  }
  if (tool === "opencode" || tool === "local") {
    let s = await pickServer(d);
    s = { ...s, models: s.kind === "ollama" ? await ensureOllama(s.baseUrl) : await ensureLMStudio(s.baseUrl) };
    const model = await pickModel(s.models, recommendedModel(tool, s.kind));
    if (s.kind === "ollama") await ensureOllamaModel(model, s.models);
    else await ensureLMStudioModel(model, s.models);
    const server = { kind: s.kind, baseUrl: s.baseUrl, model };
    if (tool === "local") {
      cfg.local = s.kind === "ollama" ? { ...server, ctx: 32768 } : server;
    } else {
      // opencode can't pass a context size to Ollama, so it gets a copy of the model with a 32k window
      if (s.kind === "ollama") server.model = ollamaLongContext(model);
      cfg.opencode = server;
      ui.ok(`opencode will use ${c.bold(writeOpencodeConfig(ROOT, { ...server, models: [...new Set([server.model, ...s.models])] }))} ${c.gray("(.opencode/opencode.json)")}`);
    }
  } else if (d[tool] || which(tool)) {
    await ensureLogin(tool);
  }
  saveConfig(ROOT, cfg);
  ui.ok(`AI assistant: ${c.bold(describe(cfg))}`);
  return cfg;
}
async function pickServer(d) {
  return ui.select("Which app runs the model?", [
    { label: "Ollama", hint: d.ollama ? `running · ${d.ollama.models.length} models` : "free · ollama.com (set up for you)", value: { kind: "ollama", ...(d.ollama ?? { baseUrl: "http://localhost:11434", models: [] }) } },
    { label: "LM Studio", hint: d.lmstudio ? `running · ${d.lmstudio.models.length} models` : "free · lmstudio.ai (set up for you)", value: { kind: "lmstudio", ...(d.lmstudio ?? { baseUrl: "http://localhost:1234/v1", models: [] }) } },
  ], { initial: d.lmstudio && !d.ollama ? 1 : 0 });
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
  if (st?.loggedIn) spawnCliSync(tool, tool === "claude" ? ["auth", "logout"] : ["logout"], { stdio: "inherit", env: agentEnv(tool) });
  login(tool);
  st = loginStatus(tool);
  st?.subscription ? ui.ok(`Signed in to ${TOOL_LABEL[tool]}`) : ui.warn(`Not signed in yet. Try: ${tool === "claude" ? "claude auth login" : "codex login"}`);
  return !!st?.subscription;
}
// ---------- first-install helpers: tools, Ollama and the model ----------
const WIN = process.platform === "win32";
const which = (bin) => spawnSync(WIN ? "where" : "which", [bin], { stdio: "ignore" }).status === 0;
/** winget (built into Windows 10/11) installs apps without a browser; false if it isn't there or fails. */
const winget = (id) => WIN && which("winget") && spawnSync("winget", ["install", "--id", id, "-e", "--accept-source-agreements", "--accept-package-agreements"], { stdio: "inherit" }).status === 0;
// a fresh winget install isn't on this window's PATH yet, so look in its install folder too
const ollamaBin = () => (which("ollama") ? "ollama" : WIN ? [join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData/Local"), "Programs/Ollama/ollama.exe")].find(existsSync) : undefined);
const GB = 1024 ** 3;
/** A model that runs on this computer: gpt-oss:20b needs ~16 GB free, qwen3:8b ~6 GB. */
function recommendedModel(tool, kind) {
  const big = totalmem() >= 24 * GB;
  if (kind === "lmstudio") return big ? "openai/gpt-oss-20b" : "qwen/qwen3-8b";
  return big ? "gpt-oss:20b" : "qwen3:8b";
}
async function installTool(tool) {
  if (!(await ui.confirm(`Install ${TOOL_LABEL[tool].replace(/ with a local model$/, "")} now? (${INSTALL_HINT[tool]})`, true))) return false;
  const [, , ...pkg] = INSTALL_HINT[tool].split(" ");
  // npm is npm.cmd on Windows, which needs a shell (the arguments are fixed, so that's safe)
  const r = spawnSync("npm", ["install", "-g", ...pkg.filter((x) => x !== "-g")], { stdio: "inherit", shell: WIN });
  if (r.status === 0 && which(tool)) { ui.ok(`${TOOL_LABEL[tool].replace(/ with a local model$/, "")} installed`); return true; }
  ui.fail(WIN ? `Couldn't install it. Try in a new terminal: ${INSTALL_HINT[tool]}` : `Couldn't install it. If npm said "permission denied" (EACCES), run: sudo ${INSTALL_HINT[tool]}`);
  return false;
}
const ollamaUp = (baseUrl) => serverUp({ kind: "ollama", baseUrl });
async function ollamaModels(baseUrl) {
  try { return ((await (await fetch(`${baseUrl.replace(/\/v1\/?$/, "")}/api/tags`)).json()).models ?? []).map((m) => m.name); } catch { return []; }
}
/** Installs and starts Ollama if needed; returns the models it has. */
async function ensureOllama(baseUrl) {
  if (await ollamaUp(baseUrl)) return ollamaModels(baseUrl);
  const mac = process.platform === "darwin";
  if (!ollamaBin() && !(mac && existsSync("/Applications/Ollama.app"))) {
    if (!(await ui.confirm("Ollama runs the model on this computer. Install it now?", true))) { ui.info("Install it later from https://ollama.com, then run: ouc ai setup"); return []; }
    if (mac && which("brew")) spawnSync("brew", ["install", "ollama"], { stdio: "inherit" });
    else if (mac) {
      ui.info("Opening https://ollama.com/download: download Ollama, drag it to Applications and open it once.");
      spawnSync("open", ["https://ollama.com/download"]);
      await ui.ask("Press Enter when Ollama is open");
    } else if (process.platform === "linux") spawnSync("sh", ["-c", "curl -fsSL https://ollama.com/install.sh | sh"], { stdio: "inherit" });
    else if (!winget("Ollama.Ollama")) {
      ui.info("Opening https://ollama.com/download: install Ollama for Windows and open it once.");
      spawnSync("explorer", ["https://ollama.com/download"]);
      await ui.ask("Press Enter when Ollama is open");
    }
  }
  if (!(await ollamaUp(baseUrl))) {
    const sp = ui.spinner("Starting Ollama…");
    if (mac && existsSync("/Applications/Ollama.app")) spawnSync("open", ["-a", "Ollama"]);
    else if (mac && which("brew") && spawnSync("brew", ["services", "start", "ollama"], { stdio: "ignore" }).status === 0) { /* starts at login too */ }
    else if (ollamaBin()) spawn(ollamaBin(), ["serve"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    for (let i = 0; i < 30 && !(await ollamaUp(baseUrl)); i++) await new Promise((r) => setTimeout(r, 1000));
    if (!(await ollamaUp(baseUrl))) { sp.fail("Ollama didn't start. Open the Ollama app (or run: ollama serve), then ouc ai setup again."); return []; }
    sp.succeed("Ollama is running");
  }
  return ollamaModels(baseUrl);
}
const hasModel = (models, m) => models.some((x) => x === m || x === `${m}:latest`);
async function ensureOllamaModel(model, models) {
  if (hasModel(models, model) || !ollamaBin()) return;
  const size = /gpt-oss:20b/.test(model) ? " (about 14 GB)" : /qwen3:8b/.test(model) ? " (about 5 GB)" : "";
  if (!(await ui.confirm(`Download ${model}${size} now?`, true))) { ui.info(`Later: ollama pull ${model}`); return; }
  spawnSync(ollamaBin(), ["pull", model], { stdio: "inherit" }).status === 0 ? ui.ok(`${model} downloaded`) : ui.warn(`Download failed. Try: ollama pull ${model}`);
}
/** gpt-oss:20b → gpt-oss-32k:20b, a copy with a 32k context window (Ollama's default is too small for opencode). */
function ollamaLongContext(model) {
  if (!ollamaBin() || /-32k(:|$)/.test(model)) return model;
  const [name, tag = "latest"] = model.split(":");
  const long = `${name}-32k:${tag}`;
  const dir = join(ROOT, ".ouc");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "Modelfile"), `FROM ${model}\nPARAMETER num_ctx 32768\n`);
  const r = spawnSync(ollamaBin(), ["create", long, "-f", join(dir, "Modelfile")], { encoding: "utf8" });
  if (r.status === 0) { ui.ok(`Made ${long}: ${model} with a 32k context window for opencode`); return long; }
  ui.warn(`Couldn't make a 32k-context copy (${(r.stderr || r.stdout).trim().split("\n").pop()}). Start Ollama with OLLAMA_CONTEXT_LENGTH=32768 instead.`);
  return model;
}

// LM Studio: its `lms` command starts the server, downloads and loads models
const lmsBin = () => (which("lms") ? "lms" : [".lmstudio/bin/lms", ".cache/lm-studio/bin/lms"].flatMap((p) => (WIN ? [`${p}.exe`] : [p])).map((p) => join(homedir(), p)).find(existsSync));
async function lmsModels(baseUrl) {
  try { return ((await (await fetch(`${baseUrl.replace(/\/$/, "")}/models`)).json()).data ?? []).map((m) => m.id); } catch { return []; }
}
/** Installs LM Studio if needed and starts its local server; returns the models it has. */
async function ensureLMStudio(baseUrl) {
  const up = () => serverUp({ kind: "lmstudio", baseUrl });
  if (await up()) return lmsModels(baseUrl);
  const mac = process.platform === "darwin";
  if (!lmsBin() && !(mac && existsSync("/Applications/LM Studio.app"))) {
    if (!(await ui.confirm("LM Studio runs the model on this computer. Install it now?", true))) { ui.info("Install it later from https://lmstudio.ai, then run: ouc ai setup"); return []; }
    if (mac && which("brew")) spawnSync("brew", ["install", "--cask", "lm-studio"], { stdio: "inherit" });
    else if (winget("ElementLabs.LMStudio")) ui.info("LM Studio is installed: open it once from the Start menu.");
    else {
      ui.info("Opening https://lmstudio.ai/download: install LM Studio and open it once.");
      spawnSync(mac ? "open" : WIN ? "explorer" : "xdg-open", ["https://lmstudio.ai/download"]);
    }
    if (mac && existsSync("/Applications/LM Studio.app")) spawnSync("open", ["-a", "LM Studio"]);
    await ui.ask("Press Enter when LM Studio is open");
  }
  const lms = lmsBin();
  const sp = ui.spinner("Starting the LM Studio server…");
  if (lms) spawnSync(lms, ["server", "start"], { stdio: "ignore" });
  for (let i = 0; i < 20 && !(await up()); i++) await new Promise((r) => setTimeout(r, 1000));
  if (!(await up())) { sp.fail("The LM Studio server isn't running. In LM Studio: Developer → Start server, then ouc ai setup again."); return []; }
  sp.succeed("LM Studio server is running");
  return lmsModels(baseUrl);
}
/** Downloads the model if needed and loads it with a 32k context window (opencode needs at least that). */
async function ensureLMStudioModel(model, models) {
  const lms = lmsBin();
  if (!lms) { ui.info(`In LM Studio, download ${model} and load it with Context Length 32768.`); return; }
  if (!models.includes(model)) {
    if (!(await ui.confirm(`Download ${model} now?`, true))) { ui.info(`Later: lms get ${model}`); return; }
    if (spawnSync(lms, ["get", model, "--yes"], { stdio: "inherit" }).status !== 0) { ui.warn(`Download failed. Try: lms get ${model}`); return; }
  }
  const r = spawnSync(lms, ["load", model, "--context-length", "32768", "--yes"], { stdio: "inherit" });
  r.status === 0 ? ui.ok(`${model} loaded with a 32k context window`) : ui.warn(`Couldn't load it. In LM Studio, load ${model} with Context Length 32768.`);
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
    const { prompt } = notesPrompt(semId, course, week);
    process.exitCode = await runAgent(ROOT, cfg, prompt);
    return;
  }

  // local model: hand it the material, then check and repair the result
  let mat = weekMaterial(ROOT, semId, week, cfg.local.budget ?? 48000);
  if (!mat.sources.length && mat.missing.length) {
    const sp = ui.spinner("Making text copies of the slides first…");
    spawnSync(which("python3") ? "python3" : "python", ["tools/extract_text.py", semId], { cwd: ROOT, stdio: "ignore" });
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
