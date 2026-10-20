#!/usr/bin/env node
// npm run dev:agents: sets this checkout up for AI coding agents that change the code (contributors).
//   dev/skills/ouc-dev-* → .claude/skills/ (Claude Code) and .agents/skills/ (Codex, opencode)
//   Superpowers (https://github.com/obra/superpowers) → the Claude Code plugin, local to this checkout
// Separate from the students' study AI (ai/, `ouc ai install`): each installer only replaces its own copies.
// Dependency-free, so any agent can run it with plain node. --no-plugins skips Superpowers.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TARGETS = [".claude/skills", ".agents/skills"];
/** A file in each installed skill folder: what dev/install.mjs put there and may replace. */
export const MARKER = ".ouc-dev";
export const SUPERPOWERS = { repo: "https://github.com/obra/superpowers.git", ref: "v7.0.0", plugin: "superpowers@claude-plugins-official" };

/** Copies skill folders from `from` into each target, replacing only the ones this installer made. */
export function copySkills(root, from, targets = TARGETS, { clean = true } = {}) {
  const names = readdirSync(from).filter((d) => existsSync(join(from, d, "SKILL.md")));
  for (const t of targets) {
    const dir = join(root, t);
    mkdirSync(dir, { recursive: true });
    if (clean) for (const d of readdirSync(dir)) if (existsSync(join(dir, d, MARKER))) rmSync(join(dir, d), { recursive: true, force: true });
    for (const n of names) {
      if (existsSync(join(dir, n)) && !existsSync(join(dir, n, MARKER))) continue;   // never overwrite a skill someone else installed
      cpSync(join(from, n), join(dir, n), { recursive: true });
      writeFileSync(join(dir, n, MARKER), "installed by dev/install.mjs; edit the source in dev/skills/ or upstream\n");
    }
  }
  return names;
}

/** The repo's own contributor skills. */
export const installDevSkills = (root = ROOT, targets = TARGETS) => copySkills(root, join(root, "dev/skills"), targets);

/** Superpowers' skills as plain skills (for cloud sessions, which don't install plugins). Returns the skills folder, or null. */
export function installSuperpowersSkills(root = ROOT, targets = [".claude/skills"]) {
  const src = join(root, ".ouc/dev/superpowers", SUPERPOWERS.ref);
  if (!existsSync(join(src, "skills"))) {
    mkdirSync(dirname(src), { recursive: true });
    const r = spawnSync("git", ["clone", "--quiet", "--depth", "1", "--branch", SUPERPOWERS.ref, SUPERPOWERS.repo, src], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", timeout: 60_000 });
    if (r.status !== 0) { rmSync(src, { recursive: true, force: true }); return null; }
  }
  copySkills(root, join(src, "skills"), targets, { clean: false });
  return join(src, "skills");
}

const has = (bin) => spawnSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" }).status === 0;

function main() {
  const names = installDevSkills();
  console.log(`✓ ${names.length} contributor skills (${names.join(", ")}) in ${TARGETS.join(" and ")}`);
  if (process.argv.includes("--no-plugins")) return;
  if (has("claude")) {
    // local scope: written to .claude/settings.local.json, so it stays out of git and off the students' installs
    const r = spawnSync("claude", ["plugin", "install", SUPERPOWERS.plugin, "--scope", "local"], { stdio: "inherit", shell: process.platform === "win32" });
    if (r.status === 0) console.log("✓ Superpowers plugin on for Claude Code in this checkout (the study app's Ask AI turns it off)");
    else console.log(`! Couldn't install Superpowers. In Claude Code run: /plugin install ${SUPERPOWERS.plugin}  (scope: local)`);
  }
  console.log(`
Superpowers for your other agents (install it once per tool, at user level):
  Codex      /plugins → search "superpowers" → Install Plugin
  opencode   add "plugin": ["superpowers@git+https://github.com/obra/superpowers.git"] to ~/.config/opencode/opencode.json
             (not the repo's opencode.json: the students' study runs use that one)
  Cursor     /add-plugin superpowers
  Gemini CLI gemini extensions install https://github.com/obra/superpowers
Then read dev/CODING.md (your agent will, through AGENTS.md).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
