// Homework answers: plain answers from before the rich editor, and the formula pop-up's symbol buttons.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FORMULA_SNIPPETS, insertSnippet, isEmptyAnswer, toEditorHtml } from "../src/lib/answer-html.ts";

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
