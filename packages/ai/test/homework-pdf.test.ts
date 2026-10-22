// Homework PDF: finding Chrome or Edge on the computer, the file name, and printing the app's print page to a PDF.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findBrowser, makeHomeworkPdf, pdfFileName, printArgs } from "../src/homework-pdf.ts";

test("OUC_PDF_BROWSER wins, then Chrome, Edge or Chromium where each system keeps them", () => {
  const none = () => false, which = () => [];
  assert.equal(findBrowser({ platform: "darwin", env: { OUC_PDF_BROWSER: "/x/chrome" }, exists: (p) => p === "/x/chrome", which }), "/x/chrome");
  assert.equal(findBrowser({ platform: "darwin", env: {}, exists: (p) => p.includes("Microsoft Edge.app"), which }), "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
  assert.equal(findBrowser({ platform: "darwin", env: {}, exists: (p) => p.includes("Google Chrome.app") || p.includes("Edge"), which }), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  const win = findBrowser({ platform: "win32", env: { "ProgramFiles(x86)": "C:\\PF86" }, exists: (p) => p.startsWith("C:\\PF86") && p.includes("Edge"), which });
  assert.match(win!, /^C:\\PF86.*msedge\.exe$/);
  assert.equal(findBrowser({ platform: "linux", env: {}, exists: none, which: (b) => (b === "chromium" ? ["/usr/bin/chromium"] : []) }), "/usr/bin/chromium");
  assert.equal(findBrowser({ platform: "linux", env: {}, exists: none, which }), null);
});

test("the PDF is named after the assignment and the student, with only safe characters", () => {
  assert.equal(pdfFileName("Assignment 3: Naïve Bayes?", "Maria Papadopoulou"), "Assignment 3 Naïve Bayes - Maria Papadopoulou.pdf");
  assert.equal(pdfFileName("Assignment 1", ""), "Assignment 1.pdf");
  assert.equal(pdfFileName("../../etc", "a/b"), "etc - a_b.pdf");
});

test("the browser prints headless, without its own header and footer, after the page has loaded its data", () => {
  const args = printArgs("http://127.0.0.1:5173/print/x", "/out/a.pdf", { root: false });
  assert.ok(args.includes("--headless"));
  assert.ok(args.includes("--print-to-pdf=/out/a.pdf"));
  assert.ok(args.includes("--no-pdf-header-footer"));
  assert.ok(args.some((a) => a.startsWith("--virtual-time-budget=")));
  assert.equal(args.at(-1), "http://127.0.0.1:5173/print/x");
  assert.ok(!args.includes("--no-sandbox"));
  // Chrome refuses to start as root (containers, some CI) unless its sandbox is off
  assert.ok(printArgs("http://x", "/o.pdf", { root: true }).includes("--no-sandbox"));
});

test("makeHomeworkPdf writes the PDF, and says why when the browser fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ouc-pdf-"));
  const out = join(dir, "my-submission", "A.pdf");
  const ok = async (_bin: string, args: string[]) => { writeFileSync(args.find((a) => a.startsWith("--print-to-pdf="))!.slice(15), "%PDF-1.7 made up"); return { ok: true, err: "" }; };
  await makeHomeworkPdf({ browser: "/b/chrome", url: "http://x/print", out, run: ok });
  assert.match(readFileSync(out, "utf8"), /^%PDF/);
  await assert.rejects(makeHomeworkPdf({ browser: "/b/chrome", url: "http://x/print", out: join(dir, "B.pdf"), run: async () => ({ ok: false, err: "crashed" }) }), /couldn't make the PDF: crashed/);
  assert.equal(existsSync(join(dir, "B.pdf")), false);
  await assert.rejects(makeHomeworkPdf({ browser: null, url: "http://x/print", out, run: ok }), /Google Chrome or Microsoft Edge/);
});
