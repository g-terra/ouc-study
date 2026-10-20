/**
 * Search across a semester, on this computer: notes, the text copies of slides and PDFs (<sem>/text/),
 * video and slide transcripts (*.transcript.md), assignments (question, prep pack, working notes) and the
 * announcements and forum posts of the update feed. Served at /api/search by apps/web/vite.config.ts.
 *
 * Each document is split into parts (a transcript line, a slide, a PDF page, a paragraph) so a hit can open
 * the right moment: the video at that time, the slide viewer at that slide, the PDF at that page.
 * Links are classic app paths (/<sem>/…); the new look maps them to its own pages.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { SemesterData, WeekItem } from "./types.ts";
import { fold, queryWords, snippet, type SearchHit, type SearchKind } from "./search-text.ts";

export { fold, queryWords, snippet, type SearchHit, type SearchKind };

interface Part { text: string; at?: number; slide?: number; page?: number }
export interface SearchDoc {
  kind: SearchKind;
  code?: string;
  weekIndex?: number;
  title: string;
  to: string;             // app path, or a /files/… or eClass address when external
  external?: boolean;     // opens in a new tab (a PDF, an eClass post)
  /** how a part's position goes into the link: "#t=65" (video), "#3" (slide), "#page=3" (PDF) */
  at?: "time" | "slide" | "page";
  parts: Part[];
}

const count = (hay: string, w: string) => { let n = 0, i = hay.indexOf(w); while (i >= 0 && n < 20) { n++; i = hay.indexOf(w, i + w.length); } return n; };

// folded text of the parts of files read before (they are kept, see readParts)
const foldedParts = new WeakMap<Part, string>();
const foldPart = (p: Part) => { let f = foldedParts.get(p); if (f === undefined) foldedParts.set(p, (f = fold(p.text))); return f; };

/** Finds the documents that have every word of the query, best first, each with its best part. */
export function search(docs: SearchDoc[], query: string, data?: Pick<SemesterData, "courses">, limit = 60): SearchHit[] {
  const words = queryWords(query);
  if (!words.length) return [];
  const hits: SearchHit[] = [];
  for (const d of docs) {
    const title = fold(d.title);
    const folded = d.parts.map(foldPart);
    const all = `${title}\n${folded.join("\n")}`;
    if (!words.every((w) => all.includes(w))) continue;
    // the part with the most of the words (the earliest when tied)
    let best = -1, bestN = 0;
    folded.forEach((p, i) => { const n = words.filter((w) => p.includes(w)).length; if (n > bestN) { best = i; bestN = n; } });
    const part = best >= 0 ? d.parts[best] : undefined;
    const score = words.reduce((s, w) => s + Math.min(count(all, w), 10) + (title.includes(w) ? 8 : 0), 0) + bestN * 3 + (d.kind === "note" ? 2 : 0);
    let to = d.to;
    if (part && d.at === "time" && part.at !== undefined) to += `#t=${part.at}`;
    else if (part && d.at === "slide" && part.slide) to += `#${part.slide}`;
    else if (part && d.at === "page" && part.page) to += `#page=${part.page}`;
    const week = d.code !== undefined && d.weekIndex !== undefined ? data?.courses.find((c) => c.code === d.code)?.weeks.find((w) => w.index === d.weekIndex) : undefined;
    hits.push({
      kind: d.kind, code: d.code, weekIndex: d.weekIndex, title: d.title, to, score,
      ...(week && { weekLabel: week.index === 0 ? "General" : week.label }),
      ...(d.external && { external: true }),
      snippet: snippet(part?.text ?? d.parts[0]?.text ?? "", words),
      ...(d.at === "time" && part?.at !== undefined && { at: part.at }),
      ...(d.at === "slide" && part?.slide && { slide: part.slide }),
      ...(d.at === "page" && part?.page && { page: part.page }),
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ---------- reading the semester ---------- */

/** Paragraphs of Markdown or plain text, as parts. */
export const paragraphs = (s: string): Part[] => s.replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((text) => ({ text }));

/** Markdown as the words it shows: no quote marks, callout tags, heading marks, emphasis, fences or link targets. */
export const plainMarkdown = (s: string) => s
  .replace(/^\s*(```|~~~).*$/gm, "").replace(/^\s*>\s?/gm, "").replace(/\[!\w+\]\s*/g, "").replace(/^\s*#{1,6}\s+/gm, "")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/(\*\*|__|\*|`)(\S(?:.*?\S)?)\1/g, "$2");
const mdParts = (s: string) => paragraphs(plainMarkdown(s));

const stripFrontMatter = (s: string) => s.replace(/^﻿?---\n[\s\S]*?\n---\n/, "");

/** A transcript file: "[1:05] …" lines (a video) or "## Slide N" sections (narrated slides). */
export function transcriptParts(md: string): Part[] {
  const out: Part[] = [];
  let slide: number | undefined;
  for (const para of paragraphs(stripFrontMatter(md))) {
    const t = para.text;
    if (/^# /.test(t) || /^_.*_$/s.test(t)) continue;   // the title, the note under it, "_(no narration)_"
    const h = t.match(/^## (?:Slide (\d+)|.*)$/i);
    if (h) { slide = h[1] ? Number(h[1]) : undefined; continue; }
    const m = t.match(/^\[(\d+(?::\d{2}){1,2})\]\s*([\s\S]*)$/);
    const at = m ? m[1]!.split(":").reduce((s, n) => s * 60 + Number(n), 0) : undefined;
    out.push({ text: m ? m[2]! : t, ...(at !== undefined && { at }), ...(slide && { slide }) });
  }
  return out;
}

/** A text copy made by tools/extract_text.py: "--- slide N ---" sections for slides, form feeds between PDF pages. */
export function textCopyParts(txt: string, ext: string): Part[] {
  if (ext === "pptx" || /^--- slide \d+ ---/m.test(txt)) {
    // split() keeps the slide numbers: [before, n1, text1, n2, text2, …]
    const bits = txt.replace(/\r/g, "").split(/^--- slide (\d+) ---$/m);
    const out: Part[] = [];
    for (let i = 1; i < bits.length; i += 2) {
      const text = bits[i + 1]!.replace(/\[speaker notes\]/g, "").trim();
      if (text) out.push({ text, slide: Number(bits[i]) });
    }
    return out;
  }
  if (txt.includes("\f")) return txt.split("\f").flatMap((p, i) => paragraphs(p).map((x) => ({ ...x, page: i + 1 })));
  return paragraphs(txt);
}

const enc = (s: string) => encodeURIComponent(s);
const encPath = (rel: string) => rel.split("/").map(enc).join("/");
const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

function walk(dir: string, keep: (f: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, keep, out);
    else if (keep(e.name)) out.push(p);
  }
  return out;
}

// files read before, by path, while they keep their size and time
const fileCache = new Map<string, { key: string; parts: Part[] }>();
function readParts(abs: string, parse: (s: string) => Part[]): Part[] {
  try {
    const st = statSync(abs);
    const key = `${st.size}:${st.mtimeMs}`;
    const hit = fileCache.get(abs);
    if (hit?.key === key) return hit.parts;
    const parts = parse(readFileSync(abs, "utf8"));
    fileCache.set(abs, { key, parts });
    return parts;
  } catch { return []; }
}

/** Every searchable document of a semester: the built app data plus the text copies and transcripts in its folder. */
export function semesterDocs(data: SemesterData, semDir: string): SearchDoc[] {
  const sem = data.id, base = `/${enc(sem)}`;
  const docs: SearchDoc[] = [];
  const files = `/files/${enc(sem)}/`;
  // week items by their file, so a text copy or transcript knows its course, week and title
  const items = new Map<string, { code: string; weekIndex: number; item: WeekItem }>();
  for (const c of data.courses) for (const w of c.weeks) for (const item of w.items) {
    const here = { code: c.code, weekIndex: w.index, item };
    if (item.href?.startsWith(files)) items.set(decode(item.href.slice(files.length)), here);
    // a transcript belongs to its video or deck (a Panopto link has no file of its own)
    if (item.transcript?.startsWith(files)) {
      const rel = decode(item.transcript.slice(files.length));
      const own = !item.external && item.href?.startsWith(files) ? decode(item.href.slice(files.length)) : undefined;
      const slides = !!own && /\.(pptx|ppsx|ppt|pps|odp)$/i.test(own);
      docs.push({
        kind: "transcript", code: c.code, weekIndex: w.index, title: item.title,
        to: own ? `${base}/${slides ? "slides" : "video"}/${enc(own)}` : `${base}/video/${enc(rel)}`,
        at: slides ? "slide" : "time",
        parts: readParts(join(semDir, rel), transcriptParts),
      });
    }
  }

  for (const n of data.notes) {
    docs.push({ kind: "note", code: n.code, weekIndex: n.weekIndex, title: n.title, to: `${base}/notes/${enc(n.code)}/${enc(n.slug)}`, parts: [...paragraphs(n.summary), ...mdParts(n.body)] });
  }

  // text copies of the course files (text/<course dir>/<week dir>/<file>.txt mirrors courses/)
  const textDir = join(semDir, "text");
  for (const abs of walk(textDir, (f) => f.endsWith(".txt"))) {
    const orig = `courses/${relative(textDir, abs).split(sep).join("/").replace(/\.txt$/, "")}`;
    const ext = orig.split(".").pop()!.toLowerCase();
    const known = items.get(orig);
    const code = known?.code ?? data.courses.find((c) => orig.split("/")[1]?.startsWith(c.code))?.code;
    const slides = /^(pptx|ppsx|ppt|pps|odp)$/.test(ext);
    docs.push({
      kind: slides ? "slides" : "file", code, weekIndex: known?.weekIndex,
      title: known?.item.title ?? orig.split("/").pop()!.replace(/\.\w+$/, "").replace(/[_-]+/g, " "),
      to: slides ? `${base}/slides/${enc(orig)}` : `${files}${encPath(orig)}`,
      ...(!slides && { external: true }),
      ...(slides ? { at: "slide" as const } : ext === "pdf" ? { at: "page" as const } : {}),
      parts: readParts(abs, (s) => textCopyParts(s, ext)),
    });
  }

  for (const a of data.assignments) {
    const notes = join(semDir, "assignments", ...a.id.split("/"), "README.md");
    docs.push({
      kind: "assignment", code: a.code, weekIndex: a.weekIndex, title: a.fullTitle || a.title,
      to: `${base}/assignments/${a.id.split("/").map(enc).join("/")}`,
      parts: [...mdParts(a.question ?? ""), ...mdParts(a.feedback ?? ""), ...mdParts(a.prep?.body ?? ""), ...readParts(notes, (s) => mdParts(stripFrontMatter(s)))],
    });
  }

  // announcements and forum posts (the same post can come back on several days: the newest is kept)
  const seen = new Set<string>();
  for (const day of data.updates.days) for (const u of day.items) {
    if (u.type !== "announcement" && u.type !== "forum") continue;
    const key = `${u.code}|${u.title}|${u.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    docs.push({ kind: "post", code: u.code, title: u.title.replace(/^(Announcement|New replies|New post|Forum):\s*/i, ""), to: `${base}/updates`, parts: paragraphs(u.detail) });
  }
  return docs;
}
