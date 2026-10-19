// Course slides in the browser: a PowerPoint file becomes a PDF (LibreOffice, on this computer) that the
// app's slide viewer shows page by page, with each slide's narration (audio clips embedded in the .pptx)
// played next to it. Made on first view and kept in .ouc/slides/ (git-ignored), next to nothing personal:
//
//   .ouc/slides/<key>/          key = hash of the file's path, size and date, so an updated file is redone
//     slides.pdf                the presentation, one page per (visible) slide
//     slides.json               { file, slides: [{ n, audio: ["media2.m4a"] }] }
//     media2.m4a, ...           the narration clips, taken out of the .pptx
//
//   GET /api/slides/info?file=<sem>/<path>.pptx   → { ok, pdf, slides: [{ n, audio: [url] }], download }
//   GET /api/slides/file/<key>/<name>             → the PDF or an audio clip (supports seeking)
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { basename, extname, join, posix, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { unzipEntry } from "./docx.ts";
import { findConverter } from "./review.ts";

export const SLIDE_FILE = /\.(pptx|ppsx|ppt|pps|odp)$/i;
const AUDIO: Record<string, string> = { ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".aac": "audio/aac", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg", ".webm": "audio/webm", ".flac": "audio/flac" };
export const NO_LIBREOFFICE = "Showing slides here needs LibreOffice (free): https://www.libreoffice.org/download/ , or on a Mac: brew install --cask libreoffice, on Windows: winget install TheDocumentFoundation.LibreOffice. Then open the slides again.";

export interface Slide { n: number; audio: string[] }
export interface SlideDeck { file: string; slides: Slide[] }

const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
/** Relationship id → { type, target } of a part's .rels file. */
function rels(buf: Buffer, part: string): Map<string, { type: string; target: string }> {
  const dir = posix.dirname(part);
  const xml = unzipEntry(buf, `${dir}/_rels/${posix.basename(part)}.rels`)?.toString("utf8") ?? "";
  const out = new Map<string, { type: string; target: string }>();
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (a.Id && a.Target && a.TargetMode !== "External") out.set(a.Id, { type: a.Type ?? "", target: posix.normalize(posix.join(dir, a.Target)) });
  }
  return out;
}

/**
 * The slides of a .pptx in show order, without hidden ones (LibreOffice leaves those out of the PDF too),
 * each with the audio clips it plays (zip paths, e.g. "ppt/media/media2.m4a"). Null if it isn't a .pptx.
 */
export function pptxSlides(buf: Buffer): { n: number; audio: string[] }[] | null {
  const pres = unzipEntry(buf, "ppt/presentation.xml")?.toString("utf8");
  if (!pres) return null;
  const pr = rels(buf, "ppt/presentation.xml");
  const parts = [...pres.matchAll(/<p:sldId\b[^>]*>/g)].map((m) => pr.get(attrs(m[0])["r:id"])?.target).filter((x): x is string => !!x);
  const out: { n: number; audio: string[] }[] = [];
  for (const part of parts) {
    const xml = unzipEntry(buf, part)?.toString("utf8");
    if (!xml || /<p:sld\b[^>]*\bshow="(0|false)"/.test(xml)) continue;
    const audio = [...new Set([...rels(buf, part).values()]
      .filter((r) => /\/(audio|media)$/.test(r.type) && AUDIO[extname(r.target).toLowerCase()])
      .map((r) => r.target))];
    out.push({ n: out.length + 1, audio });
  }
  return out;
}

// ---------- making the PDF ----------
/** Makes `<outDir>/<name>.pdf` from `src`; resolves with its path, or throws a message for the student. */
export type Convert = (src: string, outDir: string) => Promise<string>;

function run(bin: string, args: string[], ms: number) {
  return new Promise<{ ok: boolean; err: string }>((done) => {
    let err = "";
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    const t = setTimeout(() => { p.kill(); err += " Took too long."; }, ms);
    p.stderr!.on("data", (d) => (err += d));
    p.on("error", (e) => { clearTimeout(t); done({ ok: false, err: e.message }); });
    p.on("exit", (code) => { clearTimeout(t); done({ ok: code === 0, err: err.trim() }); });
  });
}

/** LibreOffice's converter, or null when it isn't installed. */
export function libreOffice(): Convert | null {
  const c = findConverter();
  if (c?.kind !== "libreoffice") return null;
  return async (src, outDir) => {
    // its own profile, so it works while LibreOffice is open (and alongside the review's PDFs)
    const profile = pathToFileURL(join(tmpdir(), "ouc-libreoffice-slides")).href;
    const r = await run(c.bin, [`-env:UserInstallation=${profile}`, "--headless", "--convert-to", "pdf", "--outdir", outDir, src], 5 * 60_000);
    const pdf = join(outDir, `${basename(src, extname(src))}.pdf`);
    if (!r.ok || !existsSync(pdf) || !statSync(pdf).size) throw new Error(`LibreOffice couldn't open these slides${r.err ? `: ${r.err.split("\n").slice(-2).join(" ")}` : "."}`);
    return pdf;
  };
}

export const deckKey = (rel: string, abs: string) => {
  const s = statSync(abs);
  return createHash("sha1").update(`${rel}|${s.size}|${Math.round(s.mtimeMs)}`).digest("hex").slice(0, 16);
};

/** Makes (or reuses) the PDF and audio of one slide file. `rel` is "<sem>/<path>" inside the semesters folder. */
export async function prepareDeck(cache: string, rel: string, abs: string, convert: Convert): Promise<{ key: string; deck: SlideDeck }> {
  const key = deckKey(rel, abs);
  const dir = join(cache, key);
  const done = join(dir, "slides.json");
  if (existsSync(done) && existsSync(join(dir, "slides.pdf"))) return { key, deck: JSON.parse(readFileSync(done, "utf8")) };
  const work = mkdtempSync(join(tmpdir(), "ouc-slides-"));
  try {
    // copied under a plain name: LibreOffice names the PDF after it, and some names trip it up
    const src = join(work, `slides${extname(abs).toLowerCase()}`);
    writeFileSync(src, readFileSync(abs));
    const pdf = await convert(src, work);
    const buf = /\.(pptx|ppsx)$/i.test(abs) ? readFileSync(abs) : null;
    const found = (buf && pptxSlides(buf)) ?? [];
    mkdirSync(dir, { recursive: true });
    const slides = found.map((s) => ({
      n: s.n,
      audio: s.audio.flatMap((zip) => {
        const name = posix.basename(zip).replace(/[^\w.-]/g, "_");
        if (!existsSync(join(dir, name))) {
          const data = unzipEntry(buf!, zip);
          if (!data) return [];
          writeFileSync(join(dir, name), data);
        }
        return [name];
      }),
    }));
    copyFileSync(pdf, join(dir, "slides.pdf"));   // not rename: the temp folder may be on another disk
    const deck: SlideDeck = { file: rel, slides };
    writeFileSync(done, JSON.stringify(deck, null, 2));
    // older versions of this same file
    for (const d of readdirSync(cache)) {
      if (d === key) continue;
      try { if (JSON.parse(readFileSync(join(cache, d, "slides.json"), "utf8")).file === rel) rmSync(join(cache, d), { recursive: true, force: true }); } catch {}
    }
    return { key, deck };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------- serving ----------
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const json = (res: ServerResponse, body: unknown, status = 200) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); };
const fileHref = (rel: string) => `/files/${rel.split("/").map(encodeURIComponent).join("/")}`;

/** Sends a file, with byte ranges (so audio and video can seek). */
export function sendFile(req: IncomingMessage, res: ServerResponse, abs: string, type: string) {
  const { size } = statSync(abs);
  res.setHeader("Content-Type", type);
  res.setHeader("Accept-Ranges", "bytes");
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) { res.statusCode = 416; res.setHeader("Content-Range", `bytes */${size}`); return res.end(); }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.setHeader("Content-Length", end - start + 1);
    return createReadStream(abs, { start, end }).pipe(res);
  }
  res.setHeader("Content-Length", size);
  createReadStream(abs).pipe(res);
}

/**
 * /api/slides/*: `semesters` is the folder the course files are in, `cache` where the PDFs go.
 * `convert` defaults to LibreOffice, looked up again after a minute so installing it needs no restart.
 */
export function createSlidesApi({ semesters, cache, convert }: { semesters: string; cache: string; convert?: () => Convert | null }) {
  semesters = resolve(semesters);
  let found = { at: 0, conv: null as Convert | null };
  const converter = convert ?? (() => { if (Date.now() - found.at > 60_000) found = { at: Date.now(), conv: libreOffice() }; return found.conv; });
  const busy = new Map<string, Promise<{ key: string; deck: SlideDeck }>>();
  let queue: Promise<unknown> = Promise.resolve();   // one LibreOffice at a time
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith("/api/slides/")) return next();
    const origin = req.headers.origin;
    if (!LOCAL_HOST.test(req.headers.host ?? "") || (origin && !LOCAL_HOST.test(origin.replace(/^https?:\/\//, "")))) return json(res, { error: "Forbidden" }, 403);
    const url = new URL(req.url, "http://x");
    const file = url.pathname.match(/^\/api\/slides\/file\/([0-9a-f]{16})\/([\w.-]+)$/);
    if (file) {
      const abs = join(cache, file[1], file[2]);
      const type = file[2] === "slides.pdf" ? "application/pdf" : AUDIO[extname(file[2]).toLowerCase()];
      if (!type || !existsSync(abs)) return json(res, { error: "Not found" }, 404);
      return sendFile(req, res, abs, type);
    }
    if (url.pathname !== "/api/slides/info") return json(res, { error: "Not found" }, 404);
    const rel = (url.searchParams.get("file") ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
    const abs = resolve(semesters, rel);
    if (!SLIDE_FILE.test(rel) || !(abs + sep).startsWith(semesters + sep) || !existsSync(abs) || !statSync(abs).isFile()) return json(res, { ok: false, error: "Those slides aren't in your course files." }, 404);
    const download = fileHref(rel);
    const conv = converter();
    if (!conv) return json(res, { ok: false, needsConverter: true, error: NO_LIBREOFFICE, download });
    let key: string;
    try { key = deckKey(rel, abs); } catch { return json(res, { ok: false, error: "Couldn't read the file.", download }, 500); }
    let job = busy.get(key);
    if (!job) {
      job = queue.then(() => prepareDeck(cache, rel, abs, conv));
      queue = job.catch(() => {});
      busy.set(key, job);
      job.finally(() => busy.delete(key)).catch(() => {});
    }
    job.then(({ key, deck }) => json(res, {
      ok: true,
      download,
      pdf: `/api/slides/file/${key}/slides.pdf`,
      slides: deck.slides.map((s) => ({ n: s.n, audio: s.audio.map((a) => `/api/slides/file/${key}/${a}`) })),
    }), (e: Error) => json(res, { ok: false, error: e.message, download }, 500));
  };
}
