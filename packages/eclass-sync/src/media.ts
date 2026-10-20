// Class videos and their transcripts: the pieces the sync (pull.ts), the transcriber
// (packages/ai/src/transcribe.ts) and the app data (packages/content) share. Zero dependencies.
//
// Where eClass keeps videos, and what happens to each kind:
//   a video file on a page or as a resource   downloaded with the course files (pluginfile, with the key)
//   a Panopto link (video.ouc.ac.cy)          not downloadable with the eClass key; its captions are
//                                             saved as the transcript when Panopto shares them without signing in
//   webconference recordings (LTI tool)       not reachable through the eClass web service
//
// A transcript is a Markdown file next to what it transcribes: "Lecture 3.mp4" → "Lecture 3.transcript.md".
// Settings (all optional) in .ouc/media.json: { "videos": true, "transcribe": true, "model": "small" }.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Video and audio files a transcript can be made from. */
export const MEDIA_FILE = /\.(mp4|m4v|mov|webm|mkv|avi|mp3|m4a|wav|aac|ogg|oga|opus|flac)$/i;
export const TRANSCRIPT_SUFFIX = ".transcript.md";

export interface MediaConfig { videos: boolean; transcribe: boolean; model: string }
export function loadMediaConfig(root: string): MediaConfig {
  let c: Partial<MediaConfig> = {};
  try { c = JSON.parse(readFileSync(join(root, ".ouc", "media.json"), "utf8")); } catch { /* defaults */ }
  return { videos: c.videos !== false, transcribe: c.transcribe !== false, model: typeof c.model === "string" && /^[\w.-]+$/.test(c.model) ? c.model : "small" };
}

/** "Week 3/Lecture.mp4" → "Week 3/Lecture.transcript.md" (any path style). */
export const transcriptPath = (file: string) => file.replace(/\.[^./\\]+$/, "") + TRANSCRIPT_SUFFIX;
export const hasTranscript = (abs: string) => existsSync(transcriptPath(abs));

// ---------- Panopto ----------
/** The Panopto session a viewer/embed link points to, or null. */
export function panoptoSession(url: unknown): { origin: string; id: string } | null {
  let u: URL;
  try { u = new URL(String(url)); } catch { return null; }
  if (!/\/Panopto\/Pages\/(Viewer|Embed)\.aspx$/i.test(u.pathname)) return null;
  const id = u.searchParams.get("id") ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? { origin: u.origin, id } : null;
}

export type CaptionResult = { ok: true; srt: string } | { ok: false; reason: "signin" | "none" | "offline" };
/**
 * A Panopto session's captions as SRT, asked for without signing in. Most university sessions need a
 * Panopto sign-in, which the eClass key can't give: those come back as { ok: false, reason: "signin" }.
 */
export async function panoptoCaptions(url: string, fetchImpl: typeof fetch = fetch): Promise<CaptionResult> {
  const s = panoptoSession(url);
  if (!s) return { ok: false, reason: "none" };
  let res: Response;
  try { res = await fetchImpl(`${s.origin}/Panopto/Pages/Transcription/GenerateSRT.ashx?id=${s.id}&language=0`, { redirect: "manual" }); }
  catch { return { ok: false, reason: "offline" }; }
  if ((res.status >= 300 && res.status < 400) || res.status === 401 || res.status === 403) return { ok: false, reason: "signin" };
  if (!res.ok) return { ok: false, reason: "none" };
  const text = await res.text();
  if (/<html/i.test(text)) return { ok: false, reason: "signin" };   // a sign-in page served with 200
  return srtToSegments(text).length ? { ok: true, srt: text } : { ok: false, reason: "none" };
}

// ---------- transcripts ----------
export interface Segment { start: number; end: number; text: string }

const srtTime = (t: string) => { const m = t.trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]!.padEnd(3, "0")) / 1000 : NaN; };
/** SRT (whisper.cpp, Panopto) → segments, empty ones and markup left out. */
export function srtToSegments(srt: string): Segment[] {
  const out: Segment[] = [];
  for (const block of srt.replace(/^﻿/, "").replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((l) => l.trim());
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i]!.split("-->");
    const text = lines.slice(i + 1).join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const start = srtTime(a!), end = srtTime(b!.trim().split(/\s/)[0]!);
    if (text && Number.isFinite(start)) out.push({ start, end: Number.isFinite(end) ? end : start, text });
  }
  return out;
}

export const stamp = (sec: number) => {
  const s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s % 60).padStart(2, "0")}`;
};
/** Segments → paragraphs of about a minute each, each starting with its time ("[12:03] …") unless stamps is false. */
export function paragraphs(segs: Segment[], { every = 60, stamps = true } = {}): string[] {
  const out: string[] = [];
  let cur: string[] = [], from = 0;
  const flush = () => { if (cur.length) out.push(`${stamps ? `[${stamp(from)}] ` : ""}${cur.join(" ")}`); cur = []; };
  for (const s of segs) {
    if (cur.length && s.start - from >= every) flush();
    if (!cur.length) from = s.start;
    cur.push(s.text.trim());
  }
  flush();
  return out;
}

export interface TranscriptInfo { title: string; source: string; by: string; made?: Date }
/**
 * The transcript file: front matter, then the text. `parts` with a heading each (a slide deck's
 * slides) or a single unnamed part (a video).
 */
export function transcriptMarkdown(info: TranscriptInfo, parts: { heading?: string; segments: Segment[] }[]): string {
  const q = (s: string) => JSON.stringify(s);
  const made = (info.made ?? new Date()).toISOString().slice(0, 10);
  const body = parts.flatMap((p) => {
    // a slide's narration is short: no times
    const text = paragraphs(p.segments, { stamps: !p.heading });
    if (p.heading) return [`## ${p.heading}`, "", ...(text.length ? text : ["_(no narration)_"]).flatMap((t) => [t, ""])];
    return text.flatMap((t) => [t, ""]);
  });
  return [
    "---", `title: ${q(info.title)}`, `source: ${q(info.source)}`, `by: ${q(info.by)}`, `made: ${made}`, "---", "",
    `# Transcript: ${info.title}`, "",
    `_Made automatically from the ${parts.some((p) => p.heading) ? "slides' narration" : "recording's audio"}, so names and terms can be misheard.${parts.some((p) => p.heading) ? "" : " Times are [minutes:seconds] into the recording."}_`, "",
    ...(body.length ? body : ["_(no speech found)_", ""]),
  ].join("\n");
}
