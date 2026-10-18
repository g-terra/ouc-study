#!/usr/bin/env node
/**
 * OUC Study installer: an interactive setup that builds your personal study workspace from eClass.
 *
 *   ouc setup             (or: npm run setup, or: node bin/setup.mjs)
 *   ouc setup --dry-run   show what it would do; changes nothing (report in .ouc/dry-run/)
 *
 * Zero dependencies, so it runs straight after `git clone`.
 */
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ui from "./lib/tui.mjs";
import { createClient, readToken, slug, strip, TOKEN_RE, isoDay, SITE } from "../packages/eclass-sync/moodle.mjs";
import { pull, reportMarkdown } from "../packages/eclass-sync/pull.mjs";
import { chooseAssistant, installSkills } from "./ai.mjs";
import { describe as describeAI, loadConfig as loadAI } from "../packages/ai/providers.mjs";

const { c } = ui;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = process.argv.slice(2);
const DRY = ARGS.includes("--dry-run");
const YES = ARGS.includes("--yes");
const MAC = process.platform === "darwin";
const WIN = process.platform === "win32";
const BACKGROUND = MAC || WIN;   // ouc install: LaunchAgents on macOS, Startup folder + Task Scheduler on Windows
const OUC = (...a) => [process.execPath, ["bin/ouc.mjs", ...a]];
const STEPS = DRY ? 5 : 8;
const PALETTE = ["#7c3aed", "#0e7490", "#be185d", "#c2410c", "#15803d", "#1d4ed8", "#a16207", "#9333ea"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const confirm = (q, d = true) => (YES ? Promise.resolve(d) : ui.confirm(q, d));
const ask = (q, o = {}) => (YES ? Promise.resolve(o.def ?? "") : ui.ask(q, o));

function sh(cmd, args, opts = {}) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], ...opts });
    let log = "";
    p.stdout?.on("data", (d) => (log += d)); p.stderr?.on("data", (d) => (log += d));
    p.on("error", (e) => res({ code: 127, log: String(e) }));
    p.on("exit", (code) => res({ code: code ?? 1, log }));
  });
}
const has = (bin) => spawnSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" }).status === 0;
const ver = (bin, a = ["--version"], o = {}) => { try { return execFileSync(bin, a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], ...o }).trim().split("\n")[0]; } catch { return ""; } };

function seasonOf(d) {
  const m = d.getMonth();
  if (m >= 7) return { season: "Fall", year: d.getFullYear() };
  if (m <= 0) return { season: "Fall", year: d.getFullYear() - 1 };   // January = end of the fall semester
  if (m <= 5) return { season: "Spring", year: d.getFullYear() };
  return { season: "Summer", year: d.getFullYear() };
}
const mondayOf = (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const fmtMonth = (sec) => (sec ? new Date(sec * 1000).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "?");

function readClipboard() {
  try {
    if (MAC) return execFileSync("pbpaste", { encoding: "utf8" });
    if (process.platform === "win32") return execFileSync("powershell", ["-NoProfile", "-Command", "Get-Clipboard"], { encoding: "utf8" });
    for (const [b, a] of [["wl-paste", []], ["xclip", ["-o", "-selection", "clipboard"]], ["xsel", ["-ob"]]]) if (has(b)) return execFileSync(b, a, { encoding: "utf8" });
  } catch {}
  return "";
}
const openUrl = (u) => { try { spawn(MAC ? "open" : process.platform === "win32" ? "explorer" : "xdg-open", [u], { stdio: "ignore", detached: true }).unref(); return true; } catch { return false; } };

/** wrap the client so the second pass (download after the preview) reuses the course listings */
function memo(client) {
  const cache = new Map();
  const ro = /^(core_course_get_contents|mod_assign_get_assignments|mod_assign_get_submission_status)$/;
  return {
    ...client,
    call: (fn, p = {}) => {
      if (!ro.test(fn)) return client.call(fn, p);
      const k = `${fn}|${JSON.stringify(p)}`;
      if (!cache.has(k)) cache.set(k, client.call(fn, p).catch((e) => { cache.delete(k); throw e; }));
      return cache.get(k);
    },
    getText: (u) => { const k = `t|${u}`; if (!cache.has(k)) cache.set(k, client.getText(u)); return cache.get(k); },
  };
}

// ---------------------------------------------------------------------------
async function main() {
  ui.say();
  ui.box([
    `${c.bold(c.violet("OUC Study"))}  ${c.gray("·")}  ${c.bold("setup")}${DRY ? c.yellow("  (dry run: nothing will change)") : ""}`,
    c.gray("Your eClass courses offline, a visual study app,"),
    c.gray("daily grade & deadline alerts, and AI study skills."),
  ]);

  // ---- 1. computer --------------------------------------------------------
  ui.step(STEPS, "Checking your computer");
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 18 || (maj === 18 && min < 18)) { ui.fail(`Node ${process.versions.node} is too old. Install Node 20 or newer from https://nodejs.org`); process.exit(1); }
  ui.ok(`Node ${process.versions.node}`);
  // npm is npm.cmd on Windows, which Node only starts through a shell (fixed arguments, so safe)
  const npmV = ver("npm", ["-v"], { shell: WIN });
  npmV ? ui.ok(`npm ${npmV}`) : ui.warn("npm not found (comes with Node.js). Needed to install the app.");
  const py = has("python3") ? "python3" : has("python") ? "python" : "";
  py ? ui.ok(`${ver(py)} ${c.gray("(for searchable text copies of the slides)")}`) : ui.info("Python not found: text copies of the slides will be skipped (optional).");
  ui.ok(`${MAC ? "macOS" : WIN ? "Windows" : process.platform}${BACKGROUND ? "" : c.gray(" (the app works; starting it at login is macOS and Windows only)")}`);

  // ---- 2. dependencies ----------------------------------------------------
  if (!DRY) {
    ui.step(STEPS, "Installing the app", "one-off, about a minute");
    if (existsSync(join(ROOT, "node_modules/vite/bin/vite.js")) && existsSync(join(ROOT, "node_modules/tsx/dist/cli.mjs"))) ui.ok("Already installed");
    else if (!npmV) { ui.fail("Can't install without npm. Install Node.js from https://nodejs.org and run setup again."); process.exit(1); }
    else {
      const sp = ui.spinner("npm install");
      const r = await sh("npm", ["install", "--no-fund", "--no-audit"], { shell: WIN });
      mkdirSync(join(ROOT, ".ouc"), { recursive: true });
      writeFileSync(join(ROOT, ".ouc/npm-install.log"), r.log);
      if (r.code !== 0) { sp.fail("npm install failed. Details: .ouc/npm-install.log"); process.exit(1); }
      sp.succeed("App installed");
    }
  }

  // ---- 3. eClass key ------------------------------------------------------
  ui.step(STEPS, "Connecting to eClass");
  let token = readToken(ROOT), me;
  const tryKey = async (t) => {
    const sp = ui.spinner("Checking the key with eClass…");
    try {
      const client = createClient(t);
      const info = await client.call("core_webservice_get_site_info");
      sp.succeed(`Signed in as ${c.bold(info.fullname)} ${c.gray(`on ${strip(info.sitename)}`)}`);
      return { client, info };
    } catch (e) { sp.fail(e.message); return null; }
  };
  if (token && (await confirm("Found a saved eClass key. Use it?", true))) me = await tryKey(token);
  while (!me) {
    ui.say();
    ui.say(`  ${c.bold("Your personal eClass key")} lets this app read your courses: the same key the`);
    ui.say(`  Moodle mobile app uses. It stays on this computer ${c.gray("(.eclass-token, never in git)")}.`);
    ui.say();
    ui.say(`   ${c.violet("1")}  Open ${c.under(c.cyan(`${SITE}/user/managetoken.php`))}`);
    ui.say(`   ${c.violet("2")}  Row ${c.bold("Moodle mobile web service")} → ${c.bold("Reset")} → copy the key that appears`);
    ui.say(`      ${c.gray("No such row? Open the Moodle app on your phone once and sign in to eClass.")}`);
    ui.say();
    if (YES) { ui.fail("No valid key (run without --yes to enter one)."); process.exit(2); }
    const how = await ui.select("How do you want to enter it?", [
      { label: "Open the eClass page for me", value: "open" },
      { label: "I've copied it: read it from the clipboard", hint: "nothing is shown", value: "clip" },
      { label: "Paste or type it here", hint: "hidden as you type", value: "type" },
    ], { initial: token ? 1 : 0 });
    if (how === "open") { openUrl(`${SITE}/user/managetoken.php`) ? ui.ok("Opened in your browser. Copy the key, then come back here.") : ui.warn("Couldn't open a browser; use the link above."); continue; }
    let t = how === "clip" ? readClipboard() : await ui.secret("eClass key:");
    t = (t.match(/[a-f0-9]{32}/i) ?? [""])[0];
    if (!TOKEN_RE.test(t)) { ui.fail(how === "clip" ? "The clipboard doesn't contain a 32-character key. Copy it and try again." : "That isn't a 32-character key."); continue; }
    me = await tryKey(t);
    if (me) token = t;
  }
  if (!DRY) {
    const tf = join(ROOT, ".eclass-token");
    if (!existsSync(tf) || readFileSync(tf, "utf8").trim() !== token) { writeFileSync(tf, `${token}\n`, { mode: 0o600 }); try { chmodSync(tf, 0o600); } catch {} ui.ok("Key saved to .eclass-token (only your user can read it)"); }
  }
  const client = memo(me.client);

  // ---- 4. courses & semester ---------------------------------------------
  ui.step(STEPS, "Choosing your courses");
  let enrolled = [];
  {
    const sp = ui.spinner("Reading your enrolled courses…");
    try { enrolled = await client.call("core_enrol_get_users_courses", { userid: me.info.userid }); sp.succeed(`${enrolled.length} courses found on eClass`); }
    catch (e) { sp.fail(e.message); process.exit(1); }
  }
  const nowS = Date.now() / 1000;
  const current = (k) => (k.startdate || 0) <= nowS + 45 * 86400 && (!k.enddate || k.enddate >= nowS - 14 * 86400);
  // eClass also enrols you in pages that aren't courses (faculty, library, training): keep only courses whose title
  // starts with a code like "COS511:". Short names don't count: non-course pages often have coded ones too
  const CODE_RE = /^\s*[A-Z]{2,5}\s?\d{3,4}[A-Z]?\b/;
  const coded = enrolled.filter((k) => CODE_RE.test(strip(k.fullname)));
  if (coded.length && coded.length < enrolled.length) { ui.info(`Leaving out ${enrolled.length - coded.length} eClass pages that aren't courses`); enrolled = coded; }
  enrolled.sort((a, b) => Number(current(b)) - Number(current(a)) || (b.startdate || 0) - (a.startdate || 0));
  const picked = YES ? enrolled.filter(current) : await ui.multiselect("Which courses do you want in your study app?", enrolled.map((k) => ({
    label: strip(k.fullname), hint: `${fmtMonth(k.startdate)}${k.enddate ? ` – ${fmtMonth(k.enddate)}` : ""}`, value: k, checked: current(k),
  })));
  if (!picked.length) { ui.fail("No courses chosen."); process.exit(1); }

  const firstStart = new Date(Math.min(...picked.map((k) => (k.startdate || nowS) * 1000)));
  const lastEnd = new Date(Math.max(...picked.map((k) => (k.enddate || (k.startdate || nowS) + 140 * 86400) * 1000)));
  const s = seasonOf(firstStart);
  const semId = await ask("Semester folder name", { def: `${s.year}-${s.season}`, validate: (v) => (/^[\w.-]+$/.test(v) ? "" : "Letters, numbers and - only") });
  const semDir = join(ROOT, "semesters", semId);
  const cfgPath = join(semDir, "semester.json");
  const existing = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : null;
  if (existing) ui.ok(`${c.bold(semId)} already exists: keeping its settings and files, adding only what's missing`);

  const cfg = existing ?? { label: `${s.season} ${s.year}`, start: isoDay(firstStart), end: isoDay(lastEnd), courses: [] };
  const used = new Set(cfg.courses.map((k) => k.code));
  for (const k of picked) {
    if (cfg.courses.some((x) => x.eclassId === k.id)) continue;
    const full = strip(k.fullname);
    let code = (`${strip(k.shortname)} ${full}`.match(/\b([A-Z]{2,5}\s?\d{3,4}[A-Z]?)\b/)?.[1] ?? slug(strip(k.shortname), 12)).replace(/\s/g, "").toUpperCase();
    while (used.has(code)) code = `${code}-${k.id}`;
    used.add(code);
    const title = full.replace(new RegExp(`^\\s*${code.replace(/(\d)/, "\\s?$1")}\\s*[:\\-–|]\\s*`, "i"), "").replace(/\s*\((Fall|Spring|Summer|Autumn|Winter)[^)]*\)\s*$/i, "").trim() || full;
    const short = title.replace(/^(an |an introduction to |introduction to |intro to )/i, "").replace(/^./, (x) => x.toUpperCase());
    // how are the weeks named? decides how the timeline dates them
    let secs = [];
    try { secs = await client.call("core_course_get_contents", { courseid: k.id }); } catch {}
    const names = secs.map((x) => strip(x.name));
    const M = MONTHS.join("|");
    const dated = names.filter((n) => new RegExp(`\\d{1,2} (${M})\\s*-\\s*\\d{1,2} (${M})`).test(n) || new RegExp(`^Week \\d+.*(${M}) \\d{1,2}`).test(n)).length;
    const weekly = names.filter((n) => /^Week (\d+)/i.test(n)).length;
    const lectures = secs.flatMap((x) => x.modules ?? []).filter((m) => /^Lecture \d+/i.test(strip(m.name))).length;
    let dating = { mode: "title" }, label = "name";
    if (dated < 2 && weekly >= 2) {
      const def = isoDay(mondayOf(new Date((k.startdate || nowS) * 1000)));
      const first = await ask(`${short}: weeks have no dates on eClass. When does Week 1 start?`, { def, validate: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? "" : "Use YYYY-MM-DD") });
      dating = { mode: "weekly", first, pattern: "^Week (\\d+)" };
      label = "stripWeek";
    }
    if (lectures >= 2) label = "lecture";
    else if (dated >= 2 && names.some((n) => /^Week \d+\./.test(n))) label = "firstResource";
    // eClass has no dated schedule for the live classes (webconferences), only the tutor's announcement
    const slot = await ask(`${short}: weekly live class, e.g. "Mon 18:00" (Cyprus time; Enter to skip)`, { validate: (v) => (!v || /^[a-z]{3}\w*\s+\d{1,2}:\d{2}$/i.test(v) ? "" : "Like Mon 18:00, or leave empty") });
    const [cday, ctime] = slot.split(/\s+/);
    cfg.courses.push({ code, title, short, color: PALETTE[cfg.courses.length % PALETTE.length], eclassId: k.id, dir: `${code}-${slug(short, 40)}`, dating, label, ...(slot ? { classes: { day: cday.slice(0, 3), time: ctime } } : {}) });
  }
  ui.say();
  for (const k of cfg.courses) ui.say(`    ${c.hex(k.color)("■")} ${c.bold(k.short)} ${c.gray(`${k.code} · ${k.dating.mode === "weekly" ? `week 1 = ${k.dating.first}` : "dates from eClass"}`)}`);

  // ---- 5. preview + download ---------------------------------------------
  ui.step(STEPS, DRY ? "Checking what would be downloaded" : "Downloading your courses");
  const listSp = ui.spinner("Reading course pages, assignments and your submissions…");
  let preview;
  try {
    preview = await pull({ root: ROOT, semId, cfg, client, dryRun: true, on: (e) => { if (e.phase === "list" && e.detail) listSp.text = `Reading ${e.detail}…`; } });
  } catch (e) { listSp.fail(e.message); process.exit(1); }
  const f = preview.files;
  listSp.succeed(`${preview.courses.reduce((n, k) => n + k.sections, 0)} weeks, ${preview.assignments.total} assignments, ${f.total} files`);
  ui.say(`    ${c.bold(f.toDownload.length)} new files${f.bytes ? ` ${c.gray(`(${ui.fmtBytes(f.bytes)})`)}` : ""}${f.existing ? ` · ${c.bold(f.existing)} already here` : ""}${f.changed.length ? ` · ${c.bold(f.changed.length)} newer on eClass` : ""}`);
  if (preview.assignments.submissions) ui.say(`    ${c.bold(preview.assignments.submissions)} of your submitted files ${c.gray("→ assignments/…/my-submission/")}`);
  for (const w of preview.warnings.slice(0, 3)) ui.warn(c.gray(w));

  if (DRY) {
    writeFileSync(join(ROOT, ".ouc/dry-run", semId, "semester.json"), JSON.stringify(cfg, null, 2));
    writeFileSync(join(ROOT, ".ouc/dry-run", semId, "report.md"), reportMarkdown(preview));
    ui.step(STEPS, "Dry run finished");
    ui.ok(`Nothing changed. Full report: ${c.cyan(`.ouc/dry-run/${semId}/report.md`)}`);
    ui.closeInput();
    return;
  }
  if (!(await confirm(f.toDownload.length ? `Download ${f.toDownload.length + f.changed.length} files now?` : "Save the course structure?", true))) { ui.info("Stopped. Run `ouc setup` again any time."); process.exit(0); }
  mkdirSync(semDir, { recursive: true });
  if (!existing || JSON.stringify(existing) !== JSON.stringify(cfg)) writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  for (const d of ["notes", "plans", "research", "updates", "_meta"]) mkdirSync(join(semDir, d), { recursive: true });
  if (!existsSync(join(semDir, "_meta/exams.json"))) writeFileSync(join(semDir, "_meta/exams.json"), "[]\n");
  const bar = ui.progress("Downloading");
  const rep = await pull({ root: ROOT, semId, cfg, client, on: (e) => { if (e.phase === "download" && e.total) bar.update(e.done, e.total, e.detail); } });
  bar.end(`${rep.files.downloaded} files downloaded${rep.files.updated ? `, ${rep.files.updated} updated versions` : ""}${rep.files.existing ? `, ${rep.files.existing} kept as they were` : ""}`);
  if (rep.files.failed) ui.warn(`${rep.files.failed} couldn't be downloaded (list in semesters/${semId}/_meta/pull-report.json). Run ${c.cyan("ouc pull")} to retry.`);

  // ---- 6. finishing -------------------------------------------------------
  ui.step(STEPS, "Finishing up");
  if (py && existsSync(join(ROOT, "tools/extract_text.py"))) {
    const sp = ui.spinner("Making searchable text copies of the slides…");
    const r = await sh(py, ["tools/extract_text.py", semId]);
    r.code === 0 ? sp.succeed("Searchable text copies in text/ (your AI assistant reads these)") : sp.warn("Text copies skipped (tools/extract_text.py failed)");
  }
  {
    const first = !existsSync(join(semDir, "_meta/sync-state.json"));
    const sp = ui.spinner("Switching on daily updates (grades, feedback, deadlines)…");
    const r = await sh(process.execPath, ["packages/eclass-sync/daily.mjs", "--quiet"]);
    r.code === 0 ? sp.succeed(first ? "Daily updates on: first snapshot saved" : "Daily updates on: checked eClass for changes") : sp.warn(`Daily updates: ${r.log.trim().split("\n").pop()}`);
  }
  {
    const sp = ui.spinner("Building the app data…");
    const r = await sh(process.execPath, ["node_modules/tsx/dist/cli.mjs", "packages/content/src/build.ts"]);
    r.code === 0 ? sp.succeed(r.log.trim().split("\n").filter((l) => l.includes(semId)).pop()?.replace(/^✓\s*/, "App data: ") ?? "App data built") : sp.fail(`Build failed:\n${r.log}`);
  }

  // ---- 7. AI assistant ------------------------------------------------------
  ui.step(STEPS, "Your AI study assistant", "Claude Code, Codex or a local model with opencode");
  {
    const r = installSkills();
    r.ok ? ui.ok("Study skills installed for Claude Code, Codex and opencode") : ui.warn("Couldn't install the skills (run: ouc ai install)");
  }
  // personal context for any AI tool (git-ignored)
  const local = join(ROOT, "STUDENT.md");
  if (!existsSync(local)) {
    const first = strip(me.info.firstname || me.info.fullname.split(" ")[0]).toLowerCase().replace(/(^|[\s-])\S/g, (x) => x.toUpperCase());
    const name = await ask("What should your AI assistant call you?", { def: first });
    const style = YES ? "visual" : await ui.select("How do you learn best?", [
      { label: "Visually", hint: "diagrams, tables, flows", value: "visual" },
      { label: "By reading", hint: "clear written explanations", value: "reading" },
      { label: "By doing", hint: "worked examples and quizzes", value: "doing" },
      { label: "A mix", value: "mix" },
    ]);
    const styleTxt = { visual: "a **visual learner**: prefer diagrams, comparison tables and step flows over long paragraphs", reading: "learns best from **clear written explanations** with examples", doing: "learns best **by doing**: worked examples, practice questions and quizzes", mix: "likes a **mix** of diagrams, short explanations and practice questions" }[style];
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    writeFileSync(local, [`# About me (personal, not committed)`, "", `- Call me **${name}**. I'm a student at the Open University of Cyprus.`, `- I ${styleTxt}.`, `- My timezone is ${tz}. Due times are copied as eClass shows them.`, `- Current semester folder: \`semesters/${semId}/\``, ""].join("\n"));
    ui.ok("Your preferences for the AI assistant saved in STUDENT.md");
  }
  mkdirSync(join(ROOT, "memory"), { recursive: true });
  for (const [fname, body] of [["progress.md", "# Progress\n\n_Nothing yet._\n"], ["learning-log.md", "# Learning log\n\n"], ["glossary.md", "# Glossary\n\n"], ["questions.md", "# Open questions\n\n"], ["profile.md", "# Profile\n\n_Stable facts about me that the AI assistant learns over time._\n"]]) {
    const p = join(ROOT, "memory", fname);
    if (!existsSync(p)) writeFileSync(p, body);
  }
  const aiCfg = loadAI(ROOT);
  if (aiCfg?.tool) ui.ok(`AI assistant: ${c.bold(describeAI(aiCfg))} ${c.gray("(change it with: ouc ai setup)")}`);
  else if (!YES) await chooseAssistant();

  // ---- 7. start -----------------------------------------------------------
  ui.step(STEPS, "Starting the app");
  let started = false;
  if (BACKGROUND && (await confirm("Start the app automatically when you log in (and sync eClass every morning)?", true))) {
    const sp = ui.spinner("Installing the background service…");
    const r = await sh(...OUC("install"));
    r.code === 0 ? sp.succeed("Runs in the background at http://localhost:5173") : sp.warn(`Background service: ${r.log.trim().split("\n").pop()}`);
    const tcc = r.log.includes("Full Disk Access");
    if (tcc) ui.warn("macOS blocks background access to this folder: see the Full Disk Access tip with `ouc status`.");
    for (const l of r.log.split("\n").filter((x) => /Command installed/.test(x))) ui.ok(strip(l.replace(/\x1b\[[0-9;]*m/g, "").replace(/^✓\s*/, "")));
    started = r.code === 0;
  }
  if (!started) {
    const r = await sh(...OUC("link"));
    for (const l of r.log.split("\n").filter((x) => /Command installed/.test(x))) ui.ok(l.replace(/\x1b\[[0-9;]*m/g, "").replace(/^✓\s*/, ""));
  }
  ui.say();
  ui.box([
    `${c.green("✓")} ${c.bold("All set.")} ${c.gray(`${cfg.courses.length} course${cfg.courses.length === 1 ? "" : "s"} in semesters/${semId}/`)}`,
    "",
    `${c.cyan("ouc open")}     open the study app ${c.gray("(http://localhost:5173)")}`,
    `${c.cyan("ouc sync")}     check eClass now: grades, feedback, new files`,
    `${c.cyan("ouc status")}   is it running? when was the last sync?`,
    `${c.cyan("ouc help")}     everything else`,
    `${c.cyan("ouc notes")}    AI notes for the latest lecture ${c.gray("· ouc plan · ouc quiz")}`,
    `${c.cyan("ouc ai")}       open your AI assistant in this folder`,
  ], { color: c.green });
  if (!started) ui.info("Start it now with: ouc open");
  else if (await confirm("Open the app now?", true)) await sh(...OUC("open"));
  ui.closeInput();
}

main().catch((e) => { ui.fail(e.stack ?? String(e)); process.exit(1); });
