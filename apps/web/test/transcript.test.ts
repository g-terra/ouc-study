import { test } from "node:test";
import assert from "node:assert/strict";
import { lineAt, parseTranscript, stamp, timeOf } from "../src/lib/transcript.ts";

const VIDEO = `---
title: "Lecture 3"
source: "2026-Fall/courses/A/03-W/Lecture 3.mp4"
by: "whisper.cpp (small)"
made: 2026-10-20
---

# Transcript: Lecture 3

_Made automatically from the recording's audio, so names and terms can be misheard. Times are [minutes:seconds] into the recording._

[0:01] Hello everyone
welcome to week one

[1:30] Neurons fire.

[1:02:05] The end.
`;
const DECK = `---
title: "Attention"
source: "x.pptx"
by: "faster-whisper (small)"
made: 2026-10-20
---

# Transcript: Attention

_Made automatically from the slides' narration, so names and terms can be misheard._

## Slide 1

Today: attention.

## Slide 2

_(no narration)_

## Slide 3

First part.

Second part.
`;

test("times read both ways", () => {
  assert.equal(timeOf("1:05"), 65);
  assert.equal(timeOf("1:02:05"), 3725);
  assert.equal(timeOf("soon"), null);
  assert.equal(stamp(65.9), "1:05");
  assert.equal(stamp(3725), "1:02:05");
});

test("a video's transcript: its details and timed paragraphs", () => {
  const t = parseTranscript(VIDEO);
  assert.deepEqual({ title: t.title, by: t.by, made: t.made }, { title: "Lecture 3", by: "whisper.cpp (small)", made: "2026-10-20" });
  assert.match(t.note!, /^Made automatically/);
  assert.deepEqual(t.sections, [{ lines: [
    { at: 1, text: "Hello everyone welcome to week one" },
    { at: 90, text: "Neurons fire." },
    { at: 3725, text: "The end." },
  ] }]);
});

test("a deck's transcript: one section per slide, empty slides kept without lines", () => {
  const t = parseTranscript(DECK.replace(/\n/g, "\r\n"));
  assert.equal(t.title, "Attention");
  assert.deepEqual(t.sections.map((s) => [s.slide, s.lines.map((l) => l.text)]), [[1, ["Today: attention."]], [2, []], [3, ["First part.", "Second part."]]]);
});

test("the line playing follows the time", () => {
  const { lines } = parseTranscript(VIDEO).sections[0]!;
  assert.equal(lineAt(lines, 0), -1);
  assert.equal(lineAt(lines, 1), 0);
  assert.equal(lineAt(lines, 89), 0);
  assert.equal(lineAt(lines, 600), 1);
  assert.equal(lineAt(lines, 99999), 2);
});
