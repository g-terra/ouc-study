/**
 * Which files a backup takes: the student's own (semesters/, memory/, STUDENT.md, CLAUDE.local.md, AI
 * settings and chats in .ouc/). An allow-list, so a new secret or cache can't slip in by accident;
 * the eClass key and the backup's own sign-in are refused wherever they are.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FileEntry } from "./summary.ts";

export interface SelectOptions {
  /** slides, PDFs and readings under semesters/<id>/courses/ (default on) */
  courseFiles?: boolean;
  /** class videos (default on) */
  videos?: boolean;
  /** files bigger than this go to `tooBig` (the target's limit) */
  maxBytes?: number;
}

const ROOTS = ["semesters", "memory", "STUDENT.md", "CLAUDE.local.md", ".ouc/ai.json", ".ouc/media.json", ".ouc/chats"];
const NEVER = new Set([".eclass-token", "backup.json", ".DS_Store", "Thumbs.db"]);
const VIDEO = /\.(mp4|m4v|mov|webm|mkv|avi)$/i;
const COURSE_FILE = /^semesters\/[^/]+\/courses\//;

const skip = (name: string) => NEVER.has(name) || name.endsWith(".part") || name === ".git" || name === "node_modules";

function walk(root: string, rel: string, out: FileEntry[]) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return;
  const st = statSync(abs);
  if (st.isDirectory()) {
    for (const name of readdirSync(abs)) if (!skip(name)) walk(root, `${rel}/${name}`, out);
  } else if (st.isFile()) out.push({ path: rel, size: st.size, mtimeMs: Math.round(st.mtimeMs) });
}

export function selectFiles(root: string, opts: SelectOptions = {}): { files: FileEntry[]; tooBig: FileEntry[] } {
  const all: FileEntry[] = [];
  for (const r of ROOTS) walk(root, r, all);
  const wanted = all.filter((f) => {
    if (opts.courseFiles === false && COURSE_FILE.test(f.path) && !f.path.endsWith(".transcript.md")) return false;
    if (opts.videos === false && VIDEO.test(f.path)) return false;
    return true;
  }).sort((a, b) => (a.path < b.path ? -1 : 1));
  const max = opts.maxBytes ?? Infinity;
  return { files: wanted.filter((f) => f.size <= max), tooBig: wanted.filter((f) => f.size > max) };
}
