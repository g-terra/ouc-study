// Pre-submission review: the student uploads their own .docx, an AI reviews it (feedback and what to
// fix, never rewritten answers), each upload is a new numbered round, and Approve turns the approved
// .docx into a PDF on this computer, unchanged. Everything stays in the git-ignored semesters/ folder:
//
//   semesters/<sem>/assignments/<CODE>/<folder>/review/
//     review.json     { versions: [{ v, name, size, words, uploaded, review? }], approved?: { v, pdf, at, with } }
//     v1.docx, v1.md  the upload and its text (for AIs that can't open Word files)
//     REVIEW-v1.md    the AI's review of v1 (front matter: verdict)
//     <name>.pdf      the approved version as a PDF, named like the .docx
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { read } from "./context.ts";
import { docxText, isDocx, wordCount } from "./docx.ts";
import { whichAll } from "./providers.ts";
import type { Assignment } from "../../content/src/types.ts";

type Ref = Pick<Assignment, "id">;
export interface Version {
  v: number; name: string; size: number; words: number; uploaded: string;
  review?: { chatId?: string; tool?: string; started?: string; finished?: string; [k: string]: unknown };
}
export interface Approval { v: number; pdf: string; at: string; with: string }
/** review/review.json */
export interface ReviewState { versions: Version[]; approved?: Approval }
export interface Converter { kind: "libreoffice" | "pandoc"; bin: string; label: string }

export const MAX_UPLOAD = 25 * 1024 * 1024;
/** The review folder of an assignment (repo-relative). */
export const reviewDir = (semId: string, a: Ref) => `semesters/${semId}/assignments/${a.id}/review`;
const stateFile = (root: string, semId: string, a: Ref) => join(root, reviewDir(semId, a), "review.json");
export const reviewFile = (semId: string, a: Ref, v: number) => `${reviewDir(semId, a)}/REVIEW-v${v}.md`;
const fileHref = (semId: string, rel: string) => `/files/${encodeURIComponent(semId)}/${rel.split("/").map(encodeURIComponent).join("/")}`;

export function loadReview(root: string, semId: string, a: Ref): ReviewState {
  try { return { versions: [], ...JSON.parse(read(stateFile(root, semId, a), "{}")) }; } catch { return { versions: [] }; }
}
function saveReview(root: string, semId: string, a: Ref, state: ReviewState) {
  mkdirSync(join(root, reviewDir(semId, a)), { recursive: true });
  writeFileSync(stateFile(root, semId, a), `${JSON.stringify(state, null, 1)}\n`);
}

/** "My answers (final).docx" → "My answers (final)" with nothing a file system dislikes. */
export const safeBase = (name: unknown) => basename(String(name || "submission")).replace(/\.docx$/i, "").replace(/[^\p{L}\p{N} ._()-]+/gu, "_").trim().slice(0, 80) || "submission";

/** Saves an upload as the next version. Throws a readable Error for anything but a .docx. */
export function addVersion(root: string, semId: string, a: Ref, name: string, buf: Buffer, now = new Date()): Version | undefined {
  if (!buf?.length) throw new Error("The file is empty.");
  if (buf.length > MAX_UPLOAD) throw new Error("That file is over 25 MB.");
  if (!isDocx(buf)) throw new Error("That isn't a Word .docx file. In Word or Pages, use Save As → .docx and upload that.");
  const state = loadReview(root, semId, a);
  const v = (state.versions.at(-1)?.v ?? 0) + 1;
  const dir = join(root, reviewDir(semId, a));
  mkdirSync(dir, { recursive: true });
  const text = docxText(buf) ?? "";
  writeFileSync(join(dir, `v${v}.docx`), buf);
  writeFileSync(join(dir, `v${v}.md`), `<!-- Text of ${safeBase(name)}.docx (version ${v}), for the reviewer. The student's own work: don't edit it. -->\n\n${text}\n`);
  state.versions.push({ v, name: `${safeBase(name)}.docx`, size: buf.length, words: wordCount(text), uploaded: now.toISOString() });
  saveReview(root, semId, a, state);
  return state.versions.at(-1);
}

/** Notes which AI is reviewing a version (when the run starts) and when it finished. */
export function markReview(root: string, semId: string, a: Ref, v: number, patch: Version["review"]): void {
  const state = loadReview(root, semId, a);
  const ver = state.versions.find((x) => x.v === v);
  if (!ver) return;
  ver.review = { ...ver.review, ...patch };
  saveReview(root, semId, a, state);
}

/** What the assignment page shows: every round with its review, newest last, and the approval. */
export function reviewState(root: string, semId: string, a: Ref, isRunning: (chatId: string) => boolean = () => false) {
  const state = loadReview(root, semId, a);
  const rel = reviewDir(semId, a).replace(`semesters/${semId}/`, "");
  const versions = state.versions.map((ver) => {
    const md = read(join(root, reviewFile(semId, a, ver.v)));
    const fm = md.match(/^---\n([\s\S]*?)\n---\n?/);
    const verdict = fm?.[1]!.match(/^verdict:\s*(.+)$/m)?.[1]!.trim().replace(/^["']|["']$/g, "");
    return {
      ...ver, href: fileHref(semId, `${rel}/v${ver.v}.docx`), textPath: `${reviewDir(semId, a)}/v${ver.v}.md`,
      review: ver.review || md ? { ...ver.review, body: md ? md.slice(fm ? fm[0].length : 0).trim() : undefined, verdict, path: reviewFile(semId, a, ver.v), running: !!ver.review?.chatId && isRunning(ver.review.chatId) } : undefined,
    };
  });
  const ap = state.approved;
  const approved = ap && existsSync(join(root, reviewDir(semId, a), ap.pdf)) ? { ...ap, href: fileHref(semId, `${rel}/${ap.pdf}`) } : undefined;
  return { versions, approved };
}

// ---------- Approve: the .docx as a PDF, converted on this computer ----------
const SOFFICE: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: ["/Applications/LibreOffice.app/Contents/MacOS/soffice", join(homedir(), "Applications/LibreOffice.app/Contents/MacOS/soffice")],
  win32: [join(process.env.ProgramFiles ?? "C:\\Program Files", "LibreOffice\\program\\soffice.exe"), join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "LibreOffice\\program\\soffice.exe")],
};
export const NO_CONVERTER = "No PDF converter on this computer. Install LibreOffice (free, https://www.libreoffice.org/download/ , or on a Mac: brew install --cask libreoffice) and press Approve again. Or open the .docx in Word and use File → Save as PDF.";

/** LibreOffice if it's installed, else pandoc (which needs a LaTeX engine for PDFs), else null. */
export function findConverter(platform: NodeJS.Platform = process.platform): Converter | null {
  const soffice = (SOFFICE[platform] ?? []).find(existsSync) ?? whichAll("soffice")[0] ?? whichAll("libreoffice")[0];
  if (soffice) return { kind: "libreoffice", bin: soffice, label: "LibreOffice" };
  const pandoc = whichAll("pandoc")[0];
  return pandoc ? { kind: "pandoc", bin: pandoc, label: "pandoc" } : null;
}

function run(bin: string, args: string[], ms = 180_000) {
  return new Promise<{ ok: boolean; err: string }>((done) => {
    let err = "";
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    const t = setTimeout(() => { p.kill(); err += "Took too long."; }, ms);
    p.stderr!.on("data", (d) => (err += d));
    p.on("error", (e) => { clearTimeout(t); done({ ok: false, err: e.message }); });
    p.on("exit", (code) => { clearTimeout(t); done({ ok: code === 0, err: err.trim() }); });
  });
}

/** Converts version v (default: the latest) to `<name>.pdf` in the review folder and records the approval. */
export async function approve(root: string, semId: string, a: Ref, v?: number | string | null, { converter = findConverter(), now = new Date() }: { converter?: Converter | null; now?: Date } = {}): Promise<Approval> {
  const state = loadReview(root, semId, a);
  const ver = v ? state.versions.find((x) => x.v === Number(v)) : state.versions.at(-1);
  if (!ver) throw new Error("Upload your .docx first.");
  if (!converter) throw new Error(NO_CONVERTER);
  const dir = join(root, reviewDir(semId, a));
  const src = join(dir, `v${ver.v}.docx`);
  const out = join(dir, `v${ver.v}.pdf`);
  rmSync(out, { force: true });
  const r = converter.kind === "libreoffice"
    // its own profile, so it works while LibreOffice is open
    ? await run(converter.bin, [`-env:UserInstallation=${pathToFileURL(join(tmpdir(), "ouc-libreoffice")).href}`, "--headless", "--convert-to", "pdf", "--outdir", dir, src])
    : await run(converter.bin, [src, "-o", out]);
  if (!r.ok || !existsSync(out) || !statSync(out).size) {
    throw new Error(`${converter.label} couldn't make the PDF${r.err ? `: ${r.err.split("\n").slice(-3).join(" ")}` : "."}${converter.kind === "pandoc" ? ` ${NO_CONVERTER}` : ""}`);
  }
  // one approved PDF at a time, named like the student's file
  const pdf = `${ver.name.replace(/\.docx$/i, "")}.pdf`;
  if (state.approved?.pdf && state.approved.pdf !== pdf) rmSync(join(dir, basename(state.approved.pdf)), { force: true });
  if (pdf !== `v${ver.v}.pdf`) renameSync(out, join(dir, pdf));
  state.approved = { v: ver.v, pdf, at: now.toISOString(), with: converter.label };
  saveReview(root, semId, a, state);
  return state.approved;
}
