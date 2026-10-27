/** File paths in Markdown (AI replies, prep packs, notes) → links to the app's pages and the files. */

import { stamp, timeOf } from "./transcript";

const enc = (s: string) => s.split("/").map(encodeURIComponent).join("/");
const TOP = /^(notes|courses|assignments|text|plans|research|updates|_meta|visuals)\//;
/** A spot in a file a note cites: "#page=12", "#page=12-14", "#slide=5", "#t=12:03" (a video or transcript). */
interface Spot { kind: "page" | "slide" | "t"; from: number; to?: number }
const SPOT = /#(page|slide|t)=(\d+(?::\d{2}){0,2})(?:\s*[-–]\s*(\d+(?::\d{2}){0,2}))?$/;
function splitSpot(path: string): [string, Spot | null] {
  const m = path.match(SPOT);
  if (!m) return [path, null];
  const kind = m[1] as Spot["kind"];
  const num = (s?: string) => (s === undefined ? undefined : kind === "t" ? timeOf(s) ?? Number(s) : Number(s));
  return [path.slice(0, m.index), { kind, from: num(m[2])!, to: num(m[3]) }];
}

/**
 * Where a path an agent wrote or named opens in the app: a note page, an assignment page, or the file
 * itself (PDFs, slides and videos in the app's viewers, anything else in a new tab). Takes repo-relative
 * or absolute paths, and paths inside the semester folder when `sem` is given ("notes/COS514/x.md"). A
 * cited spot at the end opens the PDF viewer at that page, the slide viewer at that slide, or the video
 * page at that moment. Null when the app can't open it.
 */
export function fileLink(path: string, sem?: string): { to: string; internal: boolean } | null {
  const [p0, spot] = splitSpot(path.trim().replace(/[),.;]+$/, ""));
  let p = p0.replace(/^\.\//, "").replace(/[),.;:]+$/, "");
  const at = p.indexOf("semesters/");
  if (at > 0 && p[at - 1] === "/") p = p.slice(at);   // an absolute path inside the study folder
  else if (sem && TOP.test(p)) p = `semesters/${sem}/${p}`;
  const m = p.match(/^semesters\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const [, s, rest] = m;
  const plan = rest.match(/^plans\/(\d{4}-W\d{1,2})\.md$/);
  if (plan) return { to: `/${encodeURIComponent(s)}/plan/${plan[1]}`, internal: true };
  const note = rest.match(/^notes\/([^/]+)\/([^/]+)\.md$/);
  if (note) return { to: `/${encodeURIComponent(s)}/notes/${encodeURIComponent(note[1])}/${encodeURIComponent(note[2])}`, internal: true };
  // an assignment's folder, its working notes or its prep pack open the assignment page; its files open as files
  const asg = rest.match(/^assignments\/([^/]+)\/([^/]+)(?:\/(README\.md|PREP\.md)?)?$/);
  if (asg) return { to: `/${encodeURIComponent(s)}/assignments/${encodeURIComponent(asg[1])}/${encodeURIComponent(asg[2])}`, internal: true };
  if (!/\.\w{1,6}$/.test(rest)) return null;   // a folder
  const href = `/files/${s}/${enc(rest)}`;
  if (spot?.kind === "t" && /\.transcript\.md$/i.test(rest)) return { to: `/${s}/video/${encodeURIComponent(rest)}#t=${spot.from}`, internal: true };
  const slides = slidesPage(href), video = videoPage(href), pdf = pdfPage(href);
  if (pdf) return { to: pdf + (spot?.kind === "page" ? `#page=${spot.from}` : ""), internal: true };
  if (slides) return { to: slides + (spot?.kind === "slide" ? `#${spot.from}` : ""), internal: true };
  if (video) return { to: video + (spot?.kind === "t" ? `#t=${spot.from}` : ""), internal: true };
  return { to: href, internal: false };
}

/** PowerPoint files open in the app's slide viewer: /files/<sem>/<path>.pptx → /<sem>/slides/<path>. Null for other files. */
export function slidesPage(href?: string): string | null {
  const m = href?.match(/^\/files\/([^/]+)\/(.+\.(?:pptx|ppsx|ppt|pps|odp))$/i);
  if (!m) return null;
  try { return `/${m[1]}/slides/${encodeURIComponent(decodeURIComponent(m[2]))}`; } catch { return null; }
}

/** PDFs open in the app's PDF viewer: /files/<sem>/<path>.pdf → /<sem>/pdf/<path>. Null for other files. */
export function pdfPage(href?: string): string | null {
  const m = href?.match(/^\/files\/([^/]+)\/(.+\.pdf)$/i);
  if (!m) return null;
  try { return `/${m[1]}/pdf/${encodeURIComponent(decodeURIComponent(m[2]))}`; } catch { return null; }
}

/** Class videos open on the app's video page, with the transcript beside them: /files/<sem>/<path>.mp4 → /<sem>/video/<path>. */
export function videoPage(href?: string): string | null {
  const m = href?.match(/^\/files\/([^/]+)\/(.+\.(?:mp4|m4v|mov|webm|mkv|avi|mp3|m4a|wav|aac|ogg|oga|opus|flac))$/i);
  if (!m) return null;
  try { return `/${m[1]}/video/${encodeURIComponent(decodeURIComponent(m[2]))}`; } catch { return null; }
}

/**
 * Where a week item's transcript opens: the video page (the video beside its transcript), the slide
 * viewer for narrated slides, and for a Panopto link the video page with the transcript alone.
 */
export function transcriptPage(it: { href?: string; transcript?: string; external?: boolean }): string {
  const own = !it.external && (videoPage(it.href) ?? slidesPage(it.href));
  if (own) return own;
  const m = it.transcript?.match(/^\/files\/([^/]+)\/(.+)$/);
  try { return m ? `/${m[1]}/video/${encodeURIComponent(decodeURIComponent(m[2]))}` : it.transcript ?? ""; } catch { return it.transcript ?? ""; }
}

/** "p. 12", "pp. 12–14", "slide 5", "at 12:03": where a citation points. */
function spotLabel(s: Spot): string {
  if (s.kind === "t") return `at ${stamp(s.from)}`;
  const range = s.to !== undefined && s.to !== s.from;
  const what = s.kind === "page" ? (range ? "pp." : "p.") : range ? "slides" : "slide";
  return `${what} ${s.from}${range ? `–${s.to}` : ""}`;
}

/** What a link to a path shows: the file (or folder) name; a note's slug, an assignment's folder, "Week 42 plan"; a citation adds its spot ("Reading.pdf, p. 12"). */
export function linkLabel(path: string, l = fileLink(path)): string {
  const [bare, spot] = splitSpot(path.trim().replace(/[),.;]+$/, ""));
  const parts = bare.replace(/[),.;:]+$/, "").replace(/\/+$/, "").split("/");
  const name = parts.pop() || path;
  if (spot) return spot.kind === "t" ? `${name.replace(/\.transcript\.md$/i, "")} ${spotLabel(spot)}` : `${name}, ${spotLabel(spot)}`;
  if (!l?.internal) return name;
  if (/^(README|PREP)\.md$/.test(name)) return parts.pop() ?? name;
  const wk = name.match(/^\d{4}-W(\d{1,2})\.md$/);
  return wk ? `Week ${Number(wk[1])} plan` : name.replace(/\.md$/, "");
}

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
/** Turns `paths` in a reply's HTML (and links to paths) into links to the app's pages and files. */
export function linkPaths(html: string, sem?: string): string {
  return html
    .replace(/<a href="([^"]+)"/g, (all, href) => {
      const l = /^[a-z]+:/i.test(href) || href.startsWith("/files/") ? null : fileLink(decodeURIComponent(unescape(href)), sem);
      return l ? `<a href="${attr(l.to)}"${l.internal ? " data-internal" : ' target="_blank" rel="noreferrer"'}` : all;
    })
    .replace(/(<a [^>]*>[\s\S]*?<\/a>)|<code>([^<]+)<\/code>/g, (all, link, code) => {
      if (link) return all;   // already a link
      const path = unescape(code);
      const l = fileLink(path, sem);
      // the link shows just the file (or folder) name; the full path is in the tooltip
      const name = linkLabel(path, l);
      return l ? `<a href="${attr(l.to)}"${l.internal ? " data-internal" : ' target="_blank" rel="noreferrer"'} title="${attr(path)}"><code>${attr(name).replace(/</g, "&lt;")}</code></a>` : all;
    });
}

/** A Panopto viewer link that starts at `sec`. */
export const panoptoAt = (url: string, sec: number) => { try { const u = new URL(url); u.searchParams.set("start", String(Math.floor(sec))); return u.toString(); } catch { return url; } };
