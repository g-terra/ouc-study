#!/usr/bin/env node
// Installs the study skills and agents from ai/ for every supported AI tool:
//   Claude Code → .claude/skills/<name>/SKILL.md and .claude/agents/<name>.md (subagents)
//   Codex (and other Agent Skills tools) → .agents/skills/<name>/SKILL.md (agents become skills)
//   opencode → reads the skills from .agents/skills; agents → .opencode/agents/<name>.md (subagents)
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
// removes only what this installer generated (it carries NOTE), so the contributors' skills from dev/ stay
const generated = (f) => existsSync(f) && readFileSync(f, "utf8").includes(NOTE);
function clean(dir, kind) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (kind === "skills" ? generated(join(p, "SKILL.md")) : e.endsWith(".md") && generated(p)) rmSync(p, { recursive: true, force: true });
  }
}

// Claude Code
for (const d of ["skills", "agents"]) clean(join(ROOT, ".claude", d), d);
mkdirSync(join(ROOT, ".claude/agents"), { recursive: true });
for (const s of skills) {
  cpSync(join(AI, "skills", s), join(ROOT, ".claude/skills", s), { recursive: true });
  writeFileSync(join(ROOT, ".claude/skills", s, "SKILL.md"), withNote(readFileSync(join(AI, "skills", s, "SKILL.md"), "utf8")));
}
for (const a of agents) writeFileSync(join(ROOT, ".claude/agents", a), withNote(readFileSync(join(AI, "agents", a), "utf8")));

// Codex & other Agent Skills tools: skills as-is, agents converted to skills (no subagents there)
clean(join(ROOT, ".agents/skills"), "skills");
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
// opencode: subagents with permissions matching the Claude tool list (skills come from .agents/skills)
clean(join(ROOT, ".opencode/agents"), "agents");
mkdirSync(join(ROOT, ".opencode/agents"), { recursive: true });
for (const a of agents) {
  const src = readFileSync(join(AI, "agents", a), "utf8");
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) continue;
  const description = m[1].match(/^description:\s*(.*)$/m)?.[1] ?? "";
  const tools = new Set((m[1].match(/^tools:\s*(.*)$/m)?.[1] ?? "").split(",").map((t) => t.trim()));
  // only denials: anything allowed falls back to opencode.json, which keeps the eClass key off limits
  const deny = [
    !tools.has("Write") && !tools.has("Edit") && "edit",
    !tools.has("Bash") && "bash",
    !tools.has("WebFetch") && "webfetch",
    !tools.has("WebSearch") && "websearch",
  ].filter(Boolean);
  const fm = [`description: ${JSON.stringify(description)}`, "mode: subagent", ...(deny.length ? ["permission:", ...deny.map((k) => `  ${k}: deny`)] : [])];
  writeFileSync(join(ROOT, ".opencode/agents", a), `---\n${fm.join("\n")}\n---\n${NOTE}${m[2]}`);
}
console.log(`✓ Installed ${skills.length} skills and ${agents.length} agents for Claude Code (.claude/), Codex (.agents/skills/) and opencode (.opencode/agents/)`);
