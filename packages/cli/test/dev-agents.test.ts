// The contributors' coding-agent setup (dev/) stays separate from the students' study AI (ai/):
// valid skills, both installers keep each other's copies, the hook is quiet off the cloud, and study runs turn Superpowers off.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { agentCommand } from "../../ai/src/providers.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DEV = join(ROOT, "dev/skills");
const devSkills = readdirSync(DEV);
const env = { ...process.env, CLAUDE_CODE_REMOTE: "" };

for (const dir of devSkills) {
  test(`contributor skill ${dir}: matching name and a contributor-only description`, () => {
    const fm = readFileSync(join(DEV, dir, "SKILL.md"), "utf8").match(/^---\nname: (.+)\ndescription: (.+)\n---\n/);
    assert.ok(fm, "starts with name and description front matter");
    assert.equal(fm[1], dir);
    assert.match(dir, /^ouc-dev-[a-z0-9-]+$/, "named ouc-dev-*, apart from the study skills");
    assert.match(fm[2], /^Contributor only\./);
  });
}

test("no contributor skill hides in ai/ (every skill there becomes an Ask AI action)", () => {
  assert.deepEqual(readdirSync(join(ROOT, "ai/skills")).filter((d) => d.startsWith("ouc-dev-")), []);
});

test("the shared Claude Code settings run the SessionStart hook and turn no plugin on for students", () => {
  const s = JSON.parse(readFileSync(join(ROOT, ".claude/settings.json"), "utf8"));
  const cmd: string = s.hooks.SessionStart[0].hooks[0].command;
  assert.ok(existsSync(join(ROOT, cmd.replace(/^node /, ""))), cmd);
  assert.equal(s.enabledPlugins, undefined);
  assert.ok(s.permissions.deny.some((r: string) => r.includes(".eclass-token")));
});

test("the hook does nothing outside a cloud session", () => {
  const r = spawnSync(process.execPath, ["dev/session-start.mjs"], { cwd: ROOT, env, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

test("the study and contributor installers each replace only their own copies", () => {
  const tmp = mkdtempSync(join(tmpdir(), "ouc-dev-agents-"));
  for (const d of ["ai", "dev"]) cpSync(join(ROOT, d), join(tmp, d), { recursive: true });
  mkdirSync(join(tmp, ".claude/skills/mine"), { recursive: true });
  writeFileSync(join(tmp, ".claude/skills/mine/SKILL.md"), "---\nname: mine\ndescription: someone's own skill\n---\n");
  const run = (f: string, ...a: string[]) => assert.equal(spawnSync(process.execPath, [f, ...a], { cwd: tmp, env }).status, 0, f);
  run("dev/install.mjs", "--no-plugins");
  run("ai/install.mjs");
  run("dev/install.mjs", "--no-plugins");
  run("ai/install.mjs");
  const study = readdirSync(join(ROOT, "ai/skills"));
  for (const t of [".claude/skills", ".agents/skills"]) {
    const got = readdirSync(join(tmp, t));
    for (const s of [...study, ...devSkills]) assert.ok(got.includes(s), `${t}/${s}`);
  }
  assert.ok(existsSync(join(tmp, ".claude/skills/mine/SKILL.md")), "a skill neither installer made is left alone");
  assert.ok(existsSync(join(tmp, ".claude/agents/tutor.md")));
});

test("Claude Code study runs load the settings that turn Superpowers off", () => {
  for (const opts of [{ json: true }, { interactive: true }]) {
    const args = agentCommand({ tool: "claude" }, "hi", opts)[1];
    const file = args[args.indexOf("--settings") + 1]!;
    assert.equal(JSON.parse(readFileSync(file, "utf8")).enabledPlugins["superpowers@claude-plugins-official"], false);
  }
});
