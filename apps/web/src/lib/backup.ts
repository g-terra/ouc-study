/** Settings › Backup and the one-time prompt: /api/backup (packages/backup/src/api.ts) and the words for its status. */
import type { BackupProgress } from "@ouc/backup/progress";
import { daysBetween, fmtShort, fmtTime } from "./dates.ts";

export interface BackupStatus { ok: boolean; target?: "github"; at: string; summary: string; files: number; bytes: number; error?: string; lastGood?: string }
export interface BackupInfo {
  setup: null | { target: "github"; repo: string; login: string };
  choices: { auto: boolean; courseFiles: boolean; videos: boolean };
  status: BackupStatus | null;
  running: boolean;
  /** how far the running backup has got */
  progress?: BackupProgress | null;
  prompt: "show" | "hide";
  signIn: null | { kind: "github"; userCode?: string; verificationUri?: string; error?: string };
  can: { githubDevice: boolean };
}

export function backupWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = daysBetween(d, now);
  return days === 0 ? `today ${fmtTime(d)}` : days === 1 ? `yesterday ${fmtTime(d)}` : fmtShort(d);
}

export function fileSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function statusLine(s: BackupStatus | null, now = new Date()): string {
  if (!s) return "Not backed up yet";
  if (s.ok) return `Backed up ${backupWhen(s.at, now)} · ${s.files.toLocaleString("en-GB")} files · ${fileSize(s.bytes)}`;
  return `The last backup didn't work: ${s.error ?? "unknown error"}${s.lastGood ? ` The last good one was ${backupWhen(s.lastGood, now)}.` : ""}`;
}

export const getBackup = (): Promise<BackupInfo | null> => fetch("/api/backup").then((r) => (r.ok ? r.json() : null)).catch(() => null);
export async function postBackup(path: string, body?: unknown): Promise<{ error?: string } & Record<string, unknown>> {
  const r = await fetch(`/api/backup/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
  if (!r) return { error: "The app didn't answer." };
  return r.json().catch(() => ({ error: `The app didn't answer (${r.status}).` }));
}
