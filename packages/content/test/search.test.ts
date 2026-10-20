// Search: matching words without accents, splitting files into parts, and links that open the right moment.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fold, marks, queryWords, snippet } from "../src/search-text.ts";
import { plainMarkdown, search, semesterDocs, textCopyParts, transcriptParts } from "../src/search.ts";
import type { SemesterData } from "../src/types.ts";

test("fold drops case and accents and keeps positions", () => {
  assert.equal(fold("Μνήμη Εργασίας"), "μνημη εργασιασ");
  assert.equal(fold("Café"), "cafe");
  assert.equal(fold("Ünïcode").length, "Ünïcode".length);
  assert.deepEqual(queryWords("  Working   memory, working "), ["working", "memory"]);
});

test("snippet cuts around the first match on word boundaries", () => {
  const long = `${"filler words here ".repeat(20)}the working memory model ${"and more text after ".repeat(20)}`;
  const s = snippet(long, ["working"], 80);
  assert.match(s, /^….*working memory.*…$/);
  assert.ok(s.length <= 82);
  assert.equal(snippet("short text", ["x"]), "short text");
});

test("marks highlights the query words", () => {
  assert.deepEqual(marks("The Mémoire test", ["memoire"]), [{ text: "The ", hit: false }, { text: "Mémoire", hit: true }, { text: " test", hit: false }]);
});

test("Markdown shows as plain words in results", () => {
  assert.equal(plainMarkdown("> [!IDEA] Big idea\n> **Working** memory, see [the paper](https://x.org) and `code`\n## Heading"), "Big idea\nWorking memory, see the paper and code\nHeading");
});

test("transcript parts carry times and slides", () => {
  const video = "---\ntitle: \"x\"\n---\n\n# Transcript: x\n\n_Made automatically._\n\n[0:00] Hello there.\n\n[1:05] Working memory holds a few items.";
  assert.deepEqual(transcriptParts(video), [{ text: "Hello there.", at: 0 }, { text: "Working memory holds a few items.", at: 65 }]);
  const deck = "# Transcript: d\n\n## Slide 1\n\nFirst slide.\n\n## Slide 2\n\n_(no narration)_\n\n## Slide 3\n\nThird one.";
  assert.deepEqual(transcriptParts(deck), [{ text: "First slide.", slide: 1 }, { text: "Third one.", slide: 3 }]);
});

test("text copies split by slide or PDF page", () => {
  assert.deepEqual(textCopyParts("--- slide 1 ---\nIntro\n\n[speaker notes]\nSay hi\n\n--- slide 2 ---\n\n--- slide 3 ---\nAttention", "pptx"),
    [{ text: "Intro\n\n\nSay hi", slide: 1 }, { text: "Attention", slide: 3 }]);
  assert.deepEqual(textCopyParts("page one\fpage two", "pdf"), [{ text: "page one", page: 1 }, { text: "page two", page: 2 }]);
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "ouc-search-"));
  const wk = "courses/DEMO101-Demo/01-Week-1";
  mkdirSync(join(dir, wk), { recursive: true });
  mkdirSync(join(dir, "text/DEMO101-Demo/01-Week-1"), { recursive: true });
  mkdirSync(join(dir, "assignments/DEMO101/10-01_A1"), { recursive: true });
  writeFileSync(join(dir, wk, "Talk.transcript.md"), "# Transcript: Talk\n\n[0:00] Welcome.\n\n[2:30] The exam room is Room 2.");
  writeFileSync(join(dir, wk, "Deck.transcript.md"), "## Slide 4\n\nAttention is limited.");
  writeFileSync(join(dir, "text/DEMO101-Demo/01-Week-1/Deck.pptx.txt"), "--- slide 1 ---\nTitle\n\n--- slide 2 ---\nSelective attention");
  writeFileSync(join(dir, "text/DEMO101-Demo/01-Week-1/Reading.pdf.txt"), "Intro\fChunking helps memory");
  writeFileSync(join(dir, "assignments/DEMO101/10-01_A1/README.md"), "---\nx: 1\n---\nMy plan: compare chunking studies.");
  const f = (rel: string) => `/files/2026-Demo/${rel.split("/").map(encodeURIComponent).join("/")}`;
  const data = {
    id: "2026-Demo",
    courses: [{ code: "DEMO101", weeks: [{ index: 1, label: "Getting started", items: [
      { kind: "video", title: "Talk", href: f(`${wk}/Talk.mp4`), transcript: f(`${wk}/Talk.transcript.md`) },
      { kind: "file", title: "Deck", href: f(`${wk}/Deck.pptx`), ext: "pptx", transcript: f(`${wk}/Deck.transcript.md`) },
      { kind: "file", title: "Reading", href: f(`${wk}/Reading.pdf`), ext: "pdf" },
    ] }] }],
    notes: [{ code: "DEMO101", slug: "week-01", title: "Week 1: memory", summary: "", weekIndex: 1, body: "> [!IDEA]\n> Working memory is small." }],
    assignments: [{ id: "DEMO101/10-01_A1", code: "DEMO101", title: "A1", fullTitle: "Assignment 1", question: "Explain attention.", weekIndex: 1 }],
    updates: { days: [
      { date: "2026-10-19", items: [{ type: "announcement", code: "DEMO101", title: "Announcement: Exam", detail: "The exam is in Room 2.", url: "", at: "" }] },
      { date: "2026-10-18", items: [{ type: "announcement", code: "DEMO101", title: "Announcement: Exam", detail: "The exam is in Room 2.", url: "", at: "" }, { type: "grade", code: "DEMO101", title: "Grade", detail: "Room 2", url: "", at: "" }] },
    ] },
  } as unknown as SemesterData;
  return { dir, data };
}

test("a semester's documents open at the right moment", () => {
  const { dir, data } = fixture();
  const docs = semesterDocs(data, dir);
  const room = search(docs, "exam room", data);
  const talk = room.find((h) => h.kind === "transcript")!;
  assert.equal(talk.to, "/2026-Demo/video/courses%2FDEMO101-Demo%2F01-Week-1%2FTalk.mp4#t=150");
  assert.equal(talk.at, 150);
  assert.equal(talk.weekLabel, "Getting started");
  // the same post on two days counts once; grades aren't searched
  assert.equal(room.filter((h) => h.kind === "post").length, 1);
  assert.equal(room.find((h) => h.kind === "post")!.to, "/2026-Demo/updates");

  const att = search(docs, "attention", data);
  assert.ok(att.some((h) => h.kind === "transcript" && h.to.endsWith("Deck.pptx#4")), "a deck's transcript opens the slide viewer at the slide");
  assert.ok(att.some((h) => h.kind === "slides" && h.to === "/2026-Demo/slides/courses%2FDEMO101-Demo%2F01-Week-1%2FDeck.pptx#2" && h.title === "Deck"));
  assert.ok(att.some((h) => h.kind === "assignment" && h.to === "/2026-Demo/assignments/DEMO101/10-01_A1"));

  const pdf = search(docs, "chunking", data).find((h) => h.kind === "file")!;
  assert.equal(pdf.to, "/files/2026-Demo/courses/DEMO101-Demo/01-Week-1/Reading.pdf#page=2");
  assert.equal(pdf.external, true);
  assert.ok(search(docs, "chunking", data).some((h) => h.kind === "assignment"), "working notes are searched");

  const note = search(docs, "WORKING memory", data)[0]!;
  assert.equal(note.kind, "note");
  assert.equal(note.to, "/2026-Demo/notes/DEMO101/week-01");
  assert.equal(note.snippet, "Working memory is small.");
  assert.deepEqual(search(docs, "working nothing", data), [], "every word must be there");
  assert.deepEqual(search(docs, "  ", data), []);
});
