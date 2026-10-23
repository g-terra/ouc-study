/**
 * "Back up now" (the Settings button, the automatic run after a sync, `ouc backup`): reads
 * .ouc/backup.json and runs one backup to the private GitHub repo. One run at a time per folder.
 * `restoreNow` (`ouc backup restore`, `ouc setup`) gets the backup back; a backup waits for it.
 */
import { loadBackupConfig } from "./config.ts";
import { gitAuthEnv, githubRemote } from "./github.ts";
import { githubFiles, restoreFiles, type RestoreOptions, type RestoreResult } from "./restore.ts";
import { failedStatus, runBackup, type BackupStatus } from "./run.ts";
import type { BackupProgress } from "./progress.ts";

export interface NowOptions {
  ffmpeg?: string | null;
  onProgress?: (p: BackupProgress) => void;
}

const running = new Map<string, Promise<BackupStatus>>();
const progress = new Map<string, BackupProgress>();
const restoring = new Map<string, Promise<unknown>>();

export function backupRunning(root: string) { return running.has(root); }
/** How far the backup that's running has got (null when none is). */
export function backupProgress(root: string) { return progress.get(root) ?? null; }

export function backupNow(root: string, o: NowOptions = {}): Promise<BackupStatus> {
  const busy = running.get(root);
  if (busy) return busy;
  const run = (async () => {
    await restoring.get(root);
    const cfg = loadBackupConfig(root);
    if (!cfg) return failedStatus(root, "Backup isn't set up yet. Set it up in Settings › Backup.");
    const onProgress = (p: BackupProgress) => { progress.set(root, p); o.onProgress?.(p); };
    const choices = { courseFiles: cfg.courseFiles, videos: cfg.videos, ffmpeg: o.ffmpeg ?? null, onProgress };
    return runBackup({ root, ...choices, remote: cfg.remote ?? githubRemote(cfg.repo), env: gitAuthEnv(cfg.token) });
  })().finally(() => { running.delete(root); progress.delete(root); });
  running.set(root, run);
  return run;
}

/** Restores the saved backup into `root`; `error` when there's no setup or it couldn't be reached. */
export function restoreNow(root: string, o: NowOptions & RestoreOptions = {}): Promise<{ result?: RestoreResult; error?: string }> {
  const run = (async () => {
    await running.get(root)?.catch(() => {});
    const cfg = loadBackupConfig(root);
    if (!cfg) return { error: "Backup isn't set up yet. Set it up first (ouc backup setup)." };
    try {
      const files = await githubFiles({ root, remote: cfg.remote ?? githubRemote(cfg.repo), env: gitAuthEnv(cfg.token) });
      return { result: await restoreFiles(root, files, o) };
    } catch (e) { return { error: (e as Error).message }; }
  })().finally(() => restoring.delete(root));
  restoring.set(root, run);
  return run;
}
