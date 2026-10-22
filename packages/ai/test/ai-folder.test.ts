// ai/ is the single source of the skills and agents every AI tool gets (see ai/install.mjs),
// so a new or edited one must have the front matter all of them understand.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AI = resolve(dirname(fileURLToPath(import.meta.url)), "../../../ai");
const frontMatter = (file: string): Record<string, string> => {
  const m = readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, `${file} starts with --- front matter ---`);
  return Object.fromEntries(m[1].split("\n").map((l) => l.match(/^(\w+):\s*(.*)$/)).filter((x) => x !== null).map((x) => [x[1], x[2]]));
};

for (const dir of readdirSync(join(AI, "skills"))) {
  test(`skill ${dir}: SKILL.md with a matching name and a description`, () => {
    const file = join(AI, "skills", dir, "SKILL.md");
    assert.ok(existsSync(file), `ai/skills/${dir}/SKILL.md exists`);
    const fm = frontMatter(file);
    assert.equal(fm.name, dir, "name matches the folder");
    assert.match(dir, /^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase-with-hyphens name");
    assert.ok(fm.description?.length > 20, "has a description that says when to use it");
  });
}

for (const f of readdirSync(join(AI, "agents")).filter((f) => f.endsWith(".md"))) {
  test(`agent ${f}: name, description and tools`, () => {
    const fm = frontMatter(join(AI, "agents", f));
    assert.equal(fm.name, f.replace(/\.md$/, ""), "name matches the file");
    assert.ok(fm.description?.length > 20, "has a description");
    assert.ok(fm.tools, "lists its tools (opencode permissions are derived from them)");
  });
}

// the student asked for plans without time estimates ("2 h", "30 min", "estimated hours"): too personal to guess
test("study planning never asks for or shows time estimates", () => {
  const files = ["agents/study-planner.md", "skills/plan-week/SKILL.md", "skills/assignment-helper/SKILL.md"];
  for (const f of files) {
    const text = readFileSync(join(AI, f), "utf8").replace(/[^\n]*Never estimate[^\n]*|[^\n]*Don't estimate[^\n]*|\(no time estimates\)/g, "");
    assert.doesNotMatch(text, /\b\d+(\s*[-–]\s*\d+)?\s*(h|hrs?|hours?|min|minutes?)\b|estimated hours|time-boxed|\b\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}/i, `${f} has no durations`);
  }
});

// the student found plans split each assignment into draft → review → next question and listed "submit by …" steps:
// plans stay coarse (one task per assignment) and aim to finish 1–2 days before the deadline, no earlier
test("study plans are coarse: one task per assignment, no submit steps, finish 1–2 days before", () => {
  const files = ["agents/study-planner.md", "skills/plan-week/SKILL.md", "skills/assignment-helper/SKILL.md", "skills/assignment-prep/SKILL.md"];
  for (const f of files) {
    const text = readFileSync(join(AI, f), "utf8");
    assert.match(text, /one task per assignment/i, `${f} keeps an assignment as one task`);
    assert.match(text, /1–2 days before/, `${f} finishes 1–2 days before the deadline`);
    assert.doesNotMatch(text, /at least 2 days|from start to submission/i, `${f} has no long buffers or submit steps`);
    for (const task of text.match(/^\s*- \[[ x]\] .*$/gm) ?? []) {
      assert.doesNotMatch(task, /\b(draft|review|submit|upload|hand in|question \d)/i, `${f}: "${task.trim()}" is a whole task, not a sub-step`);
    }
  }
});
