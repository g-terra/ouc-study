#!/usr/bin/env node
// Claude Code SessionStart hook (.claude/settings.json) for cloud sessions, which start from a fresh clone:
// installs the dependencies, points Playwright at the preinstalled Chromium, and adds the contributor
// skills and Superpowers (cloud sessions don't install plugins). Does nothing on your own computer.
// stdout is the JSON Claude Code reads; everything else goes to stderr. Never fails the session.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { ROOT, installDevSkills, installSuperpowersSkills } from "./install.mjs";

if (process.env.CLAUDE_CODE_REMOTE !== "true") process.exit(0);
const root = process.env.CLAUDE_PROJECT_DIR || ROOT;
const notes = [];
const step = (name, fn) => { try { fn(); } catch (e) { notes.push(`${name} failed: ${e instanceof Error ? e.message : e}`); } };

step("npm ci", () => {
  const stamp = join(root, "node_modules/.ouc-lock.sha256");
  const hash = createHash("sha256").update(readFileSync(join(root, "package-lock.json"))).digest("hex");
  if (existsSync(stamp) && readFileSync(stamp, "utf8") === hash) return;
  const r = spawnSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: root, stdio: ["ignore", process.stderr, process.stderr] });
  if (r.status !== 0) throw new Error(`exit ${r.status}; run npm ci yourself`);
  writeFileSync(stamp, hash);
});

// the image's Chromium can be an older build than the one this Playwright version looks for
step("Chromium", () => {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (process.env.PLAYWRIGHT_CHROMIUM || !base || !process.env.CLAUDE_ENV_FILE) return;
  const pw = createRequire(join(root, "package.json"))("playwright-core");
  if (existsSync(pw.chromium.executablePath())) return;
  const chrome = readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
    .map((d) => join(base, d, "chrome-linux/chrome")).find(existsSync);
  if (chrome) appendFileSync(process.env.CLAUDE_ENV_FILE, `export PLAYWRIGHT_CHROMIUM=${chrome}\n`);
});

let superpowers = null;
step("contributor skills", () => installDevSkills(root, [".claude/skills"]));
step("Superpowers", () => { superpowers = installSuperpowersSkills(root); if (!superpowers) throw new Error("couldn't clone it from GitHub"); });

const using = superpowers ? readFileSync(join(superpowers, "using-superpowers/SKILL.md"), "utf8") : "";
const context = [
  "When the task is changing OUC Study's code, follow AGENTS.md → \"Changing the tool itself\" and dev/CODING.md, and use the skills below. When it is helping a student study, ignore this whole block.",
  "Skills for this work are in .claude/skills/: the repo's own ouc-dev-* skills and Superpowers'. A `superpowers:<name>` reference means the <name> skill. If the Skill tool doesn't list one, read .claude/skills/<name>/SKILL.md.",
  ...notes,
  using && `<EXTREMELY_IMPORTANT>\nYou have superpowers.\n\n${using}\n</EXTREMELY_IMPORTANT>`,
].filter(Boolean).join("\n\n");
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }));
