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

// a table's separator row: | --- | :-: | --: |
const SEPARATOR = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;
const VOID = new Set(["br", "img", "hr", "wbr", "input"]);
type Block = { p: false; html: string } | { p: true; open: string; lines: string[] };
type Line = { block: number; html: string };

const plain = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&nbsp;| /g, " ").trim();
const isRow = (s: string) => s.trim().startsWith("|");

/** A row's cells: split at the pipes outside tags (a formula's LaTeX can hold pipes and >) and not escaped as \|. */
function cells(row: string): string[] {
  const out: string[] = [];
  let cur = "", tag = false, quoted = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i]!;
    if (c === "<" && !tag) tag = true;
    else if (c === '"' && tag) quoted = !quoted;
    else if (c === ">" && tag && !quoted) tag = false;
    if (c === "\\" && row[i + 1] === "|" && !tag) { cur += "|"; i++; continue; }
    if (c === "|" && !tag) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  const t = row.trim();
  if (t.startsWith("|")) out.shift();
  if (t.endsWith("|") && out.at(-1)!.trim() === "") out.pop();
  return out.map((s) => s.replace(/^(\s|&nbsp;)+|(\s|&nbsp;)+$/g, ""));
}

/** The answer's top-level blocks: paragraphs split into their lines (at <br>), anything else (lists, code…) as it is. */
function blocks(html: string): Block[] {
  const out: Block[] = [];
  const tags = /<(\/?)([a-zA-Z][\w-]*)[^>]*>/g;
  let depth = 0, from = 0, m: RegExpExecArray | null;
  while ((m = tags.exec(html))) {
    const name = m[2]!.toLowerCase();
    if (VOID.has(name) || m[0].endsWith("/>")) continue;
    if (!m[1] && depth === 0 && name === "p") {
      const end = html.indexOf("</p>", tags.lastIndex);
      if (end < 0) break;
      if (m.index > from) out.push({ p: false, html: html.slice(from, m.index) });
      out.push({ p: true, open: m[0], lines: html.slice(tags.lastIndex, end).split(/<br\s*\/?>/i) });
      from = tags.lastIndex = end + 4;
      continue;
    }
    depth += m[1] ? -1 : 1;
  }
  if (from < html.length) out.push({ p: false, html: html.slice(from) });
  return out;
}

/**
 * Markdown tables typed in an answer (a row per paragraph or per line: "| a | b |", then "|---|---|", then the rows)
 * as HTML tables, for the PDF. The cells keep their bold, formulas and so on. Anything else is left as it was.
 */
export function answerTables(html: string): string {
  if (!html.includes("|")) return html;
  const bs = blocks(html);
  const lines: Line[] = bs.flatMap((b, i) => (b.p ? b.lines.map((l) => ({ block: i, html: l })) : []));
  const tables = new Map<number, { end: number; html: string }>();   // first line → table
  for (let i = 0; i + 1 < lines.length; i++) {
    const head = lines[i]!.html, sep = plain(lines[i + 1]!.html);
    if (!isRow(head) || !SEPARATOR.test(sep)) continue;
    const heads = cells(head), aligns = cells(sep).map((s) => s.trim());
    if (heads.length !== aligns.length) continue;
    const style = aligns.map((a) => {
      const al = a.startsWith(":") && a.endsWith(":") ? "center" : a.endsWith(":") ? "right" : a.startsWith(":") ? "left" : "";
      return al ? ` style="text-align: ${al}"` : "";
    });
    const row = (cs: string[], tag: string) => `<tr>${heads.map((_, k) => `<${tag}${style[k]}>${cs[k] ?? ""}</${tag}>`).join("")}</tr>`;
    let end = i + 2;
    const body: string[] = [];
    while (end < lines.length && isRow(lines[end]!.html)) body.push(row(cells(lines[end++]!.html), "td"));
    tables.set(i, { end, html: `<table><thead>${row(heads, "th")}</thead>${body.length ? `<tbody>${body.join("")}</tbody>` : ""}</table>` });
    i = end - 1;
  }
  if (!tables.size) return html;
  const touched = new Set<number>();
  for (const [start, t] of tables) for (let k = start; k < t.end; k++) touched.add(lines[k]!.block);
  // the paragraphs a table took lines from are rebuilt around it; the rest are kept as they were
  let out = "", piece: string[] = [], pieceBlock = -1;
  const flush = () => {
    while (piece.length && !plain(piece[0]!) && !/<img|data-latex/.test(piece[0]!)) piece.shift();
    while (piece.length && !plain(piece.at(-1)!) && !/<img|data-latex/.test(piece.at(-1)!)) piece.pop();
    if (piece.length) out += `${(bs[pieceBlock] as { open: string }).open}${piece.join("<br>")}</p>`;
    piece = [];
  };
  let li = 0, skip = 0;   // lines up to `skip` are in a table already written
  bs.forEach((b, bi) => {
    if (!b.p) { out += b.html; return; }
    const first = li;
    li += b.lines.length;
    if (!touched.has(bi)) { out += `${b.open}${b.lines.join("<br>")}</p>`; return; }
    for (let k = Math.max(first, skip); k < li; k++) {
      const t = tables.get(k);
      if (t) { flush(); out += t.html; skip = t.end; k = skip - 1; continue; }
      if (pieceBlock !== bi) { flush(); pieceBlock = bi; }
      piece.push(lines[k]!.html);
    }
    flush();
  });
  return out;
}
