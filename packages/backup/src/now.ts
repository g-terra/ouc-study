/**
 * "Back up now" (the Settings button, the automatic run after a sync, `ouc backup`): reads
 * .ouc/backup.json, signs in to the chosen target and runs one backup. One run at a time per folder.
 * `restoreNow` (`ouc backup restore`, `ouc setup`) gets the backup back; a backup waits for it.
 */
import { loadBackupConfig } from "./config.ts";
import { driveFiles, refreshAccess } from "./drive.ts";
import { gitAuthEnv, githubRemote } from "./github.ts";
import { githubFiles, restoreFiles, type RestoreOptions, type RestoreResult } from "./restore.ts";
import { failedStatus, runBackup, type BackupStatus } from "./run.ts";

export interface NowOptions {
  /** the Google Cloud OAuth client (Drive) */
  google?: { clientId: string; clientSecret: string } | null;
  ffmpeg?: string | null;
  tokenUrl?: string;
  driveApi?: string;
}

const running = new Map<string, Promise<BackupStatus>>();
const restoring = new Map<string, Promise<unknown>>();

export function backupRunning(root: string) { return running.has(root); }

export function backupNow(root: string, o: NowOptions = {}): Promise<BackupStatus> {
  const busy = running.get(root);
  if (busy) return busy;
  const run = (async () => {
    await restoring.get(root);
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

/** Restores the saved backup into `root`; `error` when there's no setup or it couldn't be reached. */
export function restoreNow(root: string, o: NowOptions & RestoreOptions = {}): Promise<{ result?: RestoreResult; error?: string }> {
  const run = (async () => {
    await running.get(root)?.catch(() => {});
    const cfg = loadBackupConfig(root);
    if (!cfg) return { error: "Backup isn't set up yet. Set it up first (ouc backup setup)." };
    try {
      if (cfg.target === "github") {
        const files = await githubFiles({ root, remote: cfg.remote ?? githubRemote(cfg.repo), env: gitAuthEnv(cfg.token) });
        return { result: await restoreFiles(root, files, o) };
      }
      if (!o.google) return { error: "Google Drive isn't available in this version of the app." };
      const accessToken = await refreshAccess({ ...o.google, refreshToken: cfg.refreshToken, tokenUrl: o.tokenUrl });
      const listing = await driveFiles({ root, accessToken, api: o.driveApi });
      const result = await restoreFiles(root, listing.files, o);
      listing.remember(result);
      return { result };
    } catch (e) { return { error: (e as Error).message }; }
  })().finally(() => restoring.delete(root));
  restoring.set(root, run);
  return run;
}
