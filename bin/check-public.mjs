#!/usr/bin/env node
/**
 * Is it safe to push this repo somewhere public?  ouc check-public  (or npm run check:public)
 * Lists what git would publish and flags anything personal: your eClass key, course materials,
 * submissions, notes, memory, or your name.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ui from "./lib/tui.mjs";

const { c } = ui;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

ui.say();
ui.say(`  ${c.bold("Public check")} ${c.gray("· what would be shared if you push this repo")}`);
ui.say();
try { git("rev-parse", "--git-dir"); } catch {
  ui.warn(`This folder isn't a git repository yet. Run ${c.cyan("git init")} first, then this check again.`);
  process.exit(1);
}

const files = git("ls-files", "--cached", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean);
const tokenFile = join(ROOT, ".eclass-token");
const token = existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : "";
// personal words to look for: the name in STUDENT.md and the eClass account name
const names = new Set();          // matched case-insensitively
const words = new Set();          // single name words: matched only when Capitalised
const local = join(ROOT, "STUDENT.md");
if (existsSync(local)) for (const m of readFileSync(local, "utf8").matchAll(/Call me \*\*([^*]+)\*\*/g)) names.add(m[1].trim());
try {
  for (const conn of git("ls-files", "--others", "--ignored", "--exclude-standard").split("\n").filter((f) => f.endsWith("updates/connection.json"))) {
    const u = JSON.parse(readFileSync(join(ROOT, conn), "utf8")).user;
    if (u) {
      names.add(u.trim());
      for (const w of u.trim().split(/\s+/)) if (w.length > 3) words.add(w[0].toUpperCase() + w.slice(1).toLowerCase());
    }
  }
} catch {}

const problems = [];
const flag = (f, why) => problems.push([f, why]);
for (const f of files) {
  if (/^(semesters\/(?!README\.md$)|memory\/|\.claude\/|\.agents\/|\.opencode\/|\.ouc\/)/.test(f)) flag(f, "personal folder (should be git-ignored)");
  else if (/(^|\/)\.eclass-token$|(^|\/)STUDENT\.md$|CLAUDE\.local\.md$/.test(f)) flag(f, "personal file");
  else if (/\.(pdf|pptx?|docx?|xlsx?|mp4|zip|epub|djvu)$/i.test(f)) flag(f, "document/media file: course material?");
  const p = join(ROOT, f);
  if (!existsSync(p) || statSync(p).size > 2_000_000) continue;
  const text = readFileSync(p, "utf8");
  if (token && text.includes(token)) flag(f, c.red("contains your eClass key!"));
  const re = (n, fl) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, fl);
  // a LICENSE names its copyright holder on purpose
  const hit = /^LICENSE(\.\w+)?$/.test(f) ? null : [...names].find((n) => re(n, "i").test(text)) ?? [...words].find((w) => re(w, "").test(text));
  if (hit) flag(f, `mentions "${hit}"`);
}

ui.ok(`${files.length} files would be published`);
if (!problems.length) {
  ui.ok(c.green("Nothing personal found. Safe to push."));
  ui.info("Tip: also check the git history (git log) if you ever committed personal files before.");
} else {
  ui.fail(`${problems.length} thing(s) to fix before publishing:`);
  for (const [f, why] of problems) ui.say(`      ${c.yellow("•")} ${f} ${c.gray("·")} ${why}`);
  process.exitCode = 1;
}
