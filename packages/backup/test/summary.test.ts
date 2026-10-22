// What changed since the last backup, and the one-line summary the student sees ("3 notes, progress").
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffFiles, summarize, type FileEntry } from "../src/summary.ts";

const f = (path: string, size = 1, mtimeMs = 1): FileEntry => ({ path, size, mtimeMs });

test("finds new, changed and removed files", () => {
  const before = [f("a.md"), f("b.md"), f("c.md")];
  const after = [f("a.md"), f("b.md", 2), f("d.md")];
  assert.deepEqual(diffFiles(before, after), { added: ["d.md"], changed: ["b.md"], removed: ["c.md"] });
});

test("nothing changed means an empty change list", () => {
  assert.deepEqual(diffFiles([f("a.md")], [f("a.md")]), { added: [], changed: [], removed: [] });
});

test("names what changed the way the student thinks of it", () => {
  const s = summarize({
    added: ["semesters/S/notes/C1/w1.md", "semesters/S/notes/C1/w2.md", "semesters/S/courses/C1/01-W/slides.pdf"],
    changed: ["semesters/S/progress.json", "semesters/S/quizzes/attempts.json", "semesters/S/assignments/C1/09-28_A1/homework/answers.json"],
    removed: ["semesters/S/notes/C1/old.md"],
  });
  assert.equal(s, "3 notes, 1 course file, quiz scores, homework answers, progress");
});

test("one of a kind is singular and unknown files are counted as other files", () => {
  assert.equal(summarize({ added: ["semesters/S/notes/C1/w1.md", "memory/progress.md", "semesters/S/x.txt"], changed: [], removed: [] }),
    "1 note, study memory, 1 other file");
  assert.equal(summarize({ added: [], changed: [], removed: [] }), "no changes");
});
