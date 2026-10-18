#!/usr/bin/env node
// Installs the study skills and agents from ai/ for every supported AI tool:
//   Claude Code → .claude/skills/<name>/SKILL.md and .claude/agents/<name>.md (subagents)
//   Codex (and other Agent Skills tools) → .agents/skills/<name>/SKILL.md (agents become skills)
// ai/ is the only source: edit there, then run `ouc ai install` again.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AI = join(ROOT, "ai");
const NOTE = "<!-- generated from ai/ by `ouc ai install`; edit the file in ai/ instead -->\n";
const skills = readdirSync(join(AI, "skills")).filter((d) => existsSync(join(AI, "skills", d, "SKILL.md")));
const agents = readdirSync(join(AI, "agents")).filter((f) => f.endsWith(".md"));

const withNote = (md) => md.replace(/^(---\n[\s\S]*?\n---\n)/, `$1${NOTE}`);

// Claude Code
for (const d of ["skills", "agents"]) rmSync(join(ROOT, ".claude", d), { recursive: true, force: true });
mkdirSync(join(ROOT, ".claude/agents"), { recursive: true });
for (const s of skills) {
  cpSync(join(AI, "skills", s), join(ROOT, ".claude/skills", s), { recursive: true });
  writeFileSync(join(ROOT, ".claude/skills", s, "SKILL.md"), withNote(readFileSync(join(AI, "skills", s, "SKILL.md"), "utf8")));
}
for (const a of agents) writeFileSync(join(ROOT, ".claude/agents", a), withNote(readFileSync(join(AI, "agents", a), "utf8")));

// Codex & other Agent Skills tools: skills as-is, agents converted to skills (no subagents there)
rmSync(join(ROOT, ".agents/skills"), { recursive: true, force: true });
for (const s of skills) {
  cpSync(join(AI, "skills", s), join(ROOT, ".agents/skills", s), { recursive: true });
  writeFileSync(join(ROOT, ".agents/skills", s, "SKILL.md"), withNote(readFileSync(join(AI, "skills", s, "SKILL.md"), "utf8")));
}
for (const a of agents) {
  const src = readFileSync(join(AI, "agents", a), "utf8");
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) continue;
  const fm = m[1].split("\n").filter((l) => /^(name|description):/.test(l)).join("\n");
  const name = a.replace(/\.md$/, "");
  mkdirSync(join(ROOT, ".agents/skills", name), { recursive: true });
  writeFileSync(join(ROOT, ".agents/skills", name, "SKILL.md"), `---\n${fm}\n---\n${NOTE}\n_You are acting as the **${name}** role for this task._\n${m[2]}`);
}
console.log(`✓ Installed ${skills.length} skills and ${agents.length} agents for Claude Code (.claude/) and Codex (.agents/skills/)`);
