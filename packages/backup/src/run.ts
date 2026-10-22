/**
 * One backup run: pick the files, work out what changed since the last good backup, push, and save how
 * it went in .ouc/backup-status.json (what Settings shows). Never throws: a failure is a status with
 * the reason, and the next run sends everything that changed since the last good one.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { driveBackup } from "./drive.ts";
import { gitBackup } from "./git.ts";
import { prepareSources } from "./media.ts";
import { selectFiles, type SelectOptions } from "./select.ts";
import { diffFiles, summarize, type FileEntry } from "./summary.ts";

export interface BackupStatus {
  ok: boolean;
  target?: "github" | "drive";
  /** when this run happened (ISO) */
  at: string;
  /** "3 notes, progress" or "no changes" */
  summary: string;
  files: number;
  bytes: number;
  error?: string;
  /** the last run that worked, when this one didn't */
  lastGood?: string;
}

export interface RunOptions extends Omit<SelectOptions, "maxBytes"> {
  root: string;
  /** GitHub (any git remote) ... */
  remote?: string;
  env?: NodeJS.ProcessEnv;
  /** ... or Google Drive */
  drive?: { accessToken: string; api?: string };
  now?: Date;
  /** bigger files go up in parts (GitHub refuses files over 100 MB and warns above 50); Drive takes any size */
  maxBytes?: number;
  /** ffmpeg for videos' smaller copies; null backs up the originals */
  ffmpeg?: string | null;
  ffmpegEnv?: NodeJS.ProcessEnv;
}

export const GITHUB_MAX_BYTES = 50 * 1024 * 1024;

const ouc = (root: string, f: string) => join(root, ".ouc", f);
const readJson = <T>(p: string, fallback: T): T => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; } };

/** Saves a status without running (a run that couldn't start: no setup, no sign-in). */
export function failedStatus(root: string, error: string, now = new Date()): BackupStatus {
  const prev = readJson<Partial<BackupStatus>>(ouc(root, "backup-status.json"), {});
  const status: BackupStatus = { ok: false, target: prev.target, at: now.toISOString(), summary: "", files: 0, bytes: 0, error, lastGood: prev.ok ? prev.at : prev.lastGood };
  mkdirSync(join(root, ".ouc"), { recursive: true });
  writeFileSync(ouc(root, "backup-status.json"), `${JSON.stringify(status, null, 2)}\n`);
  return status;
}

export async function runBackup(o: RunOptions): Promise<BackupStatus> {
  const at = (o.now ?? new Date()).toISOString();
  const { files } = selectFiles(o.root, { courseFiles: o.courseFiles, videos: o.videos });
  const last = readJson<FileEntry[]>(ouc(o.root, "backup-manifest.json"), []);
  const summary = summarize(diffFiles(last, files));
  const target = o.drive ? "drive" as const : "github" as const;
  const base = { target, at, summary, files: files.length, bytes: files.reduce((n, f) => n + f.size, 0) };
  let status: BackupStatus;
  try {
    const sources = await prepareSources(o.root, files.map((f) => f.path), { maxBytes: o.drive ? undefined : o.maxBytes ?? GITHUB_MAX_BYTES, ffmpeg: o.ffmpeg ?? null, env: o.ffmpegEnv });
    const paths = sources.map((s) => s.path);
    const from = Object.fromEntries(sources.filter((s) => s.from !== join(o.root, s.path)).map((s) => [s.path, s.from]));
    if (o.drive) await driveBackup({ root: o.root, accessToken: o.drive.accessToken, api: o.drive.api, files: paths, from });
    else if (o.remote) await gitBackup({ root: o.root, gitDir: ouc(o.root, "backup.git"), remote: o.remote, message: summary, env: o.env, files: paths, from });
    else throw new Error("No backup target.");
    writeFileSync(ouc(o.root, "backup-manifest.json"), JSON.stringify(files));
    status = { ok: true, ...base };
  } catch (e) {
    const prev = readJson<Partial<BackupStatus>>(ouc(o.root, "backup-status.json"), {});
    status = { ok: false, ...base, error: (e as Error).message, lastGood: prev.ok ? prev.at : prev.lastGood };
  }
  mkdirSync(join(o.root, ".ouc"), { recursive: true });
  writeFileSync(ouc(o.root, "backup-status.json"), `${JSON.stringify(status, null, 2)}\n`);
  return status;
}
