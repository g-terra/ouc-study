// ai/ is the single source of the skills and agents every AI tool gets (see ai/install.mjs),
// so a new or edited one must have the front matter all of them understand.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AI = resolve(dirname(fileURLToPath(import.meta.url)), "../../../ai");
const frontMatter = (file) => {
  const m = readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, `${file} starts with --- front matter ---`);
  return Object.fromEntries(m[1].split("\n").map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
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
