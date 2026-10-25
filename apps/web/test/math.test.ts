import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { normalizeMath } from "../src/lib/math.ts";
import { mdToHtml } from "../src/lib/markdown.ts";

test("\\[ … \\] on its own line becomes a display block", () => {
  assert.equal(normalizeMath("Its core equation is:\n\n\\[ C_m\\frac{dV}{dt} = I \\]\n\nIn simple terms:"),
    "Its core equation is:\n\n$$\nC_m\\frac{dV}{dt} = I\n$$\n\nIn simple terms:");
  assert.equal(normalizeMath("\\[\n  a^2 + b^2\n  = c^2\n\\]"), "$$\na^2 + b^2 = c^2\n$$");
  assert.equal(normalizeMath("- \\[ x^2 \\]"), "- $$\n  x^2\n  $$");
});

test("\\( … \\) and \\[ … \\] inside a sentence become $ … $ and $$ … $$", () => {
  assert.equal(normalizeMath("where \\( V \\) is the voltage"), "where $V$ is the voltage");
  assert.equal(normalizeMath("so \\[x=1\\] holds"), "so $$x=1$$ holds");
});

test("a line that is only [ …LaTeX… ] (backslashes lost) becomes a display block", () => {
  assert.equal(normalizeMath("[ C_m\\frac{dV}{dt} = I_{\\text{ext}} - I_{\\text{Na}} ]"),
    "$$\nC_m\\frac{dV}{dt} = I_{\\text{ext}} - I_{\\text{Na}}\n$$");
  assert.equal(normalizeMath("  [ x^2 ]"), "$$\n  x^2\n  $$");
});

test("ordinary brackets, links, code and existing $ maths are left alone", () => {
  for (const s of [
    "[ see the slides ]", "[a link](https://x.org)", "- [ ] a task", "`\\[x\\]`",
    "```latex\n\\[ x^2 \\]\n```", "$$\n\\begin{aligned} a \\\\[2pt] b \\end{aligned}\n$$", "costs $5 and $10",
    "a literal \\\\[ bracket",
  ]) assert.equal(normalizeMath(s), s);
});

test("mdToHtml renders every form with KaTeX", () => {
  for (const s of ["$x^2$", "$$\nx^2\n$$", "\\(x^2\\)", "\\[ x^2 \\]", "[ x^{2} ]"]) {
    assert.match(mdToHtml(s, "2026-Fall"), /class="katex/, s);
  }
  assert.match(mdToHtml("\\[ x^2 \\]", "2026-Fall"), /katex-display/);
});

test("maths is laid out by the same KaTeX the app's stylesheet is for (else a √ comes out cut)", () => {
  const css = readFileSync(createRequire(import.meta.url).resolve("katex/dist/katex.min.css"), "utf8");
  const html = mdToHtml("$$\n\\lambda = \\sqrt{\\frac{r_m}{r_i}}\n$$", "2026-Fall");
  const layout = [...new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)))]
    .filter((c) => /^(katex-)?(base|strut|sizing|vlist|vlist-t|pstrut|sqrt|hide-tail|svg-align)$/.test(c));
  assert.ok(layout.length > 3, "rendered a √");
  assert.deepEqual(layout.filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(css)), []);
});

test("the LaTeX source stays in the rendered maths, for copying", () => {
  assert.match(mdToHtml("$$\n\\sqrt{x}\n$$", "2026-Fall"), /<annotation encoding="application\/x-tex">\\sqrt\{x\}<\/annotation>/);
});
