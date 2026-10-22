// Big files in a backup: class videos get a smaller copy made once with ffmpeg (the original stays on
// the computer), and anything still over the target's limit is split into parts and joined on restore.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compressVideo, joinParts, prepareSources, splitFile } from "../src/media.ts";

const FFMPEG = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-ffmpeg.mjs");
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
function study(files: Record<string, Buffer | string>) {
  const root = tmp("ouc-media-");
  for (const [p, b] of Object.entries(files)) { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), b); }
  return root;
}
const runs = (log: string) => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : []);

test("a big file is split into parts that join back into the same file", () => {
  const dir = tmp("ouc-split-");
  const src = join(dir, "class.mp4");
  const data = randomBytes(2500);
  writeFileSync(src, data);
  const parts = splitFile(src, join(dir, "cache"), 1000);
  assert.deepEqual(parts.map((p) => p.suffix), [".ouc-part-001", ".ouc-part-002", ".ouc-part-003", ".ouc-parts.json"]);
  assert.deepEqual(parts.slice(0, 3).map((p) => statSync(p.from).size), [1000, 1000, 500]);

  // restore: the parts land next to each other, the app joins them and removes the parts
  const out = tmp("ouc-restore-");
  for (const p of parts) writeFileSync(join(out, `class.mp4${p.suffix}`), readFileSync(p.from));
  assert.deepEqual(joinParts(out), ["class.mp4"]);
  assert.deepEqual(readFileSync(join(out, "class.mp4")), data);
  assert.equal(existsSync(join(out, "class.mp4.ouc-part-001")), false);
});

test("a damaged or missing part is caught on restore, and the parts are kept", () => {
  const dir = tmp("ouc-split-");
  writeFileSync(join(dir, "v.mp4"), randomBytes(2000));
  const parts = splitFile(join(dir, "v.mp4"), join(dir, "cache"), 1000);
  const out = tmp("ouc-restore-");
  for (const p of parts) writeFileSync(join(out, `v.mp4${p.suffix}`), readFileSync(p.from));
  writeFileSync(join(out, "v.mp4.ouc-part-002"), Buffer.alloc(1000));
  assert.throws(() => joinParts(out), /v\.mp4.*damaged/);
  assert.equal(existsSync(join(out, "v.mp4.ouc-part-001")), true);
  assert.equal(existsSync(join(out, "v.mp4")), false);
});

test("a class video gets a smaller copy, made once", async () => {
  const root = study({ "semesters/S/courses/C/01-W/class.mp4": Buffer.alloc(5000) });
  const log = join(root, "ffmpeg.log");
  const env = { FAKE_FFMPEG_BYTES: "800", FAKE_FFMPEG_LOG: log };
  const first = await compressVideo(root, "semesters/S/courses/C/01-W/class.mp4", { ffmpeg: FFMPEG, env });
  assert.ok(first && statSync(first).size === 800);
  assert.ok(first.startsWith(join(root, ".ouc", "backup-media")));
  assert.equal(await compressVideo(root, "semesters/S/courses/C/01-W/class.mp4", { ffmpeg: FFMPEG, env }), first);
  assert.equal(runs(log).length, 1);
  assert.match(runs(log)[0], /libx265/);
});

test("without H.265 it falls back to H.264, and without ffmpeg or a saving it keeps the original", async () => {
  const root = study({ "a.mp4": Buffer.alloc(5000), "b.mp4": Buffer.alloc(500), "c.mp4": Buffer.alloc(5000) });
  const log = join(root, "ffmpeg.log");
  const h264 = await compressVideo(root, "a.mp4", { ffmpeg: FFMPEG, env: { FAKE_FFMPEG_FAIL: "libx265", FAKE_FFMPEG_BYTES: "900", FAKE_FFMPEG_LOG: log } });
  assert.ok(h264);
  assert.match(runs(log)[1], /libx264/);
  assert.equal(await compressVideo(root, "b.mp4", { ffmpeg: FFMPEG, env: { FAKE_FFMPEG_BYTES: "800" } }), null, "not smaller");
  assert.equal(await compressVideo(root, "c.mp4", { ffmpeg: null }), null, "no ffmpeg");
  assert.equal(await compressVideo(root, "c.mp4", { ffmpeg: FFMPEG, env: { FAKE_FFMPEG_FAIL: "1" } }), null, "ffmpeg fails");
});

test("the backup takes small files as they are, videos compressed, and the rest in parts", async () => {
  const root = study({
    "semesters/S/notes/n.md": "note",
    "semesters/S/courses/C/01-W/class.mp4": Buffer.alloc(5000),
    "semesters/S/courses/C/01-W/slides.pptx": randomBytes(2500),
  });
  const src = await prepareSources(root, ["semesters/S/courses/C/01-W/class.mp4", "semesters/S/courses/C/01-W/slides.pptx", "semesters/S/notes/n.md"], {
    maxBytes: 1000, ffmpeg: FFMPEG, env: { FAKE_FFMPEG_BYTES: "700" },
  });
  const byPath = Object.fromEntries(src.map((s) => [s.path, s.from]));
  assert.equal(byPath["semesters/S/notes/n.md"], join(root, "semesters/S/notes/n.md"));
  assert.equal(statSync(byPath["semesters/S/courses/C/01-W/class.mp4"]).size, 700, "the compressed copy, under the same name");
  assert.deepEqual(Object.keys(byPath).filter((p) => p.includes("slides.pptx")).sort(), [
    "semesters/S/courses/C/01-W/slides.pptx.ouc-part-001", "semesters/S/courses/C/01-W/slides.pptx.ouc-part-002",
    "semesters/S/courses/C/01-W/slides.pptx.ouc-part-003", "semesters/S/courses/C/01-W/slides.pptx.ouc-parts.json",
  ]);
});
