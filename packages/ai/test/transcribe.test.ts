// Transcripts of class videos and narrated slides (src/transcribe.ts), with a fake speech-to-text
// engine and made-up files: which files get one, what's written, and the background queue.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { NO_WHISPER, createTranscriber, fasterWhisper, findMedia, pythonCandidates, transcribeOne, type Engine } from "../src/transcribe.ts";
import { zip } from "./helpers.ts";

const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rels = (list: [string, string, string][]) => `<Relationships>${list.map(([id, t, to]) => `<Relationship Id="${id}" Type="${t}" Target="${to}"/>`).join("")}</Relationships>`;
/** Two slides, narration on the second only. */
const deck = (narrated = true) => zip({
  "ppt/presentation.xml": `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
  "ppt/_rels/presentation.xml.rels": rels([["rId1", `${R}/slide`, "slides/slide1.xml"], ["rId2", `${R}/slide`, "slides/slide2.xml"]]),
  "ppt/slides/slide1.xml": `<p:sld xmlns:p="p"/>`,
  "ppt/slides/slide2.xml": `<p:sld xmlns:p="p"/>`,
  "ppt/slides/_rels/slide2.xml.rels": rels(narrated ? [["rId1", `${R}/audio`, "../media/media1.m4a"]] : []),
  "ppt/media/media1.m4a": Buffer.from("narration"),
});

const W1 = "courses/ABC101-Testing/01-Week-1", W2 = "courses/ABC101-Testing/02-Week-2";
function semester() {
  const root = mkdtempSync(join(tmpdir(), "ouc-transcribe-"));
  const sem = join(root, "semesters/T");
  const put = (rel: string, data: string | Buffer) => { mkdirSync(dirname(join(sem, rel)), { recursive: true }); writeFileSync(join(sem, rel), data); };
  writeFileSync(join(root, "STUDENT.md"), "Current semester: semesters/T/\n");
  put("semester.json", JSON.stringify({ label: "T", start: "2026-09-01", end: "2027-01-31", courses: [{ code: "ABC101", dir: "ABC101-Testing", title: "Testing", short: "Testing", color: "#000" }] }));
  put(`${W2}/Video-1/Intro.mp4`, "v");
  put(`${W1}/Lecture 1_audio.pptx`, deck());
  put(`${W1}/Reading.pdf`, "%PDF");
  put(`${W1}/Old.mp4`, "v");
  put(`${W1}/Old.transcript.md`, "done before");
  put(`${W1}/Silent.pptx`, deck(false));
  return { root, sem };
}
/** Says the file's name back as one segment; files named in `fail` fail. */
function fakeEngine(fail: string[] = [], gate?: Promise<void>) {
  const seen: string[] = [];
  const engine: Engine = {
    label: "fake (tiny)",
    async transcribe(files) {
      await gate;
      seen.push(...files.map((f) => basename(f)));
      return files.map((f) => (fail.some((x) => f.includes(x)) ? null : [{ start: 0, end: 1, text: `said in ${basename(f)}` }, { start: 75, end: 76, text: "later on" }]));
    },
  };
  return { engine, seen };
}

test("findMedia: videos and slide files without a transcript, oldest week first", () => {
  const { sem } = semester();
  const cfg = JSON.parse(readFileSync(join(sem, "semester.json"), "utf8"));
  assert.deepEqual(findMedia(sem, cfg).map((j) => [j.rel, j.kind, j.section, j.code]), [
    [`${W1}/Lecture 1_audio.pptx`, "slides", 1, "ABC101"],
    [`${W1}/Silent.pptx`, "slides", 1, "ABC101"],
    [`${W2}/Video-1/Intro.mp4`, "video", 2, "ABC101"],
  ]);
});

test("transcribeOne: a video's transcript, a deck's per slide, nothing for slides without narration", async () => {
  const { sem } = semester();
  const cfg = JSON.parse(readFileSync(join(sem, "semester.json"), "utf8"));
  const [lecture, silent, video] = findMedia(sem, cfg);
  const { engine } = fakeEngine();
  assert.equal(await transcribeOne(engine, video!, "T"), "done");
  const v = readFileSync(join(sem, `${W2}/Video-1/Intro.transcript.md`), "utf8");
  assert.match(v, /title: "Intro"\nsource: "T\/courses\/ABC101-Testing\/02-Week-2\/Video-1\/Intro.mp4"\nby: "fake \(tiny\)"/);
  assert.match(v, /\[0:00\] said in Intro.mp4\n\n\[1:15\] later on\n/);
  assert.equal(await transcribeOne(engine, lecture!, "T"), "done");
  const d = readFileSync(join(sem, `${W1}/Lecture 1_audio.transcript.md`), "utf8");
  assert.match(d, /title: "Lecture 1"/);
  assert.match(d, /\n## Slide 2\n\nsaid in 0\.m4a\n\nlater on\n/);
  assert.doesNotMatch(d, /Slide 1/, "slides without narration are left out");
  assert.equal(await transcribeOne(engine, silent!, "T"), "noaudio");
  assert.ok(!existsSync(join(sem, `${W1}/Silent.transcript.md`)));
  assert.equal(await transcribeOne(fakeEngine(["Intro"]).engine, { ...video!, abs: join(sem, `${W2}/Video-1/Intro.mp4`) }, "T"), "failed");
});

test("the queue: everything new once; failures wait a day; slides without narration aren't retried", async () => {
  const { root, sem } = semester();
  let now = new Date("2026-10-20T10:00:00Z");
  const { engine, seen } = fakeEngine(["Intro"]);
  const t = createTranscriber(root, { engine: () => engine, now: () => now });
  await t.run();
  assert.deepEqual(seen, ["0.m4a", "Intro.mp4"]);
  assert.ok(existsSync(join(sem, `${W1}/Lecture 1_audio.transcript.md`)));
  assert.deepEqual({ ...t.status(), current: null }, { enabled: true, busy: false, total: 3, done: 3, made: 1, failed: 1, current: null, error: null });
  await t.run();
  assert.equal(seen.length, 2, "nothing again the same day");
  now = new Date("2026-10-21T11:00:00Z");
  await t.run();
  assert.deepEqual(seen.slice(2), ["Intro.mp4"], "the failed video is tried again the next day, the silent deck isn't");
});

test("the queue: run({ only }) jumps ahead and resolves when its files are done", async () => {
  const { root, sem } = semester();
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const { engine, seen } = fakeEngine([], gate);
  const t = createTranscriber(root, { engine: () => engine });
  const all = t.run();
  const week2 = t.run({ only: (j) => j.section === 2 });
  assert.equal(t.status().busy, true);
  open();
  await week2;
  assert.ok(existsSync(join(sem, `${W2}/Video-1/Intro.transcript.md`)));
  await all;
  assert.equal(seen.length, 2);
});

test("the queue: without Whisper nothing happens and nothing complains; turned off does nothing", async () => {
  const { root, sem } = semester();
  const t = createTranscriber(root, { engine: () => null });
  await t.run();
  assert.deepEqual({ ...t.status() }, { enabled: true, busy: false, total: 0, done: 0, made: 0, failed: 0, current: null, error: null });
  assert.equal(t.whisper().available, false);
  assert.ok(!existsSync(join(sem, `${W2}/Video-1/Intro.transcript.md`)));
  mkdirSync(join(root, ".ouc"), { recursive: true });
  writeFileSync(join(root, ".ouc/media.json"), JSON.stringify({ transcribe: false }));
  let asked = 0;
  const off = createTranscriber(root, { engine: () => { asked++; return null; } });
  await off.run();
  assert.equal(asked, 0);
  assert.equal(off.status().enabled, false);
});

test("Settings: set Whisper up from the app, then it transcribes; turning it off keeps the other settings", async () => {
  const { root, sem } = semester();
  mkdirSync(join(root, ".ouc"), { recursive: true });
  writeFileSync(join(root, ".ouc/media.json"), JSON.stringify({ videos: false, transcribe: false }));
  let installed = false, finish!: () => void;
  const finished = new Promise<void>((r) => (finish = r));
  const { engine } = fakeEngine();
  const t = createTranscriber(root, { engine: () => (installed ? engine : null), install: async () => { await finished; installed = true; return { ok: true, message: "fake" }; } });
  assert.deepEqual(t.whisper(), { enabled: false, available: false, engine: null, installing: false, error: null, manual: NO_WHISPER });
  assert.equal(t.setup().installing, true);
  assert.equal(t.setup().installing, true, "a second click doesn't install twice");
  finish();
  await finished; await new Promise((r) => setImmediate(r));
  assert.deepEqual(t.whisper(), { enabled: true, available: true, engine: "fake (tiny)", installing: false, error: null, manual: NO_WHISPER });
  await t.run();
  assert.ok(existsSync(join(sem, `${W2}/Video-1/Intro.transcript.md`)), "setting it up turns transcripts on");
  assert.equal(t.setEnabled(false).enabled, false);
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".ouc/media.json"), "utf8")), { videos: false, transcribe: false });
  const failing = createTranscriber(root, { engine: () => null, install: async () => ({ ok: false, message: "brew failed" }) });
  failing.setup();
  await new Promise((r) => setImmediate(r));
  assert.equal(failing.whisper().error, "brew failed");
});

test("faster-whisper: the helper's JSON lines become segments per file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ouc-fw-"));
  const script = join(dir, "fake-transcribe.mjs");
  // stands in for tools/transcribe.py: args are --model <m> FILE...
  writeFileSync(script, `const files = process.argv.slice(4);
console.log(JSON.stringify({ file: 0, start: 0.5, end: 2, text: "first " + process.argv[3] }));
console.log("not json");
console.log(JSON.stringify({ file: 1, error: "bad audio" }));
console.log(JSON.stringify({ file: 0, start: 3, end: 4, text: "second" }));`);
  const r = await fasterWhisper(process.execPath, script, "tiny").transcribe(["a.mp4", "b.m4a"]);
  assert.deepEqual(r, [[{ start: 0.5, end: 2, text: "first tiny" }, { start: 3, end: 4, text: "second" }], null]);
});

test("Windows: the py launcher and installed Pythons, never the Microsoft Store stand-in", () => {
  const env = { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" };
  const base = "C:\\Users\\me\\AppData\\Local\\Programs\\Python";
  const onPath: Record<string, string> = { python: "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe" };
  // a fresh winget install: not on this window's PATH yet, only in its folder
  const fresh = pythonCandidates({ platform: "win32", env, which: (b) => onPath[b] ?? null, list: () => ["Python311", "Python312", "Launcher"], exists: (p) => p !== `${base}\\Launcher\\py.exe` });
  assert.deepEqual(fresh, [`${base}\\Python312\\python.exe`, `${base}\\Python311\\python.exe`]);
  onPath.py = "C:\\Windows\\py.exe";
  assert.equal(pythonCandidates({ platform: "win32", env, which: (b) => onPath[b] ?? null, list: () => [], exists: () => false })[0], "C:\\Windows\\py.exe");
  assert.deepEqual(pythonCandidates({ platform: "win32", env, which: () => null, list: () => [], exists: () => false }), []);
  assert.deepEqual(pythonCandidates({ platform: "darwin", which: (b) => (b === "python3" ? "/usr/bin/python3" : null) }), ["/usr/bin/python3"]);
});
