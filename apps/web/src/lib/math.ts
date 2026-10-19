/**
 * AI tools write maths in several ways: $…$ and $$…$$, but also LaTeX's \(…\) and \[…\] (Codex, many
 * local models). Markdown reads "\[" as an escaped "[", so those arrived as plain "[ C_m\frac… ]".
 * This rewrites \(…\) to $…$ and \[…\] to a $$ block, and a line that is only "[ …LaTeX… ]" (the same
 * thing with the backslashes already lost) to a $$ block too. Code and existing $ maths are left alone.
 */

// fenced code, inline code and existing $$…$$ / $…$ maths: copied through unchanged
const KEEP = /(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(\n[ \t]*\2[ \t]*(?=\n|$)|$)|(`+)[\s\S]*?\4|\$\$[\s\S]*?\$\$|(?<![\\$])\$(?!\s)[^$\n]+?(?<![\s\\])\$/g;
// a LaTeX command, sub- or superscript: what tells "[ x^2 ]" apart from ordinary text in brackets
const LATEX = /\\[a-zA-Z]+|[_^]\{|[_^][A-Za-z0-9]/;

const block = (indent: string, tex: string) => `$$\n${indent}${tex.trim().replace(/\s*\n\s*/g, " ")}\n${indent}$$`;

function convert(text: string): string {
  return text
    // \[ … \] (the start of its line → a display block; inside a sentence → $$…$$ inline)
    .replace(/(^|\n)([ \t]*(?:[-*+]\s+|\d+[.)]\s+|>\s*)?)\\\[([\s\S]+?)(?<!\\)\\\][ \t]*(?=\n|$)/g,
      (_, nl, lead, tex) => `${nl}${lead}${block(" ".repeat(lead.length), tex)}`)
    .replace(/(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]/g, (_, tex) => `$$${tex.trim()}$$`)
    // \( … \) → $…$
    .replace(/(?<!\\)\\\(([\s\S]+?)(?<!\\)\\\)/g, (_, tex) => `$${tex.trim()}$`)
    // a line that is only "[ …LaTeX… ]" (the backslashes got lost on the way)
    .replace(/(^|\n)([ \t]*)\[[ \t]+([^\n]+?)[ \t]+\][ \t]*(?=\n|$)/g,
      (all, nl, indent, tex) => (LATEX.test(tex) ? `${nl}${block(indent, tex)}` : all));
}

/** Markdown with maths in any of the forms above → Markdown with $ / $$ maths only. */
export function normalizeMath(src: string): string {
  let out = "";
  let last = 0;
  for (const m of src.matchAll(KEEP)) {
    out += convert(src.slice(last, m.index)) + m[0];
    last = m.index! + m[0].length;
  }
  return out + convert(src.slice(last));
}
