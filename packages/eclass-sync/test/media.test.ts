// Class videos: Panopto links, captions and the transcript format (src/media.ts), on made-up data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMediaConfig, panoptoCaptions, panoptoSession, paragraphs, srtToSegments, stamp, transcriptMarkdown, transcriptPath } from "../src/media.ts";

const ID = "0006a033-0ea5-4b2e-b1ab-b2000120fe5f";
const SRT = "\uFEFF1\r\n00:00:01,000 --> 00:00:03,500\r\nHello <i>everyone</i>\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nwelcome to\r\nweek one\r\n\r\n3\r\n00:01:10,250 --> 00:01:12,000\r\n \r\n\r\n4\r\n00:01:30,000 --> 00:01:33,000\r\nNeurons fire.\r\n";

test("transcripts sit next to the file they transcribe", () => {
  assert.equal(transcriptPath("courses/A/01-Week/Lecture 3.mp4"), "courses/A/01-Week/Lecture 3.transcript.md");
  assert.equal(transcriptPath("C:\\x\\v.1.pptx"), "C:\\x\\v.1.transcript.md");
});

test("settings default to on, with the small model", () => {
  const root = mkdtempSync(join(tmpdir(), "ouc-media-"));
  assert.deepEqual(loadMediaConfig(root), { videos: true, transcribe: true, model: "small" });
  mkdirSync(join(root, ".ouc"));
  writeFileSync(join(root, ".ouc/media.json"), JSON.stringify({ videos: false, model: "../evil" }));
  assert.deepEqual(loadMediaConfig(root), { videos: false, transcribe: true, model: "small" });
});

test("Panopto viewer and embed links give the session; others don't", () => {
  assert.deepEqual(panoptoSession(`https://video.ouc.ac.cy/Panopto/Pages/Viewer.aspx?id=${ID}`), { origin: "https://video.ouc.ac.cy", id: ID });
  assert.equal(panoptoSession(`https://video.ouc.ac.cy/Panopto/Pages/Embed.aspx?id=${ID}&autoplay=1`)?.id, ID);
  assert.equal(panoptoSession("https://video.ouc.ac.cy/Panopto/Pages/Viewer.aspx?id=nope"), null);
  assert.equal(panoptoSession("https://www.youtube.com/watch?v=x"), null);
  assert.equal(panoptoSession("not a url"), null);
});

test("SRT becomes segments, without markup or empty cues", () => {
  assert.deepEqual(srtToSegments(SRT), [
    { start: 1, end: 3.5, text: "Hello everyone" },
    { start: 4, end: 6, text: "welcome to week one" },
    { start: 90, end: 93, text: "Neurons fire." },
  ]);
  assert.deepEqual(srtToSegments("<html>sign in</html>"), []);
});

test("paragraphs of about a minute, with times", () => {
  assert.equal(stamp(3725), "1:02:05");
  assert.equal(stamp(65.9), "1:05");
  assert.deepEqual(paragraphs(srtToSegments(SRT)), ["[0:01] Hello everyone welcome to week one", "[1:30] Neurons fire."]);
  assert.deepEqual(paragraphs(srtToSegments(SRT), { stamps: false, every: 1000 }), ["Hello everyone welcome to week one Neurons fire."]);
});

test("the transcript file: front matter, then a video's paragraphs or a deck's slides", () => {
  const made = new Date("2026-10-20T10:00:00Z");
  const video = transcriptMarkdown({ title: "Lecture 3", source: "2026-Fall/courses/A/03-W/Lecture 3.mp4", by: "whisper.cpp (small)", made }, [{ segments: srtToSegments(SRT) }]);
  assert.match(video, /^---\ntitle: "Lecture 3"\nsource: "2026-Fall\/courses\/A\/03-W\/Lecture 3.mp4"\nby: "whisper.cpp \(small\)"\nmade: 2026-10-20\n---\n/);
  assert.match(video, /# Transcript: Lecture 3\n/);
  assert.match(video, /Times are \[minutes:seconds\]/);
  assert.match(video, /\n\[1:30\] Neurons fire\.\n/);
  const deck = transcriptMarkdown({ title: "Attention", source: "x.pptx", by: "faster-whisper (small)", made }, [
    { heading: "Slide 1", segments: [{ start: 0, end: 2, text: "Today: attention." }] },
    { heading: "Slide 2", segments: [] },
  ]);
  assert.match(deck, /slides' narration/);
  assert.match(deck, /## Slide 1\n\nToday: attention\.\n\n## Slide 2\n\n_\(no narration\)_\n/);
  assert.doesNotMatch(deck, /\[0:00\]/);
});

test("Panopto captions: saved when shared, 'signin' when Panopto asks for it", async () => {
  const url = `https://video.ouc.ac.cy/Panopto/Pages/Viewer.aspx?id=${ID}`;
  const asked: string[] = [];
  const answer = (body: string, status = 200) => (async (u: string | URL | Request) => { asked.push(String(u)); return new Response(body, { status }); }) as typeof fetch;
  const r = await panoptoCaptions(url, answer(SRT));
  assert.ok(r.ok && srtToSegments(r.srt).length === 3);
  assert.equal(asked[0], `https://video.ouc.ac.cy/Panopto/Pages/Transcription/GenerateSRT.ashx?id=${ID}&language=0`);
  assert.deepEqual(await panoptoCaptions(url, answer("", 302)), { ok: false, reason: "signin" });
  assert.deepEqual(await panoptoCaptions(url, answer("<html><form>Sign in</form></html>")), { ok: false, reason: "signin" });
  assert.deepEqual(await panoptoCaptions(url, answer("", 404)), { ok: false, reason: "none" });
  assert.deepEqual(await panoptoCaptions(url, (async () => { throw new Error("ENOTFOUND"); }) as typeof fetch), { ok: false, reason: "offline" });
  assert.deepEqual(await panoptoCaptions("https://example.com/x", answer(SRT)), { ok: false, reason: "none" });
});
