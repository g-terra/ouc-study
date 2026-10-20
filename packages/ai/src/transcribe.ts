// Transcripts of class videos and narrated slides, made on this computer with Whisper (free, no API,
// nothing leaves the computer). The make-notes skill reads them as the base for a week's notes.
//
//   ouc transcribe           transcribe what's new in the current semester (also runs in the background app)
//   ouc transcribe --setup   install Whisper (asked by `ouc setup` too)
//
// Engines, the first one found is used:
//   whisper.cpp   whisper-cli + ffmpeg (Mac: brew install whisper-cpp ffmpeg) and a model in .ouc/whisper/
//   faster-whisper   Python (pip install faster-whisper), through tools/transcribe.py; it downloads its model itself.
//                    Windows and Linux use this; on Windows, --setup installs Python with winget first if needed
//
// What gets a transcript: every video or audio file under semesters/<sem>/courses/ and every .pptx
// with narration (one section per slide). The transcript sits next to it ("Lecture 3.transcript.md",
// see packages/eclass-sync/src/media.ts) and is never redone. Settings: .ouc/media.json
// ("transcribe": false turns it off, "model": "small" by default). Whisper is optional: `ouc setup` asks,
// and ⚙ Settings in the app can set it up or turn it off. Without it nothing is transcribed and nothing
// complains. Files that failed are tried again after a day (.ouc/transcribe-state.json).
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, posix, relative, resolve, win32 } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import { MEDIA_FILE, loadMediaConfig, saveMediaConfig, srtToSegments, transcriptMarkdown, transcriptPath, type Segment } from "../../eclass-sync/src/media.ts";
import type { SemesterConfig } from "../../content/src/eclass.ts";
import { currentSemesterId } from "./context.ts";
import { unzipEntry } from "./docx.ts";
import { whichAll } from "./providers.ts";
import { pptxSlides } from "./slides.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const MAC = process.platform === "darwin", WIN = process.platform === "win32";
const SLIDES = /\.(pptx|ppsx)$/i;
export const NO_WHISPER = MAC
  ? "Transcripts need Whisper (free, runs on this computer). Run in Terminal: ouc transcribe --setup  (it runs: brew install whisper-cpp ffmpeg)"
  : WIN ? "Transcripts need Whisper (free, runs on this computer). Run: ouc transcribe --setup  (it installs Python with winget if needed, then faster-whisper)"
  : "Transcripts need Whisper (free, runs on this computer). Run: ouc transcribe --setup  (it installs faster-whisper for Python)";

/** Speech to text for a list of files; per file its segments, or null if that one failed. */
export interface Engine { label: string; transcribe(files: string[]): Promise<(Segment[] | null)[]> }

// ---------- running things ----------
function run(bin: string, args: string[], { ms = 3 * 3600_000, onLine }: { ms?: number; onLine?: (l: string) => void } = {}) {
  return new Promise<{ ok: boolean; err: string }>((done) => {
    let err = "", buf = "";
    const p = spawn(bin, args, { stdio: ["ignore", onLine ? "pipe" : "ignore", "pipe"], windowsHide: true });
    const t = setTimeout(() => { p.kill(); err += " Took too long."; }, ms);
    p.stdout?.on("data", (d) => { buf += d; const lines = buf.split("\n"); buf = lines.pop()!; lines.forEach((l) => onLine!(l)); });
    p.stderr!.on("data", (d) => { err = (err + d).slice(-4000); });
    p.on("error", (e) => { clearTimeout(t); done({ ok: false, err: e.message }); });
    p.on("exit", (code) => { clearTimeout(t); if (buf) onLine?.(buf); done({ ok: code === 0, err: err.trim() }); });
  });
}
// the background app starts with a short PATH: also look where Homebrew puts things
const EXTRA = MAC ? ["/opt/homebrew/bin", "/usr/local/bin"] : [];
const findBin = (...names: string[]) => {
  for (const n of names) {
    const hit = whichAll(n)[0] ?? EXTRA.map((d) => join(d, n)).find(existsSync);
    if (hit) return hit;
  }
  return null;
};
export const modelFile = (root: string, model: string) => join(root, ".ouc", "whisper", `ggml-${model}.bin`);
export const modelUrl = (model: string) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`;

/** whisper.cpp: ffmpeg makes 16 kHz WAV, whisper-cli writes SRT. */
export function whisperCpp(cli: string, ffmpeg: string, model: string): Engine {
  return {
    label: `whisper.cpp (${basename(model).replace(/^ggml-|\.bin$/g, "")})`,
    async transcribe(files) {
      const out: (Segment[] | null)[] = [];
      for (const f of files) {
        const work = mkdtempSync(join(tmpdir(), "ouc-whisper-"));
        try {
          const wav = join(work, "audio.wav");
          const a = await run(ffmpeg, ["-nostdin", "-y", "-loglevel", "error", "-i", f, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
          if (!a.ok) { out.push(null); continue; }
          const r = await run(cli, ["-m", model, "-f", wav, "-l", "auto", "-osrt", "-of", join(work, "out"), "-np"]);
          const srt = join(work, "out.srt");
          out.push(r.ok && existsSync(srt) ? srtToSegments(readFileSync(srt, "utf8")) : null);
        } finally { rmSync(work, { recursive: true, force: true }); }
      }
      return out;
    },
  };
}

/** faster-whisper through tools/transcribe.py: one Python run (one model load) for all the files. */
export function fasterWhisper(python: string, script: string, model: string): Engine {
  return {
    label: `faster-whisper (${model})`,
    async transcribe(files) {
      const out: (Segment[] | null)[] = files.map(() => []);
      const r = await run(python, [script, "--model", model, ...files], { onLine: (l) => {
        let j: { file?: number; start?: number; end?: number; text?: string; error?: string };
        try { j = JSON.parse(l); } catch { return; }
        if (typeof j.file !== "number" || !(j.file in out)) return;
        if (j.error) out[j.file] = null;
        else if (j.text) out[j.file]?.push({ start: j.start ?? 0, end: j.end ?? j.start ?? 0, text: j.text });
      } });
      return r.ok ? out : files.map(() => null);
    },
  };
}

/**
 * The Pythons to try, best first. On Windows: the py launcher and python on PATH, but not the
 * Microsoft Store's stand-in (WindowsApps\python.exe, which only opens the Store), then the places
 * the python.org / winget installer uses, so a Python installed a moment ago is found without a new window.
 */
export function pythonCandidates({ platform = process.platform, env = process.env, which = (b: string) => findBin(b), list = (d: string) => { try { return readdirSync(d); } catch { return []; } }, exists = existsSync }:
  { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; which?: (bin: string) => string | null; list?: (dir: string) => string[]; exists?: (p: string) => boolean } = {}): string[] {
  if (platform !== "win32") return ["python3", "python"].map(which).filter((p): p is string => !!p);
  const { join: wjoin } = win32;
  const local = wjoin(env.LOCALAPPDATA ?? wjoin(env.USERPROFILE ?? "C:\\Users\\Default", "AppData", "Local"), "Programs", "Python");
  const installed = list(local).filter((d) => /^Python3\d+$/i.test(d)).sort((a, b) => Number(b.slice(7)) - Number(a.slice(7))).map((d) => wjoin(local, d, "python.exe"));
  const found = ["py", "python", "python3"].map(which).filter((p): p is string => !!p && !/\\WindowsApps\\/i.test(p));
  return [...new Set([...found, wjoin(local, "Launcher", "py.exe"), ...installed])].filter((p) => found.includes(p) || exists(p));
}
const pythons = () => pythonCandidates();

/** The engine to use, or null when none is installed. */
export function findEngine(root: string, model = loadMediaConfig(root).model): Engine | null {
  const cli = findBin("whisper-cli", "whisper-cpp"), ff = findBin("ffmpeg");
  if (cli && ff && existsSync(modelFile(root, model))) return whisperCpp(cli, ff, modelFile(root, model));
  const script = join(root, "tools", "transcribe.py");
  const py = pythons().find((p) => spawnSync(p, [script, "--check"], { stdio: "ignore", windowsHide: true }).status === 0);
  return py ? fasterWhisper(py, script, model) : null;
}

// ---------- installing ----------
async function download(url: string, dest: string, on?: (done: number, total: number) => void) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  let got = 0;
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  const body = Readable.fromWeb(res.body as WebReadableStream);
  body.on("data", (c: Buffer) => { got += c.length; on?.(got, total); });
  try { await pipeline(body, createWriteStream(tmp)); renameSync(tmp, dest); } catch (e) { rmSync(tmp, { force: true }); throw e; }
}

/**
 * Installs an engine: on a Mac with Homebrew whisper.cpp + ffmpeg and the model; elsewhere
 * faster-whisper for Python (pip --user). Says what to do by hand when it can't.
 */
export async function installWhisper(root: string, { log = (_: string) => {}, progress }: { log?: (s: string) => void; progress?: (done: number, total: number) => void } = {}): Promise<{ ok: boolean; message: string }> {
  const { model } = loadMediaConfig(root);
  if (MAC && findBin("brew")) {
    if (!findBin("whisper-cli", "whisper-cpp") || !findBin("ffmpeg")) {
      log("brew install whisper-cpp ffmpeg");
      const r = spawnSync(findBin("brew")!, ["install", "whisper-cpp", "ffmpeg"], { stdio: "ignore" });
      if (r.status !== 0) return { ok: false, message: "brew install whisper-cpp ffmpeg failed. Run it in Terminal to see why." };
    }
    if (!existsSync(modelFile(root, model))) {
      log(`downloading the Whisper "${model}" model (once)`);
      try { await download(modelUrl(model), modelFile(root, model), progress); }
      catch (e) { return { ok: false, message: `Couldn't download the model (${(e as Error).message}). Try again: ouc transcribe --setup` }; }
    }
    return findEngine(root, model) ? { ok: true, message: "whisper.cpp" } : { ok: false, message: "whisper.cpp installed, but it couldn't be found. Open a new Terminal and run: ouc transcribe" };
  }
  if (findEngine(root, model)) return { ok: true, message: "already installed" };
  let py = pythons()[0];
  // Windows without Python: winget installs it for this user (no admin), then faster-whisper goes on top
  if (!py && WIN && findBin("winget")) {
    log("winget install Python 3.12");
    spawnSync("winget", ["install", "-e", "--id", "Python.Python.3.12", "--scope", "user", "--accept-package-agreements", "--accept-source-agreements"], { stdio: "ignore", windowsHide: true });
    py = pythons()[0];
  }
  if (!py) {
    return { ok: false, message: WIN ? "Install Python first (winget install -e --id Python.Python.3.12), then run: ouc transcribe --setup"
      : MAC ? "Install Homebrew (https://brew.sh), then run: ouc transcribe --setup" : "Install Python 3, then run: ouc transcribe --setup" };
  }
  log("pip install faster-whisper");
  const r = spawnSync(py, ["-m", "pip", "install", "--user", "--upgrade", "faster-whisper"], { stdio: "ignore", windowsHide: true });
  if (r.status !== 0) return { ok: false, message: `"${basename(py)} -m pip install --user faster-whisper" failed. Run it yourself to see why.` };
  return findEngine(root, model) ? { ok: true, message: "faster-whisper (its model downloads on the first transcript)" } : { ok: false, message: "faster-whisper installed, but Python can't load it." };
}

// ---------- what to transcribe ----------
export interface MediaJob { code: string; section: number; rel: string; abs: string; kind: "video" | "slides" }
const walk = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.name.startsWith(".") ? [] : e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
};
/** Course videos, audio and slide files in a semester folder that have no transcript yet, oldest week first. */
export function findMedia(semDir: string, cfg: Pick<SemesterConfig, "courses">): MediaJob[] {
  return cfg.courses.flatMap((c) => walk(join(semDir, "courses", c.dir)).flatMap((abs): MediaJob[] => {
    const kind = MEDIA_FILE.test(abs) ? "video" : SLIDES.test(abs) ? "slides" : null;
    if (!kind || existsSync(transcriptPath(abs))) return [];
    const rel = relative(semDir, abs).split(/[\\/]/).join("/");
    const section = Number(rel.split("/")[2]?.match(/^(\d+)-/)?.[1] ?? 0);
    return [{ code: c.code, section, rel, abs, kind }];
  })).sort((a, b) => a.section - b.section || a.rel.localeCompare(b.rel));
}

const titleOf = (abs: string) => basename(abs, extname(abs)).replace(/[_-]audio$/i, "").replace(/[_-]+/g, " ").trim();

/**
 * Transcribes one file next to itself. "noaudio": slides without narration (nothing written).
 * `semId` only goes into the transcript's front matter (source: <sem>/<path>).
 */
export async function transcribeOne(engine: Engine, job: MediaJob, semId: string): Promise<"done" | "noaudio" | "failed"> {
  const out = transcriptPath(job.abs);
  const info = { title: titleOf(job.abs), source: `${semId}/${job.rel}`, by: engine.label };
  if (job.kind === "video") {
    const [segs] = await engine.transcribe([job.abs]);
    if (!segs) return "failed";
    writeFileSync(out, transcriptMarkdown(info, [{ segments: segs }]));
    return "done";
  }
  const buf = readFileSync(job.abs);
  const slides = (pptxSlides(buf) ?? []).filter((s) => s.audio.length);
  if (!slides.length) return "noaudio";
  const work = mkdtempSync(join(tmpdir(), "ouc-narration-"));
  try {
    const clips: { slide: number; file: string }[] = [];
    for (const s of slides) for (const zipPath of s.audio) {
      const data = unzipEntry(buf, zipPath);
      if (!data) continue;
      const file = join(work, `${clips.length}${posix.extname(zipPath)}`);
      writeFileSync(file, data);
      clips.push({ slide: s.n, file });
    }
    const res = await engine.transcribe(clips.map((c) => c.file));
    if (res.every((r) => !r)) return "failed";
    const parts = slides.map((s) => ({ heading: `Slide ${s.n}`, segments: clips.flatMap((c, i) => (c.slide === s.n ? res[i] ?? [] : [])) }));
    writeFileSync(out, transcriptMarkdown(info, parts));
    return "done";
  } finally { rmSync(work, { recursive: true, force: true }); }
}

// ---------- the queue (the background app and `ouc transcribe`) ----------
/** done counts every file tried; made the transcripts written, failed the ones that will be tried again tomorrow. */
export interface TranscribeStatus { enabled: boolean; busy: boolean; total: number; done: number; made: number; failed: number; current: string | null; error: string | null }
/**
 * What ⚙ Settings shows: whether transcripts are on, whether Whisper is set up (engine: which one; null
 * until first checked), and an install started from the app.
 */
export interface WhisperStatus { enabled: boolean; available: boolean | null; engine: string | null; installing: boolean; error: string | null; manual: string }
type Install = (root: string, o: { log?: (s: string) => void }) => Promise<{ ok: boolean; message: string }>;
type State = Record<string, { result: "failed" | "noaudio"; at: string }>;
const stateKey = (j: MediaJob) => { const s = statSync(j.abs); return `${j.rel}|${s.size}|${Math.round(s.mtimeMs)}`; };

/**
 * One transcript at a time, in a background loop. run() resolves when everything new is done;
 * run({ only }) as soon as the matching files are (they jump the queue: Sync now asks for the weeks
 * about to get notes this way). Files that turn up while it runs join the queue.
 */
export function createTranscriber(root: string, { engine = () => findEngine(root), install = installWhisper, semester = () => currentSemesterId(root), now = () => new Date(), on }:
  { engine?: () => Engine | null; install?: Install; semester?: () => string | null; now?: () => Date; on?: (s: TranscribeStatus, job?: MediaJob) => void } = {}) {
  const st: TranscribeStatus = { enabled: loadMediaConfig(root).transcribe, busy: false, total: 0, done: 0, made: 0, failed: 0, current: null, error: null };
  const w = { available: null as boolean | null, engine: null as string | null, installing: false, error: null as string | null };
  /** Looks for Whisper (a moment: it may start Python), and remembers what it found. */
  const check = () => { const e = engine(); w.available = !!e; w.engine = e?.label ?? null; return e; };
  const statePath = join(root, ".ouc", "transcribe-state.json");
  const readState = (): State => { try { return JSON.parse(readFileSync(statePath, "utf8")); } catch { return {}; } };
  let queue: MediaJob[] = [];
  let waiters: { only?: (j: MediaJob) => boolean; done: () => void }[] = [];
  /** What's left to do in the current semester (skips files that failed less than a day ago, and slides without narration). */
  function scan(): { semId: string; jobs: MediaJob[] } | null {
    const conf = loadMediaConfig(root);
    st.enabled = conf.transcribe;
    const semId = semester();
    if (!conf.transcribe || !semId) return null;
    const semDir = join(root, "semesters", semId);
    let cfg: SemesterConfig;
    try { cfg = JSON.parse(readFileSync(join(semDir, "semester.json"), "utf8")); } catch { return null; }
    const state = readState();
    const jobs = findMedia(semDir, cfg).filter((j) => {
      const s = state[stateKey(j)];
      return !s || (s.result === "failed" && now().getTime() - Date.parse(s.at) > 24 * 3600_000);
    });
    return { semId, jobs };
  }
  /** Resolves the waiters with nothing left in the queue (all of them when the loop ends). */
  const settle = (all = false) => {
    waiters = waiters.filter((w) => {
      if (all || (w.only && !queue.some(w.only))) { w.done(); return false; }
      return true;
    });
  };
  async function loop(semId: string, eng: Engine) {
    st.busy = true;
    try {
      while (queue.length) {
        const i = Math.max(0, queue.findIndex((j) => waiters.some((w) => w.only?.(j))));
        const [j] = queue.splice(i, 1);
        if (!j || existsSync(transcriptPath(j.abs))) { st.done++; settle(); continue; }
        st.current = j.rel;
        on?.(st, j);
        let r: Awaited<ReturnType<typeof transcribeOne>> = "failed";
        try { r = await transcribeOne(eng, j, semId); } catch (e) { st.error = (e as Error).message; }
        if (r === "done") st.made++;
        else if (r === "failed") st.failed++;
        if (r !== "done") {
          const state = readState();
          state[stateKey(j)] = { result: r, at: now().toISOString() };
          mkdirSync(dirname(statePath), { recursive: true });
          writeFileSync(statePath, JSON.stringify(state, null, 1));
        }
        st.done++;
        settle();
      }
    } finally { st.busy = false; st.current = null; settle(true); on?.(st); }
  }
  const api = {
    run(opts: { only?: (j: MediaJob) => boolean } = {}): Promise<void> {
      return new Promise<void>((done) => {
        const found = scan();
        if (!found) return done();
        if (st.busy) {
          // add what's new (a sync just downloaded it) to the running loop
          const have = new Set([...queue.map((j) => j.rel), st.current]);
          const extra = found.jobs.filter((j) => !have.has(j.rel));
          queue.push(...extra); st.total += extra.length;
          waiters.push({ only: opts.only, done });
          return settle();
        }
        if (!found.jobs.length) return done();
        const eng = check();
        if (!eng) return done();   // Whisper isn't set up: no transcripts, and nothing to complain about
        queue = found.jobs;
        Object.assign(st, { total: queue.length, done: 0, made: 0, failed: 0, error: null });
        waiters.push({ only: opts.only, done });
        settle();
        loop(found.semId, eng).catch((e) => { st.error = (e as Error).message; });
      });
    },
    status: (): TranscribeStatus => ({ ...st }),
    /** For ⚙ Settings; fresh looks for Whisper again (after installing it by hand). */
    whisper(fresh = false): WhisperStatus {
      if ((fresh || w.available === null) && !w.installing) check();
      return { enabled: loadMediaConfig(root).transcribe, ...w, manual: NO_WHISPER };
    },
    /** Turns transcripts on or off (.ouc/media.json); on starts on what's waiting. */
    setEnabled(on: boolean): WhisperStatus {
      st.enabled = saveMediaConfig(root, { transcribe: on }).transcribe;
      if (on) void api.run();
      return api.whisper();
    },
    /** Sets Whisper up in the background (the app's "Set up Whisper"), then transcribes what's waiting. */
    setup(): WhisperStatus {
      if (!w.installing) {
        Object.assign(w, { installing: true, error: null });
        void install(root, {}).catch((e: Error) => ({ ok: false, message: e.message })).then((r) => {
          w.installing = false;
          if (!check()) w.error = r.ok ? "Whisper was installed, but it couldn't be found. Restart the app (ouc restart)." : r.message;
          else { saveMediaConfig(root, { transcribe: true }); st.enabled = true; void api.run(); }
        });
      }
      return api.whisper();
    },
  };
  return api;
}

// ---------- `ouc transcribe` ----------
export async function main(args: string[]): Promise<void> {
  if (args.includes("--setup")) {
    const r = await installWhisper(ROOT, { log: (s) => console.log(`  … ${s}`), progress: (d, t) => { if (process.stdout.isTTY && t) process.stdout.write(`\r\x1b[2K  ↓ ${Math.round((d / t) * 100)}%`); } });
    if (process.stdout.isTTY) process.stdout.write("\r\x1b[2K");
    console.log(r.ok ? `✓ Whisper ready: ${r.message}. Transcribe with: ouc transcribe` : `✗ ${r.message}`);
    if (!r.ok) process.exitCode = 1;
    return;
  }
  const semId = args.includes("--semester") ? args[args.indexOf("--semester") + 1]! : currentSemesterId(ROOT);
  if (!loadMediaConfig(ROOT).transcribe) { console.log("Transcripts are turned off (\"transcribe\": false in .ouc/media.json)."); return; }
  const t = createTranscriber(ROOT, { semester: () => semId, on: (s, j) => { if (j) console.log(`  ${s.done + 1}/${s.total} ${j.rel.split("/").pop()}`); } });
  await t.run();
  const s = t.status();
  if (s.total === 0 && t.whisper().available === false) { console.log(NO_WHISPER); process.exitCode = 1; return; }
  console.log(s.total ? `✓ ${s.made} transcript(s) made, next to each video or slide file (*.transcript.md)${s.failed ? `; ${s.failed} failed (tried again tomorrow)` : ""}.` : "✓ Nothing new to transcribe.");
  if (s.error) console.log(`  Last error: ${s.error}`);
}
