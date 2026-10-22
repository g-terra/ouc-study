// The homework PDF: Chrome or Edge, already on most computers, prints the app's print page
// (/print/homework/<sem>/<CODE>/<folder>) headless into the assignment's my-submission/ folder.
// The browser lays out the formulas, colours, code and pictures exactly as the app shows them.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { whichAll } from "./providers.ts";

export const NO_BROWSER = "Making the PDF needs Google Chrome or Microsoft Edge on this computer. Install one, or use the print window that opened (choose Save as PDF).";

interface Find { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; exists?: (p: string) => boolean; which?: (bin: string) => string[] }

/** The browser that prints the PDF: OUC_PDF_BROWSER if set, else Chrome, Edge, Chromium or Brave where the system keeps them; null if none. */
export function findBrowser({ platform = process.platform, env = process.env, exists = existsSync, which = (b) => whichAll(b, platform, env) }: Find = {}): string | null {
  if (env.OUC_PDF_BROWSER && exists(env.OUC_PDF_BROWSER)) return env.OUC_PDF_BROWSER;
  const app = (name: string, bin = name) => [`/Applications/${name}.app/Contents/MacOS/${bin}`, join(homedir(), `Applications/${name}.app/Contents/MacOS/${bin}`)];
  const pf = [env.ProgramFiles ?? "C:\\Program Files", env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", env.LOCALAPPDATA].filter(Boolean) as string[];
  const fixed: Partial<Record<NodeJS.Platform, string[]>> = {
    darwin: [...app("Google Chrome"), ...app("Microsoft Edge"), ...app("Chromium"), ...app("Brave Browser")],
    win32: pf.flatMap((d) => [`${d}\\Google\\Chrome\\Application\\chrome.exe`, `${d}\\Microsoft\\Edge\\Application\\msedge.exe`]),
  };
  const found = (fixed[platform] ?? []).find(exists);
  if (found) return found;
  for (const b of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"]) {
    const hit = which(b)[0];
    if (hit) return hit;
  }
  return null;
}

/** "<assignment title> - <name>.pdf", without characters a file name can't have. */
export function pdfFileName(title: string, name: string): string {
  const clean = (s: string) => s.replace(/[\\/]+/g, "_").replace(/[^\p{L}\p{N} ._()&,'-]+/gu, "").replace(/^[\s._]+|[\s.]+$/g, "").replace(/\s+/g, " ").slice(0, 80);
  const t = clean(title) || "Homework", n = clean(name);
  return `${n ? `${t} - ${n}` : t}.pdf`;
}

/**
 * Chrome's flags for printing a page to a PDF. The time budget lets the page fetch the answers before it prints.
 * As root (containers) Chrome only starts without its sandbox, and the smoke tests turn it off like Playwright does
 * (OUC_PDF_NO_SANDBOX); the page it opens is the app's own.
 */
export const printArgs = (url: string, out: string, { noSandbox = process.getuid?.() === 0 || !!process.env.OUC_PDF_NO_SANDBOX }: { noSandbox?: boolean } = {}) => [
  "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", ...(noSandbox ? ["--no-sandbox"] : []),
  `--print-to-pdf=${out}`, "--no-pdf-header-footer", "--virtual-time-budget=15000", url,
];

type Run = (bin: string, args: string[]) => Promise<{ ok: boolean; err: string }>;

const runBrowser: Run = (bin, args) => new Promise((done) => {
  let err = "";
  const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  const t = setTimeout(() => { p.kill(); err += "Took too long."; }, 120_000);
  p.stderr!.on("data", (d) => (err += d));
  p.on("error", (e) => { clearTimeout(t); done({ ok: false, err: e.message }); });
  p.on("exit", (code) => { clearTimeout(t); done({ ok: code === 0, err: err.trim() }); });
});

/** Prints `url` to `out` with the browser. Throws with the reason if there's no browser or no PDF came out. */
export async function makeHomeworkPdf({ browser = findBrowser(), url, out, run = runBrowser }: { browser?: string | null; url: string; out: string; run?: Run }): Promise<string> {
  if (!browser) throw new Error(NO_BROWSER);
  mkdirSync(dirname(out), { recursive: true });
  rmSync(out, { force: true });
  const r = await run(browser, printArgs(url, out));
  if (!r.ok || !existsSync(out) || !statSync(out).size) {
    rmSync(out, { force: true });
    throw new Error(`The browser couldn't make the PDF${r.err ? `: ${r.err.split("\n").filter(Boolean).slice(-2).join(" ")}` : "."}`);
  }
  return out;
}
