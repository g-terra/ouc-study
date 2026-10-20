import { test } from "node:test";
import assert from "node:assert/strict";
import { fileLink, transcriptPage, videoPage } from "../src/lib/links.ts";

const VIDEO = "/files/2026-Fall/courses/COS512-AI/01-Week-1/Video-1/What%20is%20AI.mp4";

test("class videos open on the video page; other files don't", () => {
  assert.equal(videoPage(VIDEO), "/2026-Fall/video/courses%2FCOS512-AI%2F01-Week-1%2FVideo-1%2FWhat%20is%20AI.mp4");
  assert.equal(videoPage("/files/2026-Fall/x/Reading.pdf"), null);
  assert.equal(videoPage("https://example.com/v.mp4"), null);
  assert.equal(fileLink("semesters/2026-Fall/courses/A/01-W/talk.m4a")?.to, "/2026-Fall/video/courses%2FA%2F01-W%2Ftalk.m4a");
});

test("a transcript opens with what it transcribes: the video, the slides, or alone for a Panopto link", () => {
  assert.equal(transcriptPage({ href: VIDEO, transcript: VIDEO.replace(".mp4", ".transcript.md") }), videoPage(VIDEO));
  assert.equal(transcriptPage({ href: "/files/S/courses/A/01/Deck.pptx", transcript: "/files/S/courses/A/01/Deck.transcript.md" }), "/S/slides/courses%2FA%2F01%2FDeck.pptx");
  assert.equal(transcriptPage({ href: "https://video.ouc.ac.cy/Panopto/Pages/Viewer.aspx?id=x", external: true, transcript: "/files/S/courses/A/01/Lecture%202.transcript.md" }),
    "/S/video/courses%2FA%2F01%2FLecture%202.transcript.md");
});
