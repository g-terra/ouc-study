/**
 * Reads a transcript file (`Lecture 3.transcript.md`, written by packages/eclass-sync/src/media.ts
 * transcriptMarkdown) back into its parts, for the video page and the slide viewer. No imports:
 * unit-tested on its own (apps/web/test/transcript.test.ts).
 *
 * A video's transcript is paragraphs that start with a time, "[1:05] …"; a deck's has a "## Slide N"
 * section per slide, without times.
 */
export interface TranscriptLine { at: number | null; text: string }
export interface TranscriptSection { heading?: string; slide?: number; lines: TranscriptLine[] }
export interface Transcript { title?: string; by?: string; made?: string; /** the language Whisper was told */ language?: string; note?: string; sections: TranscriptSection[] }

/** "1:05" → 65, "1:02:05" → 3725; null when it isn't a time. */
export function timeOf(s: string): number | null {
  if (!/^\d+(:\d{2}){1,2}$/.test(s)) return null;
  return s.split(":").reduce((t, n) => t * 60 + Number(n), 0);
}
/** 65 → "1:05", 3725 → "1:02:05". */
export function stamp(sec: number): string {
  const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

export function parseTranscript(md: string): Transcript {
  const out: Transcript = { sections: [] };
  let body = md.replace(/^﻿/, "").replace(/\r/g, "");
  const fm = body.match(/^---\n([\s\S]*?)\n---\n/);
  if (fm) {
    for (const l of fm[1]!.split("\n")) {
      const m = l.match(/^(title|by|made|language):\s*(.*)$/);
      if (!m) continue;
      let v = m[2]!.trim();
      try { if (v.startsWith('"')) v = JSON.parse(v); } catch { /* keep as written */ }
      out[m[1] as "title" | "by" | "made" | "language"] = v;
    }
    body = body.slice(fm[0].length);
  }
  let cur: TranscriptSection = { lines: [] };
  const push = () => { if (cur.lines.length || cur.heading) out.sections.push(cur); };
  for (const para of body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    const h1 = para.match(/^# (?:Transcript: )?(.*)$/);
    if (h1) { out.title ??= h1[1]; continue; }
    const h2 = para.match(/^## (.*)$/);
    if (h2) {
      push();
      const n = h2[1]!.match(/^Slide (\d+)$/i);
      cur = { heading: h2[1], ...(n && { slide: Number(n[1]) }), lines: [] };
      continue;
    }
    if (/^_.*_$/s.test(para)) {
      // the note under the title; "_(no narration)_" in a section is left out
      if (!out.note && !out.sections.length && !cur.heading) out.note = para.slice(1, -1);
      continue;
    }
    const t = para.match(/^\[(\d+(?::\d{2}){1,2})\]\s*([\s\S]*)$/);
    cur.lines.push(t ? { at: timeOf(t[1]!), text: t[2]!.replace(/\s+/g, " ") } : { at: null, text: para.replace(/\s+/g, " ") });
  }
  push();
  return out;
}

/** The line playing at `sec`: the last one that starts at or before it (-1 before the first). */
export function lineAt(lines: TranscriptLine[], sec: number): number {
  let i = -1;
  lines.forEach((l, j) => { if (l.at !== null && l.at <= sec) i = j; });
  return i;
}
