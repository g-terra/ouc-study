// Homework answers: plain answers from before the rich editor, and the formula pop-up's symbol buttons.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FORMULA_SNIPPETS, answerTables, insertSnippet, isEmptyAnswer, toEditorHtml } from "../src/lib/answer-html.ts";

test("a plain-text answer opens in the editor as paragraphs, with its characters kept as text", () => {
  assert.equal(toEditorHtml("First line\nsecond line\n\nNew <b>paragraph</b> & more"),
    "<p>First line<br>second line</p><p>New &lt;b&gt;paragraph&lt;/b&gt; &amp; more</p>");
  assert.equal(toEditorHtml(""), "");
  assert.equal(toEditorHtml(undefined), "");
});

test("an answer the editor saved opens as it was", () => {
  const html = '<p>Using <strong>Bayes</strong> <span data-latex="\\frac{1}{2}"></span></p>';
  assert.equal(toEditorHtml(html), html);
});

test("an editor with nothing typed counts as empty", () => {
  assert.equal(isEmptyAnswer("<p></p>"), true);
  assert.equal(isEmptyAnswer(""), true);
  assert.equal(isEmptyAnswer("<p> </p><p></p>"), true);
  assert.equal(isEmptyAnswer("<p>x</p>"), false);
  assert.equal(isEmptyAnswer('<p><span data-latex="x"></span></p>'), false);
});

test("a symbol button puts its LaTeX at the cursor and leaves the cursor in its first box", () => {
  const frac = FORMULA_SNIPPETS.find((s) => s.label === "Fraction")!;
  assert.deepEqual(insertSnippet("x = ", 4, 4, frac.tex), { value: "x = \\frac{}{}", caret: 10 });
  // the selected text goes into the first box
  assert.deepEqual(insertSnippet("a+b", 0, 3, frac.tex), { value: "\\frac{a+b}{}", caret: 9 });
  const alpha = FORMULA_SNIPPETS.find((s) => s.label === "alpha")!;
  assert.deepEqual(insertSnippet("2", 1, 1, alpha.tex), { value: "2\\alpha ", caret: 8 });
});

test("an answer the editor saved opens as it was, whatever it starts with", () => {
  for (const html of [
    '<img src="/files/x/homework/images/a.png" alt="image.png"><p>according to the equation</p>',
    "<pre><code>x = 1</code></pre><p>so</p>",
    '<span data-latex="x"></span>',
  ]) assert.equal(toEditorHtml(html), html);
});

test("a markdown table typed in an answer, one row per paragraph, becomes a table", () => {
  const html = "<p>Distances:</p><p>| Node | Cost |</p><p>|---|---|</p><p>| A | <strong>1</strong> |</p><p>| B | ∞ |</p><p>Next step</p>";
  assert.equal(answerTables(html),
    "<p>Distances:</p><table><thead><tr><th>Node</th><th>Cost</th></tr></thead>"
    + "<tbody><tr><td>A</td><td><strong>1</strong></td></tr><tr><td>B</td><td>∞</td></tr></tbody></table><p>Next step</p>");
});

test("a table's rows can be lines of one paragraph, after text on the lines before", () => {
  const html = "<p>Finally:<br><br>| a | b |<br>|:-|-:|<br>| 1 | 2 |</p>";
  assert.equal(answerTables(html),
    '<p>Finally:</p><table><thead><tr><th style="text-align: left">a</th><th style="text-align: right">b</th></tr></thead>'
    + '<tbody><tr><td style="text-align: left">1</td><td style="text-align: right">2</td></tr></tbody></table>');
});

test("table cells keep formulas whose LaTeX has a pipe, and rows short of cells are filled in", () => {
  const html = '<p>| P | v |</p><p>| --- | --- |</p><p>| <span data-latex="P(A|B)"></span> |</p><p></p>';
  assert.equal(answerTables(html),
    '<table><thead><tr><th>P</th><th>v</th></tr></thead><tbody><tr><td><span data-latex="P(A|B)"></span></td><td></td></tr></tbody></table><p></p>');
});

test("text with pipes that isn't a table stays as it was", () => {
  for (const html of ["<p>| a | b |</p><p>| 1 | 2 |</p>", "<p>x | y</p>", "<p>Plain</p>", ""]) assert.equal(answerTables(html), html);
});

test("cells past the header's are left out, and paragraphs around a table keep their alignment", () => {
  const html = '<p style="text-align: center">See<br>| a |<br>| - |<br>| 1 | extra</p><ul><li><p>| x |</p></li></ul>';
  assert.equal(answerTables(html),
    '<p style="text-align: center">See</p><table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><ul><li><p>| x |</p></li></ul>');
});

test("a formula with > and pipes in its LaTeX stays in one cell", () => {
  const f = '<span data-latex="|x| > 0 | y"></span>';
  assert.equal(answerTables(`<p>| a | b |</p><p>|---|---|</p><p>| ${f} | 2 |</p>`),
    `<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>${f}</td><td>2</td></tr></tbody></table>`);
});
