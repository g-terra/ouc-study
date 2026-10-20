/**
 * How search compares text, shared by the server (src/search.ts) and the app (which marks the words in a
 * result). No imports, so the browser can use it.
 */

export type SearchKind = "note" | "slides" | "file" | "transcript" | "assignment" | "post";
/** One result of /api/search. */
export interface SearchHit {
  kind: SearchKind;
  code?: string;
  weekIndex?: number;
  weekLabel?: string;
  title: string;
  snippet: string;
  to: string;
  external?: boolean;
  at?: number;            // seconds into the video
  slide?: number;
  page?: number;
  score: number;
}

/** Lower case, no accents (Greek tonos too), final sigma as sigma: what matching compares. Same length as the input's characters. */
const folded = new Map<string, string>();   // per character, worked out once
export function fold(s: string): string {
  if (/^[\x00-\x7f]*$/.test(s)) return s.toLowerCase();
  let out = "";
  for (const ch of s) {
    let f = folded.get(ch);
    if (f === undefined) {
      f = ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/ς/g, "σ");
      // keep one character per character, so a match's position is the same in the original text
      if (f.length !== ch.length) f = ch.length === 1 ? (f[0] ?? " ") : f.padEnd(ch.length, " ").slice(0, ch.length);
      folded.set(ch, f);
    }
    out += f;
  }
  return out;
}

/** The words of a query (folded, duplicates and empty ones dropped). */
export const queryWords = (q: string) => [...new Set(fold(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean))];

/** A short piece of `text` around the first of `words`, on word boundaries. */
export function snippet(text: string, words: string[], width = 180): string {
  const t = text.replace(/\s+/g, " ").trim();
  const f = fold(t);
  if (t.length <= width) return t;
  const first = Math.min(...words.map((w) => f.indexOf(w)).filter((i) => i >= 0));
  // start a little before the match, at the beginning of a word
  let start = Number.isFinite(first) ? Math.max(0, first - Math.floor(width / 3)) : 0;
  if (start > 0) { const sp = t.lastIndexOf(" ", start); start = sp > 0 ? sp + 1 : 0; }
  let end = Math.min(t.length, start + width);
  if (end < t.length) { const sp = t.lastIndexOf(" ", end); if (sp > start) end = sp; }
  return `${start > 0 ? "…" : ""}${t.slice(start, end)}${end < t.length ? "…" : ""}`;
}

/** `text` cut into pieces, the ones that are one of `words` (folded) marked, for highlighting. */
export function marks(text: string, words: string[]): { text: string; hit: boolean }[] {
  const f = fold(text);
  const on = new Array<boolean>(text.length).fill(false);
  for (const w of words) for (let i = f.indexOf(w); i >= 0 && w; i = f.indexOf(w, i + w.length)) on.fill(true, i, i + w.length);
  const out: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = out.at(-1);
    if (last && last.hit === on[i]) last.text += text[i];
    else out.push({ text: text[i]!, hit: on[i]! });
  }
  return out;
}
