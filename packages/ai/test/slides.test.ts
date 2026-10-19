// The slide viewer's server side: a made-up .pptx becomes a PDF (a fake converter, or LibreOffice when
// it's installed) plus each slide's narration clips, served at /api/slides/*.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSlidesApi, libreOffice, pptxSlides, type Convert } from "../src/slides.ts";
import { json, portOf, zip } from "./helpers.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const DEMO = join(REPO, "e2e/demo/2026-Demo/courses/DEMO101-Demo-Studies/01-Week-1-Getting-started/Demo lecture.pptx");

const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rels = (list: [id: string, type: string, target: string][]) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, t, to]) => `<Relationship Id="${id}" Type="${t}" Target="${to}"/>`).join("")}</Relationships>`;
/** Three slides, listed out of file order; the middle one hidden; narration on the first and last. */
const pptx = () => zip({
  "ppt/presentation.xml": `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/><p:sldId id="258" r:id="rId1"/></p:sldIdLst></p:presentation>`,
  "ppt/_rels/presentation.xml.rels": rels([["rId1", `${R}/slide`, "slides/slide1.xml"], ["rId2", `${R}/slide`, "slides/slide2.xml"], ["rId3", `${R}/slide`, "slides/slide3.xml"], ["rId9", `${R}/theme`, "theme/theme1.xml"]]),
  "ppt/slides/slide3.xml": `<p:sld xmlns:p="p"><p:cSld/></p:sld>`,
  "ppt/slides/_rels/slide3.xml.rels": rels([["rId1", `${R}/audio`, "../media/media7.m4a"], ["rId2", "http://schemas.microsoft.com/office/2007/relationships/media", "../media/media7.m4a"], ["rId3", `${R}/image`, "../media/image1.png"]]),
  "ppt/slides/slide2.xml": `<p:sld xmlns:p="p" show="0"><p:cSld/></p:sld>`,
  "ppt/slides/_rels/slide2.xml.rels": rels([["rId1", `${R}/audio`, "../media/media2.m4a"]]),
  "ppt/slides/slide1.xml": `<p:sld xmlns:p="p"><p:cSld/></p:sld>`,
  "ppt/slides/_rels/slide1.xml.rels": rels([["rId1", `${R}/audio`, "../media/media1.mp3"], ["rId2", `${R}/video`, "../media/media9.mp4x"]]),
  "ppt/media/media7.m4a": Buffer.from("narration seven"),
  "ppt/media/media2.m4a": Buffer.from("hidden"),
  "ppt/media/media1.mp3": Buffer.from("narration one"),
});

test("pptxSlides lists the shown slides in order, with their audio", () => {
  assert.deepEqual(pptxSlides(pptx()), [
    { n: 1, audio: ["ppt/media/media7.m4a"] },
    { n: 2, audio: ["ppt/media/media1.mp3"] },
  ]);
  assert.equal(pptxSlides(zip({ "word/document.xml": "<w:document/>" })), null);
  assert.equal(pptxSlides(Buffer.from("not a zip")), null);
  // the demo deck of the smoke tests: two slides, a tone on the first
  assert.deepEqual(pptxSlides(readFileSync(DEMO)), [{ n: 1, audio: ["ppt/media/media1.wav"] }, { n: 2, audio: [] }]);
});

/** A course folder with the made-up deck, and the API on a local server. */
async function setup(t: test.TestContext, convert: () => Convert | null) {
  const root = mkdtempSync(join(tmpdir(), "ouc-slides-test-"));
  const dir = join(root, "semesters/2026-Test/courses/T101/01-Week-1");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "Lecture 1.pptx"), pptx());
  writeFileSync(join(root, "semesters/2026-Test/notes.md"), "not slides");
  const handler = createSlidesApi({ semesters: join(root, "semesters"), cache: join(root, ".ouc/slides"), convert });
  const server = http.createServer((req, res) => handler(req, res, () => { res.statusCode = 418; res.end(); }));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${portOf(server)}`;
  const info = (file: string) => fetch(`${base}/api/slides/info?file=${encodeURIComponent(file)}`);
  return { root, base, info, file: "2026-Test/courses/T101/01-Week-1/Lecture 1.pptx" };
}

test("/api/slides makes the PDF once, keeps the narration and serves both", async (t) => {
  let calls = 0;
  const fake: Convert = async (src, out) => {
    calls++;
    await new Promise((r) => setTimeout(r, 50));
    const pdf = join(out, `${basename(src, extname(src))}.pdf`);
    writeFileSync(pdf, "%PDF-1.4 fake");
    return pdf;
  };
  const { root, base, info, file } = await setup(t, () => fake);

  // two viewers at once: one conversion
  const [a, b] = await Promise.all([json(info(file)), json(info(file))]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  assert.equal(a.ok, true);
  assert.equal(a.download, "/files/2026-Test/courses/T101/01-Week-1/Lecture%201.pptx");
  assert.match(a.pdf, /^\/api\/slides\/file\/[0-9a-f]{16}\/slides\.pdf$/);
  assert.deepEqual(a.slides.map((s: any) => s.audio.map((u: string) => u.split("/").pop())), [["media7.m4a"], ["media1.mp3"]]);

  const pdf = await fetch(base + a.pdf);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal(await pdf.text(), "%PDF-1.4 fake");
  // audio seeks with byte ranges
  const clip = await fetch(base + a.slides[0].audio[0], { headers: { Range: "bytes=10-" } });
  assert.equal(clip.status, 206);
  assert.equal(clip.headers.get("content-type"), "audio/mp4");
  assert.equal(clip.headers.get("content-range"), "bytes 10-14/15");
  assert.equal(await clip.text(), "seven");

  // cached: no second conversion, and the hidden slide's audio wasn't taken out
  assert.deepEqual(await json(info(file)), a);
  assert.equal(calls, 1);
  const [key] = readdirSync(join(root, ".ouc/slides"));
  assert.deepEqual(readdirSync(join(root, ".ouc/slides", key)).sort(), ["media1.mp3", "media7.m4a", "slides.json", "slides.pdf"]);

  // a changed file is converted again, and the old copy goes
  const later = new Date(Date.now() + 5000);
  utimesSync(join(root, "semesters", file), later, later);
  const c = await json(info(file));
  assert.equal(calls, 2);
  assert.notEqual(c.pdf, a.pdf);
  assert.deepEqual(readdirSync(join(root, ".ouc/slides")), [c.pdf.split("/")[4]]);
});

test("/api/slides refuses what isn't a slide file in the course folders", async (t) => {
  const { base, info, file } = await setup(t, () => { throw new Error("must not convert"); });
  for (const f of ["../../etc/passwd.pptx", "2026-Test/notes.md", "2026-Test/missing.pptx", ""]) {
    const r = await info(f);
    assert.equal(r.status, 404, f);
    assert.equal((await json(r)).ok, false);
  }
  assert.equal((await fetch(`${base}/api/slides/file/0123456789abcdef/../../x`)).status, 404);
  assert.equal((await fetch(`${base}/api/slides/file/0123456789abcdef/slides.pdf`)).status, 404);
  // other websites can't use it
  assert.equal((await fetch(`${base}/api/slides/info?file=${encodeURIComponent(file)}`, { headers: { Origin: "https://evil.example" } })).status, 403);
});

test("/api/slides says how to get LibreOffice when it isn't installed", async (t) => {
  const { info, file } = await setup(t, () => null);
  const r = await json(info(file));
  assert.equal(r.ok, false);
  assert.equal(r.needsConverter, true);
  assert.match(r.error, /LibreOffice/);
  assert.match(r.download, /^\/files\/2026-Test\//);
});

test("/api/slides reports a conversion that fails", async (t) => {
  const { info, file } = await setup(t, () => async () => { throw new Error("LibreOffice couldn't open these slides."); });
  const r = await info(file);
  assert.equal(r.status, 500);
  assert.match((await json(r)).error, /couldn't open/);
});

test("LibreOffice turns the demo deck into a two-page PDF", { skip: libreOffice() ? false : "LibreOffice isn't installed", timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ouc-slides-lo-"));
  cpSync(DEMO, join(dir, "deck.pptx"));
  const pdf = await libreOffice()!(join(dir, "deck.pptx"), dir);
  assert.ok(existsSync(pdf));
  const body = readFileSync(pdf, "latin1");
  assert.ok(body.startsWith("%PDF"));
  assert.equal(body.match(/\/Type\s*\/Page\b/g)?.length, 2);
});
