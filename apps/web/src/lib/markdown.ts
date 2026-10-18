import { micromark } from "micromark";
import { math, mathHtml } from "micromark-extension-math";
import { gfmTable, gfmTableHtml } from "micromark-extension-gfm-table";
import { gfmAutolinkLiteral, gfmAutolinkLiteralHtml } from "micromark-extension-gfm-autolink-literal";

const opts = {
  allowDangerousHtml: true,
  extensions: [math(), gfmTable(), gfmAutolinkLiteral()],
  htmlExtensions: [mathHtml({ throwOnError: false, strict: false }), gfmTableHtml(), gfmAutolinkLiteralHtml()],
};

/** Markdown (with $math$, $$display$$, tables, autolinks) → HTML. External links open in a new tab. */
export function mdToHtml(src: string): string {
  return micromark(src, opts).replace(/<a href="(https?:[^"]+)"/g, '<a target="_blank" rel="noreferrer" href="$1"');
}

/** Same, but without the wrapping <p> (for short inline strings in cards/tables). */
export function mdInline(src: string): string {
  const html = mdToHtml(String(src ?? ""));
  const m = html.match(/^<p>([\s\S]*)<\/p>\s*$/);
  return m && !m[1].includes("<p>") ? m[1] : html;
}

export const slugify = (s: string) =>
  s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-");
