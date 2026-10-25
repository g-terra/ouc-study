/**
 * Homework answers are HTML written by the rich editor (components/RichEditor.tsx); formulas are
 * <span data-latex="…"> elements drawn with KaTeX. No React here: unit-tested in apps/web/test/answer-html.test.ts.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// what an answer the editor saved starts with: a paragraph, list, picture, code block, formula…
const EDITOR_HTML = /^\s*<(p|h\d|ul|ol|li|blockquote|img|pre|code|span|strong|em|b|i|u|s|mark|br|div)[\s>/]/i;

/** What the editor opens: answers it saved are HTML already; plain answers (from before the editor) become paragraphs. */
export function toEditorHtml(text: string | undefined): string {
  const t = text ?? "";
  if (!t.trim() || EDITOR_HTML.test(t)) return t.trim() ? t : "";
  return t.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/** True when the editor holds nothing: no text and no formula. */
export const isEmptyAnswer = (html: string | undefined) => !/data-latex/.test(html ?? "") && !(html ?? "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

/** The formula pop-up's buttons: `tex` is put at the cursor; "{}" is a box, and the cursor goes into the first one. */
export const FORMULA_SNIPPETS: { label: string; show: string; tex: string }[] = [
  { label: "Fraction", show: "a⁄b", tex: "\\frac{}{}" },
  { label: "Power", show: "xⁿ", tex: "^{}" },
  { label: "Index", show: "xᵢ", tex: "_{}" },
  { label: "Square root", show: "√", tex: "\\sqrt{}" },
  { label: "Sum", show: "∑", tex: "\\sum_{}^{}" },
  { label: "Product", show: "∏", tex: "\\prod_{}^{}" },
  { label: "Given", show: "P(A | B)", tex: "P( \\mid )" },
  { label: "Times", show: "×", tex: "\\times " },
  { label: "Not equal", show: "≠", tex: "\\neq " },
  { label: "Less or equal", show: "≤", tex: "\\leq " },
  { label: "Greater or equal", show: "≥", tex: "\\geq " },
  { label: "About", show: "≈", tex: "\\approx " },
  { label: "In", show: "∈", tex: "\\in " },
  { label: "alpha", show: "α", tex: "\\alpha " },
  { label: "beta", show: "β", tex: "\\beta " },
  { label: "theta", show: "θ", tex: "\\theta " },
  { label: "lambda", show: "λ", tex: "\\lambda " },
  { label: "mu", show: "μ", tex: "\\mu " },
  { label: "sigma", show: "σ", tex: "\\sigma " },
  { label: "pi", show: "π", tex: "\\pi " },
];

/** Puts a snippet over the selection [start, end); the selected text goes into its first box. Returns the new text and cursor. */
export function insertSnippet(value: string, start: number, end: number, tex: string): { value: string; caret: number } {
  const sel = value.slice(start, end);
  const box = tex.indexOf("{}");
  const piece = box < 0 ? tex : `${tex.slice(0, box + 1)}${sel}${tex.slice(box + 1)}`;
  const caret = start + (box < 0 ? piece.length : box + 1 + sel.length);
  return { value: value.slice(0, start) + piece + value.slice(end), caret };
}
