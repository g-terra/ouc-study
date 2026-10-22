// What goes into a backup: the student's own files only, never keys, caches or the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { selectFiles } from "../src/select.ts";

function folder(files: Record<string, string | number>) {
  const root = mkdtempSync(join(tmpdir(), "ouc-backup-"));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), typeof body === "number" ? Buffer.alloc(body) : body);
  }
  return root;
}

const paths = (root: string, opts = {}) => selectFiles(root, opts).files.map((f) => f.path).sort();

test("backs up semesters, memory, the student's profile and AI settings and chats", () => {
  const root = folder({
    "semesters/2026-Demo/notes/C1/week-1.md": "# n",
    "semesters/2026-Demo/progress.json": "{}",
    "memory/progress.md": "p",
    "STUDENT.md": "me",
    "CLAUDE.local.md": "local",
    ".ouc/ai.json": "{}",
    ".ouc/media.json": "{}",
    ".ouc/chats/abc.json": "{}",
  });
  assert.deepEqual(paths(root), [
    ".ouc/ai.json", ".ouc/chats/abc.json", ".ouc/media.json", "CLAUDE.local.md", "STUDENT.md",
    "memory/progress.md", "semesters/2026-Demo/notes/C1/week-1.md", "semesters/2026-Demo/progress.json",
  ]);
});

test("never includes the eClass key, the backup's own sign-in, caches or the code", () => {
  const root = folder({
    ".eclass-token": "secret",
    "semesters/.eclass-token": "secret",
    ".ouc/backup.json": "{\"token\":\"x\"}",
    ".ouc/slides/k/1.pdf": "pdf",
    ".ouc/whisper/ggml-base.bin": "model",
    ".ouc/backup.git/HEAD": "ref",
    "apps/web/src/App.tsx": "code",
    "apps/web/public/data/2026-Demo.json": "{}",
    "node_modules/x/index.js": "x",
    "README.md": "readme",
    "semesters/2026-Demo/.DS_Store": "junk",
    "semesters/2026-Demo/courses/C1/01-Week/video.mp4.part": "half",
    "semesters/2026-Demo/semester.json": "{}",
  });
  assert.deepEqual(paths(root), ["semesters/2026-Demo/semester.json"]);
});

test("course files and class videos can be left out", () => {
  const root = folder({
    "semesters/S/courses/C1/01-Week/slides.pdf": "pdf",
    "semesters/S/courses/C1/01-Week/class.mp4": "video",
    "semesters/S/courses/C1/01-Week/class.transcript.md": "t",
    "semesters/S/notes/C1/n.md": "n",
  });
  assert.deepEqual(paths(root, { videos: false }), [
    "semesters/S/courses/C1/01-Week/class.transcript.md", "semesters/S/courses/C1/01-Week/slides.pdf", "semesters/S/notes/C1/n.md",
  ]);
  // transcripts were made on this computer (slow to redo), so they stay even without the course files
  assert.deepEqual(paths(root, { courseFiles: false }), ["semesters/S/courses/C1/01-Week/class.transcript.md", "semesters/S/notes/C1/n.md"]);
});

test("files over the size limit are listed apart, not dropped silently", () => {
  const root = folder({ "semesters/S/courses/C1/01-Week/class.mp4": 2000, "semesters/S/notes/n.md": "n" });
  const r = selectFiles(root, { maxBytes: 1000 });
  assert.deepEqual(r.files.map((f) => f.path), ["semesters/S/notes/n.md"]);
  assert.deepEqual(r.tooBig.map((f) => [f.path, f.size]), [["semesters/S/courses/C1/01-Week/class.mp4", 2000]]);
});

test("a missing folder is simply skipped", () => {
  assert.deepEqual(paths(folder({ "STUDENT.md": "me" })), ["STUDENT.md"]);
});
