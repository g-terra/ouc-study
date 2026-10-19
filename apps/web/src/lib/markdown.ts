import { micromark } from "micromark";
import { math, mathHtml } from "micromark-extension-math";
import { gfmTable, gfmTableHtml } from "micromark-extension-gfm-table";
import { linkPaths } from "./links";
import { normalizeMath } from "./math";
import { gfmAutolinkLiteral, gfmAutolinkLiteralHtml } from "micromark-extension-gfm-autolink-literal";

const opts = {
  allowDangerousHtml: true,
  extensions: [math(), gfmTable(), gfmAutolinkLiteral()],
  htmlExtensions: [mathHtml({ throwOnError: false, strict: false }), gfmTableHtml(), gfmAutolinkLiteralHtml()],
};

/** The semester the page is showing, for paths written relative to it ("notes/COS514/x.md"). */
const pageSem = () => {
  const seg = window.location.pathname.split("/");
  return decodeURIComponent(seg[1] === "v2" ? seg[2] ?? "" : seg[1] ?? "") || undefined;
};

/**
 * Markdown (with $math$, $$display$$, \(…\) and \[…\] maths, tables, autolinks) → HTML. External links open in a new tab;
 * file paths in `backticks` become links to the note, assignment or file (the router follows them).
 */
export function mdToHtml(src: string, sem = pageSem()): string {
  return linkPaths(micromark(normalizeMath(src), opts).replace(/<a href="(https?:[^"]+)"/g, '<a target="_blank" rel="noreferrer" href="$1"'), sem);
}

/** Same, but without the wrapping <p> (for short inline strings in cards/tables). */
export function mdInline(src: string): string {
  const html = mdToHtml(String(src ?? ""));
  const m = html.match(/^<p>([\s\S]*)<\/p>\s*$/);
  return m && !m[1].includes("<p>") ? m[1] : html;
}

export const slugify = (s: string) =>
  s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-");
