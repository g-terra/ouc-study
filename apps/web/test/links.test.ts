import { test } from "node:test";
import assert from "node:assert/strict";
import { fileLink, linkLabel, linkPaths, panoptoAt, pdfPage, transcriptPage, videoPage } from "../src/lib/links.ts";

const VIDEO = "/files/2026-Fall/courses/COS512-AI/01-Week-1/Video-1/What%20is%20AI.mp4";

test("class videos open on the video page; other files don't", () => {
  assert.equal(videoPage(VIDEO), "/2026-Fall/video/courses%2FCOS512-AI%2F01-Week-1%2FVideo-1%2FWhat%20is%20AI.mp4");
  assert.equal(videoPage("/files/2026-Fall/x/Reading.pdf"), null);
  assert.equal(videoPage("https://example.com/v.mp4"), null);
  assert.equal(fileLink("semesters/2026-Fall/courses/A/01-W/talk.m4a")?.to, "/2026-Fall/video/courses%2FA%2F01-W%2Ftalk.m4a");
});

test("PDFs open in the app's PDF viewer; other files don't", () => {
  assert.equal(pdfPage("/files/2026-Fall/courses/A/01-W/Reading%201.pdf"), "/2026-Fall/pdf/courses%2FA%2F01-W%2FReading%201.pdf");
  assert.equal(pdfPage("/files/2026-Fall/courses/A/01-W/Notes.PDF"), "/2026-Fall/pdf/courses%2FA%2F01-W%2FNotes.PDF");
  assert.equal(pdfPage("/files/2026-Fall/courses/A/01-W/Deck.pptx"), null);
  assert.equal(pdfPage("https://example.com/x.pdf"), null);
  assert.deepEqual(fileLink("semesters/S/assignments/A/09-28_A1/brief.pdf"), { to: "/S/pdf/assignments%2FA%2F09-28_A1%2Fbrief.pdf", internal: true });
});

test("a transcript opens with what it transcribes: the video, the slides, or alone for a Panopto link", () => {
  assert.equal(transcriptPage({ href: VIDEO, transcript: VIDEO.replace(".mp4", ".transcript.md") }), videoPage(VIDEO));
  assert.equal(transcriptPage({ href: "/files/S/courses/A/01/Deck.pptx", transcript: "/files/S/courses/A/01/Deck.transcript.md" }), "/S/slides/courses%2FA%2F01%2FDeck.pptx");
  assert.equal(transcriptPage({ href: "https://video.ouc.ac.cy/Panopto/Pages/Viewer.aspx?id=x", external: true, transcript: "/files/S/courses/A/01/Lecture%202.transcript.md" }),
    "/S/video/courses%2FA%2F01%2FLecture%202.transcript.md");
});

test("a note's citation opens the material at the spot: a PDF page, a slide, a moment of a video or a Panopto transcript", () => {
  const C = "semesters/S/courses/A-Course/01-Week-1";
  assert.deepEqual(fileLink(`${C}/Reading 1.pdf#page=12`), { to: "/S/pdf/courses%2FA-Course%2F01-Week-1%2FReading%201.pdf#page=12", internal: true });
  assert.deepEqual(fileLink(`${C}/Reading 1.pdf#page=12-14`), { to: "/S/pdf/courses%2FA-Course%2F01-Week-1%2FReading%201.pdf#page=12", internal: true });
  assert.deepEqual(fileLink(`${C}/Deck.pptx#slide=5`), { to: "/S/slides/courses%2FA-Course%2F01-Week-1%2FDeck.pptx#5", internal: true });
  assert.deepEqual(fileLink(`${C}/Talk.mp4#t=12:03`), { to: "/S/video/courses%2FA-Course%2F01-Week-1%2FTalk.mp4#t=723", internal: true });
  assert.deepEqual(fileLink(`${C}/Lecture 2.transcript.md#t=1:02:05`), { to: "/S/video/courses%2FA-Course%2F01-Week-1%2FLecture%202.transcript.md#t=3725", internal: true });
  // paths inside the semester folder work too, and a spot that doesn't fit the file is left off
  assert.deepEqual(fileLink("courses/A-Course/01-Week-1/Deck.pptx#slide=2", "S")?.to, "/S/slides/courses%2FA-Course%2F01-Week-1%2FDeck.pptx#2");
  assert.deepEqual(fileLink(`${C}/Notes.docx#page=3`), { to: "/files/S/courses/A-Course/01-Week-1/Notes.docx", internal: false });
});

test("a citation shows the file's name and the spot", () => {
  const C = "semesters/S/courses/A-Course/01-Week-1";
  assert.equal(linkLabel(`${C}/Reading 1.pdf#page=12`), "Reading 1.pdf, p. 12");
  assert.equal(linkLabel(`${C}/Reading 1.pdf#page=12-14`), "Reading 1.pdf, pp. 12–14");
  assert.equal(linkLabel(`${C}/Deck.pptx#slide=5`), "Deck.pptx, slide 5");
  assert.equal(linkLabel(`${C}/Deck.pptx#slide=5-7`), "Deck.pptx, slides 5–7");
  assert.equal(linkLabel(`${C}/Talk.mp4#t=12:03`), "Talk.mp4 at 12:03");
  assert.equal(linkLabel(`${C}/Lecture 2.transcript.md#t=12:03`), "Lecture 2 at 12:03");
});

test("citations in a note's Markdown become links that say where they point", () => {
  const html = linkPaths("<p>See <code>courses/A/01-W/Deck.pptx#slide=4</code>.</p>", "S");
  assert.match(html, /<a href="\/S\/slides\/courses%2FA%2F01-W%2FDeck\.pptx#4" data-internal title="courses\/A\/01-W\/Deck\.pptx#slide=4"><code>Deck\.pptx, slide 4<\/code><\/a>/);
});

test("a Panopto recording opens at a moment", () => {
  assert.equal(panoptoAt("https://video.example.cy/Panopto/Pages/Viewer.aspx?id=x", 723.4), "https://video.example.cy/Panopto/Pages/Viewer.aspx?id=x&start=723");
  assert.equal(panoptoAt("not a url", 5), "not a url");
});
