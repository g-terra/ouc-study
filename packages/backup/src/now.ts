/**
 * "Back up now" (the Settings button, the automatic run after a sync, `ouc backup`): reads
 * .ouc/backup.json, signs in to the chosen target and runs one backup. One run at a time per folder.
 */
import { loadBackupConfig } from "./config.ts";
import { refreshAccess } from "./drive.ts";
import { gitAuthEnv, githubRemote } from "./github.ts";
import { failedStatus, runBackup, type BackupStatus } from "./run.ts";

export interface NowOptions {
  /** the Google Cloud OAuth client (Drive) */
  google?: { clientId: string; clientSecret: string } | null;
  ffmpeg?: string | null;
  tokenUrl?: string;
  driveApi?: string;
}

const running = new Map<string, Promise<BackupStatus>>();

export function backupRunning(root: string) { return running.has(root); }

export function backupNow(root: string, o: NowOptions = {}): Promise<BackupStatus> {
  const busy = running.get(root);
  if (busy) return busy;
  const run = (async () => {
    const cfg = loadBackupConfig(root);
    if (!cfg) return failedStatus(root, "Backup isn't set up yet. Set it up in Settings › Backup.");
    const choices = { courseFiles: cfg.courseFiles, videos: cfg.videos, ffmpeg: o.ffmpeg ?? null };
    if (cfg.target === "github") return runBackup({ root, ...choices, remote: cfg.remote ?? githubRemote(cfg.repo), env: gitAuthEnv(cfg.token) });
    if (!o.google) return failedStatus(root, "Google Drive isn't available in this version of the app.");
    let accessToken: string;
    try { accessToken = await refreshAccess({ ...o.google, refreshToken: cfg.refreshToken, tokenUrl: o.tokenUrl }); }
    catch (e) { return failedStatus(root, (e as Error).message); }
    return runBackup({ root, ...choices, drive: { accessToken, api: o.driveApi } });
  })().finally(() => running.delete(root));
  running.set(root, run);
  return run;
}
