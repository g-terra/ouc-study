// Pre-submission review: a made-up .docx is uploaded, reviewed by the fake agent, re-uploaded and approved.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { createAiApi } from "../api.mjs";
import { docxText, isDocx, wordCount } from "../docx.mjs";
import { approve, findConverter, safeBase } from "../review.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");

// ---------- a tiny zip writer, to make a .docx without any library ----------
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const local = [], central = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), data = deflateRawSync(raw), n = Buffer.from(name);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc32(raw), 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc32(raw), 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    local.push(h, n, data); central.push(c, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, end]);
}
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const p = (text, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const docx = (body) => zip({
  "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
});
const SAMPLE = docx(p("Question 1", "Heading1") + p("Attention is selective &amp; limited.") +
  `<w:tbl><w:tr><w:tc>${p("cue")}</w:tc><w:tc>${p("valid")}</w:tc></w:tr></w:tbl>` + p("Done."));

test("docx text: headings, entities and tables", () => {
  assert.ok(isDocx(SAMPLE));
  assert.ok(!isDocx(Buffer.from("%PDF-1.4 not a docx")));
  assert.ok(!isDocx(zip({ "hello.txt": "a zip, but not Word" })));
  assert.equal(docxText(SAMPLE), "# Question 1\nAttention is selective & limited.\n| cue | valid |\n\nDone.");
  assert.equal(wordCount("It's a d′ test, 2 words-ish."), 6);
  assert.equal(safeBase("../My answers: final?.docx"), "My answers_ final_");
});

async function setup(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "ouc-review-"));
  cpSync(join(REPO, "ai/skills"), join(root, "ai/skills"), { recursive: true });
  mkdirSync(join(root, ".ouc"));
  writeFileSync(join(root, ".ouc/ai.json"), JSON.stringify({ tool: "claude" }));
  const sem = join(root, "semesters/S");
  mkdirSync(join(sem, "assignments/AAA/a1"), { recursive: true });
  writeFileSync(join(sem, "semester.json"), JSON.stringify({ start: "2000-01-01", end: "2999-01-01", courses: [] }));
  mkdirSync(join(root, "apps/web/public/data"), { recursive: true });
  const file = (name) => ({ kind: "file", title: name, href: `/files/S/courses/AAA/02-Week-1/${encodeURIComponent(name)}` });
  writeFileSync(join(root, "apps/web/public/data/S.json"), JSON.stringify({
    courses: [{ code: "AAA", short: "AAA", title: "AAA course", weeks: [{ index: 0, name: "General", items: [file("Marking rubric.pdf")] }, { index: 1, name: "Week 1", items: [file("Slides 1.pdf")] }] }],
    notes: [{ code: "AAA", slug: "week-01-attention", weekIndex: 1 }],
    assignments: [{ id: "AAA/a1", code: "AAA", title: "A1", fullTitle: "Assignment 1", status: "", submitted: false, question: "", weekIndex: 1, briefs: [{ name: "brief.pdf", href: "/files/S/assignments/AAA/a1/brief.pdf", ext: "pdf" }], submissions: [] }],
  }));
  const mw = createAiApi(root, { bin: join(HERE, "fixtures/fake-agent.mjs"), noAutoPrep: true, ...opts });
  const server = http.createServer((req, res) => mw(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { token } = await (await fetch(`${base}/api/ai/status`)).json();
  const upload = (buf, name = "My answers.docx", t = token) => fetch(`${base}/api/ai/review/upload?sem=S&assignment=AAA%2Fa1&name=${encodeURIComponent(name)}`, { method: "POST", headers: { "X-OUC-AI": t }, body: buf });
  const post = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: { "X-OUC-AI": token }, body: JSON.stringify(body) });
  return { root, sem, server, base, upload, post };
}

test("review rounds: upload, review with context, a second round, approve", async (t) => {
  const { root, sem, server, base, upload, post } = await setup({ converter: null });
  t.after(() => server.close());
  const dir = join(sem, "assignments/AAA/a1/review");

  // only this app may upload, and only a .docx
  assert.equal((await upload(SAMPLE, "x.docx", "wrong")).status, 403);
  const bad = await upload(Buffer.from("plain text"), "notes.txt");
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /\.docx/);

  // reviewing before any upload says what to do
  const early = await post("/api/ai/run", { sem: "S", action: "assignment-review", params: { assignment: "AAA/a1" } });
  assert.match((await early.json()).error, /Upload your \.docx/);

  const up = await (await upload(SAMPLE)).json();
  assert.equal(up.version.v, 1);
  assert.equal(up.version.name, "My answers.docx");
  assert.ok(readFileSync(join(dir, "v1.docx")).equals(SAMPLE));
  assert.match(readFileSync(join(dir, "v1.md"), "utf8"), /# Question 1/);

  // the reviewer gets the draft and the subject's context, and writes REVIEW-v1.md
  await (await post("/api/ai/run", { sem: "S", action: "assignment-review", params: { assignment: "AAA/a1" } })).text();
  const chat = JSON.parse(readFileSync(join(root, ".ouc/chats", `${JSON.parse(readFileSync(join(dir, "review.json"), "utf8")).versions[0].review.chatId}.json`), "utf8"));
  const prompt = chat.messages[0].prompt;
  for (const want of ["assignment-review skill", "review/v1.md", "assignments/AAA/a1/brief.pdf", "Marking rubric.pdf", "Slides 1.pdf", "notes/AAA/week-01-attention.md", "never write replacement answers"]) assert.ok(prompt.includes(want), want);
  let st = await (await fetch(`${base}/api/ai/review?sem=S&assignment=AAA%2Fa1`)).json();
  assert.equal(st.versions[0].review.verdict, "almost");
  assert.match(st.versions[0].review.body, /Nearly there/);
  assert.equal(st.versions[0].review.ok, true);
  assert.equal(st.versions[0].review.running, false);
  assert.equal(st.versions[0].href, "/files/S/assignments/AAA/a1/review/v1.docx");

  // round 2 compares with round 1
  await upload(SAMPLE, "My answers v2.docx");
  await (await post("/api/ai/run", { sem: "S", action: "assignment-review", params: { assignment: "AAA/a1" } })).text();
  st = await (await fetch(`${base}/api/ai/review?sem=S&assignment=AAA%2Fa1`)).json();
  assert.deepEqual(st.versions.map((v) => v.v), [1, 2]);
  assert.ok(existsSync(join(dir, "REVIEW-v2.md")));

  // no converter: a clear message, nothing approved
  const no = await post("/api/ai/review/approve", { sem: "S", assignment: "AAA/a1" });
  assert.equal(no.status, 400);
  assert.match((await no.json()).error, /LibreOffice/);
  assert.equal(st.approved, undefined);
});

test("approve converts the student's .docx to a PDF", { skip: !findConverter() || findConverter().kind !== "libreoffice" ? "LibreOffice isn't installed" : false }, async (t) => {
  const { root, sem, server, upload } = await setup();
  t.after(() => server.close());
  await upload(SAMPLE, "Final answers.docx");
  const a = { id: "AAA/a1" };
  const ap = await approve(root, "S", a);
  assert.equal(ap.v, 1);
  assert.equal(ap.pdf, "Final answers.pdf");
  const pdf = readFileSync(join(sem, "assignments/AAA/a1/review/Final answers.pdf"));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
});
