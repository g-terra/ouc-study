// The YAML inside a note's or prep pack's ``` blocks (docs/NOTE_FORMAT.md), read the way the author meant it.
// AIs often write LaTeX in double quotes ("\mathrm{…}", "\tau"), where YAML reads backslashes as escapes:
// "\m" is an error and "\tau" quietly becomes a tab and "au". In single quotes a backslash is just a backslash.

const DOUBLE_QUOTED = /"((?:[^"\\\n]|\\.)*)"/g;
// A backslash then a letter is LaTeX (\mathrm, \tau, even \nu), not an escape someone meant; "\\", \uXXXX and \xXX are left alone.
const ESCAPE = /\\(\\|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|U[0-9a-fA-F]{8}|.)/g;
const isLatex = (inner) => [...inner.matchAll(ESCAPE)].some((m) => /^[A-Za-z]$/.test(m[1]));

/** Rewrites double-quoted strings that hold LaTeX as single-quoted ones (same text, backslashes kept). */
export function singleQuoteLatex(raw) {
  return raw.replace(DOUBLE_QUOTED, (all, inner) => (isLatex(inner) ? `'${inner.replace(/\\"/g, '"').replace(/'/g, "''")}'` : all));
}

/** True when the block has LaTeX in double quotes (it parses wrong or not at all). */
export const hasQuotedLatex = (raw) => [...raw.matchAll(DOUBLE_QUOTED)].some((m) => isLatex(m[1]));

/** Parses a block's YAML, reading LaTeX in double quotes as written. Throws like YAML.parse when it can't. */
export function parseBlock(YAML, raw) {
  if (hasQuotedLatex(raw)) {
    try { return YAML.parse(singleQuoteLatex(raw)); } catch { /* fall back to the text as it is */ }
  }
  return YAML.parse(raw);
}
