// The text copies the AI reads (tools/extract_text.py): a PDF's pages are marked "--- page N ---" so a note
// can cite the page, and copies made before the markers are made again once. Runs the Python helpers directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const python = ["python3", "python"].find((p) => spawnSync(p, ["--version"], { stdio: "ignore" }).status === 0)!;
const tools = resolve(import.meta.dirname, "../../../tools");
/** Calls a function of tools/extract_text.py with JSON arguments and returns its JSON result. */
function py(fn: string, ...args: unknown[]): unknown {
  const code = `import sys, json; sys.path.insert(0, ${JSON.stringify(tools)}); import extract_text as x; print(json.dumps(x.${fn}(*json.loads(sys.argv[1]))))`;
  const r = spawnSync(python, ["-c", code, JSON.stringify(args)], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test("a PDF's text copy marks each page, keeping the page breaks search splits on", () => {
  assert.equal(py("paged", ["First page\n", "Second page"]), "--- page 1 ---\n\nFirst page\n\f--- page 2 ---\n\nSecond page");
});

test("a text copy is made again when its file changed, and a PDF's once more when it has no page markers yet", () => {
  const dir = mkdtempSync(join(tmpdir(), "ouc-text-"));
  const pdf = join(dir, "a.pdf"), txt = join(dir, "a.pdf.txt"), pptx = join(dir, "b.pptx"), ptxt = join(dir, "b.pptx.txt");
  writeFileSync(pdf, "x"); writeFileSync(pptx, "x");
  utimesSync(pdf, 1000, 1000); utimesSync(pptx, 1000, 1000);
  assert.equal(py("stale", pdf, txt), true);   // no copy yet
  writeFileSync(txt, "old text\fpage two"); utimesSync(txt, 2000, 2000);
  assert.equal(py("stale", pdf, txt), true);   // made before page markers
  writeFileSync(txt, "--- page 1 ---\n\nnew text"); utimesSync(txt, 2000, 2000);
  assert.equal(py("stale", pdf, txt), false);
  utimesSync(pdf, 3000, 3000);
  assert.equal(py("stale", pdf, txt), true);   // the PDF changed
  writeFileSync(ptxt, "--- slide 1 ---\nhello"); utimesSync(ptxt, 2000, 2000);
  assert.equal(py("stale", pptx, ptxt), false);   // slides were always marked
});
